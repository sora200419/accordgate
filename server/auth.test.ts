// S1 tests: owner wallet sign-in, owner-only routes, agent requests must carry their own signature.
// Runs a real Express app on an ephemeral port with a temp state file, a fixed clock and a fake
// account-key lookup (no network). Run with `npm test`.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { Server } from 'node:http';
import { AccountAddress, buildBasicAccountSigner, signMessage } from '@concordium/web-sdk';
import { AccountNotFoundError, CHALLENGE_TTL_MS, OWNER_ROUTES, SESSION_TTL_MS } from './auth.ts';
import type { AccountInfoLookup } from './auth.ts';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accordgate-test-'));
process.env.ACCORDGATE_DB_PATH = path.join(tmpDir, 'gateway-state.json');

const FIXED_START = Date.parse('2030-01-01T00:00:00.000Z');
let clock = FIXED_START;

function makeAccount() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privHex = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('hex');
  const pubHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const address = AccountAddress.fromBuffer(new Uint8Array(crypto.randomBytes(32)).buffer);
  return { address, base58: address.address, privHex, pubHex };
}

const owner = makeAccount();
const stranger = makeAccount();
const otherKey = makeAccount();

let lookupMode: 'ok' | 'not-found' | 'fail' = 'ok';
let lookupCalls = 0;
const fakeLookup: AccountInfoLookup = async (address) => {
  lookupCalls++;
  if (lookupMode === 'not-found') throw new AccountNotFoundError('not found');
  if (lookupMode === 'fail') throw new Error('UNAVAILABLE: node unreachable\nsecret-detail');
  const acc = [owner, stranger].find((a) => a.base58 === address.address);
  if (!acc) throw new AccountNotFoundError('not found');
  return {
    accountAddress: acc.address,
    accountThreshold: 1,
    accountCredentials: {
      0: { value: { contents: { credentialPublicKeys: { threshold: 1, keys: { 0: { schemeId: 'Ed25519', verifyKey: acc.pubHex } } } } } },
    },
  } as unknown as Awaited<ReturnType<AccountInfoLookup>>;
};

type CreateApp = typeof import('../server.ts').createApp;
let createApp: CreateApp;
let resetDatabase: () => unknown;

async function startApp(ownerAccounts: string[], extra: { agentNoncePerAgentCap?: number } = {}) {
  const app = createApp({ ownerAccounts, getAccountInfo: fakeLookup, now: () => clock, ...extra });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { app, server, base };
}

// Raw HTTP/1.1 client used only for /api/mcp. On the dev machine where these tests were written, local
// software rewrites loopback responses for any path ending in "/mcp" (adds `transfer-encoding: chunked`,
// drops Content-Length; reproduced with a plain Python server, so it is not this app). fetch rejects
// those responses, so MCP calls read the body until the server closes the connection instead.
async function rawCall(base: string, url: string, body: unknown, headers: Record<string, string>) {
  const { hostname, port } = new URL(base);
  const payload = JSON.stringify(body);
  const raw: string = await new Promise((resolve, reject) => {
    let data = '';
    const sock = net.connect(Number(port), hostname, () => {
      const extra = Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}\r\n`)
        .join('');
      sock.write(
        `POST ${url} HTTP/1.1\r\nHost: ${hostname}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n${extra}\r\n${payload}`,
      );
    });
    sock.setTimeout(10_000, () => sock.destroy(new Error('raw MCP call timed out')));
    sock.on('data', (c) => (data += c.toString('utf8')));
    sock.on('end', () => resolve(data));
    sock.on('error', reject);
  });
  const sep = raw.indexOf('\r\n\r\n');
  const status = Number(raw.slice(0, sep).split(' ')[1]);
  return { status, json: JSON.parse(raw.slice(sep + 4)), setCookie: null };
}

async function call(base: string, method: string, url: string, opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  if (url === '/api/mcp') return rawCall(base, url, opts.body, opts.headers ?? {});
  const res = await fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
}

async function challenge(base: string, account = owner) {
  return call(base, 'POST', '/api/auth/challenge', { body: { accountAddress: account.base58 } });
}

async function sign(message: string, signer = owner, as = owner) {
  return signMessage(as.address, message, buildBasicAccountSigner(signer.privHex));
}

function cookieFrom(setCookie: string | null): string {
  assert.ok(setCookie, 'expected a Set-Cookie header');
  return setCookie.split(';')[0];
}

async function signIn(base: string): Promise<string> {
  const ch = await challenge(base);
  assert.equal(ch.status, 200);
  const signature = await sign(ch.json.message);
  const v = await call(base, 'POST', '/api/auth/verify', {
    body: { accountAddress: owner.base58, nonce: ch.json.nonce, signature },
  });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  return cookieFrom(v.setCookie);
}

function concretePath(p: string) {
  return p.replace(/:id/g, 'x-test-id');
}

before(async () => {
  ({ createApp } = await import('../server.ts'));
  ({ resetDatabase } = await import('./store.ts'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  clock = FIXED_START;
  lookupMode = 'ok';
  lookupCalls = 0;
  resetDatabase();
});

describe('owner-only routes', () => {
  let ctx: Awaited<ReturnType<typeof startApp>>;
  before(async () => {
    ctx = await startApp([owner.base58]);
  });
  after(() => ctx.server.close());

  test('every OWNER_ROUTES entry returns 401 without a session', async () => {
    for (const r of OWNER_ROUTES) {
      const res = await call(ctx.base, r.method, concretePath(r.path), { body: {} });
      assert.equal(res.status, 401, `${r.method} ${r.path} should need a session`);
    }
  });

  test('case and trailing-slash variants of every owner route also need a session', async () => {
    for (const r of OWNER_ROUTES) {
      const p = concretePath(r.path);
      const variants = [p.toUpperCase(), p.replace('/api/', '/Api/'), p + '/', p.toUpperCase() + '/'];
      for (const v of variants) {
        const res = await call(ctx.base, r.method, v, { body: {} });
        assert.ok(res.status === 401 || res.status === 404, `${r.method} ${v} returned ${res.status}`);
      }
    }
  });

  test('every registered state-changing route is owner-only or on the public list', () => {
    const PUBLIC_NON_GET = new Set([
      'POST /api/auth/challenge',
      'POST /api/auth/verify',
      'POST /api/auth/logout',
      'POST /api/gateway/invoke', // agent signature required
      'POST /api/mcp', // tools/call needs agent signature
      'POST /api/testnet/probe', // read-only gRPC query
      'POST /api/testnet/inspect', // read-only gRPC query
    ]);
    const owned = new Set(OWNER_ROUTES.map((r) => `${r.method} ${r.path}`));
    const found: string[] = [];
    const walk = (stack: any[]) => {
      for (const layer of stack) {
        if (layer.route) {
          for (const m of Object.keys(layer.route.methods)) {
            if (m !== 'get') found.push(`${m.toUpperCase()} ${layer.route.path}`);
          }
        } else if (layer.handle?.stack) {
          walk(layer.handle.stack);
        }
      }
    };
    walk((ctx.app as any)._router.stack);
    assert.ok(found.length >= 20, `expected to find the API routes, found ${found.length}`);
    for (const key of found) {
      assert.ok(owned.has(key) || PUBLIC_NON_GET.has(key), `${key} is neither owner-only nor on the public list`);
    }
  });

  test('signed-in owner can call an owner route; /me returns the account', async () => {
    const anon = await call(ctx.base, 'GET', '/api/auth/me');
    assert.equal(anon.status, 200);
    assert.equal(anon.json.account, null);
    const cookie = await signIn(ctx.base);
    const me = await call(ctx.base, 'GET', '/api/auth/me', { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.json.account, owner.base58);
    const reset = await call(ctx.base, 'POST', '/api/sandbox/reset', { cookie });
    assert.equal(reset.status, 200);
    assert.equal(reset.json.status, 'reset');
  });

  test('replayed nonce is rejected', async () => {
    const ch = await challenge(ctx.base);
    const signature = await sign(ch.json.message);
    const body = { accountAddress: owner.base58, nonce: ch.json.nonce, signature };
    assert.equal((await call(ctx.base, 'POST', '/api/auth/verify', { body })).status, 200);
    assert.equal((await call(ctx.base, 'POST', '/api/auth/verify', { body })).status, 401);
  });

  test('two concurrent verifies with one nonce: exactly one succeeds', async () => {
    const ch = await challenge(ctx.base);
    const signature = await sign(ch.json.message);
    const body = { accountAddress: owner.base58, nonce: ch.json.nonce, signature };
    const results = await Promise.all([
      call(ctx.base, 'POST', '/api/auth/verify', { body }),
      call(ctx.base, 'POST', '/api/auth/verify', { body }),
      call(ctx.base, 'POST', '/api/auth/verify', { body }),
    ]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
  });

  test('expired challenge is rejected', async () => {
    const ch = await challenge(ctx.base);
    const signature = await sign(ch.json.message);
    clock += CHALLENGE_TTL_MS + 1;
    const v = await call(ctx.base, 'POST', '/api/auth/verify', {
      body: { accountAddress: owner.base58, nonce: ch.json.nonce, signature },
    });
    assert.equal(v.status, 401);
  });

  test('expired session and logged-out session are rejected', async () => {
    const cookie = await signIn(ctx.base);
    clock += SESSION_TTL_MS + 1;
    assert.equal((await call(ctx.base, 'POST', '/api/sandbox/reset', { cookie })).status, 401);

    clock = FIXED_START;
    const cookie2 = await signIn(ctx.base);
    assert.equal((await call(ctx.base, 'POST', '/api/auth/logout', { cookie: cookie2 })).status, 200);
    assert.equal((await call(ctx.base, 'POST', '/api/sandbox/reset', { cookie: cookie2 })).status, 401);
  });

  test('a made-up session cookie is rejected', async () => {
    const res = await call(ctx.base, 'POST', '/api/sandbox/reset', { cookie: 'ag_session=' + 'a'.repeat(64) });
    assert.equal(res.status, 401);
  });

  test('a flood of challenges cannot lock the owner out', async () => {
    for (let i = 0; i < 1100; i++) {
      assert.equal((await challenge(ctx.base)).status, 200);
    }
    const cookie = await signIn(ctx.base);
    assert.equal((await call(ctx.base, 'GET', '/api/auth/me', { cookie })).json.account, owner.base58);
  });

  test('challenges requested after the owner\'s cannot invalidate it', async () => {
    const mine = await challenge(ctx.base);
    for (let i = 0; i < 50; i++) await challenge(ctx.base);
    const v = await call(ctx.base, 'POST', '/api/auth/verify', {
      body: { accountAddress: owner.base58, nonce: mine.json.nonce, signature: await sign(mine.json.message) },
    });
    assert.equal(v.status, 200, JSON.stringify(v.json));
  });

  test('a nonce that was not issued by the server is rejected', async () => {
    const ch = await challenge(ctx.base);
    const forgedNonce = ch.json.nonce.replace(/^[0-9a-f]/, (c: string) => (c === '0' ? '1' : '0'));
    const forgedMessage = ch.json.message.replace(ch.json.nonce, forgedNonce);
    const v = await call(ctx.base, 'POST', '/api/auth/verify', {
      body: { accountAddress: owner.base58, nonce: forgedNonce, signature: await sign(forgedMessage) },
    });
    assert.equal(v.status, 401);
  });

  test('non-owner account cannot get a challenge', async () => {
    const ch = await challenge(ctx.base, stranger);
    assert.equal(ch.status, 403);
  });

  test('signature from a different key is rejected', async () => {
    const ch = await challenge(ctx.base);
    const signature = await sign(ch.json.message, otherKey, owner);
    const v = await call(ctx.base, 'POST', '/api/auth/verify', {
      body: { accountAddress: owner.base58, nonce: ch.json.nonce, signature },
    });
    assert.equal(v.status, 401);
    assert.equal(v.setCookie, null);
  });

  test('signature over a different message is rejected', async () => {
    const ch = await challenge(ctx.base);
    const signature = await sign(ch.json.message.replace(ch.json.nonce, 'f'.repeat(64)));
    const v = await call(ctx.base, 'POST', '/api/auth/verify', {
      body: { accountAddress: owner.base58, nonce: ch.json.nonce, signature },
    });
    assert.equal(v.status, 401);
  });

  test('signature naming a credential the account does not have is rejected', async () => {
    const ch = await challenge(ctx.base);
    const signature = await sign(ch.json.message);
    const v = await call(ctx.base, 'POST', '/api/auth/verify', {
      body: { accountAddress: owner.base58, nonce: ch.json.nonce, signature: { 7: signature[0] } },
    });
    assert.equal(v.status, 401);
  });

  test('account lookup failure gives a clear 502 and no session; not-found gives 401', async () => {
    lookupMode = 'fail';
    const ch = await challenge(ctx.base);
    const signature = await sign(ch.json.message);
    const v = await call(ctx.base, 'POST', '/api/auth/verify', {
      body: { accountAddress: owner.base58, nonce: ch.json.nonce, signature },
    });
    assert.equal(v.status, 502);
    assert.match(v.json.error, /UNAVAILABLE: node unreachable/);
    assert.doesNotMatch(v.json.error, /secret-detail/);
    assert.equal(v.setCookie, null);
    assert.equal(lookupCalls, 3, 'transport errors are retried 3 times');

    lookupMode = 'not-found';
    lookupCalls = 0;
    const ch2 = await challenge(ctx.base);
    const v2 = await call(ctx.base, 'POST', '/api/auth/verify', {
      body: { accountAddress: owner.base58, nonce: ch2.json.nonce, signature: await sign(ch2.json.message) },
    });
    assert.equal(v2.status, 401);
    assert.equal(lookupCalls, 1, 'not-found is not retried');
  });

  test('GET /api/webhooks never returns the full signing secret; creation returns it once', async () => {
    const cookie = await signIn(ctx.base);
    const created = await call(ctx.base, 'POST', '/api/webhooks', {
      cookie,
      body: { label: 'test', url: 'https://example.invalid/hook' },
    });
    assert.equal(created.status, 201);
    const fullSecret: string = created.json.webhook.signingSecretPreview;
    assert.match(fullSecret, /^whsec_[0-9a-f]{12}$/);
    const list = await call(ctx.base, 'GET', '/api/webhooks');
    assert.equal(list.status, 200);
    const text = JSON.stringify(list.json);
    assert.ok(!text.includes(fullSecret), 'full secret must not be listed');
    for (const wh of list.json.webhooks) {
      assert.match(wh.signingSecretPreview, /^(whsec_…[0-9a-f]{4})?$/);
    }
  });
});

describe('owner sign-in not configured', () => {
  test('owner routes and challenge return 503 when OWNER_ACCOUNTS is empty', async () => {
    const ctx = await startApp([]);
    try {
      assert.equal((await call(ctx.base, 'POST', '/api/sandbox/reset')).status, 503);
      assert.equal((await challenge(ctx.base)).status, 503);
    } finally {
      ctx.server.close();
    }
  });
});

describe('agent requests must carry their own signature', () => {
  let ctx: Awaited<ReturnType<typeof startApp>>;
  let agent: { did: string; cardHash: string };
  const restEndpoint = '/api/rest/age-gated-research';
  const mcpTool = 'eu-sanctions-screen';

  before(async () => {
    ctx = await startApp([owner.base58]);
  });
  after(() => ctx.server.close());

  beforeEach(async () => {
    const agents = await call(ctx.base, 'GET', '/api/agents');
    const active = agents.json.agents.find((a: any) => a.status === 'active');
    assert.ok(active, 'seed has an active agent');
    agent = { did: active.did, cardHash: active.cardHash };
  });

  function agentHeaders(extra: Record<string, string> = {}) {
    return { 'X-Concordium-Agent-DID': agent.did, 'X-Agent-Card-Hash': agent.cardHash, ...extra };
  }

  test('gateway invoke without a signature is 401', async () => {
    const res = await call(ctx.base, 'POST', '/api/gateway/invoke', {
      headers: agentHeaders(),
      body: { endpointPath: restEndpoint },
    });
    assert.equal(res.status, 401);
  });

  test('MCP tools/call without a signature or DID is 401', async () => {
    const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: mcpTool, arguments: {} } };
    assert.equal((await call(ctx.base, 'POST', '/api/mcp', { headers: agentHeaders(), body: rpc })).status, 401);
    assert.equal((await call(ctx.base, 'POST', '/api/mcp', { body: rpc })).status, 401);
    const list = await call(ctx.base, 'POST', '/api/mcp', { body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
    assert.equal(list.status, 200, 'tools/list stays open');
  });

  test('a forged signature fails the signature step', async () => {
    const res = await call(ctx.base, 'POST', '/api/gateway/invoke', {
      headers: agentHeaders({ 'X-Agent-Signature': '00'.repeat(64), 'X-Agent-Timestamp': new Date(clock).toISOString(), 'X-Agent-Nonce': crypto.randomUUID() }),
      body: { endpointPath: restEndpoint },
    });
    const sigStep = res.json.traces?.find((t: any) => t.key === 'signature');
    assert.equal(sigStep?.status, 'failed');
  });

  test('anonymous forged or tampered requests cannot suspend an agent', async () => {
    const beforeList = await call(ctx.base, 'GET', '/api/agents');
    const beforeViolations = beforeList.json.agents.find((a: any) => a.did === agent.did).consecutiveViolations ?? 0;
    for (let i = 0; i < 5; i++) {
      await call(ctx.base, 'POST', '/api/gateway/invoke', {
        headers: agentHeaders({ 'X-Agent-Signature': '00'.repeat(64), 'X-Agent-Timestamp': new Date(clock).toISOString(), 'X-Agent-Nonce': crypto.randomUUID() }),
        body: { endpointPath: restEndpoint },
      });
      await call(ctx.base, 'POST', '/api/gateway/invoke', {
        headers: agentHeaders({
          'X-Agent-Card-Hash': 'tampered_0000000000000000',
          'X-Agent-Signature': '00'.repeat(64),
          'X-Agent-Timestamp': new Date(clock).toISOString(), 'X-Agent-Nonce': crypto.randomUUID(),
        }),
        body: { endpointPath: restEndpoint },
      });
    }
    const agents = await call(ctx.base, 'GET', '/api/agents');
    const after = agents.json.agents.find((a: any) => a.did === agent.did);
    assert.equal(after.status, 'active');
    assert.equal(after.consecutiveViolations ?? 0, beforeViolations);
  });

  test('a valid agent signature passes the signature step (gateway and MCP)', async () => {
    const cookie = await signIn(ctx.base);
    const signed = await call(ctx.base, 'POST', '/api/sandbox/sign', {
      cookie,
      body: { agentDid: agent.did, endpointPath: restEndpoint },
    });
    assert.equal(signed.status, 200);
    const res = await call(ctx.base, 'POST', '/api/gateway/invoke', {
      headers: agentHeaders({
        'X-Agent-Signature': signed.json.signatureHex,
        'X-Agent-Timestamp': signed.json.timestamp,
        'X-Agent-Nonce': signed.json.nonce,
      }),
      body: { endpointPath: restEndpoint },
    });
    assert.equal(res.json.traces?.find((t: any) => t.key === 'signature')?.status, 'passed');

    const mcpSigned = await call(ctx.base, 'POST', '/api/sandbox/sign', {
      cookie,
      body: { agentDid: agent.did, endpointPath: `/api/mcp/${mcpTool}` },
    });
    const mcp = await call(ctx.base, 'POST', '/api/mcp', {
      headers: agentHeaders({
        'X-Agent-Signature': mcpSigned.json.signatureHex,
        'X-Agent-Timestamp': mcpSigned.json.timestamp,
        'X-Agent-Nonce': mcpSigned.json.nonce,
      }),
      body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: mcpTool, arguments: {} } },
    });
    const traces = mcp.json.result?.accordGateTrace ?? mcp.json.error?.data?.traces;
    assert.equal(traces?.find((t: any) => t.key === 'signature')?.status, 'passed', JSON.stringify(mcp.json));
  });

  test('owner sandbox probe may still let the server sign', async () => {
    const cookie = await signIn(ctx.base);
    const res = await call(ctx.base, 'POST', '/api/sandbox/probe', {
      cookie,
      body: { agentDid: agent.did, endpointPath: restEndpoint, jurisdictionClaim: 'EU', ageClaim: 30, principalVerifiedClaim: true },
    });
    assert.equal(res.json.traces?.find((t: any) => t.key === 'signature')?.status, 'passed');
  });
});

describe('S7: agent request freshness (timestamp window + single-use nonce)', () => {
  // Signs locally with the agent's seeded key, like a real agent would (no server help).
  const restEndpoint = '/api/rest/age-gated-research';
  const mcpTool = 'eu-sanctions-screen';
  const mcpEndpoint = `/api/mcp/${mcpTool}`;
  type SeedAgent = { did: string; cardHash: string; pem: string };
  let agents: SeedAgent[];

  async function loadAgents(): Promise<SeedAgent[]> {
    const { loadDatabase } = await import('./store.ts');
    const db = loadDatabase();
    const active = db.agents.filter((a) => a.status === 'active' && db.proverKeys[a.did]);
    assert.ok(active.length >= 2, 'seed has two active agents with keys');
    return active.map((a) => ({ did: a.did, cardHash: a.cardHash, pem: db.proverKeys[a.did] }));
  }

  async function signedHeaders(a: SeedAgent, endpointPath: string, tsMs = clock, nonce: string = crypto.randomUUID()) {
    const { signAgentRequest } = await import('./crypto.ts');
    const timestamp = new Date(tsMs).toISOString();
    return {
      'X-Concordium-Agent-DID': a.did,
      'X-Agent-Card-Hash': a.cardHash,
      'X-Agent-Timestamp': timestamp,
      'X-Agent-Nonce': nonce,
      'X-Agent-Signature': signAgentRequest(a.pem, `${a.did}|${endpointPath}|${timestamp}|${nonce}|${a.cardHash}`),
    };
  }

  const invoke = (base: string, headers: Record<string, string>) =>
    call(base, 'POST', '/api/gateway/invoke', { headers, body: { endpointPath: restEndpoint } });
  const mcpCall = (base: string, headers: Record<string, string>) =>
    call(base, 'POST', '/api/mcp', {
      headers,
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: mcpTool, arguments: {} } },
    });
  const step = (res: { json: any }, key: string) => {
    const traces = res.json?.traces ?? res.json?.result?.accordGateTrace ?? res.json?.error?.data?.traces;
    return traces?.find((t: any) => t.key === key);
  };
  const outcome = (res: { json: any }) => res.json?.outcome ?? res.json?.error?.data?.outcome;

  describe('default cap', () => {
    let ctx: Awaited<ReturnType<typeof startApp>>;
    before(async () => {
      clock = FIXED_START;
      ctx = await startApp([owner.base58]);
    });
    after(() => ctx.server.close());
    beforeEach(async () => {
      agents = await loadAgents();
    });

    test('a missing X-Agent-Nonce is 401 on REST and MCP', async () => {
      const h: Record<string, string> = await signedHeaders(agents[0], restEndpoint);
      delete h['X-Agent-Nonce'];
      assert.equal((await invoke(ctx.base, h)).status, 401);
      const m: Record<string, string> = await signedHeaders(agents[0], mcpEndpoint);
      delete m['X-Agent-Nonce'];
      assert.equal((await mcpCall(ctx.base, m)).status, 401);
    });

    test('replay of the same signed request is blocked (REST and MCP)', async () => {
      const h = await signedHeaders(agents[0], restEndpoint);
      const first = await invoke(ctx.base, h);
      assert.equal(step(first, 'freshness')?.status, 'passed', JSON.stringify(first.json));
      const replay = await invoke(ctx.base, h);
      assert.equal(replay.status, 403);
      assert.equal(replay.json.outcome, 'BLOCKED_REPLAYED');
      assert.equal(step(replay, 'freshness')?.status, 'failed');

      const m = await signedHeaders(agents[0], mcpEndpoint);
      assert.equal(step(await mcpCall(ctx.base, m), 'freshness')?.status, 'passed');
      const mReplay = await mcpCall(ctx.base, m);
      assert.equal(mReplay.status, 403);
      assert.equal(outcome(mReplay), 'BLOCKED_REPLAYED');

      // REST headers replayed against MCP: the signed string names the endpoint, so the signature fails.
      const cross = await mcpCall(ctx.base, h);
      assert.equal(step(cross, 'signature')?.status, 'failed');
    });

    test('a stale timestamp is blocked; one at the window edge passes', async () => {
      clock = FIXED_START + 10 * 60_000;
      const edge = await invoke(ctx.base, await signedHeaders(agents[0], restEndpoint, clock - 120_000));
      assert.equal(step(edge, 'freshness')?.status, 'passed', JSON.stringify(edge.json));
      const stale = await invoke(ctx.base, await signedHeaders(agents[0], restEndpoint, clock - 120_001));
      assert.equal(stale.status, 403);
      assert.equal(stale.json.outcome, 'BLOCKED_STALE_REQUEST');
      assert.equal(stale.json.traces.find((t: any) => t.key === 'freshness')?.metadata?.reason, 'stale');
    });

    test('a captured request replayed after the window is blocked as stale', async () => {
      const h = await signedHeaders(agents[0], restEndpoint);
      assert.equal(step(await invoke(ctx.base, h), 'freshness')?.status, 'passed');
      clock += 120_001;
      const late = await invoke(ctx.base, h);
      assert.equal(late.json.outcome, 'BLOCKED_STALE_REQUEST');
    });

    test('a future timestamp beyond 30 s is blocked; 30 s ahead passes', async () => {
      const ok = await invoke(ctx.base, await signedHeaders(agents[0], restEndpoint, clock + 30_000));
      assert.equal(step(ok, 'freshness')?.status, 'passed', JSON.stringify(ok.json));
      const future = await invoke(ctx.base, await signedHeaders(agents[0], restEndpoint, clock + 30_001));
      assert.equal(future.status, 403);
      assert.equal(future.json.outcome, 'BLOCKED_STALE_REQUEST');
      assert.equal(future.json.traces.find((t: any) => t.key === 'freshness')?.metadata?.reason, 'future');
    });

    test('20 concurrent copies of one signed request: exactly one passes', async () => {
      const h = await signedHeaders(agents[0], restEndpoint);
      const results = await Promise.all(Array.from({ length: 20 }, () => invoke(ctx.base, h)));
      const passed = results.filter((r) => step(r, 'freshness')?.status === 'passed');
      const replayed = results.filter((r) => r.json.outcome === 'BLOCKED_REPLAYED');
      assert.equal(passed.length, 1);
      assert.equal(replayed.length, 19);
    });

    test('out-of-order arrival inside the window: newer then older both pass', async () => {
      clock = FIXED_START + 60_000;
      const older = await signedHeaders(agents[0], restEndpoint, clock - 20_000);
      const newer = await signedHeaders(agents[0], restEndpoint, clock - 5_000);
      assert.equal(step(await invoke(ctx.base, newer), 'freshness')?.status, 'passed');
      assert.equal(step(await invoke(ctx.base, older), 'freshness')?.status, 'passed');
      assert.equal((await invoke(ctx.base, newer)).json.outcome, 'BLOCKED_REPLAYED');
      assert.equal((await invoke(ctx.base, older)).json.outcome, 'BLOCKED_REPLAYED');
    });

    test('replayed and stale requests do not count toward the circuit breaker', async () => {
      const h = await signedHeaders(agents[0], restEndpoint);
      await invoke(ctx.base, h);
      for (let i = 0; i < 5; i++) await invoke(ctx.base, h);
      for (let i = 0; i < 5; i++) await invoke(ctx.base, await signedHeaders(agents[0], restEndpoint, clock + 60_000));
      const list = await call(ctx.base, 'GET', '/api/agents');
      const a = list.json.agents.find((x: any) => x.did === agents[0].did);
      assert.equal(a.status, 'active');
      assert.equal(a.consecutiveViolations ?? 0, 0);
    });

    test('owner sandbox sign + probe still pass the freshness step', async () => {
      const cookie = await signIn(ctx.base);
      const signed = await call(ctx.base, 'POST', '/api/sandbox/sign', {
        cookie,
        body: { agentDid: agents[0].did, endpointPath: restEndpoint },
      });
      assert.equal(signed.json.timestamp, new Date(clock).toISOString(), 'sandbox/sign uses the injected clock');
      const res = await invoke(ctx.base, {
        'X-Concordium-Agent-DID': agents[0].did,
        'X-Agent-Card-Hash': agents[0].cardHash,
        'X-Agent-Signature': signed.json.signatureHex,
        'X-Agent-Timestamp': signed.json.timestamp,
        'X-Agent-Nonce': signed.json.nonce,
      });
      assert.equal(step(res, 'freshness')?.status, 'passed', JSON.stringify(res.json));
      for (let i = 0; i < 2; i++) {
        const probe = await call(ctx.base, 'POST', '/api/sandbox/probe', {
          cookie,
          body: { agentDid: agents[0].did, endpointPath: restEndpoint, jurisdictionClaim: 'EU', ageClaim: 30, principalVerifiedClaim: true },
        });
        assert.equal(step(probe, 'freshness')?.status, 'passed', 'each probe gets a fresh nonce');
      }
    });
  });

  describe('flooding the nonce store', () => {
    const CAP = 5;
    const floodDids = new Set<string>();
    let ctx: Awaited<ReturnType<typeof startApp>>;
    before(async () => {
      clock = FIXED_START;
      ctx = await startApp([owner.base58], { agentNoncePerAgentCap: CAP });
    });
    after(() => ctx.server.close());
    beforeEach(async () => {
      agents = await loadAgents();
    });

    test('anonymous forged requests with random nonces add nothing: the agent still has its full quota', async () => {
      floodDids.add(agents[0].did);
      for (let i = 0; i < 300; i++) {
        const h = await signedHeaders(agents[0], restEndpoint);
        h['X-Agent-Signature'] = '00'.repeat(64);
        const r = await invoke(ctx.base, h);
        assert.equal(step(r, 'signature')?.status, 'failed');
      }
      for (let i = 0; i < CAP; i++) {
        const r = await invoke(ctx.base, await signedHeaders(agents[0], restEndpoint));
        assert.equal(step(r, 'freshness')?.status, 'passed', `valid request ${i} after the flood`);
      }
    });

    test('an agent that fills its cap gets 429; another agent is unaffected', async () => {
      // Both flood tests share one guard; isolation relies on resetDatabase() minting new DIDs per test.
      assert.ok(!floodDids.has(agents[0].did), 'agent DIDs differ from the previous flood test');
      for (let i = 0; i < CAP; i++) {
        assert.equal(step(await invoke(ctx.base, await signedHeaders(agents[0], restEndpoint)), 'freshness')?.status, 'passed');
      }
      const over = await invoke(ctx.base, await signedHeaders(agents[0], restEndpoint));
      assert.equal(over.status, 429);
      assert.equal(over.json.traces.find((t: any) => t.key === 'freshness')?.metadata?.reason, 'too-many');
      const other = await invoke(ctx.base, await signedHeaders(agents[1], restEndpoint));
      assert.equal(step(other, 'freshness')?.status, 'passed', JSON.stringify(other.json));
      // After the window the full agent recovers.
      clock += 120_001;
      const later = await invoke(ctx.base, await signedHeaders(agents[0], restEndpoint));
      assert.equal(step(later, 'freshness')?.status, 'passed');
    });
  });
});

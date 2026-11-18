// S1 tests: owner wallet sign-in, owner-only routes, agent requests must carry their own signature.
// Runs a real Express app on an ephemeral port with a temp state file, a fixed clock and a fake
// account-key lookup (no network). Run with `npm test`.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { Server } from 'node:http';
import { AccountAddress, BlockHash, buildBasicAccountSigner, signMessage } from '@concordium/web-sdk';
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

async function startApp(ownerAccounts: string[], extra: Partial<Parameters<CreateApp>[0]> = {}) {
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

async function signIn(base: string, as = owner): Promise<string> {
  const ch = await challenge(base, as);
  assert.equal(ch.status, 200);
  const signature = await sign(ch.json.message, as, as);
  const v = await call(base, 'POST', '/api/auth/verify', {
    body: { accountAddress: as.base58, nonce: ch.json.nonce, signature },
  });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  return cookieFrom(v.setCookie);
}

/** S10: the newest audit entry's hash and the range text the browser client builds for it. */
async function latestRoot(base: string): Promise<{ rootHash: string; auditRange: string }> {
  const logs = (await call(base, 'GET', '/api/audit')).json.logs;
  const newest = logs.reduce((a: any, b: any) => (b.seq > a.seq ? b : a));
  const oldest = logs.reduce((a: any, b: any) => (b.seq < a.seq ? b : a));
  return { rootHash: newest.entryHash, auditRange: `#${oldest.seq}-#${newest.seq}` };
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

describe('S3: simulated results are labelled as simulated', () => {
  let ctx: Awaited<ReturnType<typeof startApp>>;
  let cookie: string;
  let agentDid: string;
  const restEndpoint = '/api/rest/age-gated-research';
  const SIM_HASH = /^sim_[0-9a-f]{56}$/;

  before(async () => {
    clock = FIXED_START;
    ctx = await startApp([owner.base58]);
  });
  after(() => ctx.server.close());

  beforeEach(async () => {
    cookie = await signIn(ctx.base);
    const agents = await call(ctx.base, 'GET', '/api/agents');
    const active = agents.json.agents.find((a: any) => a.status === 'active' && !a.parentAgentId);
    assert.ok(active, 'seed has an active root agent');
    agentDid = active.did;
  });

  const probe = (paymentReceiptId?: string) =>
    call(ctx.base, 'POST', '/api/sandbox/probe', {
      cookie,
      body: { agentDid, endpointPath: restEndpoint, jurisdictionClaim: 'EU', ageClaim: 30, principalVerifiedClaim: true, paymentReceiptId },
    });
  const trace = (res: { json: any }, key: string) => res.json.traces.find((t: any) => t.key === key);

  test('x402: invoice, settlement hash, receipt and traces say simulated; no fake sponsor address', async () => {
    const challenged = await probe();
    assert.equal(challenged.status, 402, JSON.stringify(challenged.json));
    const invoice = challenged.json.invoice;
    assert.equal(invoice.simulated, true);
    assert.equal(invoice.sponsorAccount, 'simulated-sponsor');
    assert.equal(challenged.json.headers['X-CIS3-Sponsor'], 'simulated-sponsor');
    assert.match(trace(challenged, 'x402').title, /simulated/);

    const settled = await call(ctx.base, 'POST', '/api/x402/settle', { cookie, body: { invoiceId: invoice.invoiceId } });
    assert.equal(settled.status, 200);
    assert.match(settled.json.invoice.txHash, SIM_HASH);
    assert.equal(settled.json.invoice.simulated, true);

    const paid = await probe(invoice.invoiceId);
    assert.equal(paid.status, 200, JSON.stringify(paid.json));
    assert.equal(paid.json.toolResponse.x402Receipt.simulated, true);
    assert.match(paid.json.toolResponse.x402Receipt.txHash, SIM_HASH);
    assert.match(trace(paid, 'x402').detail, /Simulated settlement/);
    assert.match(paid.json.audit.reason, /simulated settlement/);
  });

  test('step 01 says local registry, and the ZKP step says self-reported, not a proof', async () => {
    const res = await probe();
    const gate = trace(res, 'agentgate');
    assert.match(gate.title, /local registry/);
    assert.match(gate.detail, /CIS-8004 contract not queried/);
    assert.doesNotMatch(gate.detail, /Verified active CIS-8004/);
    const zkp = trace(res, 'zkp');
    assert.match(zkp.title, /simulated/);
    assert.match(zkp.detail, /no zero-knowledge proof checked/);
  });

  test('anchor without wallet data is stored as simulated: no signer, sim_ hash, not ONCHAIN_ANCHORED', async () => {
    const res = await call(ctx.base, 'POST', '/api/anchors', { cookie, body: {} });
    assert.equal(res.status, 201);
    assert.equal(res.json.anchor.mode, 'simulated-payload');
    assert.equal(res.json.anchor.signerAddress, null);
    assert.match(res.json.anchor.txHash, SIM_HASH);
    const logs = await call(ctx.base, 'GET', '/api/audit');
    const last = logs.json.logs.find((l: any) => l.x402ReceiptId === res.json.anchor.txHash);
    assert.equal(last.decision, 'ANCHOR_NOT_ONCHAIN');
    assert.match(last.reason, /Simulated anchor/);
  });

  test('a wallet mode without signer or hash falls back to simulated', async () => {
    const res = await call(ctx.base, 'POST', '/api/anchors', { cookie, body: { mode: 'browser-wallet-tx', txHash: 'ab'.repeat(32) } });
    assert.equal(res.json.anchor.mode, 'simulated-payload');
    assert.equal(res.json.anchor.signerAddress, null);
    assert.match(res.json.anchor.txHash, SIM_HASH);
  });

  test('creating an anchor is never ONCHAIN_ANCHORED (S10: only a server-verified tx is); an attestation is not either', async () => {
    const signer = owner.base58;
    const root = await latestRoot(ctx.base);
    const tx = await call(ctx.base, 'POST', '/api/anchors', {
      cookie,
      body: { mode: 'browser-wallet-tx', signerAddress: signer, txHash: 'ab'.repeat(32), ...root },
    });
    const att = await call(ctx.base, 'POST', '/api/anchors', {
      cookie,
      body: { mode: 'wallet-signed-attestation', signerAddress: signer, txHash: 'cd'.repeat(32) },
    });
    assert.equal(tx.json.anchor.mode, 'browser-wallet-tx');
    assert.equal(att.json.anchor.mode, 'wallet-signed-attestation');
    const logs = (await call(ctx.base, 'GET', '/api/audit')).json.logs;
    const byHash = (h: string) => logs.find((l: any) => l.x402ReceiptId === h);
    assert.equal(byHash('ab'.repeat(32)).decision, 'ANCHOR_NOT_ONCHAIN');
    assert.match(byHash('ab'.repeat(32)).reason, /not on chain until the server verifies it/);
    assert.equal(byHash('cd'.repeat(32)).decision, 'ANCHOR_NOT_ONCHAIN');
  });

  test('every failing step 01 trace says local registry, never on-chain or CIS-8004 registry', async () => {
    const agents = (await call(ctx.base, 'GET', '/api/agents')).json.agents;
    const revoked = agents.find((a: any) => a.status === 'revoked');
    assert.ok(revoked, 'seed has a revoked agent');
    const cases = [
      { agentDid: 'did:ccd:testnet:unknown-agent' },
      { agentDid: revoked.did },
      { agentDid, simulateTamperedCard: true },
    ];
    for (const extra of cases) {
      const res = await call(ctx.base, 'POST', '/api/sandbox/probe', {
        cookie,
        body: { endpointPath: restEndpoint, jurisdictionClaim: 'EU', ageClaim: 30, principalVerifiedClaim: true, ...extra },
      });
      const gate = trace(res, 'agentgate');
      assert.equal(gate?.status, 'failed', JSON.stringify(res.json));
      assert.match(gate.title, /local registry/);
      assert.match(gate.detail, /local registry/);
      assert.doesNotMatch(`${gate.title} ${gate.detail}`, /on-chain|in CIS-8004|CIS-8004 Registry/);
    }
  });

  test('a failed ZKP step says self-reported / simulated, never "proof missing"', async () => {
    const res = await call(ctx.base, 'POST', '/api/sandbox/probe', {
      cookie,
      body: { agentDid, endpointPath: restEndpoint, jurisdictionClaim: 'EU', ageClaim: 12, principalVerifiedClaim: false },
    });
    assert.equal(res.status, 403, JSON.stringify(res.json));
    assert.equal(res.json.audit.decision, 'BLOCKED_ZKP_FAILED');
    assert.match(res.json.audit.reason, /simulated ZKP, no proof checked/);
    assert.match(res.json.audit.reason, /Self-reported principal KYC claim missing/);
    assert.doesNotMatch(res.json.audit.reason, /proof missing|proof required|ZKP verification failed/);
    assert.match(trace(res, 'zkp').detail, /no zero-knowledge proof checked/);
  });

  test('browser-wallet-tx with a hash that is not 64 hex is stored as simulated', async () => {
    const res = await call(ctx.base, 'POST', '/api/anchors', {
      cookie,
      body: { mode: 'browser-wallet-tx', signerAddress: owner.base58, txHash: 'not-a-tx-hash' },
    });
    assert.equal(res.json.anchor.mode, 'simulated-payload');
    assert.equal(res.json.anchor.signerAddress, null);
    assert.match(res.json.anchor.txHash, SIM_HASH);
  });

  test('audit.anchored webhook says simulated / reported by wallet / not verified, for all three modes', async () => {
    const bodies: any[] = [];
    const receiver = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        bodies.push(JSON.parse(data));
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
      const wh = await call(ctx.base, 'POST', '/api/webhooks', { cookie, body: { label: 's3', url, enabledEvents: ['audit.anchored'] } });
      assert.equal(wh.status, 201, JSON.stringify(wh.json));
      const signer = owner.base58;
      await call(ctx.base, 'POST', '/api/anchors', { cookie, body: {} });
      await call(ctx.base, 'POST', '/api/anchors', { cookie, body: { mode: 'wallet-signed-attestation', signerAddress: signer, txHash: 'cd'.repeat(32) } });
      await call(ctx.base, 'POST', '/api/anchors', {
        cookie,
        body: { mode: 'browser-wallet-tx', signerAddress: signer, txHash: 'ab'.repeat(32), ...(await latestRoot(ctx.base)) },
      });
      const deadline = Date.now() + 5000;
      while (bodies.length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
      assert.equal(bodies.length, 3, 'three webhook deliveries');
      const byMode = (m: string) => bodies.find((b) => b.payload.mode === m).payload;
      for (const p of bodies.map((b) => b.payload)) {
        assert.equal(p.serverVerifiedOnChain, false);
        assert.ok(!('onChain' in p), 'no unqualified onChain field');
      }
      assert.equal(byMode('simulated-payload').simulated, true);
      assert.equal(byMode('simulated-payload').reportedOnChainByWallet, false);
      assert.equal(byMode('wallet-signed-attestation').simulated, false);
      assert.equal(byMode('wallet-signed-attestation').reportedOnChainByWallet, false);
      assert.equal(byMode('browser-wallet-tx').simulated, false);
      assert.equal(byMode('browser-wallet-tx').reportedOnChainByWallet, true);
    } finally {
      await new Promise((r) => receiver.close(r));
    }
  });

  test('MCP initialize lists what is simulated', async () => {
    const res = await call(ctx.base, 'POST', '/api/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
    assert.equal(res.status, 200);
    const simulated: string[] = res.json.result.simulated;
    assert.ok(Array.isArray(simulated));
    for (const word of ['CIS-8004', 'CIS-3', 'x402', 'ZKP']) {
      assert.ok(simulated.some((s) => s.includes(word)), `simulated list mentions ${word}`);
    }
  });

  test('fresh seed has no 0x-style fake hashes, invented sponsor or wallet addresses', async () => {
    const raw = fs.readFileSync(process.env.ACCORDGATE_DB_PATH as string, 'utf8');
    assert.doesNotMatch(raw, /0xccd_/);
    assert.doesNotMatch(raw, /Sponsor"/);
    assert.doesNotMatch(raw, /EuroTreasury88/);
    const db = JSON.parse(raw);
    for (const inv of db.invoices) {
      assert.equal(inv.simulated, true);
      if (inv.txHash) assert.match(inv.txHash, SIM_HASH);
    }
    for (const entry of db.auditLogs) assert.match(entry.reason, /^\[seed demo data\]/);
  });
});

describe('S10: browser-wallet-tx anchors are verified on chain by the server', () => {
  let ctx: Awaited<ReturnType<typeof startApp>>;
  // Each tx hash answers from its own script: one entry per lookup, the last one repeats.
  const scripts = new Map<string, any[]>();
  const lookups = new Map<string, number>();
  let gate: Promise<void> | null = null;
  const lookupCount = (h: string) => lookups.get(h) ?? 0;
  const totalLookups = () => [...lookups.values()].reduce((a, b) => a + b, 0);

  const fakeBlockItemStatus = async (txHash: string) => {
    const n = lookupCount(txHash);
    lookups.set(txHash, n + 1);
    if (gate) await gate;
    const steps = scripts.get(txHash) ?? ['notfound'];
    const step = steps[Math.min(n, steps.length - 1)];
    if (step === 'notfound') return undefined;
    if (step === 'error') throw new Error('UNAVAILABLE: connect ECONNREFUSED');
    return step;
  };

  // A finalized RegisterData by `sender` carrying the payload the browser wallet builds.
  const finalizedTx = (root: { rootHash: string; auditRange: string }, sender = owner, dataOverride?: string) => ({
    status: 'finalized',
    outcome: {
      blockHash: BlockHash.fromHexString('ef'.repeat(32)),
      summary: {
        type: 'accountTransaction',
        transactionType: 'registerData',
        sender: sender.address,
        dataRegistered: {
          tag: 'DataRegistered',
          data: dataOverride ?? Buffer.from(`accordgate:eu-ai-act:${root.auditRange}:${root.rootHash}`, 'utf8').toString('hex'),
        },
      },
    },
  });

  before(async () => {
    clock = FIXED_START;
    ctx = await startApp([owner.base58, stranger.base58], {
      getBlockItemStatus: fakeBlockItemStatus as any,
      anchorCheck: { sleep: async () => {} },
    });
  });
  after(() => ctx.server.close());
  beforeEach(() => {
    scripts.clear();
    lookups.clear();
    gate = null;
  });

  let txSeq = 0;
  const newTx = () => (++txSeq).toString(16).padStart(64, '0');

  async function createTxAnchor(cookie: string, txHash: string, signer = owner) {
    const root = await latestRoot(ctx.base);
    const res = await call(ctx.base, 'POST', '/api/anchors', {
      cookie,
      body: { mode: 'browser-wallet-tx', signerAddress: signer.base58, txHash, ...root },
    });
    return { res, root };
  }
  const verify = (cookie: string, id: string) => call(ctx.base, 'POST', `/api/anchors/${id}/verify`, { cookie });
  const auditFor = async (txHash: string) =>
    (await call(ctx.base, 'GET', '/api/audit')).json.logs.filter((l: any) => l.x402ReceiptId === txHash);
  const waitForLookup = async (txHash: string) => {
    for (let i = 0; i < 100 && lookupCount(txHash) === 0; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(lookupCount(txHash) > 0, 'lookup started');
  };

  test('POST /api/anchors only stores: no chain lookup, unverified, attempts 0, not ONCHAIN_ANCHORED', async () => {
    const cookie = await signIn(ctx.base);
    const tx = newTx();
    const { res } = await createTxAnchor(cookie, tx);
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal(totalLookups(), 0);
    assert.equal(res.json.anchor.mode, 'browser-wallet-tx');
    const v = res.json.anchor.verification;
    assert.deepEqual([v.status, v.reason, v.attempts], ['unverified', null, 0]);
    assert.equal(res.json.anchor.ownerAccount, owner.base58);
    const entries = await auditFor(tx);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].decision, 'ANCHOR_NOT_ONCHAIN');
  });

  test('verify: finalized, right sender, right data → verified; exactly one ONCHAIN_ANCHORED; rechecks do no lookup', async () => {
    const cookie = await signIn(ctx.base);
    const tx = newTx();
    const { res, root } = await createTxAnchor(cookie, tx);
    scripts.set(tx, [finalizedTx(root)]);
    const v = await verify(cookie, res.json.anchor.id);
    assert.equal(v.status, 200, JSON.stringify(v.json));
    assert.equal(v.json.anchor.verification.status, 'verified');
    assert.equal(v.json.anchor.verification.blockHash, 'ef'.repeat(32));
    assert.equal(v.json.anchor.verification.attempts, 1);
    assert.equal(v.json.anchor.verification.checkedAt, new Date(clock).toISOString());
    scripts.set(tx, ['error']);
    const again = await verify(cookie, res.json.anchor.id);
    assert.equal(again.json.anchor.verification.status, 'verified', 'a later failing lookup never downgrades');
    assert.equal(lookupCount(tx), 1);
    const onchain = (await auditFor(tx)).filter((e: any) => e.decision === 'ONCHAIN_ANCHORED');
    assert.equal(onchain.length, 1);
    assert.match(onchain[0].reason, /server checked/);
  });

  test('tx that does not exist → unverified/not_found after 3 lookups; a later verify after finalization → verified', async () => {
    const cookie = await signIn(ctx.base);
    const tx = newTx();
    const { res, root } = await createTxAnchor(cookie, tx);
    const v = await verify(cookie, res.json.anchor.id);
    assert.deepEqual([v.json.anchor.verification.status, v.json.anchor.verification.reason], ['unverified', 'not_found']);
    assert.equal(lookupCount(tx), 3);
    assert.equal((await auditFor(tx)).filter((e: any) => e.decision === 'ONCHAIN_ANCHORED').length, 0);
    scripts.set(tx, [finalizedTx(root)]);
    const later = await verify(cookie, res.json.anchor.id);
    assert.equal(later.json.anchor.verification.status, 'verified');
    assert.equal(later.json.anchor.verification.attempts, 2);
  });

  test('received / committed → unverified/not_final', async () => {
    const cookie = await signIn(ctx.base);
    for (const item of [{ status: 'received' }, { status: 'committed', outcomes: [] }]) {
      const tx = newTx();
      const { res } = await createTxAnchor(cookie, tx);
      scripts.set(tx, [item]);
      const v = await verify(cookie, res.json.anchor.id);
      assert.deepEqual([v.json.anchor.verification.status, v.json.anchor.verification.reason], ['unverified', 'not_final']);
    }
  });

  test('gRPC unreachable → unverified/unreachable (not not_found), then retryable', async () => {
    const cookie = await signIn(ctx.base);
    const tx = newTx();
    const { res, root } = await createTxAnchor(cookie, tx);
    scripts.set(tx, ['error']);
    const v = await verify(cookie, res.json.anchor.id);
    assert.deepEqual([v.json.anchor.verification.status, v.json.anchor.verification.reason], ['unverified', 'unreachable']);
    assert.match(v.json.anchor.verification.detail, /UNAVAILABLE/);
    scripts.set(tx, [finalizedTx(root)]);
    assert.equal((await verify(cookie, res.json.anchor.id)).json.anchor.verification.status, 'verified');
  });

  test('data mismatch → rejected, one rejection audit entry, terminal (no further lookup)', async () => {
    const cookie = await signIn(ctx.base);
    const tx = newTx();
    const { res, root } = await createTxAnchor(cookie, tx);
    scripts.set(tx, [finalizedTx(root, owner, Buffer.from('something else').toString('hex'))]);
    const v = await verify(cookie, res.json.anchor.id);
    assert.deepEqual([v.json.anchor.verification.status, v.json.anchor.verification.reason], ['rejected', 'data_mismatch']);
    scripts.set(tx, [finalizedTx(root)]);
    const again = await verify(cookie, res.json.anchor.id);
    assert.equal(again.json.anchor.verification.status, 'rejected');
    assert.equal(lookupCount(tx), 1);
    const entries = await auditFor(tx);
    assert.equal(entries.filter((e: any) => /rejected by server check \(data_mismatch\)/.test(e.reason)).length, 1);
    assert.equal(entries.filter((e: any) => e.decision === 'ONCHAIN_ANCHORED').length, 0);
  });

  test('sender is compared with the owner stored at creation, not with the owner who clicks verify', async () => {
    const ownerCookie = await signIn(ctx.base, owner);
    const otherCookie = await signIn(ctx.base, stranger);
    // Created by owner, chain says owner sent it, verified by the other owner → verified.
    const tx1 = newTx();
    const a1 = await createTxAnchor(ownerCookie, tx1);
    scripts.set(tx1, [finalizedTx(a1.root, owner)]);
    assert.equal((await verify(otherCookie, a1.res.json.anchor.id)).json.anchor.verification.status, 'verified');
    // Created by owner, chain says the other owner sent it, verified by that other owner → sender_mismatch.
    const tx2 = newTx();
    const a2 = await createTxAnchor(ownerCookie, tx2);
    scripts.set(tx2, [finalizedTx(a2.root, stranger)]);
    const v2 = await verify(otherCookie, a2.res.json.anchor.id);
    assert.deepEqual([v2.json.anchor.verification.status, v2.json.anchor.verification.reason], ['rejected', 'sender_mismatch']);
  });

  test('body signerAddress that is not the session owner → simulated', async () => {
    const cookie = await signIn(ctx.base, owner);
    const tx = newTx();
    const { res } = await createTxAnchor(cookie, tx, stranger);
    assert.equal(res.json.anchor.mode, 'simulated-payload');
    assert.equal(res.json.anchor.signerAddress, null);
    assert.equal(res.json.anchor.verification, null);
    // R2: the wallet may have sent a real transaction: say why it was not accepted, never "nothing sent".
    assert.equal(res.json.notAccepted, 'signer is not the signed-in owner');
    const entry = (await call(ctx.base, 'GET', '/api/audit')).json.logs.find((l: any) => l.x402ReceiptId === res.json.anchor.txHash);
    assert.match(entry.reason, new RegExp(`Wallet reported a RegisterData transaction \\(${tx.slice(0, 14)}`));
    assert.match(entry.reason, /may still have been sent/);
    assert.doesNotMatch(entry.reason, /nothing signed or sent/);
  });

  test('R2: an anchor with no wallet claim keeps the plain simulated wording and notAccepted null', async () => {
    const cookie = await signIn(ctx.base);
    const res = await call(ctx.base, 'POST', '/api/anchors', { cookie, body: {} });
    assert.equal(res.json.notAccepted, null);
    const entry = (await call(ctx.base, 'GET', '/api/audit')).json.logs.find((l: any) => l.x402ReceiptId === res.json.anchor.txHash);
    assert.match(entry.reason, /nothing signed or sent/);
  });

  test('rootHash the server does not hold, or a range not ending at it → simulated', async () => {
    const cookie = await signIn(ctx.base);
    const root = await latestRoot(ctx.base);
    const unknown = await call(ctx.base, 'POST', '/api/anchors', {
      cookie,
      body: { mode: 'browser-wallet-tx', signerAddress: owner.base58, txHash: newTx(), rootHash: '00'.repeat(32), auditRange: root.auditRange },
    });
    assert.equal(unknown.json.anchor.mode, 'simulated-payload');
    assert.equal(unknown.json.notAccepted, 'root hash or range does not match the server audit log');
    const badRange = await call(ctx.base, 'POST', '/api/anchors', {
      cookie,
      body: { mode: 'browser-wallet-tx', signerAddress: owner.base58, txHash: newTx(), rootHash: root.rootHash, auditRange: '#1-#999999' },
    });
    assert.equal(badRange.json.anchor.mode, 'simulated-payload');
  });

  test('duplicate txHash → 409 with the existing id; upper-case variant too; one record, one audit entry', async () => {
    const cookie = await signIn(ctx.base);
    const tx = 'ab'.repeat(32);
    const first = await createTxAnchor(cookie, tx);
    assert.equal(first.res.status, 201);
    const dup = await createTxAnchor(cookie, tx);
    assert.equal(dup.res.status, 409);
    assert.equal(dup.res.json.anchorId, first.res.json.anchor.id);
    const upper = await createTxAnchor(cookie, tx.toUpperCase());
    assert.equal(upper.res.status, 409);
    const anchors = (await call(ctx.base, 'GET', '/api/anchors')).json.anchors.filter((a: any) => a.txHash === tx);
    assert.equal(anchors.length, 1);
    assert.equal((await auditFor(tx)).length, 1);
  });

  test('20 concurrent posts of one txHash → one 201, nineteen 409', async () => {
    const cookie = await signIn(ctx.base);
    const tx = newTx();
    const root = await latestRoot(ctx.base);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        call(ctx.base, 'POST', '/api/anchors', { cookie, body: { mode: 'browser-wallet-tx', signerAddress: owner.base58, txHash: tx, ...root } }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 19);
  });

  test('two concurrent verifies of one anchor → one lookup run, one result written, one ONCHAIN_ANCHORED', async () => {
    const cookie = await signIn(ctx.base);
    const tx = newTx();
    const { res, root } = await createTxAnchor(cookie, tx);
    scripts.set(tx, [finalizedTx(root)]);
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const p1 = verify(cookie, res.json.anchor.id);
    const p2 = verify(cookie, res.json.anchor.id);
    await waitForLookup(tx);
    // Give the second request time to reach the server while the first lookup is still held.
    await new Promise((r) => setTimeout(r, 100));
    release();
    const [v1, v2] = await Promise.all([p1, p2]);
    assert.equal(v1.json.anchor.verification.status, 'verified');
    assert.equal(v2.json.anchor.verification.status, 'verified');
    assert.equal(lookupCount(tx), 1);
    assert.equal(v1.json.anchor.verification.attempts, 1);
    assert.equal(v2.json.anchor.verification.attempts, 1);
    assert.equal((await auditFor(tx)).filter((e: any) => e.decision === 'ONCHAIN_ANCHORED').length, 1);
  });

  test('anchor removed (sandbox reset) while a verify is in flight → 404, nothing written back', async () => {
    const cookie = await signIn(ctx.base);
    const tx = newTx();
    const { res, root } = await createTxAnchor(cookie, tx);
    scripts.set(tx, [finalizedTx(root)]);
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const pending = verify(cookie, res.json.anchor.id);
    await waitForLookup(tx);
    assert.equal((await call(ctx.base, 'POST', '/api/sandbox/reset', { cookie })).status, 200);
    release();
    const v = await pending;
    assert.equal(v.status, 404);
    assert.equal((await call(ctx.base, 'GET', '/api/anchors')).json.anchors.length, 0);
    assert.equal((await auditFor(tx)).length, 0);
  });

  test('verify on simulated / attestation anchors and on legacy records does no lookup', async () => {
    const cookie = await signIn(ctx.base);
    const sim = await call(ctx.base, 'POST', '/api/anchors', { cookie, body: {} });
    const att = await call(ctx.base, 'POST', '/api/anchors', {
      cookie,
      body: { mode: 'wallet-signed-attestation', signerAddress: owner.base58, txHash: 'cd'.repeat(32) },
    });
    for (const a of [sim, att]) {
      const v = await verify(cookie, a.json.anchor.id);
      assert.equal(v.status, 200);
      assert.equal(v.json.anchor.verification, null);
    }
    // A record stored before S10: no verification, no expected data.
    const { loadDatabase, saveDatabase } = await import('./store.ts');
    const db = loadDatabase();
    db.onchainAnchors.unshift({
      id: 'anc-legacy1',
      rootHash: '11'.repeat(32),
      auditRange: '#1 — #3',
      totalEntries: 3,
      signerAddress: owner.base58,
      txHash: '22'.repeat(32),
      network: 'testnet',
      mode: 'browser-wallet-tx',
      createdAt: new Date(clock).toISOString(),
    });
    saveDatabase(db);
    const legacy = await verify(cookie, 'anc-legacy1');
    assert.deepEqual([legacy.json.anchor.verification.status, legacy.json.anchor.verification.reason], ['unverified', 'legacy_unchecked']);
    const listed = (await call(ctx.base, 'GET', '/api/anchors')).json.anchors.find((a: any) => a.id === 'anc-legacy1');
    assert.equal(listed.verification.reason, 'legacy_unchecked');
    assert.equal(totalLookups(), 0);
  });

  test('R1: a webhook test that is slow to answer does not undo a verify that finished meanwhile', async () => {
    let releaseHook!: () => void;
    const hookHeld = new Promise<void>((r) => (releaseHook = r));
    let hookHit = false;
    const receiver = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', async () => {
        hookHit = true;
        await hookHeld;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    try {
      const cookie = await signIn(ctx.base);
      const url = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
      const wh = await call(ctx.base, 'POST', '/api/webhooks', { cookie, body: { label: 'slow', url, enabledEvents: ['agent.revoked'] } });
      assert.equal(wh.status, 201, JSON.stringify(wh.json));
      const tx = newTx();
      const { res, root } = await createTxAnchor(cookie, tx);
      scripts.set(tx, [finalizedTx(root)]);
      // The webhook test loads the state, then waits on the slow receiver.
      const pingPending = call(ctx.base, 'POST', `/api/webhooks/${wh.json.webhook.id}/test`, { cookie });
      for (let i = 0; i < 100 && !hookHit; i++) await new Promise((r) => setTimeout(r, 10));
      assert.ok(hookHit, 'webhook receiver got the ping');
      const v = await verify(cookie, res.json.anchor.id);
      assert.equal(v.json.anchor.verification.status, 'verified');
      releaseHook();
      const ping = await pingPending;
      assert.equal(ping.status, 200);
      assert.equal(ping.json.delivery.ok, true);
      const stored = (await call(ctx.base, 'GET', '/api/anchors')).json.anchors.find((a: any) => a.id === res.json.anchor.id);
      assert.equal(stored.verification.status, 'verified', 'the slow webhook test must not write back a stale anchor');
      assert.equal((await auditFor(tx)).filter((e: any) => e.decision === 'ONCHAIN_ANCHORED').length, 1);
      const hooks = (await call(ctx.base, 'GET', '/api/webhooks')).json.webhooks;
      assert.equal(hooks.find((h: any) => h.id === wh.json.webhook.id).lastStatusCode, 200);
    } finally {
      releaseHook();
      await new Promise((r) => receiver.close(r));
    }
  });

  test('verify on an unknown id → 404', async () => {
    const cookie = await signIn(ctx.base);
    assert.equal((await verify(cookie, 'anc-nope')).status, 404);
  });

  test('audit.anchor_verified webhook fires once, with serverVerifiedOnChain true', async () => {
    const bodies: any[] = [];
    const receiver = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        bodies.push(JSON.parse(data));
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    try {
      const cookie = await signIn(ctx.base);
      const url = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
      const wh = await call(ctx.base, 'POST', '/api/webhooks', { cookie, body: { label: 's10', url, enabledEvents: ['audit.anchor_verified'] } });
      assert.equal(wh.status, 201, JSON.stringify(wh.json));
      const tx = newTx();
      const { res, root } = await createTxAnchor(cookie, tx);
      scripts.set(tx, [finalizedTx(root)]);
      await verify(cookie, res.json.anchor.id);
      await verify(cookie, res.json.anchor.id);
      const deadline = Date.now() + 3000;
      while (bodies.length < 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(bodies.length, 1);
      assert.equal(bodies[0].event, 'audit.anchor_verified');
      assert.equal(bodies[0].payload.serverVerifiedOnChain, true);
      assert.equal(bodies[0].payload.txHash, tx);
    } finally {
      await new Promise((r) => receiver.close(r));
    }
  });
});

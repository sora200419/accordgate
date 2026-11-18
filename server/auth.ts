// Owner sign-in with a Concordium Browser Wallet message signature (SECURITY.md S1).
// Flow: challenge (server nonce) -> wallet signMessage -> verify against on-chain account keys -> session cookie.
import crypto from 'node:crypto';
import { AccountAddress, verifyMessageSignature } from '@concordium/web-sdk';
import type { AccountInfo, AccountTransactionSignature } from '@concordium/web-sdk';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'ag_session';

/** Routes that change server state; only a signed-in owner may call them. */
export const OWNER_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'POST', path: '/api/agents' },
  { method: 'PATCH', path: '/api/agents/:id/status' },
  { method: 'POST', path: '/api/agents/:id/rotate-card' },
  { method: 'POST', path: '/api/agents/:id/verify-vcdc' },
  { method: 'POST', path: '/api/policies' },
  { method: 'PUT', path: '/api/policies/:id' },
  { method: 'POST', path: '/api/sandbox/probe' },
  { method: 'POST', path: '/api/sandbox/sign' },
  { method: 'POST', path: '/api/x402/settle' },
  { method: 'POST', path: '/api/audit/simulate-tamper' },
  { method: 'POST', path: '/api/audit/restore-tamper' },
  { method: 'POST', path: '/api/webhooks' },
  { method: 'DELETE', path: '/api/webhooks/:id' },
  { method: 'POST', path: '/api/webhooks/:id/test' },
  { method: 'POST', path: '/api/anchors' },
  { method: 'POST', path: '/api/sandbox/reset' },
];

export type AccountInfoLookup = (
  address: AccountAddress.Type,
) => Promise<Pick<AccountInfo, 'accountThreshold' | 'accountCredentials' | 'accountAddress'>>;

export class AccountNotFoundError extends Error {}

export interface AuthDeps {
  ownerAccounts: string[];
  getAccountInfo: AccountInfoLookup;
  now?: () => number;
  secureCookie?: boolean;
}

/** Parses OWNER_ACCOUNTS (comma separated base58 addresses). Throws naming the bad entry. */
export function parseOwnerAccounts(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      try {
        return AccountAddress.fromBase58(entry).address;
      } catch {
        throw new Error(`OWNER_ACCOUNTS contains an invalid Concordium address: "${entry.slice(0, 12)}..."`);
      }
    });
}

export function maskAccount(address: string): string {
  return `${address.slice(0, 6)}…`;
}

/** Short, header-free description of a third-party error (never the raw object). */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const firstLine = (err.message || '').split('\n')[0].slice(0, 200);
    return `${err.name}: ${firstLine}`;
  }
  return 'Unknown error';
}

export function buildChallengeMessage(account: string, nonce: string, expiresAt: number): string {
  return `AccordGate owner sign-in\nAccount: ${account}\nNonce: ${nonce}\nExpires: ${new Date(expiresAt).toISOString()}`;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  }
  return out;
}

function pathToRegex(routePath: string): RegExp {
  const escaped = routePath
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  // Case-insensitive like Express's default routing, so /API/... cannot slip past the guard.
  return new RegExp(`^${escaped}/?$`, 'i');
}

const OWNER_ROUTE_MATCHERS = OWNER_ROUTES.map((r) => ({ method: r.method, re: pathToRegex(r.path) }));

export function isOwnerRoute(method: string, pathname: string): boolean {
  return OWNER_ROUTE_MATCHERS.some((r) => r.method === method.toUpperCase() && r.re.test(pathname));
}

function isSignatureShape(value: unknown): value is AccountTransactionSignature {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const creds = Object.entries(value as Record<string, unknown>);
  if (creds.length === 0 || creds.length > 16) return false;
  return creds.every(([credIdx, keys]) => {
    if (!/^\d+$/.test(credIdx) || !keys || typeof keys !== 'object' || Array.isArray(keys)) return false;
    const entries = Object.entries(keys as Record<string, unknown>);
    return (
      entries.length > 0 &&
      entries.length <= 16 &&
      entries.every(([keyIdx, sig]) => /^\d+$/.test(keyIdx) && typeof sig === 'string' && /^[0-9a-fA-F]{128}$/.test(sig))
    );
  });
}

async function withRetry<T>(fn: () => Promise<T>, attempts: number, delaysMs: number[]): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AccountNotFoundError) throw err;
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delaysMs[i] ?? 600));
    }
  }
  throw lastErr;
}

export function createAuth(deps: AuthDeps) {
  const now = deps.now ?? (() => Date.now());
  const owners = new Set(deps.ownerAccounts);
  // Per-process key for challenge MACs; a restart only invalidates challenges still being signed.
  const challengeKey = crypto.randomBytes(32);
  const usedNonces = new Map<string, number>(); // nonce -> expiresAt, kept until it would expire anyway
  const sessions = new Map<string, { account: string; expiresAt: number }>();

  function challengeMac(account: string, rand: string, expiresAt: number): string {
    return crypto.createHmac('sha256', challengeKey).update(`${account}|${rand}|${expiresAt}`).digest('hex');
  }

  /** Checks that the nonce was issued by this server for this account; returns its expiry. */
  function parseChallenge(accountInput: string, nonce: string): { account: string; expiresAt: number } | null {
    const m = /^([0-9a-f]{64})\.(\d{1,16})\.([0-9a-f]{64})$/.exec(nonce);
    if (!m) return null;
    let account: string;
    try {
      account = AccountAddress.fromBase58(accountInput).address;
    } catch {
      return null;
    }
    const expiresAt = Number(m[2]);
    const expected = Buffer.from(challengeMac(account, m[1], expiresAt), 'hex');
    const given = Buffer.from(m[3], 'hex');
    if (!crypto.timingSafeEqual(expected, given)) return null;
    return { account, expiresAt };
  }

  function pruneExpired() {
    const t = now();
    for (const [k, exp] of usedNonces) if (exp <= t) usedNonces.delete(k);
    for (const [k, v] of sessions) if (v.expiresAt <= t) sessions.delete(k);
  }

  function sessionFrom(req: Request): { token: string; account: string } | null {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const s = sessions.get(token);
    if (!s) return null;
    if (s.expiresAt <= now()) {
      sessions.delete(token);
      return null;
    }
    return { token, account: s.account };
  }

  function cookieAttrs(maxAgeSeconds: number): string {
    return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${deps.secureCookie ? '; Secure' : ''}`;
  }

  function requireOwner(req: Request, res: Response, next: NextFunction) {
    if (owners.size === 0) {
      res.status(503).json({ error: 'Owner sign-in not configured: set OWNER_ACCOUNTS on the server.' });
      return;
    }
    const session = sessionFrom(req);
    if (!session) {
      res.status(401).json({ error: 'Sign in with your Concordium wallet to make changes.' });
      return;
    }
    if (!owners.has(session.account)) {
      res.status(403).json({ error: 'This account is not an owner of this gateway.' });
      return;
    }
    next();
  }

  /** Applies requireOwner to every OWNER_ROUTES entry; register before the routes. */
  function ownerGuard(req: Request, res: Response, next: NextFunction) {
    if (isOwnerRoute(req.method, req.path)) {
      requireOwner(req, res, next);
      return;
    }
    next();
  }

  const router = express.Router();

  router.post('/api/auth/challenge', (req, res) => {
    if (owners.size === 0) {
      res.status(503).json({ error: 'Owner sign-in not configured: set OWNER_ACCOUNTS on the server.' });
      return;
    }
    let account: string;
    try {
      account = AccountAddress.fromBase58(String(req.body?.accountAddress ?? '')).address;
    } catch {
      res.status(400).json({ error: 'accountAddress must be a valid Concordium account address.' });
      return;
    }
    if (!owners.has(account)) {
      res.status(403).json({ error: 'This account is not an owner of this gateway.' });
      return;
    }
    // Stateless challenge: nothing is stored until it is used, so requesting more challenges
    // can never evict or block the owner's pending one.
    const rand = crypto.randomBytes(32).toString('hex');
    const expiresAt = now() + CHALLENGE_TTL_MS;
    const nonce = `${rand}.${expiresAt}.${challengeMac(account, rand, expiresAt)}`;
    res.json({ nonce, message: buildChallengeMessage(account, nonce, expiresAt), expiresAt: new Date(expiresAt).toISOString() });
  });

  router.post('/api/auth/verify', async (req, res) => {
    const nonce = String(req.body?.nonce ?? '');
    const signature: unknown = req.body?.signature;
    const challenge = parseChallenge(String(req.body?.accountAddress ?? ''), nonce);
    if (!challenge || challenge.expiresAt <= now() || usedNonces.has(nonce)) {
      res.status(401).json({ error: 'Sign-in challenge is unknown, already used or expired. Request a new one.' });
      return;
    }
    // Single use: mark it used before any await so a concurrent or replayed verify cannot reuse it.
    pruneExpired();
    usedNonces.set(nonce, challenge.expiresAt);
    if (!owners.has(challenge.account)) {
      res.status(403).json({ error: 'This account is not an owner of this gateway.' });
      return;
    }
    if (!isSignatureShape(signature)) {
      res.status(400).json({ error: 'signature must be a Concordium account signature object.' });
      return;
    }

    const message = buildChallengeMessage(challenge.account, nonce, challenge.expiresAt);
    let accountInfo: Awaited<ReturnType<AccountInfoLookup>>;
    try {
      accountInfo = await withRetry(
        () => deps.getAccountInfo(AccountAddress.fromBase58(challenge.account)),
        3,
        [300, 600],
      );
    } catch (err) {
      if (err instanceof AccountNotFoundError) {
        res.status(401).json({ error: 'Account not found on Concordium testnet.' });
        return;
      }
      console.error(`[auth] account lookup failed for ${maskAccount(challenge.account)}: ${describeError(err)}`);
      res.status(502).json({ error: `Could not read account keys from Concordium testnet (${describeError(err)}).` });
      return;
    }

    let valid = false;
    try {
      valid = await verifyMessageSignature(message, signature, accountInfo);
    } catch {
      // Signature references credentials or keys the account does not have.
      valid = false;
    }
    if (!valid) {
      res.status(401).json({ error: 'Wallet signature is not valid for this account.' });
      return;
    }

    pruneExpired();
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { account: challenge.account, expiresAt: now() + SESSION_TTL_MS });
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; ${cookieAttrs(Math.floor(SESSION_TTL_MS / 1000))}`);
    console.log(`[auth] owner signed in: ${maskAccount(challenge.account)}`);
    res.json({ account: challenge.account });
  });

  router.get('/api/auth/me', (req, res) => {
    // Always 200 so a signed-out page load does not log a failed request; account is null when signed out.
    const session = sessionFrom(req);
    const account = session && owners.has(session.account) ? session.account : null;
    res.json({ account, ownerSignInConfigured: owners.size > 0 });
  });

  router.post('/api/auth/logout', (req, res) => {
    const session = sessionFrom(req);
    if (session) sessions.delete(session.token);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttrs(0)}`);
    res.json({ signedOut: true });
  });

  return { router, ownerGuard, requireOwner };
}

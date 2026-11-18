// S7: agent request freshness. Each signed agent request carries an ISO timestamp and a nonce;
// a request is accepted only inside a short time window and only once per (agent DID, nonce).
// Nonces live in memory (single process). Only call check() after the signature was verified,
// so anonymous callers cannot add entries.

export const MAX_AGE_MS = 120_000;
export const MAX_FUTURE_SKEW_MS = 30_000;
export const DEFAULT_PER_AGENT_CAP = 1000;

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

export type FreshnessResult =
  | { ok: true; timestampMs: number }
  | { ok: false; reason: 'bad-timestamp' | 'bad-nonce' | 'stale' | 'future' | 'before-start' | 'replayed' | 'too-many'; detail: string };

export interface ReplayGuardOptions {
  now: () => number;
  maxAgeMs?: number;
  maxFutureSkewMs?: number;
  perAgentCap?: number;
}

export function isValidNonceFormat(nonce: string): boolean {
  return NONCE_RE.test(nonce);
}

export function isValidTimestampFormat(timestamp: string): boolean {
  if (!TIMESTAMP_RE.test(timestamp)) return false;
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return false;
  // Reject calendar-invalid values that Date.parse rolls over (2030-02-30, T24:00:00).
  return new Date(ms).toISOString().slice(0, 19) === timestamp.slice(0, 19);
}

export function createAgentReplayGuard(opts: ReplayGuardOptions) {
  const now = opts.now;
  const maxAgeMs = opts.maxAgeMs ?? MAX_AGE_MS;
  const maxFutureSkewMs = opts.maxFutureSkewMs ?? MAX_FUTURE_SKEW_MS;
  const perAgentCap = opts.perAgentCap ?? DEFAULT_PER_AGENT_CAP;
  // Nonces seen before a restart are lost, so refuse anything signed before this guard existed.
  const startedAt = now();
  const seen = new Map<string, Map<string, number>>();

  function sweep(did: string, t: number) {
    const nonces = seen.get(did);
    if (!nonces) return;
    for (const [nonce, expiresAt] of nonces) {
      if (expiresAt < t) nonces.delete(nonce);
    }
    if (nonces.size === 0) seen.delete(did);
  }

  /** Synchronous check-and-record: no await between the lookup and the insert. */
  function check(did: string, timestamp: string, nonce: string): FreshnessResult {
    if (!isValidTimestampFormat(timestamp)) {
      return { ok: false, reason: 'bad-timestamp', detail: 'X-Agent-Timestamp must be ISO-8601 UTC (YYYY-MM-DDTHH:mm:ss.sssZ).' };
    }
    if (!isValidNonceFormat(nonce)) {
      return { ok: false, reason: 'bad-nonce', detail: 'X-Agent-Nonce must be 16-128 characters of A-Z, a-z, 0-9, "_" or "-".' };
    }
    const t = now();
    const ts = Date.parse(timestamp);
    if (ts > t + maxFutureSkewMs) {
      return { ok: false, reason: 'future', detail: `Timestamp is ${ts - t} ms in the future (max ${maxFutureSkewMs} ms).` };
    }
    if (ts < t - maxAgeMs) {
      return { ok: false, reason: 'stale', detail: `Timestamp is ${t - ts} ms old (max ${maxAgeMs} ms).` };
    }
    if (ts < startedAt) {
      return { ok: false, reason: 'before-start', detail: 'Timestamp predates the gateway start; sign a new request.' };
    }

    sweep(did, t);
    let nonces = seen.get(did);
    if (nonces?.has(nonce)) {
      return { ok: false, reason: 'replayed', detail: 'This nonce was already used by this agent.' };
    }
    if (nonces && nonces.size >= perAgentCap) {
      return { ok: false, reason: 'too-many', detail: `Agent has ${nonces.size} unexpired nonces (cap ${perAgentCap}); slow down.` };
    }
    if (!nonces) {
      nonces = new Map();
      seen.set(did, nonces);
    }
    nonces.set(nonce, ts + maxAgeMs);
    return { ok: true, timestampMs: ts };
  }

  function size() {
    let n = 0;
    for (const nonces of seen.values()) n += nonces.size;
    return n;
  }

  return { check, size };
}

export type AgentReplayGuard = ReturnType<typeof createAgentReplayGuard>;

// S7 unit tests for the agent replay guard. Fake clock, fixed date, no network. Run with `npm test`.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createAgentReplayGuard, MAX_AGE_MS, MAX_FUTURE_SKEW_MS } from './agentFreshness.ts';

const T0 = Date.parse('2030-01-01T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const nonce = (i: number | string) => `nonce-${String(i).padStart(10, '0')}`;

function setup(perAgentCap?: number) {
  let clock = T0;
  const guard = createAgentReplayGuard({ now: () => clock, perAgentCap });
  return { guard, advance: (ms: number) => (clock += ms), now: () => clock };
}

describe('agent replay guard', () => {
  test('replay of the same (did, nonce) is rejected; another agent may use the same nonce', () => {
    const { guard, now } = setup();
    assert.equal(guard.check('did:a', iso(now()), nonce(1)).ok, true);
    const again = guard.check('did:a', iso(now()), nonce(1));
    assert.equal(again.ok, false);
    assert.equal(!again.ok && again.reason, 'replayed');
    // Same nonce with a different (still fresh) timestamp is still a replay.
    const otherTs = guard.check('did:a', iso(now() + 1000), nonce(1));
    assert.equal(!otherTs.ok && otherTs.reason, 'replayed');
    assert.equal(guard.check('did:b', iso(now()), nonce(1)).ok, true);
  });

  test('stale timestamps are rejected at max age + 1 ms, accepted at max age', () => {
    const { guard, advance, now } = setup();
    advance(MAX_AGE_MS + 5000);
    const atEdge = guard.check('did:a', iso(now() - MAX_AGE_MS), nonce(1));
    assert.equal(atEdge.ok, true);
    const stale = guard.check('did:a', iso(now() - MAX_AGE_MS - 1), nonce(2));
    assert.equal(!stale.ok && stale.reason, 'stale');
  });

  test('timestamps older than the guard start are rejected (no replay window after restart)', () => {
    const { guard, now } = setup();
    const r = guard.check('did:a', iso(now() - 1), nonce(1));
    assert.equal(!r.ok && r.reason, 'before-start');
  });

  test('future timestamps beyond the skew are rejected', () => {
    const { guard, now } = setup();
    assert.equal(guard.check('did:a', iso(now() + MAX_FUTURE_SKEW_MS), nonce(1)).ok, true);
    const future = guard.check('did:a', iso(now() + MAX_FUTURE_SKEW_MS + 1), nonce(2));
    assert.equal(!future.ok && future.reason, 'future');
    const farFuture = guard.check('did:a', '2099-01-01T00:00:00.000Z', nonce(3));
    assert.equal(!farFuture.ok && farFuture.reason, 'future');
  });

  test('malformed timestamps and nonces are rejected and not recorded', () => {
    const { guard, now } = setup();
    for (const ts of ['2030-01-01T00:00:00.000', '2030-01-01 00:00:00Z', '1893456000000', `${iso(now())}|x`, '2030-13-45T99:99:99Z', '2030-02-30T00:00:00Z', '2030-01-01T24:00:00Z', '']) {
      const r = guard.check('did:a', ts, nonce(1));
      assert.equal(!r.ok && r.reason, 'bad-timestamp', ts);
    }
    for (const n of ['short', 'has|pipe-0000000000', 'has space 000000000', 'x'.repeat(129), '']) {
      const r = guard.check('did:a', iso(now()), n);
      assert.equal(!r.ok && r.reason, 'bad-nonce', n);
    }
    assert.equal(guard.size(), 0);
  });

  test('out-of-order arrival inside the window: both pass, then both replays fail', () => {
    const { guard, advance, now } = setup();
    advance(20_000);
    const t = now() - 15_000;
    assert.equal(guard.check('did:a', iso(t + 10_000), nonce('n2')).ok, true);
    assert.equal(guard.check('did:a', iso(t), nonce('n1')).ok, true);
    assert.equal(guard.check('did:a', iso(t + 10_000), nonce('n2')).ok, false);
    assert.equal(guard.check('did:a', iso(t), nonce('n1')).ok, false);
  });

  test('expired nonces are swept, and their requests stay rejected as stale', () => {
    const { guard, advance, now } = setup();
    const ts = iso(now());
    for (let i = 0; i < 10; i++) assert.equal(guard.check('did:a', ts, nonce(i)).ok, true);
    assert.equal(guard.size(), 10);
    advance(MAX_AGE_MS + 1);
    const replay = guard.check('did:a', ts, nonce(0));
    assert.equal(!replay.ok && replay.reason, 'stale');
    assert.equal(guard.check('did:a', iso(now()), nonce('fresh')).ok, true);
    assert.equal(guard.size(), 1, 'old entries swept');
  });

  test('a full agent is rejected (no eviction) while other agents pass; it recovers after the window', () => {
    const cap = 50;
    const { guard, advance, now } = setup(cap);
    const ts = iso(now());
    for (let i = 0; i < cap; i++) assert.equal(guard.check('did:a', ts, nonce(i)).ok, true);
    const over = guard.check('did:a', ts, nonce('over'));
    assert.equal(!over.ok && over.reason, 'too-many');
    // Nothing was evicted: the first nonce is still a replay.
    const first = guard.check('did:a', ts, nonce(0));
    assert.equal(!first.ok && first.reason, 'replayed');
    assert.equal(guard.check('did:b', ts, nonce(0)).ok, true);
    assert.equal(guard.size(), cap + 1);
    advance(MAX_AGE_MS + 1);
    assert.equal(guard.check('did:a', iso(now()), nonce('later')).ok, true);
  });

  test('100 000 entries across many agents stay fast and counted', () => {
    const { guard, now } = setup();
    const ts = iso(now());
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) assert.equal(guard.check(`did:flood-${i}`, ts, nonce(i)).ok, true);
    assert.equal(guard.size(), 100_000);
    assert.equal(guard.check('did:normal', ts, nonce('normal')).ok, true);
    assert.ok(performance.now() - start < 5000, 'flood handled in under 5 s');
  });
});

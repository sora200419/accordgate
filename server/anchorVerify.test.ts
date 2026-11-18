// S10 unit tests for verifyAnchorTx: fake lookup, no network, no real delays (sleep is a no-op).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, test } from 'node:test';
import { AccountAddress, BlockHash } from '@concordium/web-sdk';
import { anchorPayloadHex, verifyAnchorTx } from './anchorVerify.ts';
import type { BlockItemStatusLookup } from './anchorVerify.ts';

const owner = AccountAddress.fromBuffer(new Uint8Array(crypto.randomBytes(32)).buffer);
const other = AccountAddress.fromBuffer(new Uint8Array(crypto.randomBytes(32)).buffer);
const rootHash = 'ab'.repeat(32);
const expectedData = anchorPayloadHex('#1-#7', rootHash);
const txHash = 'cd'.repeat(32);
const blockHashHex = 'ef'.repeat(32);
const input = { txHash, ownerAccount: owner.address, expectedData };
const noSleep = async () => {};

function finalized(summary: any) {
  return { status: 'finalized', outcome: { blockHash: BlockHash.fromHexString(blockHashHex), summary } } as any;
}
const registerData = (over: Record<string, unknown> = {}) =>
  finalized({
    type: 'accountTransaction',
    transactionType: 'registerData',
    sender: owner,
    dataRegistered: { tag: 'DataRegistered', data: expectedData },
    ...over,
  });

/** Answers from a script, one entry per call: a value, 'notfound-error', 'error' or 'hang'. */
function scripted(steps: any[]) {
  let calls = 0;
  const lookup: BlockItemStatusLookup = async () => {
    const step = steps[Math.min(calls, steps.length - 1)];
    calls++;
    if (step === 'notfound-error') throw Object.assign(new Error('NOT_FOUND: transaction not found'), { code: 'NOT_FOUND' });
    if (step === 'error') throw new Error('UNAVAILABLE: connect failed\nAuthorization: Bearer secret');
    if (step === 'hang') return new Promise(() => {});
    return step;
  };
  return { lookup, calls: () => calls };
}

describe('S10: verifyAnchorTx', () => {
  test('payload hex is the UTF-8 of the wallet payload', () => {
    assert.equal(Buffer.from(expectedData, 'hex').toString('utf8'), `accordgate:eu-ai-act:#1-#7:${rootHash}`);
  });

  test('finalized RegisterData from the owner with the expected data is verified', async () => {
    const s = scripted([registerData()]);
    const r = await verifyAnchorTx(s.lookup, input, { sleep: noSleep });
    assert.equal(r.status, 'verified');
    assert.equal(r.reason, null);
    assert.equal(r.blockHash, blockHashHex);
    assert.equal(s.calls(), 1);
  });

  test('a transaction that does not exist (undefined every time) is not_found after 3 lookups', async () => {
    const s = scripted([undefined]);
    const r = await verifyAnchorTx(s.lookup, input, { sleep: noSleep });
    assert.deepEqual([r.status, r.reason], ['unverified', 'not_found']);
    assert.equal(s.calls(), 3);
  });

  test('a NOT_FOUND gRPC error every time is also not_found, not unreachable', async () => {
    const s = scripted(['notfound-error']);
    const r = await verifyAnchorTx(s.lookup, input, { sleep: noSleep });
    assert.deepEqual([r.status, r.reason], ['unverified', 'not_found']);
    assert.equal(s.calls(), 3);
  });

  test('a stale node: not found twice, then found → verified', async () => {
    const s = scripted([undefined, 'notfound-error', registerData()]);
    const r = await verifyAnchorTx(s.lookup, input, { sleep: noSleep });
    assert.equal(r.status, 'verified');
    assert.equal(s.calls(), 3);
  });

  test('received and committed are not_final (no retry needed)', async () => {
    for (const item of [{ status: 'received' }, { status: 'committed', outcomes: [] }]) {
      const s = scripted([item]);
      const r = await verifyAnchorTx(s.lookup, input, { sleep: noSleep });
      assert.deepEqual([r.status, r.reason], ['unverified', 'not_final']);
      assert.equal(s.calls(), 1);
    }
  });

  test('data that does not match → rejected/data_mismatch', async () => {
    const wrong = anchorPayloadHex('#1-#7', '00'.repeat(32));
    const r = await verifyAnchorTx(scripted([registerData({ dataRegistered: { data: wrong } })]).lookup, input, { sleep: noSleep });
    assert.deepEqual([r.status, r.reason], ['rejected', 'data_mismatch']);
  });

  test('another sender → rejected/sender_mismatch', async () => {
    const r = await verifyAnchorTx(scripted([registerData({ sender: other })]).lookup, input, { sleep: noSleep });
    assert.deepEqual([r.status, r.reason], ['rejected', 'sender_mismatch']);
  });

  test('missing stored owner → sender_mismatch, never verified', async () => {
    const r = await verifyAnchorTx(scripted([registerData()]).lookup, { ...input, ownerAccount: null }, { sleep: noSleep });
    assert.deepEqual([r.status, r.reason], ['rejected', 'sender_mismatch']);
  });

  test('failed transaction → rejected/tx_failed; a transfer → rejected/wrong_type; an update → wrong_type', async () => {
    const failed = await verifyAnchorTx(
      scripted([registerData({ transactionType: 'failed', failedTransactionType: 'registerData', dataRegistered: undefined })]).lookup,
      input,
      { sleep: noSleep },
    );
    assert.deepEqual([failed.status, failed.reason], ['rejected', 'tx_failed']);
    const transfer = await verifyAnchorTx(scripted([registerData({ transactionType: 'transfer' })]).lookup, input, { sleep: noSleep });
    assert.deepEqual([transfer.status, transfer.reason], ['rejected', 'wrong_type']);
    const update = await verifyAnchorTx(scripted([finalized({ type: 'updateTransaction' })]).lookup, input, { sleep: noSleep });
    assert.deepEqual([update.status, update.reason], ['rejected', 'wrong_type']);
  });

  test('an outcome the SDK cannot read (null summary) is unknown, not rejected', async () => {
    const r = await verifyAnchorTx(scripted([finalized(null)]).lookup, input, { sleep: noSleep });
    assert.deepEqual([r.status, r.reason], ['unverified', 'unreachable']);
  });

  test('unreachable 3 times → unverified/unreachable (not not_found); detail has no second line', async () => {
    const s = scripted(['error']);
    const r = await verifyAnchorTx(s.lookup, input, { sleep: noSleep });
    assert.deepEqual([r.status, r.reason], ['unverified', 'unreachable']);
    assert.equal(s.calls(), 3);
    assert.match(r.detail ?? '', /UNAVAILABLE/);
    assert.doesNotMatch(r.detail ?? '', /Bearer|secret/);
  });

  test('a lookup that hangs times out each attempt → unreachable', async () => {
    const s = scripted(['hang']);
    const r = await verifyAnchorTx(s.lookup, input, { sleep: noSleep, timeoutMs: 20 });
    assert.deepEqual([r.status, r.reason], ['unverified', 'unreachable']);
    assert.match(r.detail ?? '', /longer than 20 ms/);
    assert.equal(s.calls(), 3);
  });

  test('mixed not-found and errors is unknown (unreachable), never not_found', async () => {
    const r = await verifyAnchorTx(scripted([undefined, 'error', 'notfound-error']).lookup, input, { sleep: noSleep });
    assert.deepEqual([r.status, r.reason], ['unverified', 'unreachable']);
  });

  test('a transient error then success → verified; delays follow the backoff', async () => {
    const slept: number[] = [];
    const s = scripted(['error', 'error', registerData()]);
    const r = await verifyAnchorTx(s.lookup, input, { sleep: async (ms) => void slept.push(ms) });
    assert.equal(r.status, 'verified');
    assert.deepEqual(slept, [300, 600]);
  });
});

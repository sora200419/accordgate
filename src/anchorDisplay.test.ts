import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchorExplorerUrl, anchorModeLabel, shouldPollVerification } from './anchorDisplay.ts';
import type { AnchorVerification } from './types.ts';

const realHash = 'ab'.repeat(32);
const ver = (over: Partial<AnchorVerification>): AnchorVerification => ({
  status: 'unverified',
  reason: null,
  detail: null,
  checkedAt: null,
  attempts: 0,
  blockHash: null,
  ...over,
});
const verified = ver({ status: 'verified', attempts: 1, blockHash: 'ef'.repeat(32) });

test('S10: only a server-verified browser-wallet-tx with a 64-hex hash gets a CCDScan link', () => {
  assert.equal(
    anchorExplorerUrl({ mode: 'browser-wallet-tx', txHash: realHash, verification: verified }),
    `https://testnet.ccdscan.io/transactions?d=${realHash}`,
  );
  for (const v of [undefined, null, ver({}), ver({ reason: 'not_found' }), ver({ status: 'rejected', reason: 'data_mismatch' })]) {
    assert.equal(anchorExplorerUrl({ mode: 'browser-wallet-tx', txHash: realHash, verification: v }), null, JSON.stringify(v));
  }
  assert.equal(anchorExplorerUrl({ mode: 'wallet-signed-attestation', txHash: realHash, verification: verified }), null);
  assert.equal(anchorExplorerUrl({ mode: 'simulated-payload', txHash: realHash, verification: verified }), null);
  assert.equal(anchorExplorerUrl({ mode: 'browser-wallet-tx', txHash: 'sim_' + 'a'.repeat(56), verification: verified }), null);
});

test('S3/S10: labels say not on chain unless verified', () => {
  assert.match(anchorModeLabel({ mode: 'simulated-payload', txHash: '', verification: null }), /模拟.*未上链/);
  assert.match(anchorModeLabel({ mode: 'wallet-signed-attestation', txHash: realHash, verification: null }), /未上链/);
  assert.match(anchorModeLabel({ mode: 'browser-wallet-tx', txHash: realHash, verification: ver({}) }), /未核验/);
  assert.match(anchorModeLabel({ mode: 'browser-wallet-tx', txHash: realHash, verification: ver({ reason: 'unreachable' }) }), /未核验.*未知/);
  assert.match(anchorModeLabel({ mode: 'browser-wallet-tx', txHash: realHash, verification: ver({ status: 'rejected', reason: 'sender_mismatch' }) }), /核验失败.*未上链/);
  assert.match(anchorModeLabel({ mode: 'browser-wallet-tx', txHash: realHash, verification: verified }), /服务器已核验/);
});

test('S10: poll only unverified transaction anchors that can still change', () => {
  assert.equal(shouldPollVerification({ mode: 'browser-wallet-tx', txHash: realHash, verification: ver({}) }), true);
  assert.equal(shouldPollVerification({ mode: 'browser-wallet-tx', txHash: realHash, verification: ver({ reason: 'not_final' }) }), true);
  assert.equal(shouldPollVerification({ mode: 'browser-wallet-tx', txHash: realHash, verification: verified }), false);
  assert.equal(shouldPollVerification({ mode: 'browser-wallet-tx', txHash: realHash, verification: ver({ status: 'rejected', reason: 'tx_failed' }) }), false);
  assert.equal(shouldPollVerification({ mode: 'browser-wallet-tx', txHash: realHash, verification: ver({ reason: 'legacy_unchecked' }) }), false);
  assert.equal(shouldPollVerification({ mode: 'simulated-payload', txHash: '', verification: null }), false);
});

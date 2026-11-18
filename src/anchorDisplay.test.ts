import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchorExplorerUrl, anchorModeLabel } from './anchorDisplay.ts';

const realHash = 'ab'.repeat(32);

test('S3: only a browser-wallet-tx with a 64-hex hash gets a CCDScan link', () => {
  assert.equal(
    anchorExplorerUrl({ mode: 'browser-wallet-tx', txHash: realHash }),
    `https://testnet.ccdscan.io/transactions?d=${realHash}`,
  );
  assert.equal(anchorExplorerUrl({ mode: 'wallet-signed-attestation', txHash: realHash }), null);
  assert.equal(anchorExplorerUrl({ mode: 'simulated-payload', txHash: realHash }), null);
  assert.equal(anchorExplorerUrl({ mode: 'simulated-payload', txHash: 'sim_' + 'a'.repeat(56) }), null);
  assert.equal(anchorExplorerUrl({ mode: 'browser-wallet-tx', txHash: 'sim_' + 'a'.repeat(56) }), null);
  assert.equal(anchorExplorerUrl({ mode: 'browser-wallet-tx', txHash: '0xccd_' + 'a'.repeat(56) }), null);
});

test('S3: every non-transaction anchor mode says it is not on chain', () => {
  assert.match(anchorModeLabel('simulated-payload'), /模拟/);
  assert.match(anchorModeLabel('simulated-payload'), /未上链/);
  assert.match(anchorModeLabel('wallet-signed-attestation'), /未上链/);
  assert.match(anchorModeLabel('browser-wallet-tx'), /未核验/);
});

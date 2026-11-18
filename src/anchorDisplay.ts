import type { OnchainAnchorRecord } from './types';

/**
 * SECURITY S3: only a RegisterData transaction sent by the wallet gets a CCDScan link.
 * Attestation digests and simulated hashes are not transactions, so linking them would
 * suggest an on-chain record that does not exist.
 */
export function anchorExplorerUrl(anchor: Pick<OnchainAnchorRecord, 'mode' | 'txHash'>): string | null {
  if (anchor.mode !== 'browser-wallet-tx') return null;
  // A Concordium transaction hash is 32 bytes of hex; anything else is not linkable.
  if (!/^[0-9a-f]{64}$/i.test(anchor.txHash)) return null;
  // Same CCDScan URL the ledger used before S3 (anchors are testnet only).
  return `https://testnet.ccdscan.io/transactions?d=${anchor.txHash}`;
}

/** Plain-language status for each anchor mode, shown next to the row. */
export function anchorModeLabel(mode: OnchainAnchorRecord['mode']): string {
  if (mode === 'browser-wallet-tx') return '链上 RegisterData（钱包上报，服务器未核验）';
  if (mode === 'wallet-signed-attestation') return '钱包签名摘要（非交易，未上链）';
  return '模拟锚定（未签名，未上链）';
}

import type { AnchorVerificationReason, OnchainAnchorRecord } from './types';

type AnchorView = Pick<OnchainAnchorRecord, 'mode' | 'txHash' | 'verification'>;

/** S10: a browser-wallet-tx anchor counts as on chain only after the server verified it. */
export function isVerifiedOnChain(anchor: AnchorView): boolean {
  return anchor.mode === 'browser-wallet-tx' && anchor.verification?.status === 'verified';
}

/**
 * S3/S10: only a RegisterData transaction the server verified gets a CCDScan link.
 * Attestation digests, simulated hashes and unverified transactions do not, so the ledger
 * never suggests an on-chain record the server has not seen.
 */
export function anchorExplorerUrl(anchor: AnchorView): string | null {
  if (!isVerifiedOnChain(anchor)) return null;
  // A Concordium transaction hash is 32 bytes of hex; anything else is not linkable.
  if (!/^[0-9a-f]{64}$/i.test(anchor.txHash)) return null;
  return `https://testnet.ccdscan.io/transactions?d=${anchor.txHash}`;
}

const REASON_TEXT: Record<AnchorVerificationReason, string> = {
  not_found: '链上暂未查到该交易',
  not_final: '交易尚未最终确认',
  unreachable: '无法连接 Testnet 节点，结果未知',
  legacy_unchecked: '旧记录，无法核验',
  sender_mismatch: '发送账户不是创建锚定的 owner',
  data_mismatch: '链上数据与审计根哈希不符',
  tx_failed: '交易在链上执行失败',
  wrong_type: '不是 RegisterData 交易',
};

/** Plain-language status for each anchor, shown next to the row. */
export function anchorModeLabel(anchor: AnchorView): string {
  if (anchor.mode === 'wallet-signed-attestation') return '钱包签名摘要（非交易，未上链）';
  if (anchor.mode === 'simulated-payload') return '模拟锚定（未签名，未上链）';
  const v = anchor.verification;
  if (v?.status === 'verified') return '链上 RegisterData（服务器已核验，已最终确认）';
  if (v?.status === 'rejected') return `钱包上报的交易核验失败：${REASON_TEXT[v.reason ?? 'wrong_type']}（未上链）`;
  if (v?.reason) return `钱包上报，服务器未核验：${REASON_TEXT[v.reason]}`;
  return '钱包上报，服务器未核验：等待核验';
}

/** S10: the frontend keeps calling verify only while the answer may still change. */
export function shouldPollVerification(anchor: AnchorView): boolean {
  if (anchor.mode !== 'browser-wallet-tx') return false;
  const v = anchor.verification;
  return !!v && v.status === 'unverified' && v.reason !== 'legacy_unchecked';
}

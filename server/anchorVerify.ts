// S10: server-side check that a `browser-wallet-tx` anchor is a finalized RegisterData transaction
// sent by the owner who created the anchor and carrying the expected bytes (SECURITY.md S10).
import { BlockHash } from '@concordium/web-sdk';
import type { BlockItemStatus } from '@concordium/web-sdk';
import { describeError } from './auth.ts';
import type { AnchorVerificationReason, AnchorVerificationStatus } from './types.ts';

/** Returns the status of a transaction, or undefined when the node does not know it. May throw. */
export type BlockItemStatusLookup = (txHashHex: string) => Promise<BlockItemStatus | undefined>;

export interface AnchorCheckInput {
  txHash: string;
  /** Owner account stored at creation (from the session); the on-chain sender must equal it. */
  ownerAccount: string | null;
  /** Hex of the bytes the RegisterData transaction must carry. */
  expectedData: string | null;
}

export interface AnchorCheckResult {
  status: AnchorVerificationStatus;
  reason: AnchorVerificationReason | null;
  detail: string | null;
  blockHash: string | null;
}

export interface AnchorCheckOptions {
  attempts?: number;
  delaysMs?: number[];
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const PAYLOAD_PREFIX = 'accordgate:eu-ai-act:';

/** Hex of the RegisterData payload the browser wallet sends (must match `anchorAuditRootWithWallet`). */
export function anchorPayloadHex(auditRange: string, rootHash: string): string {
  return Buffer.from(`${PAYLOAD_PREFIX}${auditRange}:${rootHash}`, 'utf8').toString('hex');
}

function isNotFoundError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 'NOT_FOUND' || code === 5;
}

class LookupTimeoutError extends Error {
  name = 'LookupTimeoutError';
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new LookupTimeoutError(`gRPC lookup took longer than ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const unverified = (reason: AnchorVerificationReason, detail: string): AnchorCheckResult => ({
  status: 'unverified',
  reason,
  detail,
  blockHash: null,
});
const rejected = (reason: AnchorVerificationReason, detail: string): AnchorCheckResult => ({
  status: 'rejected',
  reason,
  detail,
  blockHash: null,
});

function classify(item: BlockItemStatus, input: AnchorCheckInput): AnchorCheckResult {
  if (item.status !== 'finalized') {
    return unverified('not_final', `Transaction is ${item.status}, not finalized yet.`);
  }
  const summary = item.outcome?.summary as any;
  if (!summary) {
    // The SDK could not read the outcome: we do not know, so this is not a rejection.
    return unverified('unreachable', 'Node returned an outcome this SDK version cannot read.');
  }
  if (summary.type !== 'accountTransaction') return rejected('wrong_type', `Block item is ${summary.type}, not an account transaction.`);
  if (summary.transactionType === 'failed') {
    return rejected('tx_failed', `Transaction was rejected on chain (${summary.failedTransactionType ?? 'unknown type'}).`);
  }
  if (summary.transactionType !== 'registerData') {
    return rejected('wrong_type', `Transaction is ${summary.transactionType}, not registerData.`);
  }
  const sender: string | undefined = summary.sender?.address;
  if (!input.ownerAccount || sender !== input.ownerAccount) {
    return rejected('sender_mismatch', 'Transaction sender is not the owner who created this anchor.');
  }
  const data = String(summary.dataRegistered?.data ?? '').toLowerCase();
  if (!input.expectedData || data !== input.expectedData.toLowerCase()) {
    return rejected('data_mismatch', 'Registered data does not match this anchor\'s audit root.');
  }
  return { status: 'verified', reason: null, detail: null, blockHash: BlockHash.toHexString(item.outcome.blockHash) };
}

/**
 * Looks the transaction up with retries. A node behind a load balancer may answer stale, so
 * "not found" is retried too. "Not found" (every attempt said so) and "unknown" (any attempt
 * failed or timed out) stay separate.
 */
export async function verifyAnchorTx(
  lookup: BlockItemStatusLookup,
  input: AnchorCheckInput,
  opts: AnchorCheckOptions = {},
): Promise<AnchorCheckResult> {
  const attempts = opts.attempts ?? 3;
  const delays = opts.delaysMs ?? [300, 600];
  const timeoutMs = opts.timeoutMs ?? 3000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastError: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const item = await withTimeout(lookup(input.txHash), timeoutMs);
      if (item) return classify(item, input);
    } catch (err) {
      if (!isNotFoundError(err)) lastError = err;
    }
    if (i < attempts - 1) await sleep(delays[i] ?? delays[delays.length - 1] ?? 600);
  }
  if (lastError) {
    return unverified('unreachable', `Could not reach Concordium testnet (${describeError(lastError)}).`);
  }
  return unverified('not_found', `Transaction not found on Concordium testnet after ${attempts} lookups.`);
}

import { detectConcordiumProvider } from '@concordium/browser-wallet-api-helpers';
import { AccountTransactionType, DataBlob } from '@concordium/web-sdk';
import type { OnchainAnchorRecord } from '../types';

/**
 * Owner sign-in (SECURITY.md S1): connect the wallet, sign the server's one-time challenge,
 * and let the server check the signature against the account's on-chain keys.
 * Errors are thrown with the step that failed; nothing falls back silently.
 */
export async function signInWithWallet(api: {
  authChallenge: (accountAddress: string) => Promise<{ nonce: string; message: string }>;
  authVerify: (payload: { accountAddress: string; nonce: string; signature: unknown }) => Promise<{ account: string }>;
}): Promise<string> {
  let provider: Awaited<ReturnType<typeof detectConcordiumProvider>>;
  try {
    provider = await detectConcordiumProvider(1500);
  } catch (err) {
    throw new Error(
      `Concordium Browser Wallet not found (${err instanceof Error ? err.message : 'no provider'}). Install or unlock the extension.`,
    );
  }
  const accountAddress = await provider.connect();
  if (!accountAddress) {
    throw new Error('Wallet did not share an account; approve the connection in the wallet pop-up.');
  }
  const { nonce, message } = await api.authChallenge(accountAddress);
  let signature: unknown;
  try {
    signature = await provider.signMessage(accountAddress, message);
  } catch (err) {
    throw new Error(`Wallet did not sign the sign-in message (${err instanceof Error ? err.message : 'rejected'}).`);
  }
  const { account } = await api.authVerify({ accountAddress, nonce, signature });
  return account;
}

export async function signGovernanceActionWithWallet(
  accountAddress: string | null,
  actionMessage: string,
): Promise<{ signed: boolean; mode: 'browser-wallet' | 'deterministic-fallback'; signatureSummary: string }> {
  if (accountAddress) {
    try {
      const provider = await detectConcordiumProvider(1200);
      const signature = await provider.signMessage(accountAddress, actionMessage);
      return {
        signed: true,
        mode: 'browser-wallet',
        signatureSummary: JSON.stringify(signature).slice(0, 96),
      };
    } catch {
      // Fall through if user closed wallet popup or provider disconnected
    }
  }
  return {
    signed: false,
    mode: 'deterministic-fallback',
    signatureSummary: `local_attest_${actionMessage.slice(0, 32)}`,
  };
}

export async function anchorAuditRootWithWallet(
  accountAddress: string | null,
  rootHash: string,
  auditRange: string,
): Promise<{
  signerAddress: string | null;
  txHash: string;
  mode: OnchainAnchorRecord['mode'];
}> {
  const payloadText = `accordgate:eu-ai-act:${auditRange}:${rootHash}`;

  if (accountAddress) {
    try {
      const provider = await detectConcordiumProvider(1500);
      try {
        const txHash = await provider.sendTransaction(
          accountAddress,
          AccountTransactionType.RegisterData as never,
          {
            data: new DataBlob(new TextEncoder().encode(payloadText).buffer),
          } as never,
        );
        return {
          signerAddress: accountAddress,
          txHash,
          mode: 'browser-wallet-tx',
        };
      } catch {
        // If user has wallet connected but lacks testnet CCD for RegisterData, try wallet message attestation
        const sig = await provider.signMessage(accountAddress, payloadText);
        const encoded = new TextEncoder().encode(JSON.stringify(sig));
        const digest = await crypto.subtle.digest('SHA-256', encoded);
        const hashHex = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        return {
          signerAddress: accountAddress,
          txHash: hashHex,
          mode: 'wallet-signed-attestation',
        };
      }
    } catch {
      // Wallet provider unavailable
    }
  }

  // SECURITY S3: no wallet, so nothing is signed or sent. The server stores this as a simulated
  // anchor with no signer and its own `sim_` placeholder hash.
  return {
    signerAddress: null,
    txHash: '',
    mode: 'simulated-payload',
  };
}

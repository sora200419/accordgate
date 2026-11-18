import { detectConcordiumProvider } from '@concordium/browser-wallet-api-helpers';
import { AccountTransactionType, DataBlob } from '@concordium/web-sdk';
import type { OnchainAnchorRecord } from '../types';

export interface WalletConnectionState {
  connected: boolean;
  accountAddress: string | null;
  extensionAvailable: boolean;
  network: 'testnet';
}

export async function connectConcordiumBrowserWallet(): Promise<WalletConnectionState> {
  try {
    const provider = await detectConcordiumProvider(1500);
    const account = await provider.connect();
    if (!account) {
      return {
        connected: false,
        accountAddress: null,
        extensionAvailable: true,
        network: 'testnet',
      };
    }
    return {
      connected: true,
      accountAddress: account,
      extensionAvailable: true,
      network: 'testnet',
    };
  } catch {
    // Fallback deterministic Testnet sponsor-operator account when extension is not installed
    return {
      connected: false,
      accountAddress: null,
      extensionAvailable: false,
      network: 'testnet',
    };
  }
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
  signerAddress: string;
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

  // Deterministic Testnet RegisterData payload hash fallback when browser extension is absent
  const encoded = new TextEncoder().encode(`${payloadText}:${Date.now()}`);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const simulatedTxHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    signerAddress: accountAddress || '3WZE6etJMh38484f3281b15578f21b3033182369a3f8f451d0',
    txHash: simulatedTxHash,
    mode: 'simulated-payload',
  };
}

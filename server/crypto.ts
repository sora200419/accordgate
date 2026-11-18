import crypto from 'node:crypto';
import type { AgentCard, AuditEntry } from './types.ts';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',') + '}';
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function computeAgentCardHash(card: AgentCard): string {
  return sha256Hex(canonicalJson(card));
}

export function generateEd25519Identity(): {
  publicKeyHex: string;
  privateKeyPem: string;
  did: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyHex = Buffer.from(der).toString('hex');
  const shortFingerprint = sha256Hex(publicKeyHex).slice(0, 32);
  return {
    publicKeyHex,
    privateKeyPem,
    did: `did:ccd:testnet:${shortFingerprint}`,
  };
}

export function signAgentRequest(privateKeyPem: string, payload: string): string {
  const signature = crypto.sign(null, Buffer.from(payload, 'utf-8'), privateKeyPem);
  return signature.toString('hex');
}

export function verifyAgentSignature(publicKeyHex: string, payload: string, signatureHex: string): boolean {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyHex, 'hex'),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(payload, 'utf-8'), publicKey, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

export function generateZkpCommitment(payload: {
  agentDid: string;
  endpointPath: string;
  principalVerified: boolean;
  ageThresholdMet: boolean;
  jurisdictionMatched: boolean;
  vcdcMatched: boolean;
  nonce: string;
}): string {
  return 'zkp_' + sha256Hex(canonicalJson(payload));
}

export function computeAuditEntryHash(entry: Omit<AuditEntry, 'entryHash'>): string {
  return sha256Hex(canonicalJson(entry));
}

export function generateMockTxHash(seed: string): string {
  return '0xccd_' + sha256Hex(seed + ':' + Date.now().toString()).slice(0, 56);
}

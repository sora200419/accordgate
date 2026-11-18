export type AgentStatus = 'active' | 'suspended' | 'revoked';
export type ExternalChain = 'Ethereum' | 'Solana' | 'Base';
export type GatewayProtocol = 'MCP' | 'REST';

export type AuditDecision =
  | 'ALLOWED'
  | 'BLOCKED_UNVERIFIED'
  | 'BLOCKED_REVOKED'
  | 'BLOCKED_CARD_TAMPERED'
  | 'BLOCKED_SIGNATURE_INVALID'
  | 'BLOCKED_RATE_LIMITED'
  | 'BLOCKED_ZKP_FAILED'
  | 'BLOCKED_SPENDING_LIMIT'
  | 'PAYMENT_REQUIRED'
  | 'GOVERNANCE_REVOKED'
  | 'GOVERNANCE_CASCADE_REVOKED'
  | 'GOVERNANCE_CIRCUIT_OPENED'
  | 'GOVERNANCE_REACTIVATED'
  | 'AGENT_REGISTERED'
  | 'POLICY_UPDATED'
  | 'ONCHAIN_ANCHORED';

export interface ExternalKeyBinding {
  chain: ExternalChain;
  address: string;
  cis8BindingId: string;
}

export interface AgentCard {
  schema: 'cis-8004/v1';
  erc8004Compatible: boolean;
  name: string;
  role: string;
  mcpEndpoint: string;
  capabilities: string[];
  vcdcDomain: string | null;
  version: string;
}

export interface AgentRecord {
  id: string;
  did: string;
  name: string;
  role: string;
  ownerEntity: string;
  vcdcDomain: string | null;
  externalKeys: ExternalKeyBinding[];
  publicKeyHex: string;
  agentCard: AgentCard;
  cardHash: string;
  registryContract: string;
  keyRegistryContract: string;
  status: AgentStatus;
  verifiedPrincipal: boolean;
  dailySpentPlt: number;
  dailyLimitPlt: number;
  perCallLimitPlt: number;
  parentAgentId: string | null;
  delegationDepth: number;
  cascadeRevoke: boolean;
  consecutiveViolations: number;
  walletAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ZkpPredicates {
  principalVerified: boolean;
  minAge: number | null;
  allowedJurisdictions: string[];
  requireVcdcDomain: boolean;
}

export interface GatePolicy {
  id: string;
  serviceName: string;
  endpointPath: string;
  protocol: GatewayProtocol;
  description: string;
  requiredZkpPredicates: ZkpPredicates;
  maxPerCallPlt: number;
  dailyAgentCapPlt: number;
  x402PricePlt: number;
  asset: 'EURt';
  sponsoredGas: boolean;
  rateLimitQpm: number;
  circuitBreakerThreshold: number;
  updatedAt: string;
}

export interface X402Invoice {
  invoiceId: string;
  agentDid: string;
  endpointPath: string;
  amountPlt: number;
  asset: 'EURt';
  sponsorAccount: string;
  gasFeeCcd: number;
  gasPaidByAgent: number;
  status: 'challenged' | 'settled';
  txHash: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface ZkpVerificationSummary {
  principalVerified: boolean;
  ageThresholdMet: boolean;
  jurisdictionMatched: boolean;
  vcdcMatched: boolean;
  zkpCommitment: string;
  piiStored: false;
}

export interface AuditEntry {
  seq: number;
  timestamp: string;
  requestId: string;
  agentDid: string;
  agentName: string;
  endpointPath: string;
  protocol: GatewayProtocol | 'GOVERNANCE';
  decision: AuditDecision;
  reason: string;
  zkpClaims: ZkpVerificationSummary;
  x402ReceiptId: string | null;
  amountPlt: number;
  prevHash: string;
  entryHash: string;
}

export type WebhookEventType =
  | 'agent.revoked'
  | 'agent.cascade_revoked'
  | 'circuit_breaker.opened'
  | 'rate_limit.exceeded'
  | 'audit.tamper_detected'
  | 'audit.anchored';

export interface WebhookConfig {
  id: string;
  label: string;
  url: string;
  enabledEvents: WebhookEventType[];
  active: boolean;
  signingSecretPreview: string;
  lastStatusCode: number | null;
  lastDeliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryLog {
  id: string;
  webhookId: string;
  webhookLabel: string;
  eventType: string;
  statusCode: number | null;
  ok: boolean;
  latencyMs: number;
  detail: string;
  deliveredAt: string;
}

export interface OnchainAnchorRecord {
  id: string;
  rootHash: string;
  auditRange: string;
  totalEntries: number;
  signerAddress: string;
  txHash: string;
  network: 'testnet' | 'mainnet';
  mode: 'browser-wallet-tx' | 'wallet-signed-attestation' | 'simulated-payload';
  createdAt: string;
}

export interface GatewayDatabase {
  agents: AgentRecord[];
  proverKeys: Record<string, string>;
  policies: GatePolicy[];
  invoices: X402Invoice[];
  auditLogs: AuditEntry[];
  webhooks: WebhookConfig[];
  webhookDeliveries: WebhookDeliveryLog[];
  onchainAnchors: OnchainAnchorRecord[];
  tamperBackup?: AuditEntry[] | null;
}

export interface SandboxClaimInput {
  agentDid: string;
  endpointPath: string;
  jurisdictionClaim: string;
  ageClaim: number;
  principalVerifiedClaim: boolean;
  simulateTamperedCard?: boolean;
  simulateInvalidSignature?: boolean;
  simulateRateLimitSpike?: boolean;
  providedSignatureHex?: string | null;
  providedTimestamp?: string | null;
  /** Only the owner-only sandbox probe may let the server sign with the agent's stored key. */
  allowServerSigning?: boolean;
  requestedTransferPlt?: number;
  paymentReceiptId?: string | null;
}

export interface PipelineStepTrace {
  step: number;
  key: 'agentgate' | 'signature' | 'ratelimit' | 'zkp' | 'guardrail' | 'x402' | 'audit';
  title: string;
  status: 'passed' | 'failed' | 'challenged' | 'skipped';
  detail: string;
  metadata?: Record<string, unknown>;
}

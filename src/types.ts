export type AgentStatus = 'active' | 'suspended' | 'revoked';
export type ExternalChain = 'Ethereum' | 'Solana' | 'Base';
export type GatewayProtocol = 'MCP' | 'REST';

export type AuditDecision =
  | 'ALLOWED'
  | 'BLOCKED_UNVERIFIED'
  | 'BLOCKED_REVOKED'
  | 'BLOCKED_CARD_TAMPERED'
  | 'BLOCKED_SIGNATURE_INVALID'
  | 'BLOCKED_STALE_REQUEST'
  | 'BLOCKED_REPLAYED'
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
  | 'ONCHAIN_ANCHORED'
  | 'ANCHOR_NOT_ONCHAIN';

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

export interface VcdcDnsCheckResult {
  domain: string | null;
  dnsResolved: boolean;
  vcdcProofFound: boolean;
  txtRecords: string[];
  expectedTxtRecord: string;
  detail: string;
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
  /** SECURITY S3: settlement and gas sponsorship are simulated (older state files may lack the field). */
  simulated?: true;
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
  /** null when nothing was signed (simulated-payload). */
  signerAddress: string | null;
  /** A transaction hash only for browser-wallet-tx (reported by the wallet, not checked by the server). */
  txHash: string;
  network: 'testnet' | 'mainnet';
  mode: 'browser-wallet-tx' | 'wallet-signed-attestation' | 'simulated-payload';
  createdAt: string;
}

export interface OverviewMetrics {
  activeAgents: number;
  totalAgents: number;
  enforcedPolicies: number;
  totalCalls: number;
  blockedCalls: number;
  allowedCalls: number;
  totalSettledPlt: number;
  totalGasSavedCcd: number;
  chainValid: boolean;
  auditEntries: number;
  tamperDemoActive?: boolean;
}

export interface PipelineStepTrace {
  step: number;
  key: 'agentgate' | 'signature' | 'freshness' | 'ratelimit' | 'zkp' | 'guardrail' | 'x402' | 'audit';
  title: string;
  status: 'passed' | 'failed' | 'challenged' | 'skipped';
  detail: string;
  metadata?: Record<string, unknown>;
}

export interface SandboxProbeResponse {
  httpStatus: number;
  outcome: string;
  requestId: string;
  traces: PipelineStepTrace[];
  invoice?: X402Invoice;
  audit?: AuditEntry;
  headers: Record<string, string>;
  toolResponse?: {
    service: string;
    protocol: string;
    executedAt: string;
    accountablePrincipal: string;
    vcdcDomain: string | null;
    zkpCommitment: string;
    piiStoredOnGateway: false;
    x402Receipt: {
      invoiceId: string;
      txHash: string | null;
      amountPlt: number;
      gasPaidByAgentCcd: number;
      simulated: true;
    } | null;
    resultSummary: string;
  };
  error?: string;
}

export interface TestnetProbeResult {
  network: string;
  endpoint: string;
  reachable: boolean;
  latencyMs: number;
  mode: string;
  checkedAt: string;
  consensus?: {
    bestBlockHeight: string;
    lastFinalizedBlockHeight: string;
    bestBlock: string;
    protocolVersion: string;
  };
  contracts?: {
    cis8004: { address: string; found: boolean; name?: string; methods?: string[]; amountCcd?: number; error?: string };
    cis8: { address: string; found: boolean; name?: string; methods?: string[]; amountCcd?: number; error?: string };
  };
  detail: string;
}

export interface TestnetInspectResult {
  type: 'contract' | 'account';
  target: string;
  latencyMs: number;
  ccdScanUrl: string;
  data: Record<string, unknown>;
}

export interface ChainVerifyResult {
  valid: boolean;
  totalChecked: number;
  brokenAtSeq: number | null;
  tamperDemoActive?: boolean;
  tamperedSeq?: number;
}

export type WorkspaceTab = 'overview' | 'agents' | 'policies' | 'sandbox' | 'audit';

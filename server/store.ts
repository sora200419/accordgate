import fs from 'node:fs';
import path from 'node:path';
import {
  computeAgentCardHash,
  computeAuditEntryHash,
  generateEd25519Identity,
  generateZkpCommitment,
  sha256Hex,
} from './crypto.ts';
import type {
  AgentCard,
  AgentRecord,
  AuditDecision,
  AuditEntry,
  GatePolicy,
  GatewayDatabase,
  GatewayProtocol,
  ZkpVerificationSummary,
} from './types.ts';

// ACCORDGATE_DB_PATH lets tests use a temp file instead of data/gateway-state.json.
const DB_PATH = process.env.ACCORDGATE_DB_PATH
  ? path.resolve(process.env.ACCORDGATE_DB_PATH)
  : path.resolve(process.cwd(), 'data', 'gateway-state.json');
const DATA_DIR = path.dirname(DB_PATH);

// SECURITY S3: CIS-3 gas sponsorship is simulated, so there is no sponsor account; this literal is
// deliberately not an address.
export const SIMULATED_SPONSOR = 'simulated-sponsor';

function makeSeedAgent(params: {
  id: string;
  name: string;
  role: string;
  ownerEntity: string;
  vcdcDomain: string | null;
  externalKeys: AgentRecord['externalKeys'];
  mcpEndpoint: string;
  capabilities: string[];
  status: AgentRecord['status'];
  verifiedPrincipal: boolean;
  dailySpentPlt: number;
  dailyLimitPlt: number;
  perCallLimitPlt: number;
  parentAgentId?: string | null;
  delegationDepth?: number;
  cascadeRevoke?: boolean;
  consecutiveViolations?: number;
  walletAddress?: string | null;
  createdAt: string;
}): { agent: AgentRecord; privateKeyPem: string } {
  const card: AgentCard = {
    schema: 'cis-8004/v1',
    erc8004Compatible: true,
    name: params.name,
    role: params.role,
    mcpEndpoint: params.mcpEndpoint,
    capabilities: params.capabilities,
    vcdcDomain: params.vcdcDomain,
    version: '1.0.0',
  };
  const { publicKeyHex, privateKeyPem, did } = generateEd25519Identity();

  const agent: AgentRecord = {
    id: params.id,
    did,
    name: params.name,
    role: params.role,
    ownerEntity: params.ownerEntity,
    vcdcDomain: params.vcdcDomain,
    externalKeys: params.externalKeys,
    publicKeyHex,
    agentCard: card,
    cardHash: computeAgentCardHash(card),
    registryContract: '10082:0 (CIS-8004)',
    keyRegistryContract: '10081:0 (CIS-8)',
    status: params.status,
    verifiedPrincipal: params.verifiedPrincipal,
    dailySpentPlt: params.dailySpentPlt,
    dailyLimitPlt: params.dailyLimitPlt,
    perCallLimitPlt: params.perCallLimitPlt,
    parentAgentId: params.parentAgentId ?? null,
    delegationDepth: params.delegationDepth ?? 0,
    cascadeRevoke: params.cascadeRevoke !== false,
    consecutiveViolations: params.consecutiveViolations ?? 0,
    walletAddress: params.walletAddress ?? null,
    createdAt: params.createdAt,
    updatedAt: params.createdAt,
  };

  return { agent, privateKeyPem };
}

function createInitialDatabase(): GatewayDatabase {
  const baseTime = new Date('2026-11-16T10:00:00.000Z').getTime();
  const iso = (offsetMinutes: number) => new Date(baseTime + offsetMinutes * 60_000).toISOString();

  const seededPairs = [
    makeSeedAgent({
      id: 'agt-euroclear',
      name: 'EuroClear Treasury Copilot',
      role: 'Cross-border SEPA & PLT Treasury Execution Agent',
      ownerEntity: 'EuroClear Digital Operations GmbH',
      vcdcDomain: 'concordium.com',
      externalKeys: [
        {
          chain: 'Ethereum',
          address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          cis8BindingId: 'cis8-eth-001',
        },
        {
          chain: 'Base',
          address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
          cis8BindingId: 'cis8-base-002',
        },
      ],
      mcpEndpoint: 'https://mcp.euroclear-demo.eu/treasury',
      capabilities: ['sanctions.screen', 'sepa.settlement', 'eu-ai-act.telemetry'],
      status: 'active',
      verifiedPrincipal: true,
      dailySpentPlt: 145.5,
      dailyLimitPlt: 500,
      perCallLimitPlt: 100,
      parentAgentId: null,
      delegationDepth: 0,
      cascadeRevoke: true,
      consecutiveViolations: 0,
      walletAddress: null,
      createdAt: iso(0),
    }),
    makeSeedAgent({
      id: 'agt-nordic-kyc',
      name: 'NordicKYC Compliance Runner',
      role: 'Delegated Sub-Agent · Sanctions & PEP Verification',
      ownerEntity: 'NordicReg Tech AB (Delegated by EuroClear)',
      vcdcDomain: 'encodeclub.com',
      externalKeys: [
        {
          chain: 'Solana',
          address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
          cis8BindingId: 'cis8-sol-003',
        },
      ],
      mcpEndpoint: 'https://mcp.nordicreg-demo.se/kyc',
      capabilities: ['sanctions.screen', 'market.research'],
      status: 'active',
      verifiedPrincipal: true,
      dailySpentPlt: 42.0,
      dailyLimitPlt: 300,
      perCallLimitPlt: 50,
      parentAgentId: 'agt-euroclear',
      delegationDepth: 1,
      cascadeRevoke: true,
      consecutiveViolations: 0,
      createdAt: iso(15),
    }),
    makeSeedAgent({
      id: 'agt-procurement',
      name: 'Rheinland Procurement Bot',
      role: 'Supplier Invoice & Market Data Agent',
      ownerEntity: 'Rheinland Industrial AG',
      vcdcDomain: 'ops.rheinland-trade.de',
      externalKeys: [
        {
          chain: 'Ethereum',
          address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
          cis8BindingId: 'cis8-eth-004',
        },
      ],
      mcpEndpoint: 'https://mcp.rheinland-trade.de/procurement',
      capabilities: ['market.research'],
      status: 'suspended',
      verifiedPrincipal: true,
      dailySpentPlt: 480.0,
      dailyLimitPlt: 500,
      perCallLimitPlt: 75,
      parentAgentId: null,
      delegationDepth: 0,
      cascadeRevoke: true,
      consecutiveViolations: 3,
      createdAt: iso(30),
    }),
    makeSeedAgent({
      id: 'agt-unverified',
      name: 'Legacy External Scraper',
      role: 'Unverified Third-Party Data Harvester',
      ownerEntity: 'Unverified Entity',
      vcdcDomain: null,
      externalKeys: [
        {
          chain: 'Ethereum',
          address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
          cis8BindingId: 'cis8-eth-revoked',
        },
      ],
      mcpEndpoint: 'https://untrusted-node.example.invalid/mcp',
      capabilities: ['raw.fetch'],
      status: 'revoked',
      verifiedPrincipal: false,
      dailySpentPlt: 0,
      dailyLimitPlt: 50,
      perCallLimitPlt: 10,
      parentAgentId: null,
      delegationDepth: 0,
      cascadeRevoke: true,
      consecutiveViolations: 5,
      createdAt: iso(45),
    }),
  ];

  const agents = seededPairs.map((p) => p.agent);
  const proverKeys: Record<string, string> = {};
  for (const p of seededPairs) {
    proverKeys[p.agent.did] = p.privateKeyPem;
  }

  const policies: GatePolicy[] = [
    {
      id: 'pol-sanctions',
      serviceName: 'EU Sanctions & PEP Screening MCP',
      endpointPath: '/api/mcp/eu-sanctions-screen',
      protocol: 'MCP',
      description: 'Screens counterparty wallets and entities against EU sanctions lists without retaining caller PII.',
      requiredZkpPredicates: {
        principalVerified: true,
        minAge: 18,
        allowedJurisdictions: ['EU', 'EEA', 'CH'],
        requireVcdcDomain: true,
      },
      maxPerCallPlt: 25,
      dailyAgentCapPlt: 500,
      x402PricePlt: 0.5,
      asset: 'EURt',
      sponsoredGas: true,
      rateLimitQpm: 20,
      circuitBreakerThreshold: 3,
      updatedAt: iso(10),
    },
    {
      id: 'pol-treasury',
      serviceName: 'Automated SEPA / PLT Treasury Settlement',
      endpointPath: '/api/mcp/treasury-settlement',
      protocol: 'MCP',
      description: 'High-assurance treasury execution tool requiring corporate VCDC domain proof, 21+ principal age, and x402 settlement.',
      requiredZkpPredicates: {
        principalVerified: true,
        minAge: 21,
        allowedJurisdictions: ['EU', 'EEA'],
        requireVcdcDomain: true,
      },
      maxPerCallPlt: 100,
      dailyAgentCapPlt: 500,
      x402PricePlt: 2.0,
      asset: 'EURt',
      sponsoredGas: true,
      rateLimitQpm: 12,
      circuitBreakerThreshold: 2,
      updatedAt: iso(12),
    },
    {
      id: 'pol-research',
      serviceName: 'Regulated Market Research Feed',
      endpointPath: '/api/rest/age-gated-research',
      protocol: 'REST',
      description: 'MiCA-aligned institutional research endpoint gated by ZKP jurisdiction and 18+ age predicate.',
      requiredZkpPredicates: {
        principalVerified: true,
        minAge: 18,
        allowedJurisdictions: ['EU', 'EEA', 'UK', 'SG'],
        requireVcdcDomain: false,
      },
      maxPerCallPlt: 15,
      dailyAgentCapPlt: 300,
      x402PricePlt: 0.25,
      asset: 'EURt',
      sponsoredGas: true,
      rateLimitQpm: 30,
      circuitBreakerThreshold: 3,
      updatedAt: iso(14),
    },
    {
      id: 'pol-audit-sync',
      serviceName: 'EU AI Act Model Telemetry Sync',
      endpointPath: '/api/mcp/internal-audit-sync',
      protocol: 'MCP',
      description: 'Zero-fee internal regulatory reporting tool requiring EU principal accountability and VCDC domain binding.',
      requiredZkpPredicates: {
        principalVerified: true,
        minAge: null,
        allowedJurisdictions: ['EU'],
        requireVcdcDomain: true,
      },
      maxPerCallPlt: 50,
      dailyAgentCapPlt: 500,
      x402PricePlt: 0,
      asset: 'EURt',
      sponsoredGas: true,
      rateLimitQpm: 40,
      circuitBreakerThreshold: 5,
      updatedAt: iso(16),
    },
  ];

  const db: GatewayDatabase = {
    agents,
    proverKeys,
    policies,
    invoices: [
      {
        invoiceId: 'x402-inv-seed-001',
        agentDid: agents[0].did,
        endpointPath: '/api/mcp/eu-sanctions-screen',
        amountPlt: 0.5,
        asset: 'EURt',
        sponsorAccount: SIMULATED_SPONSOR,
        gasFeeCcd: 0.0124,
        gasPaidByAgent: 0,
        status: 'settled',
        txHash: 'sim_9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e',
        createdAt: iso(60),
        settledAt: iso(60),
        simulated: true,
      },
      {
        invoiceId: 'x402-inv-seed-002',
        agentDid: agents[1].did,
        endpointPath: '/api/rest/age-gated-research',
        amountPlt: 0.25,
        asset: 'EURt',
        sponsorAccount: SIMULATED_SPONSOR,
        gasFeeCcd: 0.0118,
        gasPaidByAgent: 0,
        status: 'settled',
        txHash: 'sim_1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5',
        createdAt: iso(90),
        settledAt: iso(90),
        simulated: true,
      },
    ],
    auditLogs: [],
    webhooks: [],
    webhookDeliveries: [],
    onchainAnchors: [],
    tamperBackup: null,
  };

  const seedEvents: Array<{
    offsetMin: number;
    reqId: string;
    agent: AgentRecord;
    endpointPath: string;
    protocol: GatewayProtocol | 'GOVERNANCE';
    decision: AuditDecision;
    reason: string;
    zkp: { principalVerified: boolean; ageThresholdMet: boolean; jurisdictionMatched: boolean; vcdcMatched: boolean };
    receiptId: string | null;
    amountPlt: number;
  }> = [
    {
      offsetMin: 5,
      reqId: 'req-seed-101',
      agent: agents[0],
      endpointPath: '/api/mcp/internal-audit-sync',
      protocol: 'GOVERNANCE',
      decision: 'AGENT_REGISTERED',
      reason:
        '[seed demo data] Registered in the local registry (not written to CIS-8004 10082:0) with Ed25519 keypair, CIS-8 EVM/Base key bindings (not verified on chain) and VCDC domain.',
      zkp: { principalVerified: true, ageThresholdMet: true, jurisdictionMatched: true, vcdcMatched: true },
      receiptId: null,
      amountPlt: 0,
    },
    {
      offsetMin: 60,
      reqId: 'req-seed-102',
      agent: agents[0],
      endpointPath: '/api/mcp/eu-sanctions-screen',
      protocol: 'MCP',
      decision: 'ALLOWED',
      reason:
        '[seed demo data] Local registry active · Ed25519 verified · self-reported EU, 18+ (simulated ZKP, SHA-256 commitment) · x402 settlement simulated (no CIS-3 transaction).',
      zkp: { principalVerified: true, ageThresholdMet: true, jurisdictionMatched: true, vcdcMatched: true },
      receiptId: 'x402-inv-seed-001',
      amountPlt: 0.5,
    },
    {
      offsetMin: 75,
      reqId: 'req-seed-103',
      agent: agents[3],
      endpointPath: '/api/mcp/treasury-settlement',
      protocol: 'MCP',
      decision: 'BLOCKED_REVOKED',
      reason: '[seed demo data] AgentGate rejected request: agent status is REVOKED in the local registry.',
      zkp: { principalVerified: false, ageThresholdMet: false, jurisdictionMatched: false, vcdcMatched: false },
      receiptId: null,
      amountPlt: 0,
    },
    {
      offsetMin: 90,
      reqId: 'req-seed-104',
      agent: agents[1],
      endpointPath: '/api/rest/age-gated-research',
      protocol: 'REST',
      decision: 'ALLOWED',
      reason:
        '[seed demo data] Delegated sub-agent (local registry) · Ed25519 verified · self-reported jurisdiction & age (simulated ZKP) · x402 settlement simulated, 0.25 EURt.',
      zkp: { principalVerified: true, ageThresholdMet: true, jurisdictionMatched: true, vcdcMatched: true },
      receiptId: 'x402-inv-seed-002',
      amountPlt: 0.25,
    },
    {
      offsetMin: 110,
      reqId: 'req-seed-105',
      agent: agents[2],
      endpointPath: '/api/mcp/treasury-settlement',
      protocol: 'MCP',
      decision: 'GOVERNANCE_CIRCUIT_OPENED',
      reason: '[seed demo data] Circuit breaker auto-suspended agent after 3 consecutive policy violations.',
      zkp: { principalVerified: true, ageThresholdMet: false, jurisdictionMatched: true, vcdcMatched: true },
      receiptId: null,
      amountPlt: 0,
    },
  ];

  for (const ev of seedEvents) {
    appendAuditEntryToDb(db, {
      timestamp: iso(ev.offsetMin),
      requestId: ev.reqId,
      agentDid: ev.agent.did,
      agentName: ev.agent.name,
      endpointPath: ev.endpointPath,
      protocol: ev.protocol,
      decision: ev.decision,
      reason: ev.reason,
      zkpClaims: {
        ...ev.zkp,
        zkpCommitment: generateZkpCommitment({
          agentDid: ev.agent.did,
          endpointPath: ev.endpointPath,
          ...ev.zkp,
          nonce: ev.reqId,
        }),
        piiStored: false,
      },
      x402ReceiptId: ev.receiptId,
      amountPlt: ev.amountPlt,
    });
  }

  return db;
}

export function appendAuditEntryToDb(
  db: GatewayDatabase,
  input: {
    timestamp?: string;
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
  },
): AuditEntry {
  const prevHash = db.auditLogs.length > 0 ? db.auditLogs[db.auditLogs.length - 1].entryHash : '0'.repeat(64);
  const seq = db.auditLogs.length + 1;
  const unsigned: Omit<AuditEntry, 'entryHash'> = {
    seq,
    timestamp: input.timestamp ?? new Date().toISOString(),
    requestId: input.requestId,
    agentDid: input.agentDid,
    agentName: input.agentName,
    endpointPath: input.endpointPath,
    protocol: input.protocol,
    decision: input.decision,
    reason: input.reason,
    zkpClaims: input.zkpClaims,
    x402ReceiptId: input.x402ReceiptId,
    amountPlt: input.amountPlt,
    prevHash,
  };
  const entry: AuditEntry = {
    ...unsigned,
    entryHash: computeAuditEntryHash(unsigned),
  };
  db.auditLogs.push(entry);
  return entry;
}

export function loadDatabase(): GatewayDatabase {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    const initial = createInitialDatabase();
    saveDatabase(initial);
    return initial;
  }
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as GatewayDatabase;
  if (!parsed.proverKeys || !parsed.webhooks || !parsed.onchainAnchors) {
    const upgraded = createInitialDatabase();
    saveDatabase(upgraded);
    return upgraded;
  }
  return parsed;
}

export function saveDatabase(db: GatewayDatabase): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
}

export function resetDatabase(): GatewayDatabase {
  const fresh = createInitialDatabase();
  saveDatabase(fresh);
  return fresh;
}

export function collectDescendantAgents(agents: AgentRecord[], rootId: string): AgentRecord[] {
  const result: AgentRecord[] = [];
  const queue = [rootId];
  const visited = new Set<string>([rootId]);
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const candidate of agents) {
      if (candidate.parentAgentId === currentId && !visited.has(candidate.id)) {
        visited.add(candidate.id);
        result.push(candidate);
        queue.push(candidate.id);
      }
    }
  }
  return result;
}

export function verifyAuditHashChain(logs: AuditEntry[]): {
  valid: boolean;
  totalChecked: number;
  brokenAtSeq: number | null;
} {
  let expectedPrev = '0'.repeat(64);
  for (const entry of logs) {
    if (entry.prevHash !== expectedPrev) {
      return { valid: false, totalChecked: entry.seq, brokenAtSeq: entry.seq };
    }
    const { entryHash, ...unsigned } = entry;
    const recomputed = computeAuditEntryHash(unsigned);
    if (recomputed !== entryHash) {
      return { valid: false, totalChecked: entry.seq, brokenAtSeq: entry.seq };
    }
    expectedPrev = entryHash;
  }
  return { valid: true, totalChecked: logs.length, brokenAtSeq: null };
}

export function createNewAgentRecord(params: {
  name: string;
  role: string;
  ownerEntity: string;
  vcdcDomain: string | null;
  chain: 'Ethereum' | 'Solana' | 'Base';
  externalAddress: string;
  mcpEndpoint: string;
  capabilities: string[];
  dailyLimitPlt: number;
  perCallLimitPlt: number;
  parentAgentId?: string | null;
  delegationDepth?: number;
  cascadeRevoke?: boolean;
  walletAddress?: string | null;
}): { agent: AgentRecord; privateKeyPem: string } {
  const { publicKeyHex, privateKeyPem, did } = generateEd25519Identity();
  const card: AgentCard = {
    schema: 'cis-8004/v1',
    erc8004Compatible: true,
    name: params.name,
    role: params.role,
    mcpEndpoint: params.mcpEndpoint,
    capabilities: params.capabilities,
    vcdcDomain: params.vcdcDomain,
    version: '1.0.0',
  };
  const now = new Date().toISOString();
  const agent: AgentRecord = {
    id: 'agt-' + sha256Hex(did + now).slice(0, 8),
    did,
    name: params.name,
    role: params.role,
    ownerEntity: params.ownerEntity,
    vcdcDomain: params.vcdcDomain,
    externalKeys: [
      {
        chain: params.chain,
        address: params.externalAddress,
        cis8BindingId: `cis8-${params.chain.toLowerCase()}-${sha256Hex(params.externalAddress).slice(0, 6)}`,
      },
    ],
    publicKeyHex,
    agentCard: card,
    cardHash: computeAgentCardHash(card),
    registryContract: '10082:0 (CIS-8004)',
    keyRegistryContract: '10081:0 (CIS-8)',
    status: 'active',
    verifiedPrincipal: true,
    dailySpentPlt: 0,
    dailyLimitPlt: params.dailyLimitPlt,
    perCallLimitPlt: params.perCallLimitPlt,
    parentAgentId: params.parentAgentId ?? null,
    delegationDepth: params.delegationDepth ?? 0,
    cascadeRevoke: params.cascadeRevoke !== false,
    consecutiveViolations: 0,
    walletAddress: params.walletAddress ?? null,
    createdAt: now,
    updatedAt: now,
  };
  return { agent, privateKeyPem };
}

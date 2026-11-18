import type {
  AgentRecord,
  AgentStatus,
  AuditEntry,
  ChainVerifyResult,
  GatePolicy,
  OnchainAnchorRecord,
  OverviewMetrics,
  SandboxProbeResponse,
  TestnetInspectResult,
  TestnetProbeResult,
  VcdcDnsCheckResult,
  WebhookConfig,
  WebhookDeliveryLog,
  WebhookEventType,
  X402Invoice,
} from './types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json();
  if (!res.ok && res.status !== 402 && res.status !== 403 && res.status !== 429) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }
  return data as T;
}

export const api = {
  getOverview: () =>
    requestJson<{ metrics: OverviewMetrics; recentLogs: AuditEntry[] }>('/api/overview'),

  getAgents: () => requestJson<{ agents: AgentRecord[] }>('/api/agents'),

  createAgent: (payload: {
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
    cascadeRevoke?: boolean;
    walletAddress?: string | null;
  }) =>
    requestJson<{ agent: AgentRecord }>('/api/agents', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAgentStatus: (id: string, status: AgentStatus) =>
    requestJson<{ agent: AgentRecord; cascadedIds?: string[] }>(`/api/agents/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  rotateAgentCard: (id: string) =>
    requestJson<{ agent: AgentRecord }>(`/api/agents/${id}/rotate-card`, {
      method: 'POST',
    }),

  verifyAgentVcdc: (id: string) =>
    requestJson<VcdcDnsCheckResult>(`/api/agents/${id}/verify-vcdc`, {
      method: 'POST',
    }),

  getPolicies: () => requestJson<{ policies: GatePolicy[] }>('/api/policies'),

  createPolicy: (payload: {
    serviceName: string;
    endpointPath: string;
    protocol: 'MCP' | 'REST';
    description: string;
    requiredZkpPredicates: GatePolicy['requiredZkpPredicates'];
    maxPerCallPlt: number;
    dailyAgentCapPlt: number;
    x402PricePlt: number;
    sponsoredGas: boolean;
    rateLimitQpm?: number;
    circuitBreakerThreshold?: number;
  }) =>
    requestJson<{ policy: GatePolicy }>('/api/policies', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updatePolicy: (id: string, patch: Partial<GatePolicy>) =>
    requestJson<{ policy: GatePolicy }>(`/api/policies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  probeSandbox: async (payload: {
    agentDid: string;
    endpointPath: string;
    jurisdictionClaim: string;
    ageClaim: number;
    principalVerifiedClaim: boolean;
    simulateTamperedCard?: boolean;
    simulateInvalidSignature?: boolean;
    simulateRateLimitSpike?: boolean;
    requestedTransferPlt?: number;
    paymentReceiptId?: string | null;
  }): Promise<SandboxProbeResponse> => {
    const res = await fetch('/api/sandbox/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as SandboxProbeResponse;
  },

  callMcpRpc: async (
    body: { jsonrpc: '2.0'; id: number; method: string; params?: Record<string, unknown> },
    headers: Record<string, string>,
  ): Promise<{ httpStatus: number; body: unknown }> => {
    const res = await fetch('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
    return { httpStatus: res.status, body: await res.json() };
  },

  settleX402Invoice: (invoiceId: string) =>
    requestJson<{ invoice: X402Invoice }>('/api/x402/settle', {
      method: 'POST',
      body: JSON.stringify({ invoiceId }),
    }),

  getAuditLogs: (decision = 'all', q = '') => {
    const params = new URLSearchParams({ decision, q });
    return requestJson<{ logs: AuditEntry[]; chainStatus: ChainVerifyResult; tamperDemoActive?: boolean }>(
      `/api/audit?${params.toString()}`,
    );
  },

  verifyAuditChain: () => requestJson<ChainVerifyResult>('/api/audit/verify'),

  simulateAuditTamper: () =>
    requestJson<ChainVerifyResult>('/api/audit/simulate-tamper', {
      method: 'POST',
    }),

  restoreAuditTamper: () =>
    requestJson<ChainVerifyResult>('/api/audit/restore-tamper', {
      method: 'POST',
    }),

  getWebhooks: () =>
    requestJson<{ webhooks: WebhookConfig[]; deliveries: WebhookDeliveryLog[] }>('/api/webhooks'),

  createWebhook: (payload: { label: string; url: string; enabledEvents: WebhookEventType[] }) =>
    requestJson<{ webhook: WebhookConfig }>('/api/webhooks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteWebhook: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/webhooks/${id}`, {
      method: 'DELETE',
    }),

  testWebhook: (id: string) =>
    requestJson<{ delivery: WebhookDeliveryLog; webhook: WebhookConfig }>(`/api/webhooks/${id}/test`, {
      method: 'POST',
    }),

  getAnchors: () => requestJson<{ anchors: OnchainAnchorRecord[] }>('/api/anchors'),

  createAnchor: (payload: {
    signerAddress: string;
    txHash: string;
    mode: OnchainAnchorRecord['mode'];
  }) =>
    requestJson<{ anchor: OnchainAnchorRecord }>('/api/anchors', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  probeTestnet: () =>
    requestJson<TestnetProbeResult>('/api/testnet/probe', {
      method: 'POST',
    }),

  inspectTestnetTarget: (target: string) =>
    requestJson<TestnetInspectResult>('/api/testnet/inspect', {
      method: 'POST',
      body: JSON.stringify({ target }),
    }),

  resetSandbox: () =>
    requestJson<{ status: string }>('/api/sandbox/reset', {
      method: 'POST',
    }),
};

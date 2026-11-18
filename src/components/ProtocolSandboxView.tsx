import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Copy, Play, ServerCog, Terminal, Wallet } from 'lucide-react';
import { api } from '../api';
import type { AgentRecord, GatePolicy, PipelineStepTrace, SandboxProbeResponse, X402Invoice } from '../types';
import { SimulatedBadge } from './SimulatedBadge';

// SECURITY S3: pipeline steps whose result is simulated, with the reason shown on the badge.
const SIMULATED_STEP_REASON: Partial<Record<PipelineStepTrace['key'], string>> = {
  agentgate: '只查本地注册表，未查询 CIS-8004 合约',
  zkp: '自报属性 + SHA-256 承诺（模拟 ZKP，非零知识证明）',
  x402: '模拟结算：无真实付款，未发送 CIS-3 赞助交易',
};
const X402_SIMULATED_REASON = SIMULATED_STEP_REASON.x402 as string;

interface ProtocolSandboxViewProps {
  agents: AgentRecord[];
  policies: GatePolicy[];
  onRefreshAll: () => Promise<void>;
  onNotify: (message: string) => void;
}

type SandboxMode = 'rest' | 'mcp';
type McpMethod = 'initialize' | 'tools/list' | 'tools/call';

export function ProtocolSandboxView({
  agents,
  policies,
  onRefreshAll,
  onNotify,
}: ProtocolSandboxViewProps) {
  const [mode, setMode] = useState<SandboxMode>('rest');
  const [agentDid, setAgentDid] = useState<string>(agents[0]?.did ?? '');
  const [endpointPath, setEndpointPath] = useState<string>(policies[0]?.endpointPath ?? '');
  const [jurisdictionClaim, setJurisdictionClaim] = useState<string>('EU');
  const [ageClaim, setAgeClaim] = useState<number>(25);
  const [principalVerifiedClaim, setPrincipalVerifiedClaim] = useState<boolean>(true);
  const [simulateTamperedCard, setSimulateTamperedCard] = useState<boolean>(false);
  const [simulateInvalidSignature, setSimulateInvalidSignature] = useState<boolean>(false);
  const [simulateRateLimitSpike, setSimulateRateLimitSpike] = useState<boolean>(false);
  const [requestedTransferPlt, setRequestedTransferPlt] = useState<number>(5);
  const [sdkLang, setSdkLang] = useState<'curl' | 'typescript' | 'python'>('curl');

  const [running, setRunning] = useState(false);
  const [settling, setSettling] = useState(false);
  const [result, setResult] = useState<SandboxProbeResponse | null>(null);
  const [showRawHeaders, setShowRawHeaders] = useState(false);

  const mcpPolicies = useMemo(() => policies.filter((p) => p.protocol === 'MCP'), [policies]);
  const [mcpMethod, setMcpMethod] = useState<McpMethod>('tools/call');
  const [mcpToolName, setMcpToolName] = useState<string>(
    mcpPolicies[0]?.endpointPath.split('/').pop() ?? 'eu-sanctions-screen',
  );
  const [mcpReceiptId, setMcpReceiptId] = useState<string>('');
  const [mcpRunning, setMcpRunning] = useState(false);
  const [mcpResponse, setMcpResponse] = useState<{
    httpStatus: number;
    requestPayload: unknown;
    body: unknown;
  } | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.did === agentDid) ?? agents[0],
    [agents, agentDid],
  );
  const selectedPolicy = useMemo(
    () => policies.find((p) => p.endpointPath === endpointPath) ?? policies[0],
    [policies, endpointPath],
  );

  function applyPreset(
    preset: 'pass' | 'revoked' | 'tampered' | 'sig_fail' | 'rate_limit' | 'zkp_fail' | 'limit_fail',
  ) {
    const activeAgt = agents.find((a) => a.status === 'active') ?? agents[0];
    const revokedAgt = agents.find((a) => a.status === 'revoked') ?? agents[agents.length - 1];
    const paidPol = policies.find((p) => p.x402PricePlt > 0) ?? policies[0];

    if (preset === 'pass') {
      if (activeAgt) setAgentDid(activeAgt.did);
      if (paidPol) setEndpointPath(paidPol.endpointPath);
      setJurisdictionClaim('EU');
      setAgeClaim(25);
      setPrincipalVerifiedClaim(true);
      setSimulateTamperedCard(false);
      setSimulateInvalidSignature(false);
      setSimulateRateLimitSpike(false);
      setRequestedTransferPlt(5);
    } else if (preset === 'revoked') {
      if (revokedAgt) setAgentDid(revokedAgt.did);
      if (paidPol) setEndpointPath(paidPol.endpointPath);
      setJurisdictionClaim('EU');
      setAgeClaim(25);
      setPrincipalVerifiedClaim(true);
      setSimulateTamperedCard(false);
      setSimulateInvalidSignature(false);
      setSimulateRateLimitSpike(false);
      setRequestedTransferPlt(5);
    } else if (preset === 'tampered') {
      if (activeAgt) setAgentDid(activeAgt.did);
      if (paidPol) setEndpointPath(paidPol.endpointPath);
      setJurisdictionClaim('EU');
      setAgeClaim(25);
      setPrincipalVerifiedClaim(true);
      setSimulateTamperedCard(true);
      setSimulateInvalidSignature(false);
      setSimulateRateLimitSpike(false);
      setRequestedTransferPlt(5);
    } else if (preset === 'sig_fail') {
      if (activeAgt) setAgentDid(activeAgt.did);
      if (paidPol) setEndpointPath(paidPol.endpointPath);
      setJurisdictionClaim('EU');
      setAgeClaim(25);
      setPrincipalVerifiedClaim(true);
      setSimulateTamperedCard(false);
      setSimulateInvalidSignature(true);
      setSimulateRateLimitSpike(false);
      setRequestedTransferPlt(5);
    } else if (preset === 'rate_limit') {
      if (activeAgt) setAgentDid(activeAgt.did);
      if (paidPol) setEndpointPath(paidPol.endpointPath);
      setJurisdictionClaim('EU');
      setAgeClaim(25);
      setPrincipalVerifiedClaim(true);
      setSimulateTamperedCard(false);
      setSimulateInvalidSignature(false);
      setSimulateRateLimitSpike(true);
      setRequestedTransferPlt(5);
    } else if (preset === 'zkp_fail') {
      if (activeAgt) setAgentDid(activeAgt.did);
      if (paidPol) setEndpointPath(paidPol.endpointPath);
      setJurisdictionClaim('US');
      setAgeClaim(17);
      setPrincipalVerifiedClaim(true);
      setSimulateTamperedCard(false);
      setSimulateInvalidSignature(false);
      setSimulateRateLimitSpike(false);
      setRequestedTransferPlt(5);
    } else if (preset === 'limit_fail') {
      if (activeAgt) setAgentDid(activeAgt.did);
      if (paidPol) setEndpointPath(paidPol.endpointPath);
      setJurisdictionClaim('EU');
      setAgeClaim(25);
      setPrincipalVerifiedClaim(true);
      setSimulateTamperedCard(false);
      setSimulateInvalidSignature(false);
      setSimulateRateLimitSpike(false);
      setRequestedTransferPlt(250);
    }
  }

  async function runProbe(receiptId: string | null = null) {
    if (!selectedAgent || !selectedPolicy) return;
    setRunning(true);
    try {
      const res = await api.probeSandbox({
        agentDid: selectedAgent.did,
        endpointPath: selectedPolicy.endpointPath,
        jurisdictionClaim,
        ageClaim,
        principalVerifiedClaim,
        simulateTamperedCard,
        simulateInvalidSignature,
        simulateRateLimitSpike,
        requestedTransferPlt,
        paymentReceiptId: receiptId,
      });
      setResult(res);
      await onRefreshAll();
    } finally {
      setRunning(false);
    }
  }

  async function handleSettleAndRetry() {
    if (!result?.invoice) return;
    setSettling(true);
    try {
      const { invoice } = await api.settleX402Invoice(result.invoice.invoiceId);
      onNotify('x402 发票已模拟结算（未上链，无真实转账，未发送 CIS-3 交易）');
      await runProbe(invoice.invoiceId);
    } finally {
      setSettling(false);
    }
  }

  async function runMcpRpc(overrideReceiptId?: string) {
    if (!selectedAgent) return;
    setMcpRunning(true);
    try {
      const requestPayload: { jsonrpc: '2.0'; id: number; method: string; params?: Record<string, unknown> } =
        mcpMethod === 'tools/call'
          ? {
              jsonrpc: '2.0',
              id: Date.now(),
              method: 'tools/call',
              params: {
                name: mcpToolName,
                arguments: {
                  targetEntity: 'counterparty-eu-0x9f12',
                  requestedTransferPlt,
                },
              },
            }
          : mcpMethod === 'initialize'
          ? {
              jsonrpc: '2.0',
              id: Date.now(),
              method: 'initialize',
              params: {
                protocolVersion: '2024-11-05',
                clientInfo: { name: 'accordgate-sandbox-client', version: '1.0.0' },
              },
            }
          : {
              jsonrpc: '2.0',
              id: Date.now(),
              method: 'tools/list',
            };

      const receiptToUse = overrideReceiptId ?? mcpReceiptId.trim();
      const headers: Record<string, string> = {
        'X-Concordium-Agent-DID': selectedAgent.did,
        'X-Agent-Card-Hash': simulateTamperedCard ? 'tampered_0000000000000000' : selectedAgent.cardHash,
        'X-ZKP-Jurisdiction': jurisdictionClaim,
        'X-ZKP-Age': String(ageClaim),
      };
      if (receiptToUse) {
        headers['X-Payment-Receipt'] = receiptToUse;
      }
      if (mcpMethod === 'tools/call') {
        // The gateway only accepts signed tool calls. In the sandbox the owner asks the server to sign
        // with the agent's demo key (owner-only route); a real agent signs with its own key.
        const toolPolicy = mcpPolicies.find(
          (p) => p.endpointPath.split('/').pop() === mcpToolName || p.endpointPath === mcpToolName,
        );
        if (toolPolicy) {
          const signed = await api.sandboxSign(selectedAgent.did, toolPolicy.endpointPath);
          headers['X-Agent-Signature'] = signed.signatureHex;
          headers['X-Agent-Timestamp'] = signed.timestamp;
          headers['X-Agent-Nonce'] = signed.nonce;
        }
      }

      const res = await api.callMcpRpc(requestPayload, headers);
      setMcpResponse({ httpStatus: res.httpStatus, requestPayload, body: res.body });
      await onRefreshAll();
    } finally {
      setMcpRunning(false);
    }
  }

  const mcpChallengedInvoice: X402Invoice | null = useMemo(() => {
    const body = mcpResponse?.body as { error?: { data?: { invoice?: X402Invoice } } } | undefined;
    return body?.error?.data?.invoice ?? null;
  }, [mcpResponse]);

  async function handleSettleMcpAndRetry() {
    if (!mcpChallengedInvoice) return;
    setSettling(true);
    try {
      const { invoice } = await api.settleX402Invoice(mcpChallengedInvoice.invoiceId);
      setMcpReceiptId(invoice.invoiceId);
      onNotify(`MCP x402 发票已模拟结算 (${invoice.invoiceId}，未上链)，正在重放 tools/call`);
      await runMcpRpc(invoice.invoiceId);
    } finally {
      setSettling(false);
    }
  }

  const curlCommand = selectedAgent && selectedPolicy
    ? `curl -i -X POST ${window.location.origin}/api/gateway/invoke \\
  -H "Content-Type: application/json" \\
  -H "X-Concordium-Agent-DID: ${selectedAgent.did}" \\
  -H "X-Agent-Card-Hash: ${simulateTamperedCard ? 'tampered_0000000000000000' : selectedAgent.cardHash}" \\
  -H "X-ZKP-Jurisdiction: ${jurisdictionClaim}" \\
  -H "X-ZKP-Age: ${ageClaim}" \\
  -H "X-Agent-Timestamp: $TS" \\
  -H "X-Agent-Nonce: $NONCE" \\
  -H "X-Agent-Signature: $SIG" \\
  -d '{"endpointPath":"${selectedPolicy.endpointPath}","requestedTransferPlt":${requestedTransferPlt}}'
# $TS = ISO-8601 UTC time (at most 120 s old, 30 s ahead); $NONCE = 16-128 random [A-Za-z0-9_-], never reused inside the window;
# $SIG = hex Ed25519 signature by the agent key over
# "${selectedAgent.did}|${selectedPolicy.endpointPath}|$TS|$NONCE|${selectedAgent.cardHash}"
# Unsigned requests are rejected with 401; a reused nonce or stale timestamp with 403.`
    : '';

  const typescriptSdkSnippet = selectedAgent && selectedPolicy
    ? `// AccordGate TypeScript Client SDK (Ed25519 + x402 Auto-Retry)
import crypto from 'node:crypto';

const GATEWAY = '${window.location.origin}';
const AGENT_DID = '${selectedAgent.did}';
const CARD_HASH = '${selectedAgent.cardHash}';

const ENDPOINT = '${selectedPolicy.endpointPath}';

async function callProtectedEndpoint(privateKeyPem: string, receiptId?: string) {
  const payload = JSON.stringify({ endpointPath: ENDPOINT, requestedTransferPlt: ${requestedTransferPlt} });
  // The gateway verifies an Ed25519 signature (hex) over "did|endpointPath|timestamp|nonce|cardHash".
  // The timestamp must be within 120 s (30 s ahead at most) and each nonce works only once.
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(16).toString('base64url');
  const signingPayload = \`\${AGENT_DID}|\${ENDPOINT}|\${timestamp}|\${nonce}|\${CARD_HASH}\`;
  const sig = crypto.sign(null, Buffer.from(signingPayload, 'utf-8'), privateKeyPem).toString('hex');

  const res = await fetch(\`\${GATEWAY}/api/gateway/invoke\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Concordium-Agent-DID': AGENT_DID,
      'X-Agent-Card-Hash': CARD_HASH,
      'X-Agent-Signature': sig,
      'X-Agent-Timestamp': timestamp,
      'X-Agent-Nonce': nonce,
      'X-ZKP-Jurisdiction': '${jurisdictionClaim}',
      'X-ZKP-Age': '${ageClaim}',
      ...(receiptId ? { 'X-Payment-Receipt': receiptId } : {}),
    },
    body: payload,
  });

  if (res.status === 402) {
    const { invoice } = await res.json();
    // In this demo x402 settlement is SIMULATED and done by the gateway owner in the console
    // (/api/x402/settle needs the owner's wallet sign-in). Retry with the receipt once it is settled.
    return { paymentRequired: invoice };
  }
  return res.json();
}`
    : '';

  const pythonSdkSnippet = selectedAgent && selectedPolicy
    ? `# AccordGate Python Client SDK (httpx + x402; settlement simulated in this demo)
import httpx

GATEWAY = "${window.location.origin}"
HEADERS = {
    "X-Concordium-Agent-DID": "${selectedAgent.did}",
    "X-Agent-Card-Hash": "${selectedAgent.cardHash}",
    "X-ZKP-Jurisdiction": "${jurisdictionClaim}",
    "X-ZKP-Age": "${ageClaim}",
}
BODY = {"endpointPath": "${selectedPolicy.endpointPath}", "requestedTransferPlt": ${requestedTransferPlt}}

with httpx.Client() as client:
    r = client.post(f"{GATEWAY}/api/gateway/invoke", json=BODY, headers=HEADERS)
    # Add X-Agent-Timestamp, X-Agent-Nonce (single use) and X-Agent-Signature
    # (hex Ed25519 over "did|endpointPath|timestamp|nonce|cardHash"); unsigned requests are rejected with 401.
    if r.status_code == 402:
        # x402 settlement is SIMULATED in this demo and done by the gateway owner in the console;
        # retry with {"X-Payment-Receipt": invoice_id} once it is settled.
        invoice_id = r.json()["invoice"]["invoiceId"]
    print(r.status_code, r.json())`
    : '';

  const activeSdkCode =
    sdkLang === 'curl' ? curlCommand : sdkLang === 'typescript' ? typescriptSdkSnippet : pythonSdkSnippet;

  const mcpClientConfig = selectedAgent
    ? JSON.stringify(
        {
          mcpServers: {
            'accordgate-concordium': {
              url: `${window.location.origin}/api/mcp`,
              transport: 'http',
              headers: {
                'X-Concordium-Agent-DID': selectedAgent.did,
                'X-Agent-Card-Hash': selectedAgent.cardHash,
                'X-ZKP-Jurisdiction': jurisdictionClaim,
                'X-ZKP-Age': String(ageClaim),
              },
            },
          },
        },
        null,
        2,
      )
    : '';

  function copyActiveSnippet() {
    if (!activeSdkCode) return;
    navigator.clipboard.writeText(activeSdkCode);
    onNotify(`已复制 ${sdkLang === 'curl' ? 'cURL' : sdkLang === 'typescript' ? 'TypeScript SDK' : 'Python SDK'} 接入代码`);
  }

  function copyMcpConfig() {
    if (!mcpClientConfig) return;
    navigator.clipboard.writeText(mcpClientConfig);
    onNotify('已复制标准 mcpServers JSON 客户端配置');
  }

  return (
    <div className="space-y-6">
      {/* Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-3.5 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            交互式协议门控与 MCP JSON-RPC 2.0 调试台
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            切换 REST 7 步管道沙盒，或直接向标准 `/api/mcp` 端点发送 MCP JSON-RPC 2.0 握手与工具调用
          </p>
        </div>

        <div className="inline-flex items-center gap-1 rounded-md bg-slate-100 p-1 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setMode('rest')}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              mode === 'rest'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            REST 门控沙盒 (7 步校验)
          </button>
          <button
            type="button"
            onClick={() => setMode('mcp')}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              mode === 'mcp'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <ServerCog className="h-3.5 w-3.5" />
            <span>MCP JSON-RPC 2.0 调试</span>
          </button>
        </div>
      </div>

      {mode === 'rest' ? (
        <div className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-12">
          {/* Left Column: Claim & Request Builder */}
          <section className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 xl:col-span-5">
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  协议交互沙盒请求构造器
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  向 Express 合规中间件发起真实请求：本地注册表、Ed25519 签名、自报属性（模拟 ZKP）、限额与 x402（模拟结算）
                </p>
              </div>

              {/* Quick Scenario Presets */}
              <div>
                <span className="mb-2 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  一键加载黑客松演示场景
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyPreset('pass')}
                    className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    合规放行 + 402
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('revoked')}
                    className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    已吊销拦截
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('tampered')}
                    className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    卡片哈希篡改
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('sig_fail')}
                    className="rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                  >
                    伪造签名拦截
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('rate_limit')}
                    className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                  >
                    QPM 突发限流 (429)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('zkp_fail')}
                    className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    ZKP 辖区/年龄失败
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('limit_fail')}
                    className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    超出单笔限额
                  </button>
                </div>
              </div>

          <div className="space-y-4 border-t border-slate-200 pt-4 text-xs dark:border-slate-800">
            <div>
              <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                发起调用的 Agent（本地注册表）
              </label>
              <select
                value={selectedAgent?.did ?? ''}
                onChange={(e) => setAgentDid(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.did}>
                    {a.name} ({a.status.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                目标受保护 MCP / API 端点
              </label>
              <select
                value={selectedPolicy?.endpointPath ?? ''}
                onChange={(e) => setEndpointPath(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {policies.map((p) => (
                  <option key={p.id} value={p.endpointPath}>
                    {p.endpointPath} ({p.x402PricePlt.toFixed(2)} EURt)
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                  自报管辖区（模拟 ZKP）
                </label>
                <select
                  value={jurisdictionClaim}
                  onChange={(e) => setJurisdictionClaim(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="EU">EU (European Union)</option>
                  <option value="EEA">EEA</option>
                  <option value="CH">CH (Switzerland)</option>
                  <option value="UK">UK</option>
                  <option value="SG">SG (Singapore)</option>
                  <option value="US">US (Out of EU Policy)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                  自报年龄（模拟 ZKP，非证明）
                </label>
                <input
                  type="number"
                  min={12}
                  max={99}
                  value={ageClaim}
                  onChange={(e) => setAgeClaim(Number(e.target.value))}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                  业务操作金额 (PLT)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={requestedTransferPlt}
                  onChange={(e) => setRequestedTransferPlt(Number(e.target.value))}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="flex flex-col justify-end space-y-1.5 pb-1">
                <label className="flex cursor-pointer items-center gap-2 text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={principalVerifiedClaim}
                    onChange={(e) => setPrincipalVerifiedClaim(e.target.checked)}
                    className="h-3.5 w-3.5 accent-blue-700"
                  />
                  <span>自报已通过 IDP 实名（模拟）</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={simulateTamperedCard}
                    onChange={(e) => setSimulateTamperedCard(e.target.checked)}
                    className="h-3.5 w-3.5 accent-red-600"
                  />
                  <span>模拟篡改 Agent Card</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={simulateInvalidSignature}
                    onChange={(e) => setSimulateInvalidSignature(e.target.checked)}
                    className="h-3.5 w-3.5 accent-red-600"
                  />
                  <span>模拟伪造 Ed25519 签名</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={simulateRateLimitSpike}
                    onChange={(e) => setSimulateRateLimitSpike(e.target.checked)}
                    className="h-3.5 w-3.5 accent-amber-600"
                  />
                  <span>模拟 QPM 突发流量 (HTTP 429)</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <button
            type="button"
            disabled={running}
            onClick={() => runProbe(null)}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
          >
            <Play className="h-4 w-4" />
            <span>{running ? '正在执行 Express 门控管道...' : '执行门控握手请求'}</span>
          </button>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-slate-600 dark:text-slate-400">
              <div className="inline-flex items-center gap-1 rounded bg-slate-200/70 p-0.5 dark:bg-slate-800">
                {(
                  [
                    ['curl', 'cURL'],
                    ['typescript', 'TypeScript SDK'],
                    ['python', 'Python SDK'],
                  ] as const
                ).map(([lang, label]) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setSdkLang(lang)}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                      sdkLang === lang
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={copyActiveSnippet}
                className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-400 whitespace-nowrap"
              >
                <Copy className="h-3 w-3" />
                <span>复制代码</span>
              </button>
            </div>
            <pre className="max-h-44 overflow-auto font-mono text-[10px] leading-relaxed text-slate-700 dark:text-slate-300">
              {activeSdkCode}
            </pre>
          </div>
        </div>
      </section>

      {/* Right Column: Live 7-Step Protocol Trace */}
      <section className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 xl:col-span-7">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">实时 7 步协议执行轨迹</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {result
                  ? `Request ID: ${result.requestId} · HTTP ${result.httpStatus} (${result.outcome})`
                  : '点击左侧“执行门控握手请求”查看实时服务端校验过程'}
              </p>
            </div>

            {result && (
              <span
                className={`font-mono text-xs font-semibold ${
                  result.httpStatus === 200
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : result.httpStatus === 402
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-red-700 dark:text-red-400'
                }`}
              >
                HTTP {result.httpStatus}
              </span>
            )}
          </div>

          {!result ? (
            <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-slate-200 py-16 text-center dark:border-slate-800">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">等待发起沙盒请求</p>
              <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                沙盒会真实调用 Express 后端：本地注册表校验、Ed25519 验签、自报属性门控（模拟 ZKP）、限额检查、x402 HTTP 402 账单（模拟结算）与 EU AI Act 哈希链入库。
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {result.traces.map((step, index) => (
                <div
                  key={`${step.step}-${step.key}`}
                  className="flex items-start gap-3 rounded-md border border-slate-200 p-3.5 dark:border-slate-800"
                >
                  <div className="mt-0.5 shrink-0">
                    {step.status === 'passed' && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                    {step.status === 'failed' && <AlertTriangle className="h-4 w-4 text-red-600" />}
                    {step.status === 'challenged' && <Clock className="h-4 w-4 text-amber-600" />}
                    {step.status === 'skipped' && <CheckCircle2 className="h-4 w-4 text-slate-400" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                        <span>
                          {String(index + 1).padStart(2, '0')}. {step.title}
                        </span>
                        {SIMULATED_STEP_REASON[step.key] && <SimulatedBadge reason={SIMULATED_STEP_REASON[step.key] as string} />}
                      </span>
                      <span className="font-mono text-[11px] uppercase text-slate-500 dark:text-slate-400">
                        {step.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{step.detail}</p>
                  </div>
                </div>
              ))}

              {/* HTTP 402 One-Click Settlement Box */}
              {result.httpStatus === 402 && result.invoice && (
                <div className="rounded-md border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">
                        <Wallet className="h-4 w-4" />
                        <span>收到 HTTP 402 Payment Required 账单 ({result.invoice.invoiceId})</span>
                        <SimulatedBadge reason={X402_SIMULATED_REASON} />
                      </div>
                      <p className="text-amber-800 dark:text-amber-300">
                        需支付 <span className="font-mono font-semibold">{result.invoice.amountPlt.toFixed(2)} EURt</span> ·{' '}
                        模拟结算：不会真实扣款，也不会发送 CIS-3 赞助交易（Gas {result.invoice.gasFeeCcd} CCD 为估算值）
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={settling}
                      onClick={handleSettleAndRetry}
                      className="rounded-md bg-amber-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-800 disabled:opacity-60 whitespace-nowrap shrink-0"
                    >
                      {settling ? '模拟结算重试中...' : '模拟支付并重试'}
                    </button>
                  </div>
                </div>
              )}

              {/* Final 200 OK Tool Execution Output */}
              {result.httpStatus === 200 && result.toolResponse && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-4 text-xs dark:border-emerald-900 dark:bg-emerald-950/30">
                  <div className="font-semibold text-emerald-900 dark:text-emerald-200">
                    HTTP 200 OK · {result.toolResponse.resultSummary}
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 font-mono text-[11px] text-emerald-800 sm:grid-cols-2 dark:text-emerald-300">
                    <div>Principal: {result.toolResponse.accountablePrincipal}</div>
                    <div>PII Stored on Gateway: {String(result.toolResponse.piiStoredOnGateway)}</div>
                    <div>SHA-256 承诺（模拟 ZKP）: {result.toolResponse.zkpCommitment.slice(0, 22)}...</div>
                    <div className="flex items-center gap-1.5">
                      <span>x402 Receipt: {result.toolResponse.x402Receipt?.invoiceId ?? 'Zero-Fee Endpoint'}</span>
                      {result.toolResponse.x402Receipt && <SimulatedBadge reason={X402_SIMULATED_REASON} />}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Raw Headers & Payload Toggle */}
        {result && (
          <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowRawHeaders((v) => !v)}
              className="text-xs font-medium text-blue-700 hover:underline dark:text-blue-400"
            >
              {showRawHeaders ? '隐藏原始 HTTP 响应头与审计摘要' : '展开原始 HTTP 响应头与审计摘要'}
            </button>
            {showRawHeaders && (
              <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100 dark:border-slate-800">
                {JSON.stringify({ httpStatus: result.httpStatus, headers: result.headers, audit: result.audit }, null, 2)}
              </pre>
            )}
          </div>
        )}
      </section>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-12">
          {/* MCP JSON-RPC Request & Client Config */}
          <section className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 xl:col-span-5">
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  标准 MCP JSON-RPC 2.0 客户端调试
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  直连 `/api/mcp` 端点，兼容 Claude Desktop / Cursor HTTP MCP 协议栈
                </p>
              </div>

              <div className="space-y-3 border-t border-slate-200 pt-4 text-xs dark:border-slate-800">
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    调用主体 Agent (X-Concordium-Agent-DID)
                  </label>
                  <select
                    value={selectedAgent?.did ?? ''}
                    onChange={(e) => setAgentDid(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {agents.map((a) => (
                      <option key={a.id} value={a.did}>
                        {a.name} ({a.status.toUpperCase()})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                      JSON-RPC Method
                    </label>
                    <select
                      value={mcpMethod}
                      onChange={(e) => setMcpMethod(e.target.value as McpMethod)}
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="initialize">initialize</option>
                      <option value="tools/list">tools/list</option>
                      <option value="tools/call">tools/call</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                      目标 MCP Tool
                    </label>
                    <select
                      value={mcpToolName}
                      disabled={mcpMethod !== 'tools/call'}
                      onChange={(e) => setMcpToolName(e.target.value)}
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 disabled:opacity-50 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      {mcpPolicies.map((p) => {
                        const slug = p.endpointPath.split('/').pop() ?? p.id;
                        return (
                          <option key={p.id} value={slug}>
                            {slug} ({p.x402PricePlt.toFixed(2)} EURt)
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                      X-ZKP-Jurisdiction
                    </label>
                    <select
                      value={jurisdictionClaim}
                      onChange={(e) => setJurisdictionClaim(e.target.value)}
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="EU">EU</option>
                      <option value="EEA">EEA</option>
                      <option value="CH">CH</option>
                      <option value="UK">UK</option>
                      <option value="SG">SG</option>
                      <option value="US">US</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                      X-Payment-Receipt (可选)
                    </label>
                    <input
                      type="text"
                      value={mcpReceiptId}
                      onChange={(e) => setMcpReceiptId(e.target.value)}
                      placeholder="x402-..."
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={mcpRunning}
                onClick={() => runMcpRpc()}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
              >
                <Play className="h-4 w-4" />
                <span>{mcpRunning ? '发送 JSON-RPC 2.0 中...' : `发送 MCP ${mcpMethod}`}</span>
              </button>
            </div>

            <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-slate-600 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5" />
                  <span>Claude Desktop / Cursor mcpServers JSON 配置</span>
                </span>
                <button
                  type="button"
                  onClick={copyMcpConfig}
                  className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-400"
                >
                  <Copy className="h-3 w-3" />
                  <span>复制配置</span>
                </button>
              </div>
              <pre className="max-h-48 overflow-auto font-mono text-[10px] leading-relaxed text-slate-700 dark:text-slate-300">
                {mcpClientConfig}
              </pre>
            </div>
          </section>

          {/* MCP JSON-RPC Response */}
          <section className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 xl:col-span-7">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    MCP JSON-RPC 2.0 实时报文响应
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {mcpResponse
                      ? `POST /api/mcp · HTTP ${mcpResponse.httpStatus}`
                      : '支持 initialize / tools/list / tools/call 标准 MCP 协议发现与 x402 拦截'}
                  </p>
                </div>
                {mcpResponse && (
                  <span
                    className={`font-mono text-xs font-semibold ${
                      mcpResponse.httpStatus === 200
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : mcpResponse.httpStatus === 402
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    HTTP {mcpResponse.httpStatus}
                  </span>
                )}
              </div>

              {mcpResponse?.httpStatus === 402 && mcpChallengedInvoice && (
                <div className="rounded-md border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">
                        <Wallet className="h-4 w-4" />
                        <span>JSON-RPC -32002: x402 Payment Required ({mcpChallengedInvoice.invoiceId})</span>
                        <SimulatedBadge reason={X402_SIMULATED_REASON} />
                      </div>
                      <p className="text-amber-800 dark:text-amber-300">
                        MCP 工具调用前需支付{' '}
                        <span className="font-mono font-semibold">{mcpChallengedInvoice.amountPlt.toFixed(2)} EURt</span>
                        （模拟结算，不扣款，不发送 CIS-3 赞助交易）
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={settling}
                      onClick={handleSettleMcpAndRetry}
                      className="rounded-md bg-amber-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-800 disabled:opacity-60 whitespace-nowrap shrink-0"
                    >
                      {settling ? '模拟结算重放中...' : '模拟结算并重放 tools/call'}
                    </button>
                  </div>
                </div>
              )}

              {!mcpResponse ? (
                <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-slate-200 py-20 text-center dark:border-slate-800">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">准备发送 MCP JSON-RPC 2.0 请求</p>
                  <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                    先运行 `tools/list` 发现网关暴露的受保护工具，再运行 `tools/call` 触发完整 Concordium 合规与 x402 计费拦截。
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-slate-500">Request JSON-RPC Payload</div>
                    <pre className="max-h-40 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                      {JSON.stringify(mcpResponse.requestPayload, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-slate-500">Response JSON-RPC Payload</div>
                    <pre className="max-h-80 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100 dark:border-slate-800">
                      {JSON.stringify(mcpResponse.body, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  Lock,
  Network,
  Search,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { api } from '../api';
import type { AuditEntry, OverviewMetrics, TestnetInspectResult, TestnetProbeResult, WorkspaceTab } from '../types';
import { AuditDecisionText } from './StatusBadge';
import { SimulatedBadge } from './SimulatedBadge';

interface OverviewViewProps {
  metrics: OverviewMetrics | null;
  recentLogs: AuditEntry[];
  testnetProbe: TestnetProbeResult | null;
  probingTestnet: boolean;
  onProbeTestnet: () => void;
  onNavigate: (tab: WorkspaceTab) => void;
}

export function OverviewView({
  metrics,
  recentLogs,
  testnetProbe,
  probingTestnet,
  onProbeTestnet,
  onNavigate,
}: OverviewViewProps) {
  const [inspectTarget, setInspectTarget] = useState('10082:0');
  const [inspecting, setInspecting] = useState(false);
  const [inspectResult, setInspectResult] = useState<TestnetInspectResult | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);

  const blockRate =
    metrics && metrics.totalCalls > 0 ? Math.round((metrics.blockedCalls / metrics.totalCalls) * 100) : 0;

  async function handleInspect(e: React.FormEvent) {
    e.preventDefault();
    if (!inspectTarget.trim()) return;
    setInspecting(true);
    setInspectError(null);
    try {
      const res = await api.inspectTestnetTarget(inspectTarget.trim());
      setInspectResult(res);
    } catch (err) {
      setInspectResult(null);
      setInspectError(err instanceof Error ? err.message : 'Testnet query failed');
    } finally {
      setInspecting(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Executive Summary Banner */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-medium text-blue-700 dark:text-blue-400">
              Concordium Trusted Agents Hackathon · 三合一企业合规架构
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 [text-wrap:balance]">
              Verify, Gate, Pay, Audit — AI Agent 合规网关原型
            </h1>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              真实部分：<span className="font-mono">@concordium/web-sdk</span> 测试网查询、Ed25519 请求验签、标准 MCP
              JSON-RPC 2.0 服务与 EU AI Act 哈希链审计。模拟部分（带「模拟」标记）：CIS-8004/CIS-8 链上注册、ZKP（自报属性 +
              SHA-256 承诺，非零知识证明）、x402 结算与 CIS-3 Gas 代付。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('sandbox')}
              className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0"
            >
              <span>运行实时协议沙盒</span>
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('audit')}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              <span>查看 EU AI Act 账本</span>
            </button>
          </div>
        </div>
      </section>

      {/* 4-Column KPI Row */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>本地 Agent 注册表</span>
              <SimulatedBadge reason="Agent 只登记在本地，没有写入 CIS-8004 / CIS-8 合约" />
            </span>
            <ShieldCheck className="h-4 w-4 text-blue-700 dark:text-blue-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-100">
              {metrics ? metrics.activeAgents : '--'}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              / {metrics ? metrics.totalAgents : '--'} 注册 Agent
            </span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">Ed25519 真实验签 · CIS-8004/CIS-8 未上链</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>ZKP 门控 & MCP</span>
              <SimulatedBadge reason="自报属性 + SHA-256 承诺（模拟 ZKP，非零知识证明）" />
            </span>
            <Lock className="h-4 w-4 text-blue-700 dark:text-blue-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-100">
              {metrics ? metrics.enforcedPolicies : '--'}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">个受保护 MCP / API</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">零 PII 留存 · 拦截率 {blockRate}%</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>x402 微支付</span>
              <SimulatedBadge reason="模拟结算：无真实付款，未发送 CIS-3 赞助交易" />
            </span>
            <Wallet className="h-4 w-4 text-blue-700 dark:text-blue-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-100">
              {metrics ? metrics.totalSettledPlt.toFixed(2) : '--'}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">EURt PLT（模拟结算）</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            模拟代付 Gas（估算值）{metrics ? metrics.totalGasSavedCcd.toFixed(4) : '--'} CCD，未发送 CIS-3 交易
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">EU AI Act 审计链</span>
            <FileCheck2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-100">
              {metrics ? metrics.auditEntries : '--'}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">条不可篡改记录</span>
          </div>
          <p
            className={`mt-1.5 text-xs font-medium ${
              metrics?.chainValid ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
            }`}
          >
            {metrics?.chainValid ? 'SHA-256 哈希链校验通过' : '检测到篡改异常'}
          </p>
        </div>
      </section>

      {/* 4-Stage Architecture Pipeline */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            合规请求处理流水线（对应 5 场官方 Workshop 核心技术）
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            每次 REST 或标准 MCP JSON-RPC 2.0 调用受保护工具，Express 网关依次执行以下四道协议验证
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            onClick={() => onNavigate('agents')}
            className="flex flex-col items-start rounded-md border border-slate-200 p-4 text-left transition-colors hover:border-blue-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-blue-700 dark:hover:bg-slate-800/50"
          >
            <span className="font-mono text-xs font-medium text-blue-700 dark:text-blue-400">01 · AgentGate</span>
            <span className="mt-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
              本地注册表 + Ed25519 验签
            </span>
            <span className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              校验本地注册状态（模拟 CIS-8004，未查合约）、Card SHA-256 摘要、Ed25519 请求签名与 VCDC 企业域名。
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('policies')}
            className="flex flex-col items-start rounded-md border border-slate-200 p-4 text-left transition-colors hover:border-blue-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-blue-700 dark:hover:bg-slate-800/50"
          >
            <span className="font-mono text-xs font-medium text-blue-700 dark:text-blue-400">02 · Zero PII</span>
            <span className="mt-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
              属性门控（模拟 ZKP）与额度锁
            </span>
            <span className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              按调用方自报的管辖区与年龄判断白名单和 18+/21+ 门槛（非零知识证明），再检查单笔/日预算护栏；只保存判定结果和 SHA-256 承诺。
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('sandbox')}
            className="flex flex-col items-start rounded-md border border-slate-200 p-4 text-left transition-colors hover:border-blue-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-blue-700 dark:hover:bg-slate-800/50"
          >
            <span className="font-mono text-xs font-medium text-blue-700 dark:text-blue-400">03 · x402 + MCP</span>
            <span className="mt-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
              x402 微支付（模拟结算）与 MCP 工具
            </span>
            <span className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              标准 /api/mcp 端点自动触发 HTTP 402 账单；结算与 CIS-3 Gas 代付均为模拟，不发生真实转账。
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('audit')}
            className="flex flex-col items-start rounded-md border border-slate-200 p-4 text-left transition-colors hover:border-blue-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-blue-700 dark:hover:bg-slate-800/50"
          >
            <span className="font-mono text-xs font-medium text-blue-700 dark:text-blue-400">04 · EU AI Act</span>
            <span className="mt-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
              不可篡改合规审计链
            </span>
            <span className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              每笔放行、拦截与吊销写入 SHA-256 哈希链，支持防篡改演练与 CSV/JSON 导出。
            </span>
          </button>
        </div>
      </section>

      {/* Bottom Split: Recent Invocations Table + Live Concordium Testnet gRPC Inspector */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 xl:col-span-7">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">最近门控调用与治理记录</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">来自后端审计账本的实时记录</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('audit')}
              className="text-xs font-medium text-blue-700 hover:underline dark:text-blue-400 whitespace-nowrap"
            >
              查看全部记录
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-5 py-2.5 font-medium">Seq</th>
                  <th className="px-3 py-2.5 font-medium">Agent</th>
                  <th className="px-3 py-2.5 font-medium">受保护端点</th>
                  <th className="px-3 py-2.5 font-medium">决策结果</th>
                  <th className="px-5 py-2.5 text-right font-medium">Entry Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {recentLogs.map((log) => (
                  <tr key={log.seq} className="h-10 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-2 font-mono text-slate-500 tabular-nums">#{log.seq}</td>
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{log.agentName}</td>
                    <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-300">{log.endpointPath}</td>
                    <td className="px-3 py-2">
                      <AuditDecisionText decision={log.decision} />
                    </td>
                    <td className="px-5 py-2 text-right font-mono text-slate-500 tabular-nums">
                      {log.entryHash.slice(0, 12)}...
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Live Concordium Testnet gRPC Inspector */}
        <section className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 xl:col-span-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Concordium Testnet 链上实时查验 (@concordium/web-sdk)
              </h2>
              <Network className="h-4 w-4 text-blue-700 dark:text-blue-400" />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-950">
              <div className="min-w-0">
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  {testnetProbe?.reachable && testnetProbe.consensus
                    ? `区块 #${testnetProbe.consensus.bestBlockHeight} · Protocol v${testnetProbe.consensus.protocolVersion}`
                    : 'grpc.testnet.concordium.com:20000'}
                </div>
                <div className="truncate font-mono text-[11px] text-slate-500">
                  {testnetProbe?.consensus
                    ? `Best Block: ${testnetProbe.consensus.bestBlock.slice(0, 20)}... (${testnetProbe.latencyMs}ms)`
                    : '点击右侧拉取真实测试网共识状态与合约实例'}
                </div>
              </div>
              <button
                type="button"
                onClick={onProbeTestnet}
                disabled={probingTestnet}
                className="rounded-md bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {probingTestnet ? '读取中...' : '拉取链上状态'}
              </button>
            </div>

            {testnetProbe?.contracts && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border border-slate-200 p-2.5 dark:border-slate-800">
                  <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">10082:0 (CIS-8004)</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {testnetProbe.contracts.cis8004.found
                      ? `${testnetProbe.contracts.cis8004.name} · ${testnetProbe.contracts.cis8004.methods?.length ?? 0} 方法`
                      : '未查询到实例'}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 p-2.5 dark:border-slate-800">
                  <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">10081:0 (CIS-8)</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {testnetProbe.contracts.cis8.found
                      ? `${testnetProbe.contracts.cis8.name} · ${testnetProbe.contracts.cis8.methods?.length ?? 0} 方法`
                      : '未查询到实例'}
                  </div>
                </div>
              </div>
            )}

            {/* Interactive Contract / Account Lookup */}
            <form onSubmit={handleInspect} className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                查询任意 Testnet 合约索引 (如 10082:0) 或 Base58 账户地址
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    value={inspectTarget}
                    onChange={(e) => setInspectTarget(e.target.value)}
                    placeholder="10082:0 或 3..."
                    className="w-full rounded-md border border-slate-200 bg-white py-1.5 pr-3 pl-8 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <button
                  type="submit"
                  disabled={inspecting}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
                >
                  {inspecting ? '查询中...' : '链上查询'}
                </button>
              </div>
            </form>

            {inspectError && <p className="text-xs text-red-600 dark:text-red-400">{inspectError}</p>}

            {inspectResult && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-900 dark:text-slate-100">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span>
                      {inspectResult.type === 'contract' ? '合约实例' : '链上账户'} {inspectResult.target} (
                      {inspectResult.latencyMs}ms)
                    </span>
                  </span>
                  <a
                    href={inspectResult.ccdScanUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline dark:text-blue-400"
                  >
                    <span>CCDScan</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <pre className="mt-2 max-h-28 overflow-auto font-mono text-[10px] leading-relaxed text-slate-700 dark:text-slate-300">
                  {JSON.stringify(inspectResult.data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

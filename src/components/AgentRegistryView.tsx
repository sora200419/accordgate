import { useMemo, useState } from 'react';
import {
  CornerDownRight,
  ExternalLink,
  GitBranch,
  Globe,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { AgentRecord, AgentStatus, ExternalChain, VcdcDnsCheckResult } from '../types';
import { AgentStatusText } from './StatusBadge';

interface AgentRegistryViewProps {
  agents: AgentRecord[];
  onCreateAgent: (payload: {
    name: string;
    role: string;
    ownerEntity: string;
    vcdcDomain: string | null;
    chain: ExternalChain;
    externalAddress: string;
    mcpEndpoint: string;
    capabilities: string[];
    dailyLimitPlt: number;
    perCallLimitPlt: number;
    parentAgentId?: string | null;
    cascadeRevoke?: boolean;
    walletAddress?: string | null;
  }) => Promise<void>;
  onUpdateStatus: (id: string, status: AgentStatus) => Promise<void>;
  onRotateCard: (id: string) => Promise<void>;
}

export function AgentRegistryView({
  agents,
  onCreateAgent,
  onUpdateStatus,
  onRotateCard,
}: AgentRegistryViewProps) {
  const [filter, setFilter] = useState<'all' | AgentStatus>('all');
  const [search, setSearch] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(agents[0]?.id ?? null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [vcdcResult, setVcdcResult] = useState<VcdcDnsCheckResult | null>(null);
  const [checkingVcdc, setCheckingVcdc] = useState(false);

  // Create form state
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [ownerEntity, setOwnerEntity] = useState('');
  const [vcdcDomain, setVcdcDomain] = useState('');
  const [chain, setChain] = useState<ExternalChain>('Ethereum');
  const [externalAddress, setExternalAddress] = useState('0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199');
  const [mcpEndpoint, setMcpEndpoint] = useState('https://mcp.enterprise-demo.eu/agent');
  const [capabilitiesInput, setCapabilitiesInput] = useState('sanctions.screen, market.research');
  const [dailyLimitPlt, setDailyLimitPlt] = useState(500);
  const [perCallLimitPlt, setPerCallLimitPlt] = useState(75);
  const [parentAgentId, setParentAgentId] = useState<string>('');
  const [cascadeRevoke, setCascadeRevoke] = useState<boolean>(true);
  const [walletAddress, setWalletAddress] = useState<string>('');

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents.filter((a) => {
      if (filter !== 'all' && a.status !== filter) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.did.toLowerCase().includes(q) ||
        a.ownerEntity.toLowerCase().includes(q) ||
        (a.vcdcDomain ?? '').toLowerCase().includes(q)
      );
    });
  }, [agents, filter, search]);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? filteredAgents[0] ?? null,
    [agents, filteredAgents, selectedAgentId],
  );

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !ownerEntity.trim() || !externalAddress.trim()) return;
    setSubmitting(true);
    try {
      await onCreateAgent({
        name: name.trim(),
        role: role.trim() || 'Enterprise Automated Compliance Agent',
        ownerEntity: ownerEntity.trim(),
        vcdcDomain: vcdcDomain.trim() ? vcdcDomain.trim() : null,
        chain,
        externalAddress: externalAddress.trim(),
        mcpEndpoint: mcpEndpoint.trim() || 'https://mcp.enterprise-demo.eu/agent',
        capabilities: capabilitiesInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        dailyLimitPlt,
        perCallLimitPlt,
        parentAgentId: parentAgentId || null,
        cascadeRevoke,
        walletAddress: walletAddress.trim() || null,
      });
      setShowCreateModal(false);
      setName('');
      setRole('');
      setOwnerEntity('');
      setVcdcDomain('');
      setParentAgentId('');
      setCascadeRevoke(true);
      setWalletAddress('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 rounded-md bg-slate-100 p-1 dark:bg-slate-800">
            {(
              [
                ['all', '全部'],
                ['active', '已激活'],
                ['suspended', '已暂停'],
                ['revoked', '已吊销'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  filter === key
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[240px]">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索 Agent 名称、did:ccd、主体或 VCDC..."
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>注册 CIS-8004 Agent</span>
        </button>
      </div>

      {/* Main Split: Agent Table + Card Inspector */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 xl:col-span-7">
          <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Verified by Concordium 注册目录 ({filteredAgents.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              CIS-8004 身份卡片与 CIS-8 跨链密钥绑定 · 点击任意行查看密码学摘要
            </p>
          </div>

          {filteredAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">未找到匹配的 Agent 记录</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">尝试调整筛选状态或新建 CIS-8004 Agent</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="px-5 py-2.5 font-medium">Agent 与归属主体</th>
                    <th className="px-3 py-2.5 font-medium">外链绑定 (CIS-8)</th>
                    <th className="px-3 py-2.5 font-medium">状态</th>
                    <th className="px-5 py-2.5 text-right font-medium">今日预算 (PLT)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredAgents.map((agent) => {
                    const isSelected = selectedAgent?.id === agent.id;
                    const parentAgent = agent.parentAgentId
                      ? agents.find((p) => p.id === agent.parentAgentId)
                      : null;
                    return (
                      <tr
                        key={agent.id}
                        onClick={() => {
                          setSelectedAgentId(agent.id);
                          setVcdcResult(null);
                        }}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-50/70 dark:bg-blue-950/30'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="px-5 py-3">
                          <div
                            className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-slate-100"
                            style={agent.delegationDepth > 0 ? { paddingLeft: `${agent.delegationDepth * 14}px` } : undefined}
                          >
                            {agent.delegationDepth > 0 && (
                              <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                            )}
                            <span>{agent.name}</span>
                            {parentAgent && (
                              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-normal text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 whitespace-nowrap">
                                子委托 · L{agent.delegationDepth}
                              </span>
                            )}
                          </div>
                          <div
                            className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400"
                            style={agent.delegationDepth > 0 ? { paddingLeft: `${agent.delegationDepth * 14}px` } : undefined}
                          >
                            {agent.ownerEntity} ·{' '}
                            <span className="font-mono">{agent.did.slice(0, 22)}...</span>
                            {parentAgent ? ` · 上级: ${parentAgent.name}` : ''}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                          {agent.externalKeys.map((k) => k.chain).join(' / ')}
                        </td>
                        <td className="px-3 py-3">
                          <AgentStatusText status={agent.status} />
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                          {agent.dailySpentPlt.toFixed(1)} / {agent.dailyLimitPlt.toFixed(0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Inspector Panel */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 xl:col-span-5">
          {!selectedAgent ? (
            <div className="py-12 text-center text-xs text-slate-500">请选择左侧 Agent 查看完整 CIS-8004 详情</div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{selectedAgent.name}</h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{selectedAgent.role}</p>
                </div>
                <AgentStatusText status={selectedAgent.status} />
              </div>

              <dl className="space-y-2.5 text-xs">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400 shrink-0">Concordium DID</dt>
                  <dd className="break-all text-right font-mono text-slate-900 dark:text-slate-100">
                    {selectedAgent.did}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400 shrink-0">真实归属主体</dt>
                  <dd className="text-right font-medium text-slate-900 dark:text-slate-100">
                    {selectedAgent.ownerEntity}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400 shrink-0">VCDC 企业域名证明</dt>
                  <dd className="flex flex-col items-end gap-1 text-right">
                    <span className="font-mono text-slate-900 dark:text-slate-100">
                      {selectedAgent.vcdcDomain ?? '未绑定域名 (None)'}
                    </span>
                    {selectedAgent.vcdcDomain && (
                      <button
                        type="button"
                        disabled={checkingVcdc}
                        onClick={async () => {
                          setCheckingVcdc(true);
                          try {
                            const res = await api.verifyAgentVcdc(selectedAgent.id);
                            setVcdcResult(res);
                          } finally {
                            setCheckingVcdc(false);
                          }
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline disabled:opacity-60 dark:text-blue-400"
                      >
                        <Globe className="h-3 w-3" />
                        <span>{checkingVcdc ? 'DNS TXT 查询中...' : '实时 DNS TXT 核验'}</span>
                      </button>
                    )}
                  </dd>
                </div>
                {vcdcResult && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 text-[11px] dark:border-slate-800 dark:bg-slate-950">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{vcdcResult.detail}</div>
                    <div className="mt-1 break-all font-mono text-[10px] text-slate-500">
                      Expected TXT: {vcdcResult.expectedTxtRecord}
                    </div>
                    {vcdcResult.txtRecords.length > 0 && (
                      <div className="mt-1 break-all font-mono text-[10px] text-slate-600 dark:text-slate-400">
                        Live TXT[0]: {vcdcResult.txtRecords[0]}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400 shrink-0">Ed25519 SPKI 公钥</dt>
                  <dd className="break-all text-right font-mono text-[11px] text-slate-700 dark:text-slate-300">
                    {selectedAgent.publicKeyHex.slice(0, 44)}...
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400 shrink-0">链上注册合约</dt>
                  <dd className="text-right font-mono text-slate-700 dark:text-slate-300">
                    {selectedAgent.registryContract} · {selectedAgent.keyRegistryContract}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400 shrink-0">Card SHA-256 摘要</dt>
                  <dd className="break-all text-right font-mono text-blue-700 dark:text-blue-400">
                    {selectedAgent.cardHash}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400 shrink-0">父级委托链 (Delegation)</dt>
                  <dd className="text-right text-slate-800 dark:text-slate-200">
                    {selectedAgent.parentAgentId ? (
                      <span className="inline-flex items-center gap-1 font-medium text-blue-700 dark:text-blue-400">
                        <GitBranch className="h-3 w-3" />
                        <span>
                          {agents.find((a) => a.id === selectedAgent.parentAgentId)?.name ?? selectedAgent.parentAgentId}{' '}
                          (L{selectedAgent.delegationDepth} · {selectedAgent.cascadeRevoke ? '级联吊销已启用' : '独立生命周期'})
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-500">根级法人主体授权 (Root L0)</span>
                    )}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400 shrink-0">连续违规计数 (Circuit Breaker)</dt>
                  <dd className="text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    <span
                      className={
                        selectedAgent.consecutiveViolations > 0
                          ? 'font-semibold text-amber-700 dark:text-amber-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }
                    >
                      {selectedAgent.consecutiveViolations} 次
                    </span>
                  </dd>
                </div>
                {selectedAgent.walletAddress && (
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500 dark:text-slate-400 shrink-0">Concordium 钱包账户</dt>
                    <dd className="break-all text-right font-mono text-[11px] text-slate-700 dark:text-slate-300">
                      {selectedAgent.walletAddress}
                    </dd>
                  </div>
                )}
              </dl>

              {/* CIS-8 External Keys */}
              <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <KeyRound className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" />
                  <span>CIS-8 跨链外部密钥绑定</span>
                </div>
                <div className="space-y-2">
                  {selectedAgent.externalKeys.map((binding) => (
                    <div
                      key={binding.cis8BindingId}
                      className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950"
                    >
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {binding.chain} · {binding.cis8BindingId}
                      </span>
                      <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                        {binding.address.slice(0, 10)}...{binding.address.slice(-6)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Agent Card JSON */}
              <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    ERC-8004 / CIS-8004 Agent Card 元数据
                  </span>
                  <button
                    type="button"
                    onClick={() => onRotateCard(selectedAgent.id)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline dark:text-blue-400"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>更新版本并重算 Hash</span>
                  </button>
                </div>
                <pre className="max-h-48 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100 dark:border-slate-800">
                  {JSON.stringify(selectedAgent.agentCard, null, 2)}
                </pre>
              </div>

              {/* Kill Switch Governance Actions */}
              <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                {selectedAgent.status !== 'revoked' ? (
                  <button
                    type="button"
                    onClick={() => onUpdateStatus(selectedAgent.id, 'revoked')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    <span>一键吊销权限 (Kill Switch)</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onUpdateStatus(selectedAgent.id, 'active')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>恢复为已激活 (Reactivate)</span>
                  </button>
                )}

                {selectedAgent.status === 'active' && (
                  <button
                    type="button"
                    onClick={() => onUpdateStatus(selectedAgent.id, 'suspended')}
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    临时暂停 (Suspend)
                  </button>
                )}
                {selectedAgent.status === 'suspended' && (
                  <button
                    type="button"
                    onClick={() => onUpdateStatus(selectedAgent.id, 'active')}
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    恢复活跃 (Activate)
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Create Agent Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  注册新 Verified by Concordium Agent
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  自动签发 Ed25519 密钥对、did:ccd 身份与 SHA-256 Agent Card 承诺
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">Agent 名称 *</label>
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：Alpine Treasury Guard"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">归属法人 / 真人主体 *</label>
                  <input
                    required
                    value={ownerEntity}
                    onChange={(e) => setOwnerEntity(e.target.value)}
                    placeholder="例如：Alpine FinTech AG"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">职能描述</label>
                  <input
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="Automated EU Compliance & Risk Agent"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">VCDC 企业域名（可选）</label>
                  <input
                    value={vcdcDomain}
                    onChange={(e) => setVcdcDomain(e.target.value)}
                    placeholder="agents.alpine-fintech.ch"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">CIS-8 绑定链</label>
                  <select
                    value={chain}
                    onChange={(e) => setChain(e.target.value as ExternalChain)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="Ethereum">Ethereum</option>
                    <option value="Solana">Solana</option>
                    <option value="Base">Base</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">外部链钱包地址 *</label>
                  <input
                    required
                    value={externalAddress}
                    onChange={(e) => setExternalAddress(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">单笔护栏上限 (PLT)</label>
                  <input
                    type="number"
                    min={1}
                    value={perCallLimitPlt}
                    onChange={(e) => setPerCallLimitPlt(Number(e.target.value))}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">每日预算上限 (PLT)</label>
                  <input
                    type="number"
                    min={1}
                    value={dailyLimitPlt}
                    onChange={(e) => setDailyLimitPlt(Number(e.target.value))}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">MCP 服务端点 & 能力集</label>
                <input
                  value={mcpEndpoint}
                  onChange={(e) => setMcpEndpoint(e.target.value)}
                  className="mb-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <input
                  value={capabilitiesInput}
                  onChange={(e) => setCapabilitiesInput(e.target.value)}
                  placeholder="sanctions.screen, market.research"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    父级委托 Agent（可选，支持级联 Kill Switch）
                  </label>
                  <select
                    value={parentAgentId}
                    onChange={(e) => setParentAgentId(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">无父级委托 (根主体 Agent L0)</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} (L{a.delegationDepth})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                    Concordium 账户地址（可选 Base58）
                  </label>
                  <input
                    value={walletAddress}
                    onChange={(e) => setWalletAddress(e.target.value)}
                    placeholder="3WZE6etJMh..."
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-slate-700 dark:text-slate-300 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={cascadeRevoke}
                    onChange={(e) => setCascadeRevoke(e.target.checked)}
                    className="h-3.5 w-3.5 accent-blue-700"
                  />
                  <span>当父级 Agent 被吊销或暂停时，自动执行级联吊销 (Cascade Kill Switch)</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-md border border-slate-200 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-60"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>{submitting ? '正在签发 did:ccd...' : '提交至 CIS-8004 注册表'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

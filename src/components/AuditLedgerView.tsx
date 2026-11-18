import { useState } from 'react';
import {
  AlertTriangle,
  Anchor,
  CheckCircle2,
  Download,
  ExternalLink,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { AuditEntry, ChainVerifyResult, OnchainAnchorRecord } from '../types';
import { AuditDecisionText } from './StatusBadge';

interface AuditLedgerViewProps {
  logs: AuditEntry[];
  onchainAnchors: OnchainAnchorRecord[];
  chainStatus: ChainVerifyResult | null;
  filterDecision: string;
  searchQuery: string;
  onFilterChange: (decision: string) => void;
  onSearchChange: (q: string) => void;
  onVerifyChain: () => Promise<void>;
  onSimulateTamper: () => Promise<void>;
  onRestoreTamper: () => Promise<void>;
  onAnchorAuditRoot: () => Promise<void>;
}

export function AuditLedgerView({
  logs,
  onchainAnchors,
  chainStatus,
  filterDecision,
  searchQuery,
  onFilterChange,
  onSearchChange,
  onVerifyChain,
  onSimulateTamper,
  onRestoreTamper,
  onAnchorAuditRoot,
}: AuditLedgerViewProps) {
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [tampering, setTampering] = useState(false);
  const [anchoring, setAnchoring] = useState(false);

  async function handleVerify() {
    setVerifying(true);
    try {
      await onVerifyChain();
    } finally {
      setVerifying(false);
    }
  }

  async function handleTamper() {
    setTampering(true);
    try {
      await onSimulateTamper();
    } finally {
      setTampering(false);
    }
  }

  async function handleRestore() {
    setTampering(true);
    try {
      await onRestoreTamper();
    } finally {
      setTampering(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 rounded-md bg-slate-100 p-1 dark:bg-slate-800">
            {(
              [
                ['all', '全部日志'],
                ['allowed', '仅放行'],
                ['blocked', '拦截与 402'],
                ['governance', '治理变更'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => onFilterChange(key)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  filterDecision === key
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
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索 did:ccd、端点或 SHA-256 哈希..."
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleVerify}
            disabled={verifying}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 whitespace-nowrap"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{verifying ? '正在重算 SHA-256...' : '验证哈希链完整性'}</span>
          </button>

          {chainStatus?.tamperDemoActive ? (
            <button
              type="button"
              onClick={handleRestore}
              disabled={tampering}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{tampering ? '恢复中...' : '恢复已备份账本'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleTamper}
              disabled={tampering || logs.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 whitespace-nowrap"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>{tampering ? '演示中...' : '模拟数据库篡改'}</span>
            </button>
          )}

          <button
            type="button"
            disabled={anchoring || logs.length === 0}
            onClick={async () => {
              setAnchoring(true);
              try {
                await onAnchorAuditRoot();
              } finally {
                setAnchoring(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-100 disabled:opacity-60 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 whitespace-nowrap"
          >
            <Anchor className="h-3.5 w-3.5" />
            <span>{anchoring ? '锚定签名中...' : '锚定根哈希至 Testnet'}</span>
          </button>

          <a
            href="/api/audit/export?format=csv"
            download="eu-ai-act-audit-report.csv"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>导出 CSV</span>
          </a>

          <a
            href="/api/audit/export?format=json"
            download="eu-ai-act-audit-report.json"
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-800 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>导出 EU AI Act JSON</span>
          </a>
        </div>
      </div>

      {/* Integrity Banner */}
      {chainStatus && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-5 py-3.5 text-xs ${
            chainStatus.valid
              ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
              : 'border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30'
          }`}
        >
          <div className="flex items-center gap-2">
            {chainStatus.valid ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-red-600" />
            )}
            <span
              className={`font-medium ${
                chainStatus.valid ? 'text-slate-900 dark:text-slate-100' : 'text-red-800 dark:text-red-200'
              }`}
            >
              {chainStatus.valid
                ? `EU AI Act 审计哈希链完整无篡改（已逐条验证 ${chainStatus.totalChecked} 条 SHA-256 链接）`
                : `检测到哈希链断裂，异常序号 #${chainStatus.brokenAtSeq}（已触发防篡改警报）`}
            </span>
          </div>
          <span className="text-slate-500 dark:text-slate-400">
            Zero-PII 合规保障：所有记录仅保留 ZKP 布尔断言与 Commitment 摘要
          </span>
        </div>
      )}

      {/* High-Density Audit Table */}
      <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {logs.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">暂无符合筛选条件的审计记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-5 py-3 font-medium">Seq</th>
                  <th className="px-3 py-3 font-medium">时间 (UTC)</th>
                  <th className="px-3 py-3 font-medium">Agent</th>
                  <th className="px-3 py-3 font-medium">端点 / 协议</th>
                  <th className="px-3 py-3 font-medium">决策结果</th>
                  <th className="px-3 py-3 font-medium">ZKP & PII</th>
                  <th className="px-3 py-3 text-right font-medium">金额 (PLT)</th>
                  <th className="px-5 py-3 text-right font-medium">Entry Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((entry) => (
                  <tr
                    key={entry.seq}
                    onClick={() => setSelectedEntry(entry)}
                    className="h-11 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-5 py-2.5 font-mono text-slate-500 tabular-nums">#{entry.seq}</td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600 tabular-nums dark:text-slate-400">
                      {entry.timestamp.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{entry.agentName}</div>
                      <div className="font-mono text-[10px] text-slate-500">{entry.agentDid.slice(0, 24)}...</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-slate-700 dark:text-slate-300">{entry.endpointPath}</div>
                      <div className="text-[10px] text-slate-500">{entry.protocol}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <AuditDecisionText decision={entry.decision} />
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                      PII: <span className="font-mono font-medium">false</span> ·{' '}
                      {entry.zkpClaims.principalVerified ? 'KYC✓' : 'KYC✗'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                      {entry.amountPlt.toFixed(2)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-[11px] text-blue-700 tabular-nums dark:text-blue-400">
                      {entry.entryHash.slice(0, 14)}...
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Concordium Testnet On-Chain Anchor Receipts */}
      <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Concordium Testnet 链上存证锚点记录 ({onchainAnchors.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              通过 Browser Wallet (`RegisterData` / `signMessage`) 将最新 EU AI Act 哈希链根指纹永久存证
            </p>
          </div>
        </div>
        {onchainAnchors.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            点击上方“锚定根哈希至 Testnet”按钮即可生成第一条链上合规存证记录
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-5 py-2.5 font-medium">锚定区间</th>
                  <th className="px-3 py-2.5 font-medium">根指纹 (Root Hash)</th>
                  <th className="px-3 py-2.5 font-medium">签名账户 / 模式</th>
                  <th className="px-3 py-2.5 font-medium">Tx Hash / 存证凭证</th>
                  <th className="px-5 py-2.5 text-right font-medium">时间 (UTC)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {onchainAnchors.map((anchor) => (
                  <tr key={anchor.id}>
                    <td className="px-5 py-2.5 font-mono text-slate-700 dark:text-slate-200">
                      {anchor.auditRange} ({anchor.totalEntries} 条)
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-blue-700 dark:text-blue-400">
                      {anchor.rootHash.slice(0, 16)}...
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                        {anchor.signerAddress.slice(0, 14)}...
                      </div>
                      <div className="text-[10px] text-slate-500">{anchor.mode}</div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px]">
                      <a
                        href={`https://testnet.ccdscan.io/transactions?d=${anchor.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-400"
                      >
                        <span>{anchor.txHash.slice(0, 14)}...</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-[11px] text-slate-500 tabular-nums">
                      {anchor.createdAt.replace('T', ' ').slice(0, 19)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Entry Proof Drawer Modal */}
      {selectedEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  EU AI Act 审计记录详情 #{selectedEntry.seq}
                </h3>
                <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{selectedEntry.requestId}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEntry(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <AuditDecisionText decision={selectedEntry.decision} />
                <span className="font-mono text-slate-500">{selectedEntry.timestamp}</span>
              </div>

              <p className="rounded-md border border-slate-200 bg-slate-50 p-3 leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                {selectedEntry.reason}
              </p>

              <dl className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Agent DID</dt>
                  <dd className="break-all text-right font-mono text-slate-900 dark:text-slate-100">
                    {selectedEntry.agentDid}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">ZKP Commitment</dt>
                  <dd className="break-all text-right font-mono text-slate-900 dark:text-slate-100">
                    {selectedEntry.zkpClaims.zkpCommitment}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">prevHash (上一节点)</dt>
                  <dd className="break-all text-right font-mono text-slate-600 dark:text-slate-400">
                    {selectedEntry.prevHash}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">entryHash (本条 SHA-256)</dt>
                  <dd className="break-all text-right font-mono text-blue-700 dark:text-blue-400">
                    {selectedEntry.entryHash}
                  </dd>
                </div>
              </dl>

              <pre className="max-h-56 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] text-slate-100 dark:border-slate-800">
                {JSON.stringify(selectedEntry, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

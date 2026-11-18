import { AlertTriangle, CheckCircle2, Clock, ShieldOff } from 'lucide-react';
import type { AgentStatus, AuditDecision } from '../types';

export function AgentStatusText({ status }: { status: AgentStatus }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>已验证活跃 (Active)</span>
      </span>
    );
  }
  if (status === 'suspended') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        <span>已暂停 (Suspended)</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400 whitespace-nowrap">
      <ShieldOff className="h-3.5 w-3.5 shrink-0" />
      <span>已吊销 (Revoked)</span>
    </span>
  );
}

export function AuditDecisionText({ decision }: { decision: AuditDecision }) {
  if (decision === 'ALLOWED') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>放行 · ALLOWED</span>
      </span>
    );
  }
  if (decision === 'PAYMENT_REQUIRED') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        <span>待支付 · HTTP 402</span>
      </span>
    );
  }
  if (decision.startsWith('BLOCKED_')) {
    const labelMap: Record<string, string> = {
      BLOCKED_UNVERIFIED: '拦截 · 未注册身份',
      BLOCKED_REVOKED: '拦截 · 身份已吊销',
      BLOCKED_CARD_TAMPERED: '拦截 · 卡片哈希篡改',
      BLOCKED_SIGNATURE_INVALID: '拦截 · Ed25519 签名无效',
      BLOCKED_STALE_REQUEST: '拦截 · 请求时间戳过期',
      BLOCKED_REPLAYED: '拦截 · 重放请求 (nonce 已用)',
      BLOCKED_RATE_LIMITED: '拦截 · QPM 突发限流 (429)',
      BLOCKED_ZKP_FAILED: '拦截 · ZKP 未通过',
      BLOCKED_SPENDING_LIMIT: '拦截 · 超出限额护栏',
    };
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400 whitespace-nowrap">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>{labelMap[decision] || decision}</span>
      </span>
    );
  }

  const govLabels: Record<string, string> = {
    GOVERNANCE_REVOKED: '治理 · 吊销 Agent',
    GOVERNANCE_CASCADE_REVOKED: '治理 · 级联吊销子 Agent',
    GOVERNANCE_CIRCUIT_OPENED: '熔断 · 连续违规自动暂停',
    GOVERNANCE_REACTIVATED: '治理 · 恢复 Agent',
    AGENT_REGISTERED: '治理 · 新建 CIS-8004',
    POLICY_UPDATED: '治理 · 更新门控策略',
    ONCHAIN_ANCHORED: '存证 · 根哈希锚定 Testnet',
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
      <span>{govLabels[decision] || decision}</span>
    </span>
  );
}

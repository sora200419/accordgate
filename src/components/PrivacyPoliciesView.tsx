import { useEffect, useState } from 'react';
import { BellRing, Check, Lock, Plus, Save, Send, ShieldCheck, Trash2, X } from 'lucide-react';
import type {
  GatePolicy,
  GatewayProtocol,
  WebhookConfig,
  WebhookDeliveryLog,
  WebhookEventType,
} from '../types';

interface PrivacyPoliciesViewProps {
  policies: GatePolicy[];
  webhooks: WebhookConfig[];
  webhookDeliveries: WebhookDeliveryLog[];
  onSavePolicy: (id: string, patch: Partial<GatePolicy>) => Promise<void>;
  onCreatePolicy: (payload: {
    serviceName: string;
    endpointPath: string;
    protocol: GatewayProtocol;
    description: string;
    requiredZkpPredicates: GatePolicy['requiredZkpPredicates'];
    maxPerCallPlt: number;
    dailyAgentCapPlt: number;
    x402PricePlt: number;
    sponsoredGas: boolean;
    rateLimitQpm?: number;
    circuitBreakerThreshold?: number;
  }) => Promise<void>;
  onCreateWebhook: (payload: {
    label: string;
    url: string;
    enabledEvents: WebhookEventType[];
  }) => Promise<void>;
  onDeleteWebhook: (id: string) => Promise<void>;
  onTestWebhook: (id: string) => Promise<void>;
}

const ALL_JURISDICTIONS = ['EU', 'EEA', 'CH', 'UK', 'SG'];
const ALL_WEBHOOK_EVENTS: Array<{ id: WebhookEventType; label: string }> = [
  { id: 'circuit_breaker.opened', label: '熔断触发' },
  { id: 'agent.revoked', label: 'Agent 吊销' },
  { id: 'agent.cascade_revoked', label: '级联吊销' },
  { id: 'rate_limit.exceeded', label: 'QPM 限流' },
  { id: 'audit.tamper_detected', label: '链篡改警报' },
  { id: 'audit.anchored', label: 'Testnet 锚定' },
];

export function PrivacyPoliciesView({
  policies,
  webhooks,
  webhookDeliveries,
  onSavePolicy,
  onCreatePolicy,
  onCreateWebhook,
  onDeleteWebhook,
  onTestWebhook,
}: PrivacyPoliciesViewProps) {
  const [selectedId, setSelectedId] = useState<string>(policies[0]?.id ?? '');
  const activePolicy = policies.find((p) => p.id === selectedId) ?? policies[0] ?? null;

  const [principalVerified, setPrincipalVerified] = useState(true);
  const [minAge, setMinAge] = useState<number | null>(18);
  const [allowedJurisdictions, setAllowedJurisdictions] = useState<string[]>(['EU', 'EEA']);
  const [requireVcdcDomain, setRequireVcdcDomain] = useState(true);
  const [maxPerCallPlt, setMaxPerCallPlt] = useState(25);
  const [dailyAgentCapPlt, setDailyAgentCapPlt] = useState(500);
  const [x402PricePlt, setX402PricePlt] = useState(0.5);
  const [sponsoredGas, setSponsoredGas] = useState(true);
  const [rateLimitQpm, setRateLimitQpm] = useState(25);
  const [circuitBreakerThreshold, setCircuitBreakerThreshold] = useState(3);
  const [saving, setSaving] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('/api/mcp/custom-risk-oracle');
  const [newProtocol, setNewProtocol] = useState<GatewayProtocol>('MCP');
  const [newDesc, setNewDesc] = useState('');
  const [newPrice, setNewPrice] = useState(0.5);
  const [newMinAge, setNewMinAge] = useState<number | null>(18);
  const [newRateLimitQpm, setNewRateLimitQpm] = useState(20);
  const [newCircuitThreshold, setNewCircuitThreshold] = useState(3);
  const [creating, setCreating] = useState(false);

  // Webhook creation state
  const [whLabel, setWhLabel] = useState('SOC 合规告警中心 (Slack / SIEM)');
  const [whUrl, setWhUrl] = useState('https://httpbin.org/post');
  const [whEvents, setWhEvents] = useState<WebhookEventType[]>([
    'circuit_breaker.opened',
    'agent.cascade_revoked',
    'audit.tamper_detected',
  ]);
  const [whSubmitting, setWhSubmitting] = useState(false);
  const [testingWhId, setTestingWhId] = useState<string | null>(null);

  useEffect(() => {
    if (!activePolicy) return;
    setPrincipalVerified(activePolicy.requiredZkpPredicates.principalVerified);
    setMinAge(activePolicy.requiredZkpPredicates.minAge);
    setAllowedJurisdictions(activePolicy.requiredZkpPredicates.allowedJurisdictions);
    setRequireVcdcDomain(activePolicy.requiredZkpPredicates.requireVcdcDomain);
    setMaxPerCallPlt(activePolicy.maxPerCallPlt);
    setDailyAgentCapPlt(activePolicy.dailyAgentCapPlt);
    setX402PricePlt(activePolicy.x402PricePlt);
    setSponsoredGas(activePolicy.sponsoredGas);
    setRateLimitQpm(activePolicy.rateLimitQpm ?? 25);
    setCircuitBreakerThreshold(activePolicy.circuitBreakerThreshold ?? 3);
  }, [activePolicy]);

  function toggleJurisdiction(code: string) {
    setAllowedJurisdictions((prev) =>
      prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code],
    );
  }

  function toggleWebhookEvent(ev: WebhookEventType) {
    setWhEvents((prev) => {
      if (prev.includes(ev)) {
        return prev.length > 1 ? prev.filter((item) => item !== ev) : prev;
      }
      return [...prev, ev];
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!activePolicy) return;
    setSaving(true);
    try {
      await onSavePolicy(activePolicy.id, {
        requiredZkpPredicates: {
          principalVerified,
          minAge,
          allowedJurisdictions,
          requireVcdcDomain,
        },
        maxPerCallPlt,
        dailyAgentCapPlt,
        x402PricePlt,
        sponsoredGas,
        rateLimitQpm,
        circuitBreakerThreshold,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleAddWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!whLabel.trim() || !whUrl.trim()) return;
    setWhSubmitting(true);
    try {
      await onCreateWebhook({
        label: whLabel.trim(),
        url: whUrl.trim(),
        enabledEvents: whEvents,
      });
    } finally {
      setWhSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Endpoint Selector List */}
        <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 xl:col-span-5">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">受保护的 MCP 工具与 REST 端点</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                基于零知识证明断言、QPM 限流与熔断阈值进行访问门控，服务端不存储个人隐私数据
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1 rounded-md bg-blue-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新增端点</span>
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {policies.map((pol) => {
              const isSelected = activePolicy?.id === pol.id;
              return (
                <button
                  key={pol.id}
                  type="button"
                  onClick={() => setSelectedId(pol.id)}
                  className={`flex w-full flex-col items-start px-5 py-4 text-left transition-colors ${
                    isSelected
                      ? 'bg-blue-50/70 dark:bg-blue-950/30'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{pol.serviceName}</span>
                    <span className="font-mono text-xs font-medium text-blue-700 dark:text-blue-400">
                      {pol.protocol}
                    </span>
                  </div>
                  <span className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-400">{pol.endpointPath}</span>
                  <span className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    辖区: {pol.requiredZkpPredicates.allowedJurisdictions.join('/')} · QPM:{' '}
                    <span className="font-mono tabular-nums">{pol.rateLimitQpm ?? 25}</span> · 熔断:{' '}
                    <span className="font-mono tabular-nums">{pol.circuitBreakerThreshold ?? 3}次</span> · x402:{' '}
                    <span className="font-mono tabular-nums">{pol.x402PricePlt.toFixed(2)} EURt</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Policy Configuration Editor */}
        <section className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 xl:col-span-7">
          {!activePolicy ? (
            <div className="py-12 text-center text-xs text-slate-500">未选择策略</div>
          ) : (
            <form onSubmit={handleSave} className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-blue-700 dark:text-blue-400" />
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      {activePolicy.serviceName}
                    </h3>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{activePolicy.description}</p>
                </div>
                <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{activePolicy.endpointPath}</span>
              </div>

              {/* ZKP Predicate Matrix */}
              <div className="space-y-4">
                <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  1. ZKP 零知识证明属性门控（Verify Once, Reveal Nothing）
                </h4>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3.5 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                    <input
                      type="checkbox"
                      checked={principalVerified}
                      onChange={(e) => setPrincipalVerified(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-blue-700"
                    />
                    <div className="text-xs">
                      <div className="font-medium text-slate-900 dark:text-slate-100">强制 Verified Principal 背书</div>
                      <div className="mt-0.5 text-slate-500 dark:text-slate-400">
                        要求 Agent 背后存在已通过 Concordium IDP 验证的真人或法人
                      </div>
                    </div>
                  </label>

                  <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3.5 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                    <input
                      type="checkbox"
                      checked={requireVcdcDomain}
                      onChange={(e) => setRequireVcdcDomain(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-blue-700"
                    />
                    <div className="text-xs">
                      <div className="font-medium text-slate-900 dark:text-slate-100">强制 VCDC 企业域名控制证明</div>
                      <div className="mt-0.5 text-slate-500 dark:text-slate-400">
                        校验 Agent Card 中的企业官方域名已与 Concordium 账户签名绑定
                      </div>
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      ZKP 年龄门控阈值 (Age Predicate)
                    </label>
                    <select
                      value={minAge === null ? 'none' : String(minAge)}
                      onChange={(e) => setMinAge(e.target.value === 'none' ? null : Number(e.target.value))}
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="none">不校验年龄属性 (None)</option>
                      <option value="18">仅限 18+ 已成年授权主体</option>
                      <option value="21">仅限 21+ 高净值/机构授权主体</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      ZKP 合规司法管辖区白名单
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_JURISDICTIONS.map((code) => {
                        const active = allowedJurisdictions.includes(code);
                        return (
                          <button
                            key={code}
                            type="button"
                            onClick={() => toggleJurisdiction(code)}
                            className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 font-mono text-xs font-medium transition-colors ${
                              active
                                ? 'border-blue-700 bg-blue-700 text-white'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
                            }`}
                          >
                            {active && <Check className="h-3 w-3" />}
                            <span>{code}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Guardrails, Rate Limit & Circuit Breaker */}
              <div className="space-y-4 border-t border-slate-200 pt-5 dark:border-slate-800">
                <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  2. 消费护栏锁、网关限流熔断与 x402 赞助微支付配置
                </h4>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      单笔限额上限 (PLT)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={maxPerCallPlt}
                      onChange={(e) => setMaxPerCallPlt(Number(e.target.value))}
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      每日总限额 (PLT)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={10}
                      value={dailyAgentCapPlt}
                      onChange={(e) => setDailyAgentCapPlt(Number(e.target.value))}
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      x402 按次调用费 (EURt)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.05}
                      value={x402PricePlt}
                      onChange={(e) => setX402PricePlt(Number(e.target.value))}
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      滑动窗口限流上限 (QPM · 每分钟最大请求数)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={rateLimitQpm}
                      onChange={(e) => setRateLimitQpm(Number(e.target.value))}
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      异常自动熔断阈值 (连续违规 N 次自动暂停 Agent)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={circuitBreakerThreshold}
                      onChange={(e) => setCircuitBreakerThreshold(Number(e.target.value))}
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                </div>

                <label className="flex cursor-pointer items-center justify-between rounded-md border border-slate-200 p-3.5 dark:border-slate-800">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <div className="text-xs">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        启用 CIS-3 赞助交易 (Sponsored Gas)
                      </div>
                      <div className="mt-0.5 text-slate-500 dark:text-slate-400">
                        由 x402 Facilitator 替 Agent 代付底层 CCD 手续费，Agent 无需持有原生 Gas 代币
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={sponsoredGas}
                    onChange={(e) => setSponsoredGas(e.target.checked)}
                    className="h-4 w-4 accent-blue-700"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  每次修改策略会自动记录一条不可篡改的 GOVERNANCE 审计日志
                </span>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{saving ? '保存中...' : '保存并生效策略'}</span>
                </button>
              </div>
            </form>
          )}
        </section>
      </div>

      {/* Webhook Alerting & Real Delivery Log Section */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <BellRing className="h-4 w-4 text-blue-700 dark:text-blue-400" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                企业合规 Webhook 告警与 HMAC-SHA256 投递审计 ({webhooks.length})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                当触发熔断自动暂停、级联吊销、限流拦截或审计链篡改时，网关自动向 SIEM / Slack / PagerDuty 推送带{' '}
                <code className="font-mono">X-AccordGate-Signature</code> 签名的 HTTP POST 事件
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 xl:grid-cols-12">
          {/* Add Webhook Form + Configured Targets */}
          <div className="space-y-4 xl:col-span-6">
            <form
              onSubmit={handleAddWebhook}
              className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-800 dark:bg-slate-950"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">接收通道名称 *</label>
                  <input
                    required
                    value={whLabel}
                    onChange={(e) => setWhLabel(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">HTTPS Webhook URL *</label>
                  <input
                    required
                    type="url"
                    value={whUrl}
                    onChange={(e) => setWhUrl(e.target.value)}
                    placeholder="https://httpbin.org/post"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 font-mono text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <div className="mb-1.5 font-medium text-slate-700 dark:text-slate-300">订阅安全与治理事件</div>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_WEBHOOK_EVENTS.map((ev) => {
                    const active = whEvents.includes(ev.id);
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => toggleWebhookEvent(ev.id)}
                        className={`rounded border px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                          active
                            ? 'border-blue-700 bg-blue-700 text-white'
                            : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                        }`}
                      >
                        {ev.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={whSubmitting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3 py-1.5 font-medium text-white hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{whSubmitting ? '添加中...' : '添加 Webhook 订阅'}</span>
                </button>
              </div>
            </form>

            {/* Configured Webhooks */}
            <div className="space-y-2">
              {webhooks.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500 dark:border-slate-800">
                  尚未配置企业 Webhook 告警接收端点
                </div>
              ) : (
                webhooks.map((wh) => (
                  <div
                    key={wh.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3 text-xs dark:border-slate-800"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{wh.label}</div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {wh.url}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        签名密钥: <span className="font-mono">{wh.signingSecretPreview}</span> · 最近状态:{' '}
                        <span className="font-mono font-medium">
                          {wh.lastStatusCode !== null ? `HTTP ${wh.lastStatusCode}` : '待触发'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={testingWhId === wh.id}
                        onClick={async () => {
                          setTestingWhId(wh.id);
                          try {
                            await onTestWebhook(wh.id);
                          } finally {
                            setTestingWhId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
                      >
                        <Send className="h-3 w-3" />
                        <span>{testingWhId === wh.id ? '发送中...' : '发送测试'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteWebhook(wh.id)}
                        className="rounded border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
                        title="删除 Webhook"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Delivery Logs */}
          <div className="xl:col-span-6">
            <div className="mb-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
              最近实时投递记录 ({webhookDeliveries.length})
            </div>
            {webhookDeliveries.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 py-12 text-center text-xs text-slate-500 dark:border-slate-800">
                点击“发送测试”或触发熔断 / 级联吊销事件后，此处将展示真实 HTTP 响应与耗时
              </div>
            ) : (
              <div className="max-h-72 overflow-auto rounded-md border border-slate-200 dark:border-slate-800">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                      <th className="px-3 py-2 font-medium">事件</th>
                      <th className="px-3 py-2 font-medium">通道</th>
                      <th className="px-3 py-2 font-medium">响应</th>
                      <th className="px-3 py-2 text-right font-medium">耗时</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {webhookDeliveries.map((d) => (
                      <tr key={d.id}>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-800 dark:text-slate-200">
                          {d.eventType}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{d.webhookLabel}</td>
                        <td className="px-3 py-2 font-mono text-[11px]">
                          <span className={d.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                            {d.detail}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">
                          {d.latencyMs}ms
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">新增 ZKP 隐私门控端点</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newName.trim() || !newPath.trim()) return;
                setCreating(true);
                try {
                  await onCreatePolicy({
                    serviceName: newName.trim(),
                    endpointPath: newPath.trim(),
                    protocol: newProtocol,
                    description: newDesc.trim() || 'Custom ZKP & x402 protected enterprise endpoint.',
                    requiredZkpPredicates: {
                      principalVerified: true,
                      minAge: newMinAge,
                      allowedJurisdictions: ['EU', 'EEA'],
                      requireVcdcDomain: true,
                    },
                    maxPerCallPlt: 50,
                    dailyAgentCapPlt: 500,
                    x402PricePlt: newPrice,
                    sponsoredGas: true,
                    rateLimitQpm: newRateLimitQpm,
                    circuitBreakerThreshold: newCircuitThreshold,
                  });
                  setShowCreateModal(false);
                  setNewName('');
                  setNewDesc('');
                } finally {
                  setCreating(false);
                }
              }}
              className="mt-4 space-y-4 text-xs"
            >
              <div>
                <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">服务名称 *</label>
                <input
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例如：Credit Risk Oracle MCP"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">协议类型</label>
                  <select
                    value={newProtocol}
                    onChange={(e) => setNewProtocol(e.target.value as GatewayProtocol)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="MCP">MCP</option>
                    <option value="REST">REST</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">端点路径 *</label>
                  <input
                    required
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">年龄门槛</label>
                  <select
                    value={newMinAge === null ? 'none' : String(newMinAge)}
                    onChange={(e) => setNewMinAge(e.target.value === 'none' ? null : Number(e.target.value))}
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="none">不限</option>
                    <option value="18">18+</option>
                    <option value="21">21+</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">x402 (EURt)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={newPrice}
                    onChange={(e) => setNewPrice(Number(e.target.value))}
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">QPM 上限</label>
                  <input
                    type="number"
                    min={1}
                    value={newRateLimitQpm}
                    onChange={(e) => setNewRateLimitQpm(Number(e.target.value))}
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">熔断阈值</label>
                  <input
                    type="number"
                    min={1}
                    value={newCircuitThreshold}
                    onChange={(e) => setNewCircuitThreshold(Number(e.target.value))}
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">合规说明</label>
                <input
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="描述该端点的业务用途与 ZKP 约束"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-md border border-slate-200 px-4 py-2 font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-60"
                >
                  {creating ? '创建中...' : '创建门控端点'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

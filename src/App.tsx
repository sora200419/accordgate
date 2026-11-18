import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  Activity,
  Bot,
  Cloud,
  FileCheck2,
  FlaskConical,
  LayoutDashboard,
  Lock,
  LogIn,
  LogOut,
  Menu,
  Moon,
  RotateCcw,
  Shield,
  Sun,
  Wallet,
  X,
} from 'lucide-react';
import { api, SignInRequiredError } from './api';
import { AgentRegistryView } from './components/AgentRegistryView';
import { AuditLedgerView } from './components/AuditLedgerView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OverviewView } from './components/OverviewView';
import { PrivacyPoliciesView } from './components/PrivacyPoliciesView';
import { ProtocolSandboxView } from './components/ProtocolSandboxView';
import { auth, firebaseEnabled, googleProvider, testFirestoreConnection } from './firebase';
import {
  anchorAuditRootWithWallet,
  signGovernanceActionWithWallet,
  signInWithWallet,
} from './services/concordiumWallet';
import { syncWorkspaceToFirestore, type WorkspaceSyncSummary } from './services/firestoreSync';
import type {
  AgentRecord,
  AgentStatus,
  AuditEntry,
  ChainVerifyResult,
  ExternalChain,
  GatePolicy,
  GatewayProtocol,
  OnchainAnchorRecord,
  OverviewMetrics,
  TestnetProbeResult,
  WebhookConfig,
  WebhookDeliveryLog,
  WebhookEventType,
  WorkspaceTab,
} from './types';

const NAV_ITEMS: Array<{ id: WorkspaceTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: '概览工作台', icon: LayoutDashboard },
  { id: 'agents', label: '可信 Agent 注册表', icon: Bot },
  { id: 'policies', label: 'ZKP 隐私门控策略', icon: Lock },
  { id: 'sandbox', label: '协议交互沙盒', icon: FlaskConical },
  { id: 'audit', label: 'EU AI Act 审计账本', icon: FileCheck2 },
];

function AccordGateDashboard() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [recentLogs, setRecentLogs] = useState<AuditEntry[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [policies, setPolicies] = useState<GatePolicy[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [chainStatus, setChainStatus] = useState<ChainVerifyResult | null>(null);
  const [auditFilter, setAuditFilter] = useState<string>('all');
  const [auditSearch, setAuditSearch] = useState<string>('');
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDeliveryLog[]>([]);
  const [onchainAnchors, setOnchainAnchors] = useState<OnchainAnchorRecord[]>([]);

  const [testnetProbe, setTestnetProbe] = useState<TestnetProbeResult | null>(null);
  const [probingTestnet, setProbingTestnet] = useState(false);

  // Firebase Auth & Cloud Firestore Sync state
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudSummary, setCloudSummary] = useState<WorkspaceSyncSummary | null>(null);

  // Concordium Browser Wallet state
  const [walletAccount, setWalletAccount] = useState<string | null>(null);
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [ownerSignInConfigured, setOwnerSignInConfigured] = useState(true);

  const notify = useCallback((message: string) => {
    setToastMsg(message);
    window.setTimeout(() => {
      setToastMsg((prev) => (prev === message ? null : prev));
    }, 3800);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Restore the owner session (HttpOnly cookie) and show sign-in errors from any action.
  useEffect(() => {
    api
      .authMe()
      .then((me) => {
        setWalletAccount(me.account);
        setOwnerSignInConfigured(me.ownerSignInConfigured);
      })
      .catch((err) => console.error('Owner session check failed:', err instanceof Error ? err.message : err));
    const onRejection = (event: PromiseRejectionEvent) => {
      // Only sign-in errors are expected here; anything else stays in the console as a real bug.
      if (event.reason instanceof SignInRequiredError) {
        notify(event.reason.message);
        event.preventDefault();
      }
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, [notify]);

  useEffect(() => {
    if (!auth) return;
    void testFirestoreConnection();
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
    });
    return () => unsub();
  }, []);

  const refreshAuditOnly = useCallback(async (decision: string, q: string) => {
    const res = await api.getAuditLogs(decision, q);
    setAuditLogs(res.logs);
    setChainStatus(res.chainStatus);
  }, []);

  const syncSnapshotToCloud = useCallback(
    async (
      user: User,
      snapshot: {
        agents: AgentRecord[];
        policies: GatePolicy[];
        auditLogs: AuditEntry[];
        webhooks: WebhookConfig[];
        anchors: OnchainAnchorRecord[];
      },
    ) => {
      setCloudSyncing(true);
      try {
        const summary = await syncWorkspaceToFirestore(user, snapshot);
        setCloudSummary(summary);
      } catch (err) {
        console.error('Cloud Firestore sync failed:', err);
      } finally {
        setCloudSyncing(false);
      }
    },
    [],
  );

  const refreshAll = useCallback(async () => {
    try {
      setErrorMsg(null);
      const [overviewRes, agentsRes, policiesRes, auditRes, webhooksRes, anchorsRes] = await Promise.all([
        api.getOverview(),
        api.getAgents(),
        api.getPolicies(),
        api.getAuditLogs(auditFilter, auditSearch),
        api.getWebhooks(),
        api.getAnchors(),
      ]);
      setMetrics(overviewRes.metrics);
      setRecentLogs(overviewRes.recentLogs);
      setAgents(agentsRes.agents);
      setPolicies(policiesRes.policies);
      setAuditLogs(auditRes.logs);
      setChainStatus(auditRes.chainStatus);
      setWebhooks(webhooksRes.webhooks);
      setWebhookDeliveries(webhooksRes.deliveries);
      setOnchainAnchors(anchorsRes.anchors);

      const cloudUser = auth?.currentUser;
      if (cloudUser && cloudUser.emailVerified) {
        const allAuditRes =
          auditFilter === 'all' && !auditSearch
            ? auditRes
            : await api.getAuditLogs('all', '');
        void syncSnapshotToCloud(cloudUser, {
          agents: agentsRes.agents,
          policies: policiesRes.policies,
          auditLogs: allAuditRes.logs,
          webhooks: webhooksRes.webhooks,
          anchors: anchorsRes.anchors,
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载网关数据失败');
    } finally {
      setLoading(false);
    }
  }, [auditFilter, auditSearch, syncSnapshotToCloud]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!loading) {
      void refreshAuditOnly(auditFilter, auditSearch);
    }
  }, [auditFilter, auditSearch, loading, refreshAuditOnly]);

  async function handleGoogleLogin() {
    if (!auth) {
      notify('云端同步未配置（缺少 VITE_FIREBASE_* 环境变量）');
      return;
    }
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      notify(`已登录云端合规账号: ${cred.user.email ?? cred.user.displayName ?? 'Verified User'}`);
      await refreshAll();
    } catch (err) {
      notify(err instanceof Error ? `登录未完成: ${err.message}` : 'Google 登录取消或失败');
    }
  }

  async function handleGoogleLogout() {
    if (!auth) return;
    await signOut(auth);
    setCloudSummary(null);
    notify('已退出 Google 云端会话（本地服务端沙盒继续运行）');
  }

  async function handleConnectWallet() {
    setConnectingWallet(true);
    try {
      const account = await signInWithWallet(api);
      setWalletAccount(account);
      notify(`已用 Concordium 钱包登录为所有者: ${account.slice(0, 10)}...`);
    } catch (err) {
      notify(err instanceof Error ? `钱包登录失败: ${err.message}` : '钱包登录失败');
    } finally {
      setConnectingWallet(false);
    }
  }

  async function handleWalletSignOut() {
    try {
      await api.authLogout();
    } catch (err) {
      notify(err instanceof Error ? `退出失败: ${err.message}` : '退出失败');
      return;
    }
    setWalletAccount(null);
    notify('已退出所有者会话');
  }

  async function handleCreateAgent(payload: {
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
  }) {
    await api.createAgent({
      ...payload,
      walletAddress: payload.walletAddress || walletAccount || null,
    });
    await refreshAll();
    notify(`已登记到本地注册表（未写入 CIS-8004）: ${payload.name}`);
  }

  async function handleUpdateAgentStatus(id: string, status: AgentStatus) {
    if (status === 'revoked' && walletAccount) {
      await signGovernanceActionWithWallet(walletAccount, `accordgate:kill-switch:${id}:${status}`);
    }
    const res = await api.updateAgentStatus(id, status);
    await refreshAll();
    if (status === 'revoked') {
      const cascadeCount = res.cascadedIds?.length ?? 0;
      notify(
        cascadeCount > 0
          ? `Kill Switch 已吊销该 Agent 并级联吊销 ${cascadeCount} 个下级子 Agent`
          : '已执行 Kill Switch 吊销该 Agent 权限',
      );
    } else {
      notify(`Agent 状态已更新为 ${status}`);
    }
  }

  async function handleRotateAgentCard(id: string) {
    await api.rotateAgentCard(id);
    await refreshAll();
    notify('Agent Card 版本已更新，SHA-256 承诺摘要已重算');
  }

  async function handleSavePolicy(id: string, patch: Partial<GatePolicy>) {
    await api.updatePolicy(id, patch);
    await refreshAll();
    notify('ZKP 隐私门控、限流熔断与 x402 策略已保存并生效');
  }

  async function handleCreatePolicy(payload: {
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
  }) {
    await api.createPolicy(payload);
    await refreshAll();
    notify(`已新增受保护端点策略: ${payload.endpointPath}`);
  }

  async function handleCreateWebhook(payload: {
    label: string;
    url: string;
    enabledEvents: WebhookEventType[];
  }) {
    await api.createWebhook(payload);
    await refreshAll();
    notify(`已添加 Webhook 告警通道: ${payload.label}`);
  }

  async function handleDeleteWebhook(id: string) {
    await api.deleteWebhook(id);
    await refreshAll();
    notify('已移除 Webhook 配置');
  }

  async function handleTestWebhook(id: string) {
    const res = await api.testWebhook(id);
    await refreshAll();
    notify(
      res.delivery.ok
        ? `Webhook 测试投递成功 (${res.delivery.detail}, ${res.delivery.latencyMs}ms)`
        : `Webhook 测试返回: ${res.delivery.detail}`,
    );
  }

  async function handleAnchorAuditRoot() {
    const latestEntry = auditLogs[0];
    const rootHash = latestEntry?.entryHash ?? '0'.repeat(64);
    const oldestSeq = auditLogs[auditLogs.length - 1]?.seq ?? 1;
    const newestSeq = latestEntry?.seq ?? 1;
    const auditRange = `#${oldestSeq}-#${newestSeq}`;

    const signed = await anchorAuditRootWithWallet(walletAccount, rootHash, auditRange);
    // The toast follows the anchor the server stored, which may be downgraded to simulated.
    const { anchor } = await api.createAnchor({
      signerAddress: signed.signerAddress,
      txHash: signed.txHash,
      mode: signed.mode,
    });
    await refreshAll();
    notify(
      anchor.mode === 'browser-wallet-tx'
        ? `钱包已提交 RegisterData 交易 (${anchor.txHash.slice(0, 12)}...)，服务器未核验`
        : anchor.mode === 'wallet-signed-attestation'
          ? '钱包只签名了根哈希（未上链，未发交易）'
          : '模拟锚定：未签名、未上链',
    );
  }

  async function handleVerifyChain() {
    const res = await api.verifyAuditChain();
    setChainStatus(res);
    notify(res.valid ? `哈希链校验通过 (${res.totalChecked} 条记录)` : `哈希链异常于 #${res.brokenAtSeq}`);
  }

  async function handleSimulateTamper() {
    const res = await api.simulateAuditTamper();
    await refreshAll();
    setChainStatus(res);
    notify(`已篡改历史记录 #${res.tamperedSeq}，SHA-256 校验已捕获断链！`);
  }

  async function handleRestoreTamper() {
    const res = await api.restoreAuditTamper();
    await refreshAll();
    setChainStatus(res);
    notify('已从备份恢复完整 EU AI Act 审计哈希链');
  }

  async function handleProbeTestnet() {
    setProbingTestnet(true);
    try {
      const res = await api.probeTestnet();
      setTestnetProbe(res);
      notify(res.reachable ? `Concordium Testnet 连通正常 (${res.latencyMs}ms)` : 'Testnet 不可达，未读取链上状态');
    } finally {
      setProbingTestnet(false);
    }
  }

  async function handleResetSandbox() {
    await api.resetSandbox();
    setAuditFilter('all');
    setAuditSearch('');
    await refreshAll();
    notify('沙盒数据与初始审计链已重置');
  }

  const currentNavLabel = NAV_ITEMS.find((item) => item.id === activeTab)?.label ?? '概览工作台';

  const sidebarFooterControls = (
    <div className="space-y-2 border-t border-slate-200 p-4 dark:border-slate-800">
      {/* Firebase Cloud Sync & Google Sign-In */}
      {firebaseUser ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 truncate font-medium text-slate-800 dark:text-slate-200">
              <Cloud className="h-3.5 w-3.5 shrink-0 text-blue-700 dark:text-blue-400" />
              <span className="truncate">{firebaseUser.displayName || firebaseUser.email}</span>
            </span>
            <button
              type="button"
              onClick={handleGoogleLogout}
              className="rounded p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
              title="退出 Google 云端同步"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-1 font-mono text-[10px] text-slate-500 dark:text-slate-400">
            {cloudSyncing
              ? 'Firestore 云端同步中...'
              : cloudSummary
              ? `Firestore 已同步 · ${cloudSummary.agentCount} Agents · ${cloudSummary.auditCount} Logs`
              : 'Firestore 就绪'}
          </div>
        </div>
      ) : !firebaseEnabled ? (
        <div
          className="flex w-full items-center gap-2.5 rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400"
          title="设置 VITE_FIREBASE_* 环境变量后可启用 Google 登录与 Firestore 同步"
        >
          <Cloud className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">云端同步未配置</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleGoogleLogin}
          className="flex w-full items-center gap-2.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <LogIn className="h-3.5 w-3.5 shrink-0 text-blue-700 dark:text-blue-400" />
          <span className="truncate">Google 登录云端持久化</span>
        </button>
      )}

      {/* Concordium Browser Wallet */}
      {walletAccount ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          <span className="inline-flex items-center gap-1.5 truncate font-mono text-[11px]">
            <Wallet className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{walletAccount.slice(0, 12)}...</span>
          </span>
          <button
            type="button"
            onClick={handleWalletSignOut}
            className="text-[11px] underline shrink-0"
          >
            退出
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={connectingWallet}
          onClick={handleConnectWallet}
          className="flex w-full items-center gap-2.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <Wallet className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {connectingWallet ? '等待钱包签名...' : ownerSignInConfigured ? '用 Concordium 钱包登录（所有者）' : '所有者登录未配置（OWNER_ACCOUNTS）'}
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={() => setDarkMode((d) => !d)}
        className="flex w-full items-center gap-2.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        <span>{darkMode ? '切换浅色控制台' : '切换深色控制台'}</span>
      </button>

      <button
        type="button"
        onClick={handleResetSandbox}
        className="flex w-full items-center gap-2.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        <span>重置演示状态</span>
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Desktop Left Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col justify-between border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:flex">
        <div>
          <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-6 dark:border-slate-800">
            <Shield className="h-5 w-5 text-blue-700 dark:text-blue-400" />
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
              AccordGate
            </span>
          </div>

          <nav className="space-y-1 p-4">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {sidebarFooterControls}
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-900/50" onClick={() => setMobileNavOpen(false)} />
          <div className="relative z-10 flex w-64 flex-col justify-between bg-white dark:bg-slate-900">
            <div className="p-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-blue-700 dark:text-blue-400" />
                  <span className="font-display text-lg font-bold">AccordGate</span>
                </div>
                <button type="button" onClick={() => setMobileNavOpen(false)} className="p-1 text-slate-500">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <nav className="mt-4 space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileNavOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium ${
                        isActive
                          ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
            {sidebarFooterControls}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-8 border-b border-slate-200 bg-white px-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="rounded-md border border-slate-200 p-1.5 text-slate-600 lg:hidden dark:border-slate-700 dark:text-slate-300"
              aria-label="Open Navigation"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 truncate text-sm">
              <span className="text-slate-500 dark:text-slate-400">AccordGate</span>
              <span className="text-slate-400">/</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">{currentNavLabel}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab(activeTab === 'sandbox' ? 'audit' : 'sandbox')}
            className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0"
          >
            <Activity className="h-3.5 w-3.5" />
            <span>{activeTab === 'sandbox' ? '查看审计账本' : '启动协议沙盒'}</span>
          </button>
        </header>

        <main className="mx-auto w-full max-w-[1320px] flex-1 p-6">
          {errorMsg && (
            <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {errorMsg}
            </div>
          )}

          {loading ? (
            <div className="space-y-4">
              <div className="h-28 animate-pulse rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[1, 2, 3, 4].map((k) => (
                  <div
                    key={k}
                    className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                  />
                ))}
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewView
                  metrics={metrics}
                  recentLogs={recentLogs}
                  testnetProbe={testnetProbe}
                  probingTestnet={probingTestnet}
                  onProbeTestnet={handleProbeTestnet}
                  onNavigate={setActiveTab}
                />
              )}

              {activeTab === 'agents' && (
                <AgentRegistryView
                  agents={agents}
                  onCreateAgent={handleCreateAgent}
                  onUpdateStatus={handleUpdateAgentStatus}
                  onRotateCard={handleRotateAgentCard}
                />
              )}

              {activeTab === 'policies' && (
                <PrivacyPoliciesView
                  policies={policies}
                  webhooks={webhooks}
                  webhookDeliveries={webhookDeliveries}
                  onSavePolicy={handleSavePolicy}
                  onCreatePolicy={handleCreatePolicy}
                  onCreateWebhook={handleCreateWebhook}
                  onDeleteWebhook={handleDeleteWebhook}
                  onTestWebhook={handleTestWebhook}
                />
              )}

              {activeTab === 'sandbox' && (
                <ProtocolSandboxView
                  agents={agents}
                  policies={policies}
                  onRefreshAll={refreshAll}
                  onNotify={notify}
                />
              )}

              {activeTab === 'audit' && (
                <AuditLedgerView
                  logs={auditLogs}
                  onchainAnchors={onchainAnchors}
                  chainStatus={chainStatus}
                  filterDecision={auditFilter}
                  searchQuery={auditSearch}
                  onFilterChange={setAuditFilter}
                  onSearchChange={setAuditSearch}
                  onVerifyChain={handleVerifyChain}
                  onSimulateTamper={handleSimulateTamper}
                  onRestoreTamper={handleRestoreTamper}
                  onAnchorAuditRoot={handleAnchorAuditRoot}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Non-intrusive Toast Notification */}
      {toastMsg && (
        <div className="fixed right-6 bottom-6 z-50 rounded-md border border-slate-200 bg-slate-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg dark:border-slate-700 dark:bg-slate-100 dark:text-slate-900">
          {toastMsg}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AccordGateDashboard />
    </ErrorBoundary>
  );
}

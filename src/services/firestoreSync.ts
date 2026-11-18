import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { db as firestoreDb, handleFirestoreError, OperationType } from '../firebase';
import type {
  AgentRecord,
  AuditEntry,
  GatePolicy,
  OnchainAnchorRecord,
  WebhookConfig,
} from '../types';

function getDb(): Firestore {
  if (!firestoreDb) {
    throw new Error('Firebase not configured: set VITE_FIREBASE_* env vars to enable Firestore sync');
  }
  return firestoreDb;
}

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned.slice(0, 128) || 'doc_default';
}

function getWorkspaceId(uid: string): string {
  return sanitizeId(`ws_${uid}`);
}

function normalizeHash64(raw: string): string {
  const hexOnly = raw.replace(/[^a-fA-F0-9]/g, '');
  if (hexOnly.length >= 64) return hexOnly.slice(0, 64);
  return hexOnly.padEnd(64, '0');
}

export interface WorkspaceSyncSummary {
  workspaceId: string;
  agentCount: number;
  policyCount: number;
  auditCount: number;
  webhookCount: number;
  anchorCount: number;
  syncedAt: string;
}

export async function ensureUserWorkspace(user: User): Promise<string> {
  if (!user.emailVerified) {
    throw new Error('请使用已验证邮箱的 Google 账号登录以启用 Firestore 云端持久化');
  }
  const userPath = `users/${user.uid}`;
  const userRef = doc(getDb(), 'users', user.uid);
  try {
    const userSnap = await getDoc(userRef);
    const profileBase: Record<string, unknown> = {
      uid: user.uid,
      email: user.email ?? `${user.uid}@users.local`,
      updatedAt: serverTimestamp(),
    };
    if (user.displayName && user.displayName.trim()) {
      profileBase.displayName = user.displayName.trim().slice(0, 120);
    }
    if (user.photoURL && user.photoURL.trim()) {
      profileBase.photoURL = user.photoURL.trim().slice(0, 512);
    }
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        ...profileBase,
        createdAt: serverTimestamp(),
      });
    } else {
      const updatePatch: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (profileBase.displayName) updatePatch.displayName = profileBase.displayName;
      if (profileBase.photoURL) updatePatch.photoURL = profileBase.photoURL;
      await updateDoc(userRef, updatePatch);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }

  const workspaceId = getWorkspaceId(user.uid);
  const wsPath = `workspaces/${workspaceId}`;
  const wsRef = doc(getDb(), 'workspaces', workspaceId);
  try {
    const wsSnap = await getDoc(wsRef);
    if (!wsSnap.exists()) {
      await setDoc(wsRef, {
        id: workspaceId,
        ownerUid: user.uid,
        name: 'AccordGate Enterprise Gateway',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, wsPath);
  }

  return workspaceId;
}

export async function syncWorkspaceToFirestore(
  user: User,
  snapshot: {
    agents: AgentRecord[];
    policies: GatePolicy[];
    auditLogs: AuditEntry[];
    webhooks: WebhookConfig[];
    anchors: OnchainAnchorRecord[];
  },
): Promise<WorkspaceSyncSummary> {
  const workspaceId = await ensureUserWorkspace(user);
  const ownerUid = user.uid;

  // 1. Sync Agents
  const agentsColPath = `workspaces/${workspaceId}/agents`;
  let existingAgentIds = new Set<string>();
  try {
    const existingAgentsSnap = await getDocs(
      query(collection(getDb(), 'workspaces', workspaceId, 'agents'), where('ownerUid', '==', ownerUid)),
    );
    existingAgentIds = new Set(existingAgentsSnap.docs.map((d) => d.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, agentsColPath);
  }

  for (const agent of snapshot.agents) {
    const agentId = sanitizeId(agent.id);
    const agentRef = doc(getDb(), 'workspaces', workspaceId, 'agents', agentId);
    const path = `${agentsColPath}/${agentId}`;
    try {
      if (!existingAgentIds.has(agentId)) {
        await setDoc(agentRef, {
          id: agentId,
          ownerUid,
          workspaceId,
          did: agent.did.slice(0, 256),
          name: agent.name.slice(0, 120),
          role: agent.role.slice(0, 180),
          ownerEntity: agent.ownerEntity.slice(0, 180),
          vcdcDomain: agent.vcdcDomain ? agent.vcdcDomain.slice(0, 253) : null,
          externalKeys: agent.externalKeys.slice(0, 10),
          publicKeyHex: agent.publicKeyHex.slice(0, 512),
          agentCard: agent.agentCard,
          cardHash: agent.cardHash.slice(0, 128),
          registryContract: agent.registryContract.slice(0, 64),
          keyRegistryContract: agent.keyRegistryContract.slice(0, 64),
          status: agent.status,
          verifiedPrincipal: agent.verifiedPrincipal,
          dailySpentPlt: Math.max(0, Number(agent.dailySpentPlt) || 0),
          dailyLimitPlt: Math.max(0, Number(agent.dailyLimitPlt) || 0),
          perCallLimitPlt: Math.max(0, Number(agent.perCallLimitPlt) || 0),
          parentAgentId: agent.parentAgentId ? sanitizeId(agent.parentAgentId) : null,
          delegationDepth: Math.min(5, Math.max(0, Math.trunc(agent.delegationDepth ?? 0))),
          cascadeRevoke: Boolean(agent.cascadeRevoke),
          consecutiveViolations: Math.max(0, Math.trunc(agent.consecutiveViolations ?? 0)),
          walletAddress: agent.walletAddress ? agent.walletAddress.slice(0, 128) : null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(agentRef, {
          status: agent.status,
          dailySpentPlt: Math.max(0, Number(agent.dailySpentPlt) || 0),
          consecutiveViolations: Math.max(0, Math.trunc(agent.consecutiveViolations ?? 0)),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }

  // 2. Sync Policies
  const policiesColPath = `workspaces/${workspaceId}/policies`;
  let existingPolicyIds = new Set<string>();
  try {
    const existingPoliciesSnap = await getDocs(
      query(collection(getDb(), 'workspaces', workspaceId, 'policies'), where('ownerUid', '==', ownerUid)),
    );
    existingPolicyIds = new Set(existingPoliciesSnap.docs.map((d) => d.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, policiesColPath);
  }

  for (const policy of snapshot.policies) {
    const policyId = sanitizeId(policy.id);
    const policyRef = doc(getDb(), 'workspaces', workspaceId, 'policies', policyId);
    const path = `${policiesColPath}/${policyId}`;
    try {
      const rateLimitQpm = Math.min(10000, Math.max(1, Math.trunc(policy.rateLimitQpm || 20)));
      const circuitBreakerThreshold = Math.min(
        100,
        Math.max(1, Math.trunc(policy.circuitBreakerThreshold || 3)),
      );
      if (!existingPolicyIds.has(policyId)) {
        await setDoc(policyRef, {
          id: policyId,
          ownerUid,
          workspaceId,
          serviceName: policy.serviceName.slice(0, 120),
          endpointPath: policy.endpointPath.slice(0, 200),
          protocol: policy.protocol,
          description: policy.description.slice(0, 500),
          requiredZkpPredicates: policy.requiredZkpPredicates,
          maxPerCallPlt: Math.max(0, Number(policy.maxPerCallPlt) || 0),
          dailyAgentCapPlt: Math.max(0, Number(policy.dailyAgentCapPlt) || 0),
          x402PricePlt: Math.max(0, Number(policy.x402PricePlt) || 0),
          asset: 'EURt',
          sponsoredGas: Boolean(policy.sponsoredGas),
          rateLimitQpm,
          circuitBreakerThreshold,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(policyRef, {
          requiredZkpPredicates: policy.requiredZkpPredicates,
          maxPerCallPlt: Math.max(0, Number(policy.maxPerCallPlt) || 0),
          dailyAgentCapPlt: Math.max(0, Number(policy.dailyAgentCapPlt) || 0),
          x402PricePlt: Math.max(0, Number(policy.x402PricePlt) || 0),
          sponsoredGas: Boolean(policy.sponsoredGas),
          rateLimitQpm,
          circuitBreakerThreshold,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }

  // 3. Sync Append-Only Audit Logs (only create entries not yet synced)
  const auditColPath = `workspaces/${workspaceId}/auditLogs`;
  let existingAuditIds = new Set<string>();
  try {
    const existingAuditsSnap = await getDocs(
      query(collection(getDb(), 'workspaces', workspaceId, 'auditLogs'), where('ownerUid', '==', ownerUid)),
    );
    existingAuditIds = new Set(existingAuditsSnap.docs.map((d) => d.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, auditColPath);
  }

  for (const entry of snapshot.auditLogs.slice(0, 60)) {
    const auditId = sanitizeId(`aud_${entry.seq}`);
    if (existingAuditIds.has(auditId)) continue;
    const auditRef = doc(getDb(), 'workspaces', workspaceId, 'auditLogs', auditId);
    const path = `${auditColPath}/${auditId}`;
    try {
      await setDoc(auditRef, {
        id: auditId,
        ownerUid,
        workspaceId,
        seq: Math.max(1, Math.trunc(entry.seq)),
        timestamp: entry.timestamp.slice(0, 64),
        requestId: entry.requestId.slice(0, 64),
        agentDid: entry.agentDid.slice(0, 256),
        agentName: entry.agentName.slice(0, 120),
        endpointPath: entry.endpointPath.slice(0, 200),
        protocol: entry.protocol,
        decision: entry.decision.slice(0, 64),
        reason: entry.reason.slice(0, 500),
        zkpClaims: entry.zkpClaims,
        x402ReceiptId: entry.x402ReceiptId ? entry.x402ReceiptId.slice(0, 128) : null,
        amountPlt: Math.max(0, Number(entry.amountPlt) || 0),
        prevHash: normalizeHash64(entry.prevHash),
        entryHash: normalizeHash64(entry.entryHash),
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }

  // 4. Sync Webhook Configs
  const whColPath = `workspaces/${workspaceId}/webhookConfigs`;
  let existingWhIds = new Set<string>();
  try {
    const existingWhSnap = await getDocs(
      query(collection(getDb(), 'workspaces', workspaceId, 'webhookConfigs'), where('ownerUid', '==', ownerUid)),
    );
    existingWhIds = new Set(existingWhSnap.docs.map((d) => d.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, whColPath);
  }

  for (const wh of snapshot.webhooks) {
    const whId = sanitizeId(wh.id);
    const whRef = doc(getDb(), 'workspaces', workspaceId, 'webhookConfigs', whId);
    const path = `${whColPath}/${whId}`;
    const enabledEvents =
      wh.enabledEvents.length > 0 ? wh.enabledEvents.slice(0, 10) : ['circuit_breaker.opened'];
    try {
      if (!existingWhIds.has(whId)) {
        await setDoc(whRef, {
          id: whId,
          ownerUid,
          workspaceId,
          label: wh.label.slice(0, 120),
          url: wh.url.slice(0, 512),
          enabledEvents,
          active: Boolean(wh.active),
          lastStatusCode: wh.lastStatusCode ?? null,
          lastDeliveredAt: wh.lastDeliveredAt ? wh.lastDeliveredAt.slice(0, 64) : null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(whRef, {
          label: wh.label.slice(0, 120),
          url: wh.url.slice(0, 512),
          enabledEvents,
          active: Boolean(wh.active),
          lastStatusCode: wh.lastStatusCode ?? null,
          lastDeliveredAt: wh.lastDeliveredAt ? wh.lastDeliveredAt.slice(0, 64) : null,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }

  // 5. Sync Append-Only On-Chain Anchors
  const anchorsColPath = `workspaces/${workspaceId}/onchainAnchors`;
  let existingAnchorIds = new Set<string>();
  try {
    const existingAnchorsSnap = await getDocs(
      query(collection(getDb(), 'workspaces', workspaceId, 'onchainAnchors'), where('ownerUid', '==', ownerUid)),
    );
    existingAnchorIds = new Set(existingAnchorsSnap.docs.map((d) => d.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, anchorsColPath);
  }

  for (const anchor of snapshot.anchors) {
    const anchorId = sanitizeId(anchor.id);
    if (existingAnchorIds.has(anchorId)) continue;
    const anchorRef = doc(getDb(), 'workspaces', workspaceId, 'onchainAnchors', anchorId);
    const path = `${anchorsColPath}/${anchorId}`;
    try {
      await setDoc(anchorRef, {
        id: anchorId,
        ownerUid,
        workspaceId,
        rootHash: normalizeHash64(anchor.rootHash),
        auditRange: anchor.auditRange.slice(0, 64),
        totalEntries: Math.max(1, Math.trunc(anchor.totalEntries || 1)),
        // Simulated anchors have no signer; the Firestore rule needs a 10–128 char string.
        signerAddress: (anchor.signerAddress ?? 'none (simulated)').slice(0, 128),
        txHash: anchor.txHash.slice(0, 128),
        network: anchor.network === 'mainnet' ? 'mainnet' : 'testnet',
        mode: anchor.mode,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }

  return {
    workspaceId,
    agentCount: snapshot.agents.length,
    policyCount: snapshot.policies.length,
    auditCount: snapshot.auditLogs.length,
    webhookCount: snapshot.webhooks.length,
    anchorCount: snapshot.anchors.length,
    syncedAt: new Date().toISOString(),
  };
}

export async function loadWorkspaceSummaryFromFirestore(user: User): Promise<WorkspaceSyncSummary> {
  const workspaceId = await ensureUserWorkspace(user);
  const ownerUid = user.uid;
  try {
    const [agentsSnap, policiesSnap, auditsSnap, whSnap, anchorsSnap] = await Promise.all([
      getDocs(query(collection(getDb(), 'workspaces', workspaceId, 'agents'), where('ownerUid', '==', ownerUid))),
      getDocs(query(collection(getDb(), 'workspaces', workspaceId, 'policies'), where('ownerUid', '==', ownerUid))),
      getDocs(query(collection(getDb(), 'workspaces', workspaceId, 'auditLogs'), where('ownerUid', '==', ownerUid))),
      getDocs(
        query(collection(getDb(), 'workspaces', workspaceId, 'webhookConfigs'), where('ownerUid', '==', ownerUid)),
      ),
      getDocs(
        query(collection(getDb(), 'workspaces', workspaceId, 'onchainAnchors'), where('ownerUid', '==', ownerUid)),
      ),
    ]);
    return {
      workspaceId,
      agentCount: agentsSnap.size,
      policyCount: policiesSnap.size,
      auditCount: auditsSnap.size,
      webhookCount: whSnap.size,
      anchorCount: anchorsSnap.size,
      syncedAt: new Date().toISOString(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `workspaces/${workspaceId}`);
  }
}

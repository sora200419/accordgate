/**
 * Firestore Security Rules Test Specification (Dirty Dozen Verification Matrix)
 * Validates all 12 adversarial payloads against /workspaces/{workspaceId} & /users/{userId}.
 */
export interface DirtyDozenCase {
  id: number;
  name: string;
  targetPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expected: 'PERMISSION_DENIED';
  reason: string;
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated read on workspace agent',
    targetPath: '/workspaces/ws_u1/agents/agt_1',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    reason: 'isVerifiedUser() requires request.auth != null && email_verified == true.',
  },
  {
    id: 2,
    name: 'Unverified email creating workspace',
    targetPath: '/workspaces/ws_u1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isVerifiedUser() mandates request.auth.token.email_verified == true.',
  },
  {
    id: 3,
    name: 'Cross-tenant PII read on /users/{victim}',
    targetPath: '/users/victim_uid',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    reason: 'isOwner(userId) enforces request.auth.uid == userId.',
  },
  {
    id: 4,
    name: 'Blanket list query without ownerUid filter',
    targetPath: '/workspaces/ws_u1/agents',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    reason: 'allow list requires resource.data.ownerUid == request.auth.uid.',
  },
  {
    id: 5,
    name: 'Shadow field isAdmin=true injection on user profile create',
    targetPath: '/users/u1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidUserProfile enforces data.keys().hasOnly([...]).',
  },
  {
    id: 6,
    name: 'Ghost field injection on agent update',
    targetPath: '/workspaces/ws_u1/agents/agt_1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'affectedKeys().hasOnly(...) and isValidAgent block unlisted keys.',
  },
  {
    id: 7,
    name: 'Identity spoofing ownerUid != request.auth.uid',
    targetPath: '/workspaces/ws_u1/policies/pol_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidPolicy verifies data.ownerUid == request.auth.uid.',
  },
  {
    id: 8,
    name: 'Oversized 200-char ID poisoning',
    targetPath: '/workspaces/ws_u1/agents/' + 'a'.repeat(200),
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidId() limits ID length <= 128 and regex ^[a-zA-Z0-9_\\-]+$.',
  },
  {
    id: 9,
    name: 'Client-forged createdAt timestamp',
    targetPath: '/workspaces/ws_u1/policies/pol_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'incoming().createdAt == request.time prevents backdating.',
  },
  {
    id: 10,
    name: 'Tampering existing audit entry via update',
    targetPath: '/workspaces/ws_u1/auditLogs/aud_1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'auditLogs has allow update: if false for EU AI Act immutability.',
  },
  {
    id: 11,
    name: 'Unbounded array attack on webhookConfigs',
    targetPath: '/workspaces/ws_u1/webhookConfigs/wh_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidWebhookConfig enforces enabledEvents.size() <= 10.',
  },
  {
    id: 12,
    name: 'Type poisoning x402PricePlt as string',
    targetPath: '/workspaces/ws_u1/policies/pol_1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidPolicy requires data.x402PricePlt is number && >= 0.',
  },
];

# AccordGate 2.0 Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **PII Isolation**: `/users/{userId}` stores email/displayName and may ONLY be read or written by the verified owner (`request.auth.uid == userId && request.auth.token.email_verified == true`).
2. **Workspace Ownership (Master Gate)**: Every subcollection under `/workspaces/{workspaceId}/...` belongs to a single verified workspace owner. Both `ownerUid == request.auth.uid` on the child document AND `get(/workspaces/{workspaceId}).data.ownerUid == request.auth.uid` on single-document operations are strictly enforced.
3. **Zero Client Timestamp Forgery**: `createdAt` and `updatedAt` must match `request.time` on creation, and `createdAt` + `ownerUid` + `workspaceId` are immutable on updates.
4. **Immutable Append-Only Proof Records**: `auditLogs` and `onchainAnchors` are tamper-evident compliance logs — once created, client SDKs may NOT mutate `entryHash`, `prevHash`, `rootHash`, or `txHash` (updates denied).
5. **Bounded Strings & Arrays**: Every string enforces explicit `.size()` limits, every ID matches `^[a-zA-Z0-9_\-]+$`, and arrays (`externalKeys`, `enabledEvents`) are bounded with `.size() <= 10`.

## 2. "Dirty Dozen" Attack Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read on `/workspaces/ws_u1/agents/agt_1` -> `PERMISSION_DENIED`.
2. Unverified email (`email_verified: false`) attempting create on `/workspaces/ws_u1` -> `PERMISSION_DENIED`.
3. Cross-tenant `get` on `/users/victim_uid` by `attacker_uid` -> `PERMISSION_DENIED`.
4. Blanket `list` query on `/workspaces/ws_u1/agents` without `where('ownerUid', '==', uid)` -> `PERMISSION_DENIED`.
5. Shadow field injection (`isAdmin: true`) during `create` on `/users/u1` -> `PERMISSION_DENIED`.
6. Ghost field injection (`extraHack: 1`) during `update` on `/workspaces/ws_u1/agents/agt_1` -> `PERMISSION_DENIED`.
7. Identity spoofing (`ownerUid: 'victim_uid'`) during `create` on `/workspaces/ws_u1/policies/pol_1` -> `PERMISSION_DENIED`.
8. Oversized ID injection (200-char doc ID) on `/workspaces/ws_u1/agents/{longId}` -> `PERMISSION_DENIED`.
9. Client-forged timestamp (`createdAt: '2020-01-01'`) instead of `request.time` -> `PERMISSION_DENIED`.
10. Post-terminal state update on a revoked agent or immutable audit log entry (`update` on `/auditLogs/{id}`) -> `PERMISSION_DENIED`.
11. Unbounded array attack (`enabledEvents` with 50 items) on `webhookConfigs` -> `PERMISSION_DENIED`.
12. Value poisoning (`x402PricePlt: "free"` string instead of number) on `policies` update -> `PERMISSION_DENIED`.

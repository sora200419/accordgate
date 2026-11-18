# Plan: current slice

<!-- Rewritten at the end of Plan Mode for every slice. After /clear, a new session continues with "@PLAN.md". -->

## Slice
S10 — the server checks `browser-wallet-tx` anchors on Concordium testnet (gRPC `getBlockItemStatus`) before they count as on chain. Branch `feat/anchor-verify` (from `main` after PR #4).

## Decisions (made 2026-11-18)
- `POST /api/anchors` only stores (status `unverified`, `attempts: 0`) and returns 201 at once; no gRPC call
- Verification only in owner route `POST /api/anchors/:id/verify`; the frontend calls it right after creation, then every 4 s for about 60 s, plus a 重新核验 button
- The anchor stores `ownerAccount` from the session at creation; verify compares the on-chain sender with that stored address, not the caller's session. Body `signerAddress` ≠ session account → simulated
- Client sends `rootHash` + `auditRange`; the server requires `rootHash` to be an `entryHash` in its audit log and derives `expectedData` (hex of `accordgate:eu-ai-act:<range>:<rootHash>`) itself
- Statuses: `verified` | `unverified` (reason `null`, `not_found`, `not_final`, `unreachable`, `legacy_unchecked`) | `rejected` (`sender_mismatch`, `data_mismatch`, `tx_failed`, `wrong_type`). Unknown and not-found stay separate. `verified` and `rejected` are terminal
- Lookup: 3 attempts, 3 s timeout each, 300/600 ms delays; NOT_FOUND is retried too (load-balanced node may be stale)
- Duplicate `txHash` (case-insensitive) → 409, checked and inserted synchronously
- Concurrent verifies of one anchor share one in-flight promise and write once; exactly one `ONCHAIN_ANCHORED` audit entry per anchor, on the transition
- Webhook `audit.anchored` at creation (`serverVerifiedOnChain: false`); `audit.anchor_verified` on the transition

## Steps
- [x] `server/anchorVerify.ts` + `server/anchorVerify.test.ts`
- [x] Server routes, auth helper, `OWNER_ROUTES`
- [x] Route tests in `server/auth.test.ts`
- [x] Client: `anchorDisplay`, ledger status + 重新核验, polling in `App.tsx`, `api.verifyAnchor`
- [x] Docs: SECURITY S10, README, BRIEF, DATA_MODEL, CLAUDE.md; grep `服务器未核验`, `serverVerifiedOnChain`, `reportedOnChainByWallet`, `ONCHAIN_ANCHORED`, `not checked by the server`
- [x] Review fixes: R1 webhook-test route re-reads state after its fetch; R2 client re-checks session + fresh root before sending, server says why a wallet claim was not accepted; R4/N1 errors shown to the user

## Verification gate
- [x] `npm run lint`, `npm test` (98/98), `npm run check:docs`, `npm run build`
- [x] Mutation proof: 18 mutations (M1–M18) each make a named test fail; files restored from copies, sha checked
- [x] `harness-review` PASS (2 rounds; R3, R5, R8 accepted with reasons in SECURITY/README)
- [x] Real testnet RegisterData from the user's wallet (2026-11-18, tx `270ee8d4…083a`, preview run as `dev-system-ca`): stored `unverified`, `verified` on the 2nd poll (~5 s), one `ONCHAIN_ANCHORED`, ledger shows "服务器已核验，已最终确认" with the only CCDScan link, no console errors. Direct gRPC read: data is raw UTF-8 (no length prefix), sender base58 equals the session address (R6 not an issue here), unknown hash throws `NOT_FOUND`. Signed out, then 锚定 (user, 2026-11-19): no wallet pop-up, balance unchanged (19,995.91 CCD), POST refused 401 and the page showed "锚定未记录（Sign in with your Concordium wallet to make changes.）", so nothing was sent or stored. Still not exercised in the browser: the branch where the page still holds a wallet account but the server session has expired (`authMe` mismatch)
- [ ] CI green on the PR

## Next slices
1. S4 — SSRF guard on webhooks; S5 — remove PII from error logs; S6 — stop swallowing wallet errors
2. S2 — move agent private keys out of the JSON state file

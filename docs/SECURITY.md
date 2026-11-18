# Security: AccordGate

<!-- Any change to a privacy claim here must be made in README, demo script, UI text and
     code comments in the same change. Firestore-rule specifics stay in security_spec.md. -->

Review of the imported Gemini demo done on 2026-11-18 by reading the code (not by running it). Items marked **open** are not fixed yet.

## Assets to protect
- Agent Ed25519 private keys (`proverKeys` in `data/gateway-state.json`)
- Gate policies and agent status (who may call what, kill switch)
- Audit ledger integrity and on-chain anchors
- x402 invoices and spend limits
- Users' Google account data (email, display name) in Firestore
- Webhook signing secrets

## Roles and permissions
| Role | Can read | Can change | Cannot |
| --- | --- | --- | --- |
| Anonymous | All `GET` data (webhook secrets masked); testnet probe/inspect | Only indirectly: a call to `/api/gateway/invoke` or MCP `tools/call` with any signature header writes a `BLOCKED_*` audit entry (and, for an unknown DID or policy, nothing else). Failed card-hash or signature checks do not count toward the circuit breaker, so they cannot suspend an agent | Any route in `OWNER_ROUTES`, in any letter case or with a trailing slash (401) |
| Owner (wallet signed in, address in `OWNER_ACCOUNTS`) | Everything | Agents, policies, webhooks, anchors, x402 settle (simulated), sandbox probe/sign/reset, audit tamper demo | Edit audit entries except through the tamper demo. Single tenant: all owners share one workspace |
| AI agent (calling the gateway) | Gateway/MCP responses | Nothing; invokes `/api/gateway/invoke` and MCP `tools/call` only with its own Ed25519 signature over a fresh timestamp and a single-use nonce | Owner routes; requests without a signature (401) |

## Findings from the demo review
| # | Finding | Where | Status |
| --- | --- | --- | --- |
| S1 | No authentication on any server API: anyone can change agent status, policies, settle invoices, delete webhooks, reset the sandbox | `server.ts` routes | fixed 2026-11-18: Concordium wallet sign-in + `OWNER_ROUTES` guard (`server/auth.ts`), tests in `server/auth.test.ts`. Also fixed: the pipeline signed unsigned agent requests itself with the stored agent key, so unsigned `/api/gateway/invoke` and MCP `tools/call` passed (MCP also defaulted to the first agent's DID); `GET /api/webhooks` returned full HMAC secrets |
| S8 | `/api/auth/challenge` and `/api/auth/verify` need no login and have no rate limit; each verify attempt with a valid-looking nonce keeps a used-nonce entry for up to 5 min, so a flood grows memory. Sign-in state is per process (single instance only) | `server/auth.ts` | open (accepted for the MVP demo) |
| S7 | Agent request signatures had no freshness: `X-Agent-Timestamp` was signed but never checked against the clock and there was no nonce, so a captured signed request could be replayed | `server.ts` `evaluateCompliancePipeline` | fixed 2026-11-18: signed string is now `did\|endpointPath\|timestamp\|nonce\|cardHash`; `X-Agent-Nonce` required; timestamp at most 120 s old and 30 s ahead, and not before the process start; each (DID, nonce) accepted once while its timestamp is inside the window (`server/agentFreshness.ts`), checked only after the signature is valid; tests in `server/agentFreshness.test.ts` and `server/auth.test.ts` |
| S9 | The S7 nonce store is in memory per process: multiple instances would each accept the same nonce once. A restart is covered (timestamps before the process start are refused). Each agent may hold at most 1000 unexpired nonces; over that it gets 429 until old ones expire. Nonces of an agent that stops calling are swept only when that DID calls again (bounded by cap × registered agents). Anyone holding one captured request can resend it without limit; each resend is blocked but writes an audit entry, as forged signatures already do | `server/agentFreshness.ts` | open (accepted for the MVP demo: single instance) |
| S2 | Agent private keys stored in plaintext in `data/gateway-state.json` | `server/store.ts`, `server.ts` ~1023 | partly: `data/` is now git-ignored and not imported; storage itself unchanged |
| S3 | Simulated results look real: x402 settle sets `settled` with a fake `0xccd_…` hash; anchors fall back to `simulated-payload` with a hard-coded address; "ZKP" is a SHA-256 commitment, not a zero-knowledge proof | `server.ts` ~1424, `server/crypto.ts`, `src/services/concordiumWallet.ts` | open |
| S4 | Webhook test fetches any user-supplied URL (SSRF); only a 4.5 s timeout, no block on private/internal addresses | `server.ts` ~1749 | open |
| S5 | Firestore error handler puts user email, display name and provider data into `console.error` and the thrown message | `src/firebase.ts` | open |
| S6 | Wallet helpers swallow errors in empty `catch {}` blocks and silently fall back | `src/services/concordiumWallet.ts` | open |

## Threats
| Threat | Where | Defence | Test |
| --- | --- | --- | --- |
| Unauthenticated admin actions | every route in `OWNER_ROUTES` | S1: wallet-signed challenge (single use, 5 min), HttpOnly SameSite=Strict session cookie (8 h), allowlist `OWNER_ACCOUNTS`, fail closed (503) when unset | `server/auth.test.ts`: every owner route 401; registered non-GET routes all owner-only or listed public; 503 unconfigured |
| Sign-in replay / forgery / lockout | `/api/auth/challenge`, `/api/auth/verify` | Stateless challenge: nonce = random + expiry + HMAC (per-process key) over account, so requesting more challenges cannot evict or block the owner's; nonce marked used before any await; message rebuilt server-side; signature checked against on-chain account keys | `auth.test.ts`: replay, 3 concurrent verifies → 1 success, expired challenge, forged nonce, 50 later challenges do not invalidate the owner's, 1100-challenge flood, wrong key, wrong message, unknown credential, lookup failure |
| Accessing another workspace's record by id (IDOR) | `/api/agents/:id/*`, `/api/webhooks/:id` | Not applicable yet: single tenant, every owner owns everything | — |
| Replay / double settle | `/api/x402/settle`, `/api/gateway/invoke` | Settle is owner-only and idempotent (already settled → unchanged). Agent request replay (S7): timestamp window (120 s back, 30 s ahead, not before process start) + single-use nonce per agent DID, recorded synchronously after the signature check; replay → 403 `BLOCKED_REPLAYED`, stale/future → 403 `BLOCKED_STALE_REQUEST`, neither counts toward the circuit breaker; per-agent cap rejects (429), never evicts | `agentFreshness.test.ts`: replay, edges of the window, future, malformed, out of order, sweep, cap without eviction, 100 000 entries. `auth.test.ts`: REST + MCP replay, cross-endpoint replay, stale, future, 20 concurrent copies → 1 passes, out of order, no circuit breaker, 300 forged requests add no nonces, capped agent does not block another |
| Forged agent request | `/api/gateway/invoke`, `/api/mcp` | Caller must send `X-Agent-Signature` + `X-Agent-Timestamp` + `X-Agent-Nonce`; server self-signs only for the owner sandbox | `auth.test.ts`: unsigned or no nonce → 401, forged → signature step fails, valid → passes |
| SSRF via webhook URL | `/api/webhooks/:id/test` and dispatch | S4: https only, resolve and block private ranges | TODO |
| Audit tampering | `/api/audit/simulate-tamper` exists on purpose for the demo | Keep only in demo mode; verification must flag it | TODO |
| Key leakage | state file, logs, API responses | Never return or log keys; move keys out of the JSON file | TODO |

## Privacy claims, per party
<!-- Scope every claim to the party; never write a bare "anonymous" or "unlinkable". -->
| Party | Already knows | Can infer from public data | Our claim |
| --- | --- | --- | --- |
| Our server | Agent DIDs, owners, every request and decision, Google email of officers | Everything in the audit log | TODO |
| Chain observers | Anchored root hashes, signer account address | Activity timing of the signer account | TODO |
| Gated service | Agent DID, predicate results (not the raw attributes) | Repeated calls by the same DID are linkable | TODO — today "ZKP" is a hash, so no ZK claim may be made yet |

## External services
| Service / SDK | Version | Network | Timeout | Rate limit | On failure |
| --- | --- | --- | --- | --- | --- |
| Concordium gRPC node (`@concordium/web-sdk`) | ^12.0.2 | testnet | 5 s per call | TODO | Probe returns `reachable: false`; sign-in account lookup retries 3× (300/600 ms) then 502 naming the cause, NOT_FOUND → 401 |
| Concordium Browser Wallet (`@concordium/browser-wallet-api-helpers`) | ^3.3.0 | testnet | 1.2–1.5 s detect | — | Falls back silently (S6) |
| Firebase Auth + Firestore (`firebase`) | ^13.4.0, optional (off unless `VITE_FIREBASE_*` set) | — | TODO | TODO | Sync errors caught and logged in `App.tsx`; when off, sync throws "Firebase not configured" |
| DNS TXT lookup (`node:dns`) | Node built-in | — | TODO | — | Returns `dnsResolved: false` |
| Outbound webhooks | `fetch` | — | 4.5 s | — | Logged as failed delivery |
| Gemini API (`@google/genai`) | removed from package.json (2026-11-18) | — | — | — | Was never imported; `GEMINI_API_KEY` removed from `.env.example` |

### Known dependency advisories
`npm audit --omit=dev` (2026-11-18) reports 12 (9 high, 3 moderate), e.g. `@grpc/grpc-js <=1.13.5`, `picomatch`, `uuid <11.1.1`. They come mostly through `@concordium/web-sdk` and pre-date slice 1. TODO: review in a later slice.

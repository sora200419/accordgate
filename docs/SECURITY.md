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
| Anonymous | TODO (today: everything) | TODO (today: everything) | TODO |
| Compliance officer (signed-in workspace owner) | Own workspace | Agents, policies, webhooks, anchors in own workspace | Other workspaces; audit entries after creation |
| AI agent (calling the gateway) | Its own invoices | Nothing; only invokes endpoints with a valid signature | Policies, other agents |

## Findings from the demo review
| # | Finding | Where | Status |
| --- | --- | --- | --- |
| S1 | No authentication on any server API: anyone can change agent status, policies, settle invoices, delete webhooks, reset the sandbox | `server.ts` routes from line ~932 | open |
| S2 | Agent private keys stored in plaintext in `data/gateway-state.json` | `server/store.ts`, `server.ts` ~1023 | partly: `data/` is now git-ignored and not imported; storage itself unchanged |
| S3 | Simulated results look real: x402 settle sets `settled` with a fake `0xccd_…` hash; anchors fall back to `simulated-payload` with a hard-coded address; "ZKP" is a SHA-256 commitment, not a zero-knowledge proof | `server.ts` ~1424, `server/crypto.ts`, `src/services/concordiumWallet.ts` | open |
| S4 | Webhook test fetches any user-supplied URL (SSRF); only a 4.5 s timeout, no block on private/internal addresses | `server.ts` ~1749 | open |
| S5 | Firestore error handler puts user email, display name and provider data into `console.error` and the thrown message | `src/firebase.ts` | open |
| S6 | Wallet helpers swallow errors in empty `catch {}` blocks and silently fall back | `src/services/concordiumWallet.ts` | open |

## Threats
| Threat | Where | Defence | Test |
| --- | --- | --- | --- |
| Unauthenticated admin actions | all mutating `/api/*` routes | S1: require a verified session, check workspace ownership | TODO |
| Accessing another workspace's record by id (IDOR) | `/api/agents/:id/*`, `/api/webhooks/:id` | Owner check from session | TODO |
| Replay / double settle | `/api/x402/settle`, `/api/gateway/invoke` | Nonce or idempotency key; settle at most once | TODO |
| Forged agent request | `/api/gateway/invoke`, `/api/mcp` | Ed25519 signature over a canonical payload with nonce and expiry | TODO |
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
| Concordium gRPC node (`@concordium/web-sdk`) | ^12.0.2 | testnet | TODO | TODO | Probe returns `reachable: false` |
| Concordium Browser Wallet (`@concordium/browser-wallet-api-helpers`) | not in package.json | testnet | 1.2–1.5 s detect | — | Falls back silently (S6) |
| Firebase Auth + Firestore (`firebase`) | not in package.json | — | TODO | TODO | TODO |
| DNS TXT lookup (`node:dns`) | Node built-in | — | TODO | — | Returns `dnsResolved: false` |
| Outbound webhooks | `fetch` | — | 4.5 s | — | Logged as failed delivery |
| Gemini API (`@google/genai`) | ^2.4.0 | — | — | — | Listed in package.json and `.env.example`, not imported anywhere: remove or use |

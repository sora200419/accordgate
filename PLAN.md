# Plan: current slice

<!-- Rewritten at the end of Plan Mode for every slice. After /clear, a new session continues with "@PLAN.md". -->

## Slice
S1 — owner sign-in with the Concordium Browser Wallet; every state-changing route needs a signed-in owner; agents must sign their own gateway requests. Branch `feat/s1-wallet-owner-auth`.

## Decisions (made 2026-11-18)
- Sign-in = wallet `signMessage` over a one-time server challenge, verified against on-chain account keys (no Google/Firebase needed)
- Owners = `OWNER_ACCOUNTS` env allowlist; empty → owner routes 503 (fail closed)
- Reads stay public; `GET /api/webhooks` masks the signing secret
- Server self-signing allowed only for the owner sandbox; agent request freshness / replay → S7, later slice
- Tests: node:test via `tsx --test`, no new dependency

## Phase 1: server
- [x] `server/auth.ts`: challenge / verify / me / logout, stateless HMAC challenges (5 min, single use via an in-memory used-nonce set) and in-memory sessions (8 h), HttpOnly SameSite=Strict cookie, `OWNER_ROUTES` guard
- [x] `server.ts`: `createApp()` / `startServer()` split, `dotenv/config`, guard applied, `/api/sandbox/sign`, gateway + MCP `tools/call` require signature, webhook secret masked
- [x] `server/store.ts`: `ACCORDGATE_DB_PATH` override for tests

## Phase 2: frontend and docs
- [x] Sidebar wallet sign-in / sign-out, session restored on load, sign-in errors shown as toasts
- [x] Sandbox MCP `tools/call` signs through `/api/sandbox/sign`; curl / TS / Python snippets show the real signing payload and no agent-side settle
- [x] README, SECURITY (S1 fixed, S7 new), BRIEF, DATA_MODEL, CLAUDE.md, CI Test step
- [x] `.env.example`: `OWNER_ACCOUNTS=` placeholder (approved by the user 2026-11-18)

## Contract
New: `POST /api/auth/challenge`, `POST /api/auth/verify`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/sandbox/sign` (owner). Changed: `OWNER_ROUTES` return 401/403/503 without an owner session; `/api/gateway/invoke` and MCP `tools/call` return 401 without `X-Agent-Signature` + `X-Agent-Timestamp`; `GET /api/webhooks` masks `signingSecretPreview`. Error shape stays `{ "error": "message" }`.

## Verification gate
- [x] Typecheck (`npm run lint`)
- [x] Build (`npm run build`)
- [x] Tests (`npm test`, 25 pass) + mutation check (guard, nonce single use, challenge MAC, gateway/MCP signature checks, webhook mask, path-case bypass, anonymous suspend, challenge eviction each caught)
- [x] Ran the app: with `OWNER_ACCOUNTS` unset, reset → 503 with toast, unsigned invoke → 401, Sandbox tab renders
- [ ] Real wallet sign-in clicked through once by the user (needs the extension)
- [x] `harness-review` passed (3 rounds; R1–R3, R7, R8 fixed, R4 applied, R5/N1/N2 recorded)
- [ ] CI green

## Next slices
1. Chore — bump GitHub Action versions; CI check that docs don't name packages missing from `package.json` (F-001)
2. S7 — agent request freshness (timestamp window + nonce)
3. S3 — label every simulated result in UI and README
4. S4 — SSRF guard on webhooks; S5 — remove PII from error logs; S6 — stop swallowing wallet errors
5. S2 — move agent private keys out of the JSON state file

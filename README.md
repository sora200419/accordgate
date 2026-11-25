# AccordGate — Concordium Trusted Agent Compliance Gateway

A compliance gateway for AI agents: agents get a Concordium-anchored identity, calls to protected endpoints are gated by policy checks and priced with x402 micro-payments, and every decision is written to a hash-chained audit ledger that can be anchored on Concordium testnet.

Status: early hackathon prototype, started from a Gemini AI Studio demo. See "Known limitations" before relying on anything.

## What works now
<!-- Every line here must point to working code. Update in the same commit as each milestone. -->
Verified on Node 22.15 / npm 11.3 (2026-11-18). Only start-up is checked so far, not what each feature does:
- A clean clone installs (`npm ci`), typechecks (`npm run lint`) and builds (`npm run build`).
- `npm run dev` serves the UI and API on http://localhost:3000 with seed data. All five tabs open with no browser console errors: 概览工作台, 可信 Agent 注册表, ZKP 隐私门控策略, 协议交互沙盒, EU AI Act 审计账本.
- Without Firebase config, the app runs, and the sidebar shows 云端同步未配置 in place of Google sign-in.
- Owner sign-in with the Concordium Browser Wallet (sidebar button 用 Concordium 钱包登录（所有者）): the server sends a one-time challenge, the wallet signs it, and the server checks the signature against the account's keys read from Concordium testnet (`server/auth.ts`). Only accounts listed in `OWNER_ACCOUNTS` can sign in. The session is an HttpOnly cookie that lasts 8 hours and is kept in server memory, so a server restart signs everyone out.
- Every owner route that changes data (agents, policies, webhooks, anchors, x402 settle, sandbox probe/sign/reset, audit tamper demo) needs a signed-in owner, whatever the path's letter case; the list is `OWNER_ROUTES` in `server/auth.ts`. Reads stay public. `GET /api/webhooks` shows only the last 4 characters of each signing secret; the full secret is returned once, when the webhook is created.
- `/api/gateway/invoke` and MCP `tools/call` reject requests without `X-Agent-Signature`, `X-Agent-Timestamp` and `X-Agent-Nonce` (401). The agent signs `did|endpointPath|timestamp|nonce|cardHash` with Ed25519. The timestamp must be at most 120 s old and at most 30 s ahead, and each nonce works once per agent within that window; a replayed or stale request is blocked (403) and audited (`server/agentFreshness.ts`). The server signs with an agent's stored demo key only for the owner's sandbox (`/api/sandbox/probe`, `/api/sandbox/sign`). A request with a wrong signature or card hash is blocked and audited, but outside the owner's sandbox it does not count toward the circuit breaker, so strangers cannot suspend an agent.
- Every simulated result carries a 模拟 badge in the UI and says so in API responses and audit text (SECURITY S3): x402 settlement hashes start with `sim_` and invoices have `simulated: true`; anchors made without a wallet have no signer and no CCDScan link; MCP `initialize` returns a `simulated` list.
- `npm test` runs `server/auth.test.ts` (sign-in, replay, expiry, owner routes, agent signatures, agent request freshness, simulated labels), `server/agentFreshness.test.ts` (nonce store), `server/port.test.ts` (PORT parsing), `src/anchorDisplay.test.ts` (which anchors get a CCDScan link) and the docs package check tests, without network access.
- `npm run check:docs` checks backticked lower-case package names in README, CLAUDE.md and `docs/` (scoped names, or names in `package-lock.json`): it fails when one is not a direct dependency, or when a line calls a direct dependency "not in package.json". Unscoped names that are not installed, upper-case names and names with a version inside the backticks are not checked.

## Run it
Needs Node 22.12 or later (Vite 8).

```bash
npm ci
```

```bash
npm run dev
```

Then open http://localhost:3000. `npm start` runs the same server; it serves the built `dist/` only when `NODE_ENV=production` is set and `npm run build` has been run.

## Deploy (Render free web service)
`render.yaml` is a Render Blueprint: one free web service, build `npm ci --include=dev && npm run build`, start `npm start`, health check `/api/health`, `NODE_ENV=production`, auto-deploy from `main` only after CI passes (`autoDeployTrigger: checksPass`; needs the GitHub checks on the commit, so Render has to see the CI workflow). In the Render dashboard choose New > Blueprint, pick this repository and enter `OWNER_ACCOUNTS` when asked. The server listens on the `PORT` the platform provides (default 3000 when unset or invalid).

What the free plan means (accepted for the hackathon):
- The service sleeps after 15 minutes without traffic; the first request afterwards takes about a minute. Open the URL before a demo.
- The filesystem is ephemeral: `data/gateway-state.json` is rebuilt from the seed after every sleep and every redeploy, so agents, policies, anchors and audit entries created on the live site are lost then. No `ACCORDGATE_DB_PATH` is set and no disk is attached.
- Sign-in sessions, challenges and agent nonces are in memory, so after a restart the owner has to sign in again. This is expected.
- The free plan runs one instance, which is what the in-memory state (SECURITY S8, S9) needs.
- Demo agent private keys sit in that same ephemeral file (SECURITY S2).
- Live at https://accordgate.onrender.com/ (Render free plan). Checked on 2026-11-19 in Chrome: `/api/health` 200; the 5 tabs open with no console errors from the app; an owner route without a session answers 401; owner sign-in with the wallet works over https and the session cookie `ag_session` is HttpOnly, Secure and SameSite=Strict (seen in Chrome DevTools, Application > Cookies); a signed-in write (`POST /api/agents`) answers 201; the public `GET /api/agents` shows no private-key fields; after a restart the seed data is back (4 agents) and the owner is signed out. Not observed directly: that `autoDeployTrigger: checksPass` waits for CI (the one deploy on record, of the merge commit of PR 6, started 3.6 minutes after CI finished there: consistent, not proof). BRIEF core path 1-5 run on the live site on 2026-11-19 (owner signed in with the wallet): (1) `POST /api/agents` 201, agent active; (2) `POST /api/policies` 201 (EU only, 18+, x402 price 0.5); (3) the agent called `/api/gateway/invoke` with its own Ed25519 signature headers (signed through the owner sandbox): no payment 402 `PAYMENT_REQUIRED` with an invoice, after the simulated settle (`sim_` hash) 200 `ALLOWED`, the same signed request again 403 `BLOCKED_REPLAYED`, a non-EU claim 403 `BLOCKED_ZKP_FAILED` (self-reported attribute, not a zero-knowledge proof); (4) all of these are in the audit ledger, the hash chain checks valid, and a real testnet RegisterData from the owner's wallet (tx `9938d42d43e6…`, range #1-#11) was stored `unverified`, then `verified` by the server on the 2nd attempt with one `ONCHAIN_ANCHORED` entry and a CCDScan link; (5) `PATCH /api/agents/:id/status` revoked 200, and the next signed call is 403 `BLOCKED_REVOKED`. This data was lost at the next sleep or redeploy (free plan).

## Configuration
Copy `.env.example` to `.env` and fill in the values.

`PORT` (optional): HTTP port, default 3000. Hosting platforms set it themselves.

`OWNER_ACCOUNTS` (server, required to make changes): comma-separated Concordium **testnet** account addresses that may sign in as the gateway owner. When it is empty, every change is refused with 503 and the sidebar shows 所有者登录未配置. Sign-in needs the Concordium Browser Wallet extension with one of those accounts.

Firebase (Google sign-in plus Firestore sync) is optional. To turn it on, set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID`. Optional: `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_FIRESTORE_DATABASE_ID`. Vite bundles every `VITE_*` value into the browser code, where anyone can read it. That is fine for Firebase web config, which is public by design, but never put a real secret behind a `VITE_` prefix.

## Known limitations
- Run the server as a single instance: the sign-in key, used challenges, sessions and used agent nonces live in process memory, so several instances behind a load balancer would reject each other's sign-ins and could each accept the same agent nonce once (SECURITY S9). The sign-in endpoints have no rate limit yet.
- One owner group for the whole server (no per-workspace ownership).
- Antivirus that scans HTTPS (seen with AVG Web Shield) re-signs the TLS connection to `grpc.testnet.concordium.com` with its own root certificate, so wallet sign-in fails with "unable to verify the first certificate". Either add an exception for that host in the antivirus, or start the server with Node trusting the Windows certificate store (Node 22.15 or later): `$env:NODE_OPTIONS="--use-system-ca"; npm run dev`. Never disable TLS checks (`NODE_TLS_REJECT_UNAUTHORIZED=0`).
- On the dev machine, local security software (probably the same AVG Web Shield) also rewrites HTTP responses for paths ending in `/mcp`, so browsers and `fetch` fail on `/api/mcp` even on localhost. Seen with a plain Python server too; not caused by this app.
- `firebase` 13 declares `node >=24.12` in its package metadata, so `npm ci` prints engine warnings on Node 22. Firebase runs only in the browser bundle here, so the server is not affected.
- The client bundle is one ~970 kB chunk (Vite warns about size).
- Simulated, not on chain (each is marked 模拟 in the UI):
  - x402 settlement: no payment is made; the "transaction hash" is a `sim_…` placeholder.
  - CIS-3 gas sponsorship: no sponsored transaction is sent; the gas figure is an estimate.
  - Agent registration and CIS-8 key bindings: kept in the local registry only, never written to or read from the CIS-8004 / CIS-8 contracts.
  - "ZKP": age, jurisdiction and KYC are self-reported request headers; the gateway stores a SHA-256 commitment of the results. No zero-knowledge proof is checked.
  - Audit anchoring: without a wallet the anchor is simulated (no signer, no link). If the wallet only signs, the row is a signature digest, not a transaction.
- Audit anchoring with a RegisterData transaction is real, but counts as on chain only after the server checks it on testnet (`POST /api/anchors/:id/verify`): the transaction must be finalized, sent by the owner who created the anchor, and carry the anchored audit root. Until then the row says 未核验 (not found yet, not final, or node unreachable); a mismatch says 核验失败. Before the wallet sends, the page checks that you are still signed in as that owner and uses the current audit root. If the server still does not accept the wallet's report (signer is not the signed-in owner, or the root is unknown), the row is stored as simulated with the reason, and the audit entry keeps the reported hash. The page asks the server every 4 s for about 60 s after anchoring; the 重新核验 button asks again.
- Anchors stored before S10 (`legacy_unchecked`) cannot be checked and never count as on chain. The optional Firestore mirror copies an anchor once, when first synced, and does not copy its verification status.
- A state file created before S3 still holds old `0xccd_…` seed hashes, invoices without `simulated`, and simulated anchors recorded as `ONCHAIN_ANCHORED`; reset with `POST /api/sandbox/reset` (owner) or delete `data/gateway-state.json`.
- Demo state (including agent private keys) is kept in a local JSON file, `data/gateway-state.json`.

Details and status of each item: `docs/SECURITY.md`.

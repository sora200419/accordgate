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
- `/api/gateway/invoke` and MCP `tools/call` reject requests without `X-Agent-Signature` and `X-Agent-Timestamp` (401). The server signs with an agent's stored demo key only for the owner's sandbox (`/api/sandbox/probe`, `/api/sandbox/sign`). A request with a wrong signature or card hash is blocked and audited, but outside the owner's sandbox it does not count toward the circuit breaker, so strangers cannot suspend an agent.
- `npm test` runs `server/auth.test.ts` (sign-in, replay, expiry, owner routes, agent signatures) without network access.

## Run it
Needs Node 22.12 or later (Vite 8).

```bash
npm ci
```

```bash
npm run dev
```

Then open http://localhost:3000. `npm start` runs the same server; it serves the built `dist/` only when `NODE_ENV=production` is set and `npm run build` has been run.

## Configuration
Copy `.env.example` to `.env` and fill in the values.

`OWNER_ACCOUNTS` (server, required to make changes): comma-separated Concordium **testnet** account addresses that may sign in as the gateway owner. When it is empty, every change is refused with 503 and the sidebar shows 所有者登录未配置. Sign-in needs the Concordium Browser Wallet extension with one of those accounts.

Firebase (Google sign-in plus Firestore sync) is optional. To turn it on, set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID`. Optional: `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_FIRESTORE_DATABASE_ID`. Vite bundles every `VITE_*` value into the browser code, where anyone can read it. That is fine for Firebase web config, which is public by design, but never put a real secret behind a `VITE_` prefix.

## Known limitations
- Run the server as a single instance: the sign-in key, used challenges and sessions live in process memory, so several instances behind a load balancer would reject each other's sign-ins. The sign-in endpoints have no rate limit yet.
- One owner group for the whole server (no per-workspace ownership). Agent requests are signed, but the timestamp is not checked for freshness and has no nonce, so a captured signed request can be replayed (SECURITY S7).
- Antivirus that scans HTTPS (seen with AVG Web Shield) re-signs the TLS connection to `grpc.testnet.concordium.com` with its own root certificate, so wallet sign-in fails with "unable to verify the first certificate". Either add an exception for that host in the antivirus, or start the server with Node trusting the Windows certificate store (Node 22.15 or later): `$env:NODE_OPTIONS="--use-system-ca"; npm run dev`. Never disable TLS checks (`NODE_TLS_REJECT_UNAUTHORIZED=0`).
- On the dev machine, local security software (probably the same AVG Web Shield) also rewrites HTTP responses for paths ending in `/mcp`, so browsers and `fetch` fail on `/api/mcp` even on localhost. Seen with a plain Python server too; not caused by this app.
- `firebase` 13 declares `node >=24.12` in its package metadata, so `npm ci` prints engine warnings on Node 22. Firebase runs only in the browser bundle here, so the server is not affected.
- The client bundle is one ~970 kB chunk (Vite warns about size).
- Some results are simulated, not on-chain: x402 settlement produces a mock transaction hash; audit anchoring falls back to a simulated payload when no wallet is connected; the "ZKP" commitment is a SHA-256 hash, not a zero-knowledge proof.
- Demo state (including agent private keys) is kept in a local JSON file, `data/gateway-state.json`.

Details and status of each item: `docs/SECURITY.md`.

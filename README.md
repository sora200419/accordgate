# AccordGate — Concordium Trusted Agent Compliance Gateway

A compliance gateway for AI agents: agents get a Concordium-anchored identity, calls to protected endpoints are gated by policy checks and priced with x402 micro-payments, and every decision is written to a hash-chained audit ledger that can be anchored on Concordium testnet.

Status: early hackathon prototype, started from a Gemini AI Studio demo. See "Known limitations" before relying on anything.

## What works now
<!-- Every line here must point to working code. Update in the same commit as each milestone. -->
Verified on Node 22.15 / npm 11.3 (2026-11-18). Only start-up is checked so far, not what each feature does:
- A clean clone installs (`npm ci`), typechecks (`npm run lint`) and builds (`npm run build`).
- `npm run dev` serves the UI and API on http://localhost:3000 with seed data. All five tabs open with no browser console errors: 概览工作台, 可信 Agent 注册表, ZKP 隐私门控策略, 协议交互沙盒, EU AI Act 审计账本.
- Without Firebase config, the app runs, and the sidebar shows 云端同步未配置 in place of Google sign-in.

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

Firebase (Google sign-in plus Firestore sync) is optional. To turn it on, set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID`. Optional: `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_FIRESTORE_DATABASE_ID`. Vite bundles every `VITE_*` value into the browser code, where anyone can read it. That is fine for Firebase web config, which is public by design, but never put a real secret behind a `VITE_` prefix.

## Known limitations
- The server API has no authentication yet.
- `firebase` 13 declares `node >=24.12` in its package metadata, so `npm ci` prints engine warnings on Node 22. Firebase runs only in the browser bundle here, so the server is not affected.
- The client bundle is one ~970 kB chunk (Vite warns about size).
- Some results are simulated, not on-chain: x402 settlement produces a mock transaction hash; audit anchoring falls back to a simulated payload when no wallet is connected; the "ZKP" commitment is a SHA-256 hash, not a zero-knowledge proof.
- Demo state (including agent private keys) is kept in a local JSON file, `data/gateway-state.json`.

Details and status of each item: `docs/SECURITY.md`.

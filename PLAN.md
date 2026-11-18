# Plan: current slice

<!-- Rewritten at the end of Plan Mode for every slice. After /clear, a new session continues with "@PLAN.md". -->

## Slice
Slice 1 — make the imported demo install, typecheck and build from a clean clone. No behaviour changes.
Start this in Plan Mode: confirm each item below by running the commands before changing anything.

## Decisions (made 2026-11-18)
- npm (bun.lock deleted, package-lock.json committed)
- Firebase optional via `VITE_FIREBASE_*` env vars; off when unset

## Phase 1: dependencies and config
- [x] Baseline: `npm install` failed on peer conflict (root `esbuild ^0.25` vs vite 8 peer `^0.27 || ^0.28`); after deps fixed, lint/build failed only on missing `firebase-applet-config.json`
- [x] Added `firebase ^13.4.0` (declares Node >=24.12; firebase 12 pulls the same `@firebase/app` via peers. User accepted the Node 22 engine warning on 2026-11-18), `@concordium/browser-wallet-api-helpers ^3.3.0`; removed unused `esbuild`, `@google/genai`
- [x] `typescript 7.0.2` is released and `tsc --noEmit` passes
- [ ] Remove `GEMINI_API_KEY` from `.env.example` and add `VITE_FIREBASE_*` placeholders (waiting for the user)
- [x] Firebase config from env (`src/firebase.ts`, `README.md`)
- [x] `npm start` → `tsx server.ts` (Node 22.15 cannot run .ts without a flag); serves `/` and `/api/agents` with 200

## Phase 2: frontend and integration
- [x] `npm run dev`: all five tabs render, no browser console errors
- [x] README "What works now", "Run it", "Configuration" updated

## Contract
No API changes in this slice.

## Verification gate
- [x] Typecheck (`npm run lint`)
- [x] Build (`npm run build`)
- [x] Ran the app by hand, all tabs load
- [ ] CI green on the branch (placeholder Test step dropped; needs a push)
- [ ] `.claude/settings.json` deny rule: `Read(./.env.*)` → specific files (edit blocked for Claude; the user applies it)

## Next slices (from docs/SECURITY.md)
1. S1 — require a signed-in owner on every mutating API route
2. S3 — label every simulated result in UI and README
3. S4 — SSRF guard on webhooks; S5 — remove PII from error logs; S6 — stop swallowing wallet errors
4. S2 — move agent private keys out of the JSON state file

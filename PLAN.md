# Plan: current slice

<!-- Rewritten at the end of Plan Mode for every slice. After /clear, a new session continues with "@PLAN.md". -->

## Slice
Slice 1 — make the imported demo install, typecheck and build from a clean clone. No behaviour changes.
Start this in Plan Mode: confirm each item below by running the commands before changing anything.

## Decisions needed from the user first
- npm or bun (delete the other lockfile)
- Keep Firebase (sign-in + Firestore sync) or drop it for now? If kept: where `firebase-applet-config.json` comes from (it is git-ignored)

## Phase 1: dependencies and config
- [ ] Run install, `npm run lint`, `npm run build`; record the real errors (`package.json`)
- [ ] Add missing deps `firebase`, `@concordium/browser-wallet-api-helpers` at versions compatible with `@concordium/web-sdk` ^12 (`package.json`; explain versions and lockfile impact first)
- [ ] Verify `typescript ^7.0.2` exists and works with `tsc --noEmit`; otherwise pin a released version (`package.json`)
- [ ] Remove unused `@google/genai` and `GEMINI_API_KEY` if nothing uses them (`package.json`, `.env.example` — ask before editing)
- [ ] Firebase config: load from env or document `firebase-applet-config.json` (`src/firebase.ts`, `README.md`)
- [ ] Check `npm start` (`node server.ts`) works on the chosen Node version, or change it to `tsx` (`package.json`)

## Phase 2: frontend and integration
- [ ] `npm run dev`, open http://localhost:3000, click through all five tabs; note console errors
- [ ] Update README "What works now" and "Run it" with what was actually verified

## Contract
No API changes in this slice.

## Verification gate
- [ ] Typecheck (`npm run lint`)
- [ ] Build (`npm run build`)
- [ ] Ran the app by hand, all tabs load
- [ ] CI green on the branch (add a test runner or drop the placeholder Test step)

## Next slices (from docs/SECURITY.md)
1. S1 — require a signed-in owner on every mutating API route
2. S3 — label every simulated result in UI and README
3. S4 — SSRF guard on webhooks; S5 — remove PII from error logs; S6 — stop swallowing wallet errors
4. S2 — move agent private keys out of the JSON state file

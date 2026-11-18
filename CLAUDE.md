# AccordGate — Concordium Trusted Agent Compliance Gateway

## Mode
MVP / hackathon. Workflow: follow `~/.claude/skills/new-project/SOP.md` for this mode. Goal, scope and milestones: `docs/BRIEF.md`. Entities and invariants: `docs/DATA_MODEL.md`. UI direction and screens: `docs/DESIGN.md`. Permissions, threats and privacy claims: `docs/SECURITY.md`. Current slice: `PLAN.md`.

- Keep it simple (KISS). Write the most direct code that works; no new abstraction layers, caches or queues unless BRIEF asks for them.
- Started from a Gemini / AI Studio demo (imported 2026-11-18). Treat its code as unreviewed: check before trusting, and never assume a feature works because the UI says so.

## Stack
- Frontend: React 19, Vite 8, Tailwind 4, `motion`, `lucide-react` (`src/`)
- Backend: Express 4 in `server.ts` (~2000 lines) plus `server/` (store, crypto, types); runs through `tsx`
- Chain: `@concordium/web-sdk` ^12 (testnet gRPC), `@concordium/browser-wallet-api-helpers` ^3.3 (browser wallet)
- Persistence: JSON file `data/gateway-state.json` (server, regenerated if missing, git-ignored); optional Firebase Firestore + Google sign-in on the client (`firebase` ^13.4; its packages declare Node >=24.12, so npm warns on Node 22: accepted, browser-only), turned on only when `VITE_FIREBASE_*` env vars are set (`src/firebase.ts` `firebaseEnabled`)
- Language: TypeScript 7 (`typescript ^7.0.2`, verified with `tsc --noEmit`)
- Package manager: npm (`package-lock.json`; CI uses `npm ci`)
- Hosting: TODO (the demo ran on AI Studio / Cloud Run)

## Common Commands
- Install: `npm ci` (add deps with `npm install <pkg>`)
- Start: `npm start` (`tsx server.ts`; serves `dist/` only with `NODE_ENV=production`)
- Dev server (Express + Vite middleware): `npm run dev`
- Typecheck: `npm run lint` (runs `tsc --noEmit`)
- Lint: TODO (`eslint.config.mjs` exists, eslint is not installed)
- Test: `npm test` (`tsx --test server/auth.test.ts server/agentFreshness.test.ts src/anchorDisplay.test.ts scripts/check-doc-packages.test.ts`, node:test, no network; `firestore.rules.test.ts` exists but nothing runs it)
- Docs package check (F-001): `npm run check:docs` — backticked lower-case package names (scoped, or in `package-lock.json`) in README, CLAUDE.md and `docs/` must be direct dependencies (or listed in `ALLOWED` in `scripts/check-doc-packages.ts` with a reason)
- Owner sign-in needs `OWNER_ACCOUNTS` (testnet addresses) in `.env`; owner-only routes are `OWNER_ROUTES` in `server/auth.ts`
- Build: `npm run build`
- Reset demo data: delete `data/gateway-state.json` or `POST /api/sandbox/reset`

## Environments
| | Local | Staging / testnet | Production |
| --- | --- | --- | --- |
| URL | http://localhost:3000 (`PORT` in server.ts) | TODO | TODO |
| Chain network | Concordium testnet | Concordium testnet | TODO |
| Secrets from | `.env` | Platform env vars | Platform env vars |
| Deploys when | — | Every PR (preview) | Merge to main, after CI is green |

- CI: `.github/workflows/ci.yml` runs install, docs package check, typecheck, test, build.
- Contracts read by the server: testnet `<10082,0>` (CIS-8004) and `<10081,0>` (CIS-8). Not deployed by us.
- Mainnet actions are done by the user, never by CI or Claude.
- Live state comes from the platform's deploy records and logs, never inferred from config.

## Conventions
- API errors: the demo uses `{ "error": "message" }`; new code keeps that shape until a slice changes it on purpose.
- Anything simulated (`sim_` tx hashes, `simulated-payload` anchors, hash-based "ZKP" commitments, x402 settlement, CIS-3 sponsorship, local CIS-8004 registration) must be labelled as simulated in the UI (`src/components/SimulatedBadge.tsx`), API responses and README.
- Test data and test accounts live in the seed (`server/store.ts` default state); never paste passwords in chat.
- Tests use a fixed clock or non-expiring data, never the real date.
- Logs never contain secrets, private keys, tokens, auth headers or personal data (emails, display names); sanitise third-party errors before logging or returning them.
- Every external call (gRPC, DNS, webhooks, Firebase) has a timeout and an error message that names the cause.

## Git
- Branches: `feat/…`, `fix/…`, `chore/…`.
- Conventional Commits (`feat(scope): …`); one slice per commit.
- Never commit `.env*` (except `.env.example`), `data/`, keys or build output.

## Project Structure
- `server.ts` — `createApp()` with all API routes (`/api/...`) and gateway logic; `startServer()` adds Vite/static and listens (only when run directly)
- `server/auth.ts` — wallet sign-in (challenge/verify/me/logout), sessions, `OWNER_ROUTES` guard; `server/auth.test.ts`
- `server/agentFreshness.ts` — agent request freshness (timestamp window, single-use nonce per DID, in memory); `server/agentFreshness.test.ts`
- `src/components/SimulatedBadge.tsx` — the 模拟 badge; `src/anchorDisplay.ts` — which anchors get a CCDScan link and their labels; `src/anchorDisplay.test.ts`
- `server/store.ts` — JSON-file database (`ACCORDGATE_DB_PATH` overrides the path), seed data; `server/crypto.ts` — hashing, Ed25519, mock tx hash; `server/types.ts`
- `src/App.tsx` — shell, Google sign-in; `src/components/*View.tsx` — one view per tab; `src/api.ts` — fetch wrapper
- `src/services/concordiumWallet.ts` — browser wallet connect, sign, RegisterData anchor (with fallbacks)
- `src/firebase.ts`, `src/services/firestoreSync.ts`, `DRAFT_firestore.rules`, `firestore.rules.test.ts`, `firebase-blueprint.json`, `security_spec.md` — Firestore sync and its rules

## Red Lines
- Money, signing, identity, permissions and privacy claims: Plan first, test concurrency / replay / expiry / reordering, then `harness-review`.
- Take the current user from the session or token, never from the request body.
- Secrets only in `.env` (ignored); `.env.example` keeps placeholders. Agent private keys never leave the server and never get committed.
- Never present a simulated chain or payment result as real.

# Mishaps and Prevention Rules
- **[2026-11-18] AVG on the dev machine rewrites traffic**: When a local `/mcp` call fails with "terminated", use the raw-socket client in `server/auth.test.ts` instead of debugging the app. When testnet TLS fails with "unable to verify the first certificate", run the server with `NODE_OPTIONS=--use-system-ca`, never with TLS checks off. (F-004)
- **[2026-11-18] Limits on unauthenticated sign-in endpoints must not displace the owner**: When capping or evicting state that anonymous callers can create (challenges, pending requests), test "owner first, flood after, owner completes". Prefer stateless signed tokens over stored state that can be evicted. (F-003)
<!-- Project-specific lessons from harness-postmortem. One rule, at most 2 sentences, with date and source. -->

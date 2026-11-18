# Plan: current slice

<!-- Rewritten at the end of Plan Mode for every slice. After /clear, a new session continues with "@PLAN.md". -->

## Slice
Chore — CI and docs cleanup after S1. Branch `chore/ci-and-docs`.

## Decisions (made 2026-11-18)
- GitHub Actions: `actions/checkout@v7` (latest v7.0.1), `actions/setup-node@v7` (latest v7.1.0); their breaking changes touch only `pull_request_target`, which we don't use
- F-001 automation: `scripts/check-doc-packages.ts`, no new dependency, two checks only: (a) a backticked package (scoped, or installed per `package-lock.json`) must be a direct dependency unless in `ALLOWED` with a reason; (b) a line saying "not in / removed from package.json" must not name a direct dependency
- Scope of the check: README.md, CLAUDE.md, `docs/**/*.md`; PLAN.md and FAILURES.md are history and not checked
- `APP_URL` removed from `.env.example`: nothing in the repo reads it

## Steps
- [x] Bump actions in `.github/workflows/ci.yml` (including the commented deploy job)
- [x] `scripts/check-doc-packages.ts` + `scripts/check-doc-packages.test.ts`; `npm run check:docs`; CI step "Docs packages"
- [x] `vite.config.ts`: `__dirname` → `import.meta.dirname` (Vite 8 `configLoader: 'native'` warning)
- [x] BRIEF milestone "Server API protected" marked done (CI run 44259897748)
- [x] `.env.example`: `APP_URL` removed
- [x] README, CLAUDE.md, FAILURES.md (F-001 now automated) updated; pending FAILURES.md pruning committed separately

## Verification gate
- [x] `npm run lint`, `npm test`, `npm run check:docs` (0 problems), `npm run build` (no `__dirname` warning)
- [x] Check proven to catch F-001: an injected "`firebase` … not in package.json" line and a missing `ALLOWED` entry each fail
- [x] `harness-review` passed (1 round; R1 claim wording fixed, R3 noted in header, R2 not adopted per scope, R4 → check CI log for the summary line)
- [ ] CI green on the PR

## Next slices
1. S7 — agent request freshness (timestamp window + nonce)
2. S3 — label every simulated result in UI and README
3. S4 — SSRF guard on webhooks; S5 — remove PII from error logs; S6 — stop swallowing wallet errors
4. S2 — move agent private keys out of the JSON state file

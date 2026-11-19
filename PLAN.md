# Plan: current slice

<!-- Rewritten at the end of Plan Mode for every slice. After /clear, a new session continues with "@PLAN.md". -->

## Slice
Deploy — Walking skeleton deployed (BRIEF milestone). Branch `chore/deploy`, rebased on `main` after S10 was merged (PR 5, 2026-11-18, CI green). Local commit only so far: not pushed, no PR yet.

## Decisions (made 2026-11-19)
- Platform: Render free web service (compared with Railway and Fly.io: free tier, disk, GitHub auto-deploy, single instance)
- No disk, no `ACCORDGATE_DB_PATH`: state resets to the seed after every sleep (15 min idle) and redeploy; the owner signs in again (sessions in memory). Accepted and written in README, BRIEF, SECURITY
- Single instance because the free plan has one instance (S8/S9)
- `PORT` from env (default 3000); `NODE_ENV=production` serves `dist/`; `OWNER_ACCOUNTS` is a dashboard secret
- Build command needs `--include=dev` (tailwindcss and typescript are devDependencies)
- Deploys only after CI passes: `autoDeployTrigger: checksPass` (user decision 2026-11-19, replaces `autoDeploy`)
- No keep-alive pinger; no per-PR previews (not in this slice)

## Steps
- [x] `resolvePort` in `server/port.ts` (used by `server.ts`) + `server/port.test.ts`, mutation-checked (7 mutations each fail a test)
- [x] `render.yaml`, `.node-version`, `.env.example` (`PORT`)
- [x] Docs: README deploy section, CLAUDE.md Hosting/Environments, BRIEF milestone and question, SECURITY external services
- [x] `npm run lint`, `npm test` (101/101 with `server/port.test.ts`), `npm run check:docs`, `npm run build`
- [x] Local production run with `PORT=4123`: `/api/health` 200, `dist/` served, owner route 401, 5 tabs no console errors; `PORT=abc` logs the warning and falls back to 3000
- [x] `harness-review` PASS (round 1; S2 and S3 fixed in docs, no blocking issues)
- [ ] User deploys on Render (their steps), sends URL or log
- [ ] Live check: 5 tabs, `/api/health`, owner route 401 without session, wallet sign-in over https, restart resets to seed and requires sign-in
- [ ] Only then: fill the URL in CLAUDE.md and README, tick the BRIEF milestone

## Next slices
1. S4 — SSRF guard on webhooks; S5 — remove PII from error logs; S6 — stop swallowing wallet errors
2. S2 — move agent private keys out of the JSON state file

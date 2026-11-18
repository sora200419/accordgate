# Failures

Mishaps that forced rework, with the rule each one produced. Newest at the bottom.

### F-001 · 2026-11-18 · Stale dependency facts left in docs/
- **What happened**: Slice 1 added `firebase` and `@concordium/browser-wallet-api-helpers`, removed `@google/genai` and chose npm. README, CLAUDE.md and PLAN.md were updated, but `docs/SECURITY.md` still said both packages were "not in package.json" and that genai was listed. `docs/BRIEF.md` still had the milestone as TODO and asked "npm or bun?". The referee flagged it as Blocking (R1).
- **Root cause**: I updated only the files the plan named. I didn't grep the repo for the old facts, even though a global rule already asks for every surface to be fixed.
- **Fix**: updated SECURITY.md and BRIEF.md. `grep -rn "not in package.json\|npm or bun\|firebase-applet-config"` now finds only history lines in PLAN.md.
- **Rule destination**: global ledger, merged into "Trace feature claims to where they are written" (a recurrence of PayPal F-014 / oco-reactive F-006). → merged (pruned 2026-11-18) into global "Trace claims to code and fix every copy of a changed fact".
- **Recurrences**: this is itself the recurrence. Automated (2026-11-18, `chore/ci-and-docs`): CI step `npm run check:docs` (`scripts/check-doc-packages.ts`) checks backticked lower-case package names (scoped, or in `package-lock.json`) in README, CLAUDE.md and `docs/`: it fails when one is not a direct dependency, or when a line calls a direct dependency "not in package.json". It does not catch unscoped names that are not installed, upper-case names, or names with a version inside the backticks.

### F-002 · 2026-11-18 · Owner guard bypassed by path letter case
- **What happened**: S1's `ownerGuard` matched `OWNER_ROUTES` with case-sensitive regexes on `req.path`, but Express 4 routes case-insensitively by default. `POST /API/sandbox/reset` and `/api/Sandbox/Sign` reached owner-only handlers without a session. The tests sent only exact lowercase paths, so all 20 passed. The referee flagged it as Blocking (R1).
- **Root cause**: wrong assumption. I wrote my own path matcher and assumed it matched paths the same way the router does.
- **Fix**: the guard regex is now case-insensitive, and `createApp` sets `case sensitive routing` and `strict routing`. A new test sends upper-case, mixed-case and trailing-slash variants of every owner route. It failed before the fix and passes now (`npm test`).
- **Rule destination**: global ledger, "Path-matching guards use the router's matching rules". → merged (pruned 2026-11-18) into global "Guards keyed on request-derived values follow the real request and the router".
- **Recurrences**: none.

### F-003 · 2026-11-18 · Anti-flood limit moved the lockout instead of removing it
- **What happened**: The referee found that the global cap on pending sign-in challenges let anyone lock the owner out (R3). I replaced it with per-account eviction, and the re-review found that anonymous requests could now evict the owner's own pending challenge (R8). The fix that worked was a stateless HMAC challenge plus a used-nonce set.
- **Root cause**: not verified. I tested the flood only before the owner's request, never "owner first, attacker after".
- **Fix**: `server/auth.ts` stateless challenges. The test "challenges requested after the owner's cannot invalidate it" failed on the eviction code and passes now.
- **Rule destination**: project CLAUDE.md, because the global ledger is at its 30-rule limit. Consider promoting it to global during `harness-prune`.
- **Recurrences**: none.

### F-004 · 2026-11-18 · Local responses on `*/mcp` paths rewritten on the dev machine
- **What happened**: The MCP tests failed with "terminated". Software on this PC rewrites loopback HTTP responses for any path ending in `/mcp`: it adds `transfer-encoding: chunked` and drops Content-Length. A plain Python server shows the same thing, and the rewrite happens even outside the sandbox. Diagnosis took about 10 tool calls.
- **Root cause**: missing information about this machine's environment.
- **Fix**: `server/auth.test.ts` sends `/api/mcp` calls through a raw-socket client and reads until the connection closes. The cause is documented in README "Known limitations".
- **Later finding (2026-11-18)**: the first real wallet sign-in failed with "unable to verify the first certificate". `openssl s_client` against `grpc.testnet.concordium.com:20000` showed the certificate issued by "AVG Web/Mail Shield Root", so AVG Web Shield re-signs TLS on this PC. It is probably also what rewrites the `/mcp` responses (not confirmed). Starting the server with `NODE_OPTIONS=--use-system-ca` fixed sign-in.
- **Rule destination**: project CLAUDE.md.
- **Recurrences**: none.

### F-005 · 2026-11-18 · Referee's working copies carried `.env` and a `node_modules` junction
- **What happened**: During `harness-review` of S10, the referee subagent ran the mutation script against full copies of the project (robocopy into `scratchpad\repocopy` and `scratchpad\rc3`) so it could stay read-only. Both copies included the project `.env`, putting local secrets outside the repo. Each copy also held a directory junction to the real `node_modules`, so a recursive delete of the copy could have followed it and wiped the real dependencies. A hook blocked deleting the copied `.env`, so the user had to delete both folders by hand.
- **Root cause**: missing information. My re-review prompt said "run it against a copy if you want to stay read-only" but never said what a copy must leave out. The mutation script only needs single-file backups, so a full copy was never necessary.
- **Fix**: removed both junctions with `cmd /c rmdir` (link only) and confirmed the real `node_modules` was intact; the user deleted `rc3` and `repocopy`, and `Test-Path` confirms both are gone.
- **Rule destination**: global ledger, merged into "Regression and rejection tests must first prove they catch the bug". Automation candidate (proposed to the user, not done): `~/.claude/hooks/harness/harness-guard.js` already denies copying a named `.env` file, but not a recursive directory copy (robocopy, xcopy /s, `cp -r`, `Copy-Item -Recurse`) whose source holds `.env*`.
- **Recurrences**: none.

## Pruning log

| Date | Action (delete / merge / automate / promote to global) | Entries | Notes |
| --- | --- | --- | --- |
| 2026-11-18 | merge ×2 | F-001, F-002 | Global ledger 30 → 24 (5 merges, 1 rule split back out, #30 trimmed, 2 demotions). Project ledger unchanged at 2. |

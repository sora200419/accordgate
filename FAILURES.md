# Failures

Mishaps that forced rework, with the rule each one produced. Newest at the bottom.

### F-001 · 2026-11-18 · Stale dependency facts left in docs/
- **What happened**: Slice 1 added `firebase` and `@concordium/browser-wallet-api-helpers`, removed `@google/genai` and chose npm. README, CLAUDE.md and PLAN.md were updated, but `docs/SECURITY.md` still said both packages were "not in package.json" and that genai was listed. `docs/BRIEF.md` still had the milestone as TODO and asked "npm or bun?". The referee flagged it as Blocking (R1).
- **Root cause**: I updated only the files the plan named. I didn't grep the repo for the old facts, even though a global rule already asks for every surface to be fixed.
- **Fix**: updated SECURITY.md and BRIEF.md. `grep -rn "not in package.json\|npm or bun\|firebase-applet-config"` now finds only history lines in PLAN.md.
- **Rule destination**: global ledger, merged into "Trace feature claims to where they are written" (a recurrence of PayPal F-014 / oco-reactive F-006).
- **Recurrences**: this is itself the recurrence. Automation proposed to the user, not started: a CI step that fails when docs mention a package that is not in package.json.

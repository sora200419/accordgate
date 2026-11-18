# Plan: current slice

<!-- Rewritten at the end of Plan Mode for every slice. After /clear, a new session continues with "@PLAN.md". -->

## Slice
S7 — agent request freshness (timestamp window + nonce). Branch `feat/s7-agent-request-freshness`.

## Decisions (made 2026-11-18)
- New header `X-Agent-Nonce`, part of the signed string: `did|endpointPath|timestamp|nonce|cardHash`; missing → 401 (REST and MCP)
- Strict formats: timestamp `YYYY-MM-DDTHH:mm:ss(.sss)Z`, nonce `^[A-Za-z0-9_-]{16,128}$` (no `|`, so the signed string is unambiguous)
- Window: at most 120 s old, at most 30 s in the future; timestamps older than the guard's creation (process start) are rejected, so a restart does not reopen replay
- Order: signature first, then freshness + nonce, so only validly signed requests can add nonces; check-and-insert is synchronous (no await), so concurrent duplicates → exactly one passes
- Store `server/agentFreshness.ts`: per-agent `Map<nonce, expiresAt = ts + maxAge>`, swept on each check; per-agent cap (default 1000) rejects that agent with 429 and never evicts unexpired nonces
- Outcomes: `BLOCKED_STALE_REQUEST` / `BLOCKED_REPLAYED` (403), cap → `BLOCKED_RATE_LIMITED` (429); none count toward the circuit breaker
- `/api/sandbox/sign` uses the injected clock and returns a random nonce; the sandbox probe goes through the same guard

## Steps
- [ ] `server/agentFreshness.ts` + `server/agentFreshness.test.ts`
- [ ] Wire into `evaluateCompliancePipeline`, `/api/gateway/invoke`, MCP `tools/call`, `/api/sandbox/sign`, `/api/sandbox/probe`
- [ ] Types, StatusBadge labels, `api.ts`, ProtocolSandboxView headers and snippets
- [ ] Route tests in `server/auth.test.ts`: replay, stale, future, concurrent same nonce, out of order, flood (anonymous and capped agent), no circuit breaker, missing nonce 401
- [ ] Docs: SECURITY (S7 fixed, nonce store per process), README, CLAUDE.md

## Verification gate
- [x] `npm run lint`, `npm test`, `npm run check:docs`, `npm run build`
- [x] Tests proven to catch the bug: guard call removed (copy of `server.ts` aside) → 7 S7 route tests fail; nonce recorded before the signature check → the anonymous-flood test fails; restored from the copy → 51/51
- [x] `harness-review` passed (2 rounds; R1 trace key/labels fixed, R2 mutation evidence, R3/R5 wording and strict dates fixed, R4 assertion added, R6/R7 documented in SECURITY S9)
- [x] CI green on PR #3 (GitHub Actions run 44314124660, 51/51 tests, Docs packages step printed "6 files, 0 problem(s)", 2026-11-18)

## Next slices
1. S3 — label every simulated result in UI and README
2. S4 — SSRF guard on webhooks; S5 — remove PII from error logs; S6 — stop swallowing wallet errors
3. S2 — move agent private keys out of the JSON state file

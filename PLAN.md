# Plan: current slice

<!-- Rewritten at the end of Plan Mode for every slice. After /clear, a new session continues with "@PLAN.md". -->

## Slice
S3 — label every simulated result in UI, API responses, audit text and README. Branch `feat/s3-label-simulated`. Nothing becomes real in this slice.

## Decisions (made 2026-11-18)
- Fake tx hashes get the prefix `sim_` (never `0x…`); invoices carry `simulated: true`; sponsor "account" is the literal `simulated-sponsor`
- Anchors: ccdscan link only for `browser-wallet-tx`; audit decision `ONCHAIN_ANCHORED` only for that mode, otherwise `ANCHOR_NOT_ONCHAIN`; `browser-wallet-tx` is labelled "钱包上报，服务器未核验" (server-side gRPC check is a later slice)
- "ZKP" stays as a name; every sentence claiming a zero-knowledge proof becomes "自报属性 + SHA-256 承诺（模拟 ZKP，非零知识证明）" with a 模拟 badge; API header and field names unchanged
- Agent registration, CIS-8 bindings and the sandbox step 01 trace say "local registry, not written to / not read from CIS-8004"
- Seed: no invented addresses (`walletAddress: null` for EuroClear), seed audit reasons prefixed `[seed demo data]`
- MCP `initialize` adds a `simulated` list
- One shared `SimulatedBadge` component; no other abstraction

## Inventory
Full table with file positions: `C:\Users\ONG\.claude\plans\pasted-content-id-086d-plan-md-docs-sec-dapper-stream.md`. Items: 1 x402 settle hash, 2 seed invoices, 3 CIS-3 sponsor + gas, 4 `simulated-payload` anchor, 5 `wallet-signed-attestation` anchor, 6 unverified `browser-wallet-tx`, 7 ZKP wording, 8 agent registration, 8b sandbox step 01 trace, 9 seed addresses, 10 seed audit reasons, 11 MCP standards, 12 testnet probe fallback text.

## Steps
- [x] Server: `sim_` hashes, sponsor literal, anchor defaults and decision, traces, MCP list, seed
- [x] Client: `SimulatedBadge`, `anchorExplorerUrl`, wallet fallback without hard-coded signer, wording per inventory
- [x] Tests in `server/auth.test.ts` (+ helper test), each proven to fail without the change
- [x] Docs: SECURITY S3, README, BRIEF, DATA_MODEL, `index.html`, `metadata.json`; grep `0xccd`, `SPONSOR_FACILITATOR`, `零知识`, `Gasless`, `ONCHAIN_ANCHORED`

## Verification gate
- [x] `npm run lint`, `npm test` (64/64), `npm run check:docs`, `npm run build`
- [x] Mutation proof (copies in the scratchpad, restored with `cp`, not git): (1) `main`'s `server.ts`, `server/store.ts`, `server/crypto.ts`, `server/types.ts` swapped in → the first 7 S3 tests fail with ERR_ASSERTION; (2) `anchorExplorerUrl` mode/hash guard removed → `src/anchorDisplay.test.ts` link test fails; (3) pre-review `server.ts` swapped in → the 4 review tests (failing step 01 wording, failed-ZKP wording, non-hex wallet hash, webhook payload) fail; restored → 64/64
- [x] Browser (2026-11-18): five tabs in the preview pane, no console errors; owner flows in the user's Chrome (signed in; preview server run as `dev-system-ca` because AVG re-signs testnet TLS): reset → EuroClear `walletAddress: null`, detail renders without a wallet row; sandbox "合规放行 + 402" → 402 box with 模拟 badges → 模拟支付并重试 → HTTP 200 with simulated receipt and toast; anchor via API with no wallet data → `simulated-payload`, no signer, `sim_` hash, ledger row "—（无签名）" + 模拟, 0 CCDScan links, decision "存证 · 未上链". One console exception came from Chrome extension messaging ("message channel closed"), not app code
- [x] `harness-review` passed (2 rounds: R1–R5, R7, R8, R10 fixed with tests; R6 mutation evidence + browser check; R9 documented)
- [ ] CI green on the PR

## Next slices
1. Verify `browser-wallet-tx` anchors on the server (gRPC `getBlockItemStatus`) before showing them as on-chain
2. S4 — SSRF guard on webhooks; S5 — remove PII from error logs; S6 — stop swallowing wallet errors
3. S2 — move agent private keys out of the JSON state file

# AccordGate — Concordium Trusted Agent Compliance Gateway

A compliance gateway for AI agents: agents get a Concordium-anchored identity, calls to protected endpoints are gated by policy checks and priced with x402 micro-payments, and every decision is written to a hash-chained audit ledger that can be anchored on Concordium testnet.

Status: early hackathon prototype, started from a Gemini AI Studio demo. See "Known limitations" before relying on anything.

## What works now
<!-- Every line here must point to working code. Update in the same commit as each milestone. -->
Not verified yet: the imported demo does not install and build as-is (see Known limitations). This list will be filled once the first slice makes it run.

## Run it
Not runnable yet from a clean clone. Intended steps once the dependency fix lands:

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:3000.

## Configuration
Copy `.env.example` to `.env` and fill in the values. Firebase needs a `firebase-applet-config.json` (not committed; TODO: document its fields).

## Known limitations
- Dependencies missing from `package.json` (`firebase`, `@concordium/browser-wallet-api-helpers`), and `firebase-applet-config.json` is not in the repo, so install/build fails.
- The server API has no authentication yet.
- Some results are simulated, not on-chain: x402 settlement produces a mock transaction hash; audit anchoring falls back to a simulated payload when no wallet is connected; the "ZKP" commitment is a SHA-256 hash, not a zero-knowledge proof.
- Demo state (including agent private keys) is kept in a local JSON file, `data/gateway-state.json`.

Details and status of each item: `docs/SECURITY.md`.

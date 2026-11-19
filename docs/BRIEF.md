# Brief: AccordGate — Concordium Trusted Agent Compliance Gateway

## Goal
A gateway that lets companies decide which AI agents may call their services: agents carry a Concordium-anchored identity, calls are gated by privacy-preserving checks and priced with x402 micro-payments, and every decision lands in a tamper-evident audit trail (EU AI Act angle). TODO: confirm this framing against the hackathon brief.

## Who uses or judges it
Hackathon judges (Concordium Trusted Agents). In the product story: compliance officers who govern agents, and agent developers who integrate with the gateway.

## Deadline
TODO (not set yet)

## Core user path
<!-- The one path that must work end to end. Each step becomes a slice. TODO: confirm. -->
1. Compliance officer signs in and registers an agent (DID, key, spend limits).
2. Officer sets a gate policy on an endpoint (required predicates, price, caps).
3. The agent calls the endpoint through the gateway; it is allowed, challenged for x402 payment, or blocked.
4. The decision appears in the hash-chained audit ledger; the officer anchors the ledger root on Concordium testnet; the server checks the transaction on testnet (finalized, right sender, right data) and only then links it to CCDScan.
5. Officer revokes the agent (kill switch); the next call is blocked.

## Acceptance criteria
- [ ] The app installs and builds from a clean clone
- [ ] Core path steps 1–5 work in the deployed app
- [x] Every simulated result is labelled as simulated (S3, 2026-11-18)
- [ ] TODO

## Out of scope (not doing)
- TODO

## Milestones
| Date | Milestone | Done when |
| --- | --- | --- |
| 2026-11-18 (local and CI green) | Demo builds and runs | `npm ci`, `npm run lint`, `npm run build` pass from a clean clone |
| TODO (slice `chore/deploy` in progress) | Walking skeleton deployed | App reachable at a public Render URL, CI green; state resets on sleep/redeploy (accepted) |
| 2026-11-18 (done; CI green, run 44259897748) | Server API protected | Mutating routes require a signed-in owner (SECURITY S1) |
| TODO | Feature freeze | Only bug fixes and demo prep after this date |
| TODO | Delivery | Everything in the deliverables list below is submitted |

## Deliverables
- [ ] Deployed URL
- [ ] Public repository with README
- [ ] Demo video
- [ ] Pitch / slides
- [ ] Submission form

## Open questions
- Which store is the source of truth: the server JSON file or Firestore?
- Which parts must be real on testnet for judging (anchoring, x402 settlement, credential checks), and which may stay simulated if labelled?
- Hosting platform: decided 2026-11-19, Render free web service (`render.yaml`). Open: whether judging needs state to survive restarts (then Render Starter + disk, about $7.25/month).

## Demo / delivery script
<!-- Exact steps to show it working. Run this for real before every delivery. -->
1. TODO

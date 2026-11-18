# Design: AccordGate

<!-- Keep direction, tokens, screen list and mockup links only. The existing components
     are the source of truth for details. -->

## Direction
Dense professional SaaS console (as the demo already does): flat 1px borders, tabular numbers, status badges, little decoration. TODO: confirm or change.

## Mockups
- None yet; the running demo is the reference. TODO: add a Claude Design mockup if the direction changes.

## Tokens
TODO: extract from `src/index.css` and the Tailwind classes in use.

| Token | Light | Dark |
| --- | --- | --- |
| Background | TODO | TODO |
| Text | TODO | TODO |
| Accent | TODO | TODO |
| Danger | TODO | TODO |

## Screens (tabs in `src/App.tsx`)
| Screen | Component | Step in core path | Loading | Empty | Error |
| --- | --- | --- | --- | --- | --- |
| Overview | `OverviewView.tsx` | summary | TODO | TODO | TODO |
| Agent registry | `AgentRegistryView.tsx` | 1, 5 | TODO | TODO | TODO |
| Privacy policies | `PrivacyPoliciesView.tsx` | 2 | TODO | TODO | TODO |
| Protocol sandbox | `ProtocolSandboxView.tsx` | 3 | TODO | TODO | TODO |
| Audit ledger | `AuditLedgerView.tsx` | 4 | TODO | TODO | TODO |

## Baseline
- Works at phone width (375px) without horizontal scroll.
- Keyboard reachable, visible focus, text contrast at least 4.5:1.
- Every form: inline validation, disabled submit while sending, error message the user can act on.
- Simulated results carry a visible "simulated" label.

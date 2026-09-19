# Wave 1 / Task 2 — SOLO_MID call-site inventory (read-only, taken BEFORE any edit)

Grep terms: `SOLO_MID_SIMULATOR_POLICY`, `isSoloMidSimulatorMetadata`, `humanRosterSlot`, `humanPosition`, `rosterPositions`,
`SOLO_MID_RECOMMENDATION_OUTPUT_LIMIT`, `soloMid` / `solo-mid`. Repo at `r1/product-certification` @ `ea537db` + untracked Wave 0 files.

## Covered by design.md §22 (4 files)
| File | What referenced the old policy |
|---|---|
| `apps/engine/src/simulator/solo-mid-policy.ts` | the policy constant (Radiant / Pos2 / roster slot 4 / party 1 / `rosterPositions` table), `participantForRoundSlot`, `deriveExternalDecisionSeed`, `chooseExternalSuggestion`, `isSoloMidSimulatorMetadata` |
| `apps/engine/src/server/routes/protocol-sessions.ts` | creation gate (`unsupported_simulator_policy`), `postAutoDrive`, `getRecommendations` (targetPosition / teamOpening:false / limit / `controlledRosterSlots` / `partyPreferredPositions`) |
| `apps/engine/src/server/protocol-session.ts` | `isCommandAuthorized`, `authorizedLegalActions`, `humanRosterSlot` in metadata + create input |
| `apps/engine/src/recommendation/decision.ts` | imports `rosterSlotForRoundSlot` |

## NOT covered by design.md §22 (task 2 STOP condition — documented, work proceeded under the PO's "all related call sites" instruction)
| File | Reference |
|---|---|
| `apps/engine/src/recommendation/build.ts`, `recommendation/index.ts` | `SOLO_MID_RECOMMENDATION_OUTPUT_LIMIT` (design §21 lists the rename, §22 does not) |
| `apps/engine/src/draft-protocol/validation.ts` | `humanRosterSlot` was a *required* field of the create-session body |
| `apps/engine/src/tools/solo-mid-playtest.ts` (+ `package.json` script `playtest:solo-mid`) | recovery-build judge-pack generator hard-coded to Radiant / Pos2 / slot 4 / party 1 |
| `apps/engine/src/simulator/solo-mid-policy.test.ts`, `server/routes/protocol-sessions.solo-mid.test.ts` | tests certifying the old behaviour |
| `apps/web/features/random-draft-simulator/protocol-client.ts` | `humanRosterSlot` option, `requestSoloMidAutoDrive` |
| `apps/web/features/random-draft-simulator/use-random-draft-session.ts` | `partySize:1, humanPosition:2, humanRosterSlot:4`, random hero on timer expiry |
| `apps/web/features/random-draft-simulator/components/ConfigPanel.tsx` | Radiant / Pos2 hard-coded, "fixed configuration" banner |
| `apps/web/features/random-draft-simulator/components/BlindRoundPanel.tsx` | "Tu pick Mid — 1 de 1" |
| `apps/web/features/random-draft-simulator/__tests__/use-random-draft-session.integration.test.ts` | `FakeSoloMidProtocolEngine` |
| `e2e/simulator.spec.ts`, `e2e/ap-party-sizes.spec.ts`, `e2e/copilot-intelligence.spec.ts` | Playwright specs of the Solo Mid flow |

## Left untouched on purpose (data/signal work, not simulator policy)
`signals/hero-positions.ts` (`isCandidateAdmittedForPosition`, Mid admission thresholds), `signals/position-fit.ts`, `signals/mix.ts`,
`signals/counter.ts`, meta sync/bootstrap — comments only say "Solo Mid" for the data-repair history. None enforces
Radiant / Mid / last-pick.

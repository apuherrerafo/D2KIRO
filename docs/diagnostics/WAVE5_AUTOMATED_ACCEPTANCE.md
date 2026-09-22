# Wave 5 — Automated Product Certification Report

**Result: PASS**

- Run started: 2026-09-20T23:54:27.135Z  (duration 185 s)
- Git HEAD: `6c9e5fffe8531a3f6d034af285fef911be2d09a4` (+ uncommitted working-tree changes)
- Command: `bun run test:wave5:smoke`
- Environment: headless Chromium, production web build, real engine (`index.e2e.ts`), deterministic fixture DB (50 heroes) for the browser layer; real meta snapshot (SQLite readonly) for the evidence run
- Engine/web-config/tooling preflight: 721 pass / 0 fail
- Browser scenarios: 7/7 pass
- Playwright exit code: 0
- Real-data evidence run: [wave5-certification] PASS — 600 drafts (600 complete), 3094 states, twins 345/345, separation 416/416, p95 40.73 ms → docs/diagnostics/WAVE5_AUTOMATED_EVIDENCE.md

## Browser scenarios

| Area | Scenario | Seed(s) | Coach primary action kinds (in order) | Result | Time |
|---|---|---|---|---|---|
| Complete Radiant journey (Pos2, Hero Pool, Flex assignment, deviation) | J1. RADIANT, Pos2 + Hero Pool: personal view, Coach recompute after every own pick and reveal, Own-Flex assignment, deviation, COMPLETE | WAVE5RAD | REVEAL_POSITION,REVEAL_POSITION,REVEAL_POSITION,REVEAL_POSITION,REVEAL_POSITION,REVEAL_POSITION,REVEAL_POSITION | PASS | 19.5 s |
| Complete Dire journey (Pos5, Hero Pool) | J2. DIRE, Pos5 + Hero Pool: the same product from the other side, no behaviour exclusive to Radiant | WAVE5DIR | REVEAL_POSITION,REVEAL_POSITION,REVEAL_POSITION,REVEAL_POSITION,REVEAL_POSITION | PASS | 18.1 s |
| Side symmetry | J3. side symmetry (PD-019): both journeys expose the same Coach contract, triggers and perspective rules | — | — | PASS | 0.0 s |
| Hidden information (real HTTP path) | H. identical Coach output on every surface before the reveal (incl. personal view, beliefs, availability, provenance); a legal divergence after it | TWINSEED | — | PASS | 0.4 s |
| Collision #1 | C1. collision #1: the shared hero is banned, both sides re-select, the round does not advance until they have | COLLIDE1 | — | PASS | 0.1 s |
| Collision #3 (authority) | C3-bot. collision #3 (two prior collisions in the round): WAITING_FOR_COLLISION_AUTHORITY, the Enemy Bot registered first and keeps the hero | COLLIDE3B | — | PASS | 0.3 s |
| Collision #3 (authority) | C3-player. collision #3 (two prior collisions in the round): WAITING_FOR_COLLISION_AUTHORITY, the Player registered first and keeps the hero | COLLIDE3P | — | PASS | 0.2 s |

## UX observations recorded by the browser run (not failures — see WAVE5_PRODUCT_CERTIFICATION.md)

- ux-flex-row-before-assignment: Tu equipo: Kunkka · FLEX 3/2 Asignar Pos3 Asignar Pos2
- ux-flex-row-after-assignment: Tu equipo: Kunkka · Asignado a Pos2 Quitar asignación

## Failures

None.

## Scope

Certifies the PRODUCT PATH end to end (browser → /engine proxy → perspective-safe route → Coach → real V6 → DOM) and the invariants the MVP is sold on. It does **not** judge whether the advice is good Dota — that is the independent Dota Judge review (`docs/diagnostics/WAVE5_DOTA_JUDGE.*`). Task 26 (side context) and Task 27 (one-ply) are intentionally deferred from the MVP.

## What still needs a human

A short visual check only (layout/legibility of the Coach panel: primary action, team shortlist, personal `TU … AHORA` view, Flex row and Safe Core block next to the round panel) and the Product Owner sign-off tasks 35/36 of tasks.md.

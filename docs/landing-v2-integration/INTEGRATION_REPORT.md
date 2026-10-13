# Landing V2 integration — report

Route `/lab/landing-v2` · branch `lab/landing-v2-integration` · base `6fc9cc2` · frozen in one local commit, not pushed, merged or deployed. Production `/` is Landing 01B, untouched.

## FINAL STATE — Landing V2 product direction: LOCKED
Hero, Memory, Counterfactual, Proposition and CTA are not to be redesigned.

- **Coach**: pre-rendered sprites (desktop + mobile); Three.js removed from the Landing V2 runtime.
- **Weight**: desktop initial ~4.33 MB (was 12.92 MB); mobile ~4.34 MB; JS ~0.80 MB (was 1.63 MB).
- **Runtime**: 0 long tasks (was 43); near-zero CLS.
- **Memory scroll coupling**: fixed. Calm scrolling preserves the full choreography; Match 24 stays the expressive peak.
- **Exit guarantee**: verified. The Final state is reached before Memory leaves the viewport, and "Now use it." never overtakes an unfinished Memory state. Scrolling is never trapped.

### Accepted Memory trade-off
Fast/skimming users may skip intermediate Match 24 animation. Normal reading preserves it. The Final state is always guaranteed before the Memory→Counterfactual seam.

### Promotion gates (OPEN — not blockers to the design lock, not fixed here)
1. Dota/content sign-off
2. Real iPhone smoke
3. Mobile Nav decision / show-through
4. Hero Draft 2 vocabulary cleanup: "Few games" / "In your pool"
5. Known Memory label collisions: desktop "Heroes you return to"; mobile "You · Mid"
6. Production routing
7. Waitlist production behaviour
8. Staging smoke
9. Production promotion

Heavy evidence (screenshots, videos, coupling frame dumps) is intentionally not committed; regenerate with `e2e-landing-v2/`.

## Unresolved production claims (DOTA sign-off, never shown in the UI)
Carried forward, not solved here:
- **Hero `DOTA_SIGNOFF`** (`features/landing-v2/story/scenarios.ts`): every `signoff: true` step — matchup deltas (Axe, Slark, Viper, Pangolier, Drow, Night Stalker, Spectre, Medusa), supports synergy, base FIT per candidate, role assumptions.
- **Counterfactual `CF_SIGNOFF`** (`features/counterfactual-lab/scenario.ts`): Pos 2 Mid shortlist (Queen of Pain / Void Spirit / Puck), generic signals ("Holds vs Slark", "Weaker vs Slark", "Pairs with the supports"), personal weights (+6 / −1 / 0) and the qualitative phrases are placeholders for a model that is not defined.
- **Memory fixtures**: "Pos 4 can rotate mid" is a lab hypothesis. Hero relations in the graph (Storm Spirit, Ember Spirit, Queen of Pain, Viper) are illustrative. `Match 01/08/24/56` are story indices, not claimed game counts; the section is labelled "Illustrative fixtures".
- **Proposition**: draft B's "Faceless Void FIT 84, draft read only" is a Hero fixture value.
- **FIT** is a recommendation score everywhere; the page says "not a win rate". No win rate, MMR, match count or percentage is rendered (asserted by test).

## Open product items found in integration
1. Memory graph previously labelled the `void` node "Void Spirit" while the Counterfactual says Void Spirit has "No history yet". Label-only change to "Ember Spirit" (ids, physics unchanged); covered by `content.test.ts`.
2. Global app NavBar is 85 px tall and 668 px wide on a phone (horizontal page scroll). Contained for this route only in `landing-v2.css`; production `/` already hides it for visitors. Needs a decision when V2 is promoted.
3. Hero keeps its locked "hold the clock until every portrait of the 3 drafts settles" preloading; it is not deferred to idle.
4. Counterfactual still imports the Hero Coach component and `CoachCue` type (a shared Coach, by design).
5. Headless WebKit on Windows renders Syne headings with odd tracking; verify on a real iPhone.

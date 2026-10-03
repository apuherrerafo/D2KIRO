# D2KIRO — Design Intent (UX-0 Foundation)

This document encodes human architectural and product intent that tokens, types, and stories cannot express on their own. It guides future implementation agents when constructing or evaluating UI components.

## Core Principles

1. **Decision Support, Not a Generic Dashboard**: D2KIRO exists to help players make high-stakes draft decisions under strict time pressure. Every pixel and interaction must serve the immediate decision.
2. **Decision Latency > Decorative Density**: Speed of cognitive comprehension trumps visual complexity. If an element does not reduce the time needed to evaluate a pick, it is visual debt.
3. **Exactly One Canonical Recommendation Dominates**: The current recommended action must visually command the screen. Multiple competing "primary" visual calls to action confuse the player.
4. **Recommendation is Advisory, Never Mandatory**: The human player retains full agency. Recommendations advise; legality is authoritative. Any legal hero and any controlled position remains selectable at all times.
5. **Primary Emphasis Must Remain Scarce**: If everything looks important, nothing is. High-contrast accent surfaces (`BUTTON_PRIMARY`, primary badges) must be rationed strictly.
6. **Semantic Status Colors Communicate State, Not Decoration**: Green, red, and amber communicate operational and game status (positive, negative, warning), never ambient aesthetic flair.
7. **Not Every Information Group Deserves a Card/Container**: Avoid "card soup". Layout structure, typographic hierarchy, and whitespace organize content before adding borders and background containers.
8. **Avoid Decorative Analytics**: Do not render charts, meters, or counters unless they directly alter the current draft decision.
9. **Avoid Badge and Pill Proliferation**: Tags, pills, and badges must be purposeful. Do not decorate entities with redundant metadata chips.
10. **Avoid Generic SaaS / AI-Generated Composition**: Do not use placeholder generic patterns (e.g., standard marketing hero sections, arbitrary shadow cards, pastel glassmorphism). Respect the focused gaming utility context.
11. **Hierarchy Before Ornament**: Structure information logically (Heading -> Dominant Decision -> Secondary Context -> Supporting Metadata). Visual embellishments must never obscure hierarchy.
12. **Reuse Existing Components Before Creating New Ones**: Check the component catalog (`COMPONENTS.generated.json`) before introducing any new primitive or variant. Avoid duplicate button or notice implementations.
13. **Accessibility is Core Behavior, Not Post-Processing**: Focus-visible outlines, keyboard activation (Enter/Space), semantic ARIA structure, color contrast, and `prefers-reduced-motion` are integral requirements of the component contract from Day 1.

---

## Areas Requiring Human Decision (Do NOT Assume or Invent)

The following areas are intentionally NOT decided in UX-0 and must remain unchanged until explicit human direction:

- **Final Brand Personality**: `HUMAN_DECISION_REQUIRED`
- **Final Color Palette**: `HUMAN_DECISION_REQUIRED`
- **Final Typography Personality**: `HUMAN_DECISION_REQUIRED`
- **Dota / Esports HUD Styling**: `HUMAN_DECISION_REQUIRED`
- **Visual Direction (e.g., Radiant/Dire theming, glass, decorative gradients)**: `HUMAN_DECISION_REQUIRED`

UX-0 establishes only the technical foundation, tokens, initial primitives, and enforcement gates. It introduces ZERO intentional product visual change.

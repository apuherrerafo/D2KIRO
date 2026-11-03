/* DS V1.1 · Canonical primitive registry — provenance + governance in one place.
   Rendered by Master sections A (Provenance) and Q (Governance) and locked by CanonicalMaster.test.tsx.
   STATUS: H = explicit Julio decision (quoted from a brief) · D = recovered / derived from an existing
   study · NEW = genuinely new (minimised; every NEW is flagged on the board).
   Rule for consumers (Landing, product): if a primitive exists here, IMPORT / COMPOSE it. Never re-draw
   its skin locally. If what you need is not here: NEEDS DESIGN DECISION — not "make something similar". */

export type ProvenanceStatus = "H" | "D" | "NEW";

export type CanonicalPrimitive = {
  /** Allowed interaction variants (states). */
  interaction: string;
  interactionStatus: ProvenanceStatus;
  /** Where to import it from (relative to apps/web/design/). */
  importFrom: string;
  forbidden: string;
  id: string;
  /** Human evidence for the skin, quoted or referenced. "—" when none exists. */
  human: string;
  motion: string;
  name: string;
  /** Exact originating study / component / story. */
  source: string;
  status: ProvenanceStatus;
  tokens: string;
  visual: string;
};

export const PRIMITIVES: CanonicalPrimitive[] = [
  {
    id: "action-primary",
    name: "ActionPrimary",
    importFrom: "canonical/primitives · ActionPrimary",
    source: "R3A Spectral Action, Typography C (round-3a-labs.css:156-173 · story round-3a-typography-spectral--spectral-action)",
    status: "D",
    human: "Julio commissioned it (3A brief Part 2 'Primary button: Analizar draft'); never named a winner. V1.1: current cut 'differs from what I selected'. LOCKED: Primary = Candidate A, 8 px radius preserved.",
    tokens: "--r3-spec-fill · --r3-on-spec · --cx-action-radius/height/cut · --m-instant · --m-medium · --m-spring-snappy",
    visual: "geometry round, 8 px (locked; the cut belongs to rejected B) · one per view",
    interaction: "rest · hover (slide) · focus (ring+brackets+node) · contact/pressed (spectrum condenses, corner closes, label settles) · release (spring) · keyboard commit · busy · success · disabled (spectrum drains)",
    interactionStatus: "NEW",
    motion: "contact 80 ms out · release snappy spring 281 ms · hover 280 ms · busy bar loops only while aria-busy",
    forbidden: "new radius/height/clip outside --cx-action-*, own focus ring, hover lift, glow, scale(.97), a second gradient, two Primaries in one view",
  },
  {
    id: "action-secondary",
    name: "ActionSecondary",
    importFrom: "canonical/primitives · ActionSecondary (wraps round-3b SkinControl skin B)",
    source: "R3B ICON_SKIN_B — corner brackets + micro-index (round-3b-labs.css:248-266 · story round-3b-hybrid-motion-skin--semantic-icon-reskin)",
    status: "D",
    human: "— (only 3B anti-generic PASS, self-assessed)",
    tokens: "--r3-line-strong · --r3-ink · spectral stops on contact",
    visual: "brackets, optional micro-index, glyph + visible label",
    interaction: "rest (2 ticks) · hover/focus (4 ink brackets) · contact (brackets turn spectral + contract 1.5 px) · disabled (dotted)",
    interactionStatus: "D",
    motion: "brackets: snappy spring · glyph verb plays once",
    forbidden: "wrapping it in a box, a fill, an icon without its label",
  },
  {
    id: "action-quiet",
    name: "ActionQuiet",
    importFrom: "canonical/primitives · ActionQuiet",
    source: "R3B `.r3b-quiet` (round-3b-labs.css:207-212); contact trace from Skin A (round-3b-labs.css:232-245)",
    status: "D",
    human: "—",
    tokens: "--r3-ink · --r3-line-strong · --r3-spec-fill · --r3-spec-cyan",
    visual: "text + 1 px rule · optional glyph · selected = 1.5 px cyan rule",
    interaction: "hover (rule darkens) · focus (canonical) · contact (spectral rule draws) · selected · disabled",
    interactionStatus: "D",
    motion: "rule colour 160 ms · trace 280 ms",
    forbidden: "filled background, pill, border box",
  },
  {
    id: "glass",
    name: "Glass",
    importFrom: "canonical/primitives · Glass level=\"b\"",
    source: "R3B material ladder (round-3b-labs.css:8-38) → V1.1 level B anchored on R2 smoke (round-2-labs.css glass)",
    status: "NEW",
    human: "H: 'medium-protagonist glass' (3B brief); 'a little more glass presence' (V1.1). Values are the council's.",
    tokens: "--cx-glass-tint/hi/line/spec/reflect/shade/shadow/blur/sat · --cx-ghost",
    visual: "level b (canonical) · level b + edge (L4) · level a / c only as comparison specimens",
    interaction: "none on the material itself; Level 4 edge only while active / selected / read",
    interactionStatus: "D",
    motion: "blur is never animated · edge sweep once",
    forbidden: "glass on dense rows, on every card, over a hero portrait; blur outside --cx-glass-blur*; a fourth recipe",
  },
  {
    id: "surface",
    name: "Surface levels L0–L4",
    importFrom: "canonical.css .cx-lvl[data-level]",
    source: "R3B material ladder (field · solid · glass · glass+edge); L1 unboxed is V1.1",
    status: "D",
    human: "H on the hierarchy idea (Round 2 brief: base → solid → glass → elevated → live); L1 unboxed = council (CONTESTED).",
    tokens: "--r3-bg · --r3-raise · --r3-line · --cx-glass-*",
    visual: "L0 field · L1 rule + type, no fill · L2 raise + ring + ticks · L3 glass B · L4 glass B + spectral edge",
    interaction: "—",
    interactionStatus: "D",
    motion: "—",
    forbidden: "backdrop-filter below L3 (sticky toolbars excepted), luminance-only steps",
  },
  {
    id: "metric",
    name: "Metric",
    importFrom: "canonical/primitives · Metric",
    source: "R3B live value / compact data module value; type role V1.1 (Council B face-off, option A)",
    status: "D",
    human: "H: Julio circled the terminal meta string as wrong; 'do NOT assume DATA = MONO' (V1.1 brief).",
    tokens: "--f-plex (operational) · --f-syne + tnum (expressive ≥ 48 px)",
    visual: "operational | expressive · value → muted written label",
    interaction: "inspect on hover/tap (data intent class)",
    interactionStatus: "D",
    motion: "settle spring only (0 % overshoot) · 2 px lean + ghost of previous value",
    forbidden: "Plex Mono numbers, Pixelify digits, terminal notation (n=, edge.NN, conf.)",
  },
  {
    id: "delta",
    name: "Delta · RankMove",
    importFrom: "canonical/primitives · Delta, RankMove",
    source: "R3B trailing delta cell (round-3b-labs.css:298); rank badge from R3A MOTION_07 (motion-lab.tsx:499)",
    status: "D",
    human: "—",
    tokens: "--r3-up · --r3-down · --r3-muted",
    visual: "signed value in a trailing cell · drawn rank mark (NEW) only for rank movement",
    interaction: "—",
    interactionStatus: "D",
    motion: "lean 2 px, settle; never rolling digits",
    forbidden: "triangle font glyphs, pill / chip deltas, tinted fills, a delta next to spectral lime",
  },
  {
    id: "perimeter",
    name: "PerimeterFrame",
    importFrom: "round-3a/perimeter-frame · PerimeterFrame",
    source: "R3A MOTION_08 engine + R3B corners rest (perimeter-frame.tsx)",
    status: "D",
    human: "H: 'Julio likes the active perimeter/stroke concept' — but denser (3A brief).",
    tokens: "--r3-spec-fill · --r3-line-strong",
    visual: "rest = 4 corner ticks · selected = 62 % spectral segment on the edge that matters",
    interaction: "selected travels the shortest way, flashes once, rests · default source never gets the segment",
    interactionStatus: "D",
    motion: "segment: snappy spring · flash 460 ms once",
    forbidden: "permanent orbit, conic spinner, glow, segment on the deterministic default",
  },
  {
    id: "live-state",
    name: "LiveModule (live state / Coach attention)",
    importFrom: "round-3b/hybrid-lab · LiveModule (glass=\"b\", meta=…)",
    source: "R3B LIVE_STATE_SKIN (hybrid-lab.tsx:260) · MOTION_05",
    status: "D",
    human: "H: 3A motion grammar 'accepted for continuation'.",
    tokens: "--cx-glass-* · --r3-spec-fill-v (cue)",
    visual: "hanging notch · value · written label · trailing delta · cue",
    interaction: "live pulse once · attention sweep once · default stays neutral",
    interactionStatus: "D",
    motion: "pulse 700 ms once · sweep 620 ms once",
    forbidden: "infinite pulse, glow on the default option, terminal meta",
  },
  {
    id: "recommendation-call",
    name: "CompactModule (recommendation call)",
    importFrom: "round-3b/hybrid-lab · CompactModule (action=<ActionPrimary/>, meta=…)",
    source: "R3B COMPACT_DATA_MODULE (hybrid-lab.tsx:459)",
    status: "D",
    human: "—",
    tokens: "--cx-glass-* · PerimeterFrame",
    visual: "index outside · notch · title (Syne) · body · metric · actions",
    interaction: "focus routes the segment · Primary commits",
    interactionStatus: "D",
    motion: "segment travel once · confirm glyph draws once",
    forbidden: "a second Primary inside, terminal meta",
  },
  {
    id: "glyphs",
    name: "D2Icon (product glyphs)",
    importFrom: "round-3b/icons · D2Icon",
    source: "R3B Custom Iconography (icons.tsx) — 16 grid, 1.5 stroke, 45° cuts, 2×2 nodes",
    status: "D",
    human: "H on the system: 'YES, create custom iconography' (3B brief). The six glyphs themselves are unreviewed (D).",
    tokens: "--d2i-accent",
    visual: "inspect · live · confirm · signal · shift · attention · always with a visible label",
    interaction: "one finite verb per glyph, on hover = focus",
    interactionStatus: "D",
    motion: "verb ≤ 640 ms, then rest",
    forbidden: "stock / Lucide icons as brand, emoji, icon-only controls",
  },
  {
    id: "focus",
    name: "Focus form (FocusMarks)",
    importFrom: "canonical/primitives · FocusMarks + .cx-focusable",
    source: "ring: audit 'focus solid 2 px'; brackets: R3B Skin B (round-3b-labs.css:251-256); node: V1.1",
    status: "D",
    human: "—",
    tokens: "--r3-focus · --r3-spec-cyan",
    visual: "2 px ink ring at 3 px, outside, never clipped + 4 brackets + 4 px cyan node",
    interaction: "keyboard only (:focus-visible) — never on hover, never on selected",
    interactionStatus: "NEW",
    motion: "brackets snap in 160 ms; reduced = appear in place",
    forbidden: "per-component offsets, inset rings, rings clipped by clip-path",
  },
  {
    id: "state-grammar",
    name: "StateTarget (state grammar)",
    importFrom: "canonical/primitives · StateTarget",
    source: "PerimeterFrame ticks + segment (R3A/3B) · LiveModule cue (3B) · notch (3B) · busy track (R3A) · glyph verbs (3B)",
    status: "D",
    human: "H: hover / focus / selected / active / recommended / confirmed / processing / success / warning / uncertain / disabled must look and behave differently (V1.1 brief).",
    tokens: "--r3-spec-fill(-v) · --r3-ink · --r3-neutral · --r3-line-strong",
    visual: "one channel per state; spectral only on selected, active, recommended",
    interaction: "11 states + rest",
    interactionStatus: "NEW",
    motion: "segment snappy · cue 280 ms · track loops only while aria-busy",
    forbidden: "tinted-fill selected, a second hue for selected, glow, pulses",
  },
  {
    id: "hero-media",
    name: "HeroPortrait · HeroIcon · HeroDraftSlot",
    importFrom: "canonical/hero-media",
    source: "canonical/hero-media (real Valve CDN portraits, allow-listed host) · V1.1 skin",
    status: "H",
    human: "H: 'recognizable Dota hero portraits … not abstract glyphs' (Landing correction brief).",
    tokens: "--r3-* · --cx-attr-*",
    visual: "portrait dominant · name in sentence case · attribute rail",
    interaction: "available · hover (ink brackets outside) · focus · selected (bottom segment) · recommended (notch + edge + one acquire) · banned · unknown · confirmed (closed ink perimeter, no lock glyph)",
    interactionStatus: "NEW",
    motion: "acquire once 460 ms · no pulse",
    forbidden: "overlays / glass / glow on the art, uppercase names, amber / emerald / violet states, infinite pulse",
  },
  {
    id: "pixel",
    name: "Pixel accent",
    importFrom: "canonical.css .dsc-px*",
    source: "R3A PIXEL_LOW (story round-3a-typography-spectral--pixel-data-intensity)",
    status: "H",
    human: "H: pixel low use only; never critical numbers ('62% read like 68%', 3B brief).",
    tokens: "--f-pixel",
    visual: "letters in micro badges · nodes · texture · resolving state",
    interaction: "—",
    interactionStatus: "D",
    motion: "stepped easing, resolve once",
    forbidden: "digits, body, CTA, headings",
  },
];

export function primitiveCounts(primitives: CanonicalPrimitive[] = PRIMITIVES) {
  const counts: Record<ProvenanceStatus, number> = { H: 0, D: 0, NEW: 0 };
  for (const primitive of primitives) counts[primitive.status] += 1;
  return counts;
}

/**
 * Landing V2 Memory - fixture data ONLY.
 *
 * Everything here is illustrative. No statistics, no win rates, no model claims.
 * The "Pos 4 can rotate mid" condition is a lab hypothesis, not production truth.
 */

import type { LayoutId, LinkDef, NodeDef, NodeId, RegionDef, SceneDef, Vec } from './types';

export const SEED = 24;

export const LAYOUTS: Record<LayoutId, { w: number; h: number; scale: number }> = {
  wide: { w: 1000, h: 620, scale: 1 },
  narrow: { w: 400, h: 540, scale: 0.7 },
};

/** Coach reading position (viewBox px), at the EDGE of the graph, never in it. */
export const COACH_POS: Record<LayoutId, Vec> = {
  wide: [900, 540],
  narrow: [336, 470],
};
/** Sprite Coach width in viewBox units (~104-128 px on screen: the wide viewBox renders ~1.1x, the phone one ~0.98x). */
export const COACH_SPRITE_WIDTH: Record<LayoutId, number> = { wide: 100, narrow: 112 };

/**
 * Wide is authored by hand. Narrow is the same composition transposed (the long axis of the
 * graph becomes vertical) so the topology - and every scene - reads identically on a phone.
 */
export function mapPoint(layout: LayoutId, p: Vec): Vec {
  if (layout === 'wide') return p;
  return [54 + (p[1] - 150) * 0.8, 56 + (p[0] - 190) * 0.62];
}

export const NODES: NodeDef[] = [
  { id: 'you', label: 'You · Mid', kind: 'you', tone: 'lime', r: 13, mass: 2.6, charge: 1.4, dir: 'b', dirNarrow: 'r' },
  { id: 'puck', label: 'Puck', kind: 'hero', tone: 'cyan', r: 9, mass: 1.2, charge: 1.3, dir: 't', dirNarrow: 'r' },
  { id: 'm01', label: 'Match 01', kind: 'match', tone: 'cyan', r: 5.5, mass: 0.6, charge: 0.6, dir: 'r', dirNarrow: 'r' },
  { id: 'm08', label: 'Match 08', kind: 'match', tone: 'cyan', r: 5.5, mass: 0.6, charge: 0.6, dir: 'r', dirNarrow: 'r' },
  { id: 'storm', label: 'Storm Spirit', kind: 'hero', tone: 'cyan', r: 8, mass: 1, charge: 1, dir: 'l', dirNarrow: 't' },
  /* Label only (id and physics unchanged): the Counterfactual says Void Spirit has "No history yet" for this player, so the
     graph must not show it as a hero they return to. Same family, no claim about this player. */
  { id: 'void', label: 'Ember Spirit', kind: 'hero', tone: 'cyan', r: 8, mass: 1, charge: 1, dir: 'r', dirNarrow: 'b' },
  { id: 'qop', label: 'Queen of Pain', kind: 'hero', tone: 'cyan', r: 8, mass: 1, charge: 1, dir: 'l', dirNarrow: 'r' },
  { id: 'viper', label: 'Viper', kind: 'hero', tone: 'pink', r: 9, mass: 1.3, charge: 1.5, dir: 'r', dirNarrow: 'l' },
  { id: 'm24', label: 'Match 24', kind: 'match', tone: 'pink', r: 6, mass: 0.7, charge: 0.7, dir: 'r', dirNarrow: 'r' },
  { id: 'condition', label: 'Pos 4 can rotate mid', kind: 'condition', tone: 'pink', r: 7, mass: 0.9, charge: 0.9, dir: 'b', dirNarrow: 'l' },
  { id: 'lane', label: 'Lane context', kind: 'concept', tone: 'cyan', r: 7, mass: 1, charge: 1, dir: 'r', dirNarrow: 'b' },
  { id: 'm56', label: 'Match 56', kind: 'match', tone: 'cyan', r: 5.5, mass: 0.6, charge: 0.6, dir: 'r', dirNarrow: 'l' },
  { id: 'open', label: 'Not yet known', kind: 'open', tone: 'neutral', r: 15, mass: 1, charge: 0.8, dir: 'b', dirNarrow: 'b' },
];

export const NODE_BY_ID = Object.fromEntries(NODES.map((n) => [n.id, n])) as Record<NodeId, NodeDef>;

export const LINKS: LinkDef[] = [
  { id: 'you-puck', a: 'you', b: 'puck', tone: 'cyan', weight: 0.8, k: 14 },
  { id: 'm01-puck', a: 'm01', b: 'puck', tone: 'cyan', weight: 1, k: 14 },
  { id: 'm08-puck', a: 'm08', b: 'puck', tone: 'cyan', weight: 1, k: 14 },
  { id: 'storm-puck', a: 'storm', b: 'puck', tone: 'cyan', weight: 0.9, k: 14 },
  { id: 'void-puck', a: 'void', b: 'puck', tone: 'cyan', weight: 0.9, k: 14 },
  { id: 'storm-void', a: 'storm', b: 'void', tone: 'cyan', weight: 0.45, k: 8 },
  { id: 'm24-viper', a: 'm24', b: 'viper', tone: 'pink', weight: 1, k: 14 },
  { id: 'cond-viper', a: 'condition', b: 'viper', tone: 'pink', weight: 1, k: 14 },
  { id: 'cond-you', a: 'condition', b: 'you', tone: 'lime', weight: 1, k: 12 },
  { id: 'qop-puck', a: 'qop', b: 'puck', tone: 'cyan', weight: 0.8, k: 12 },
  { id: 'lane-you', a: 'lane', b: 'you', tone: 'cyan', weight: 0.8, k: 12 },
  { id: 'm56-lane', a: 'm56', b: 'lane', tone: 'cyan', weight: 1, k: 14 },
  { id: 'lane-cond', a: 'lane', b: 'condition', tone: 'lime', weight: 0.7, k: 10 },
  { id: 'qop-storm', a: 'qop', b: 'storm', tone: 'cyan', weight: 0.45, k: 8 },
];

export const REGIONS: RegionDef[] = [
  { id: 'heroes', caption: 'heroes you return to', members: ['puck', 'storm', 'void', 'qop', 'm01', 'm08'], tone: 'cyan', capDy: -46 },
  { id: 'play', caption: 'where you play', members: ['you'], tone: 'lime', capDy: 6, capDx: -112, narrow: { dx: 46, dy: -28 } },
  { id: 'lanes', caption: 'how lanes go', members: ['lane', 'm56'], tone: 'cyan', capDy: 52, capDx: 0, narrow: 'hidden' },
  { id: 'exceptions', caption: 'exceptions', members: ['viper', 'condition', 'm24'], tone: 'pink', capDy: -48, narrow: { dx: -52, dy: -30 } },
  { id: 'open', caption: 'open', members: ['open'], tone: 'neutral', dashed: true, capDy: -46 },
];

/** Scene order is the story: MATCH 01 -> 08 -> 24 -> 56 -> WHAT IT KNOWS ABOUT YOU. */
export const SCENES: SceneDef[] = [
  {
    id: 'm01',
    tab: 'Match 01',
    eyebrow: 'MATCH 01',
    headline: 'One game of Puck.',
    line: 'Remembered, not concluded.',
    anchors: { you: [290, 350], puck: [480, 350], m01: [600, 268] },
    timed: [
      { at: 0, kind: 'coach', state: 'watching', focus: [] },
      { at: 0, kind: 'spawn', ids: ['you', 'puck'], from: { you: { p: [250, 360] }, puck: { p: [450, 348] } } },
      { at: 150, kind: 'tether', links: ['you-puck'] },
      { at: 700, kind: 'spawn', ids: ['m01'], from: { m01: { near: 'puck', dist: 70 } }, speed: 40 },
      { at: 780, kind: 'tether', links: ['m01-puck'] },
    ],
    afterSettle: [],
    layers: { soft: 0, crisp: 0, caption: 0, ghost: 0 },
    restCoach: { state: 'watching', focus: [] },
  },
  {
    id: 'm08',
    tab: 'Match 08',
    eyebrow: 'MATCH 08',
    headline: 'Puck again.',
    line: 'Looks like a comfort pick. Not proven yet.',
    anchors: { puck: [500, 345], m01: [605, 262], m08: [610, 430], storm: [420, 232], void: [430, 462] },
    timed: [
      { at: 0, kind: 'coach', state: 'watching', focus: [] },
      { at: 300, kind: 'spawn', ids: ['m08'], from: { m08: { p: [950, 480] } }, speed: 380 },
      { at: 330, kind: 'tether', links: ['m08-puck'] },
      { at: 330, kind: 'reheat', amount: 0.55 },
      { at: 520, kind: 'coach', state: 'analyzing', focus: ['m08', 'puck'] },
      { at: 900, kind: 'spawn', ids: ['storm', 'void'], from: { storm: { p: [420, -40] }, void: { p: [430, 680] } }, speed: 260 },
      { at: 940, kind: 'tether', links: ['storm-puck', 'void-puck'] },
      { at: 1500, kind: 'tether', links: ['storm-void'] },
      { at: 1500, kind: 'coach', state: 'analyzing', focus: ['puck', 'storm', 'void'] },
    ],
    afterSettle: [{ at: 700, kind: 'coach', state: 'watching', focus: [] }],
    layers: { soft: 0, crisp: 0, caption: 0, ghost: 0 },
    restCoach: { state: 'analyzing', focus: ['puck', 'storm', 'void'] },
  },
  {
    id: 'm24',
    tab: 'Match 24',
    eyebrow: 'MATCH 24',
    headline: 'Then Viper changes the picture.',
    line: 'The same evidence is still here. It is just read differently.',
    anchors: {
      you: [290, 400],
      puck: [440, 235],
      storm: [330, 170],
      void: [545, 160],
      m01: [575, 255],
      m08: [345, 285],
      viper: [775, 405],
      m24: [700, 495],
      condition: [530, 415],
    },
    timed: [
      { at: 0, kind: 'coach', state: 'watching', focus: [] },
      // Viper enters from OUTSIDE the graph, aimed at the Puck cluster (entry anchor, not its final place).
      {
        at: 400,
        kind: 'spawn',
        ids: ['viper', 'm24'],
        from: { viper: { p: [1090, 440] }, m24: { p: [1120, 520] } },
        speed: 700,
        k: 70,
        anchor: { viper: [655, 440], m24: [720, 520] },
      },
      { at: 430, kind: 'tether', links: ['m24-viper'] },
      { at: 430, kind: 'reheat', amount: 0.6 },
      { at: 640, kind: 'coach', state: 'analyzing', focus: ['viper', 'puck'] },
      // Remember what the system looked like before it lost its balance.
      { at: 700, kind: 'ghost', links: ['you-puck', 'storm-puck', 'void-puck', 'm08-puck', 'm01-puck'] },
      // REPEL - reserved for contradiction. Puck takes most of it; the cluster tears apart.
      {
        at: 760,
        kind: 'repel',
        from: 'viper',
        targets: [
          ['puck', 4.6],
          ['m08', 0.5],
          ['void', 0.35],
          ['m01', 0.2],
          ['storm', 0.15],
          ['you', 0.05],
        ],
        strength: 7800,
        radius: 360,
        duration: 1100,
      },
      { at: 760, kind: 'loosen', ids: ['puck'], k: 3, duration: 2300 },
      { at: 760, kind: 'loosen', ids: ['m08', 'void', 'm01', 'storm'], k: 24, duration: 2300 },
      { at: 760, kind: 'slack', factor: 0.5, duration: 2000 },
      { at: 760, kind: 'reheat', amount: 1 },
      // The CONDITION enters and is tethered - this is what restores the structure.
      { at: 2500, kind: 'spawn', ids: ['condition'], from: { condition: { p: [700, 372] } }, speed: 90 },
      { at: 2560, kind: 'tether', links: ['cond-viper'] },
      { at: 2560, kind: 'coach', state: 'analyzing', focus: ['condition', 'viper', 'you'] },
      { at: 2900, kind: 'tether', links: ['cond-you'] },
      { at: 2900, kind: 'reheat', amount: 0.75 },
      // Base Form RECONSTRUCT: the Coach re-reads the picture once the condition has landed. Same state, same focus.
      { at: 3000, kind: 'coach', state: 'analyzing', focus: ['condition', 'viper', 'you'], reconstruct: true },
      { at: 3250, kind: 'rebalance' },
    ],
    afterSettle: [
      { at: 300, kind: 'tone', id: 'condition', tone: 'lime' },
      { at: 350, kind: 'coach', state: 'confirming', focus: ['condition', 'you'] },
    ],
    layers: { soft: 0, crisp: 0, caption: 0, ghost: 0.12 },
    ghostLive: 0.55,
    restCoach: { state: 'confirming', focus: ['condition', 'you'] },
  },
  {
    id: 'm56',
    tab: 'Match 56',
    eyebrow: 'MATCH 56',
    headline: 'Enough games to read you.',
    line: 'Not enough to be sure.',
    anchors: {
      you: [230, 430],
      puck: [330, 235],
      storm: [225, 172],
      void: [440, 165],
      qop: [205, 290],
      m01: [425, 285],
      m08: [320, 340],
      lane: [430, 470],
      m56: [545, 520],
      condition: [620, 395],
      viper: [790, 350],
      m24: [770, 460],
      open: [780, 185],
    },
    timed: [
      { at: 0, kind: 'coach', state: 'watching', focus: [] },
      { at: 0, kind: 'rebalance' },
      { at: 0, kind: 'reheat', amount: 0.5 },
      {
        at: 150,
        kind: 'spawn',
        ids: ['qop', 'lane', 'm56', 'open'],
        from: { qop: { p: [-40, 300] }, lane: { p: [430, 690] }, m56: { p: [560, 700] }, open: { p: [800, -50] } },
        speed: 240,
      },
      { at: 600, kind: 'tone', id: 'condition', tone: 'lime' },
      { at: 700, kind: 'tether', links: ['qop-puck', 'lane-you'] },
      { at: 950, kind: 'tether', links: ['m56-lane'] },
    ],
    afterSettle: [{ at: 700, kind: 'coach', state: 'confirming', focus: ['you'] }],
    layers: { soft: 1, crisp: 0, caption: 1, ghost: 0.09 },
    ghostLive: 0.14,
    restCoach: { state: 'confirming', focus: ['you'] },
  },
  {
    id: 'final',
    tab: 'What it knows',
    eyebrow: 'SO FAR',
    headline: 'What it knows about you',
    line: 'Not a verdict. The shape your games take.',
    anchors: {
      you: [430, 370],
      puck: [335, 255],
      storm: [235, 200],
      void: [425, 165],
      qop: [215, 300],
      m01: [430, 255],
      m08: [310, 335],
      lane: [425, 480],
      m56: [520, 520],
      condition: [595, 370],
      viper: [735, 335],
      m24: [740, 440],
      open: [790, 185],
    },
    timed: [
      { at: 0, kind: 'coach', state: 'watching', focus: [] },
      // Same nodes, new topology: each cluster glides to its final anchors in turn (little heat, so
      // trajectories stay readable), leaving a thin trail from where every node started.
      { at: 0, kind: 'rebalance', ids: ['puck', 'storm', 'void', 'qop', 'm01', 'm08'] },
      { at: 180, kind: 'rebalance', ids: ['you', 'lane', 'm56'] },
      { at: 360, kind: 'rebalance', ids: ['condition', 'viper', 'm24', 'open'] },
      { at: 0, kind: 'reheat', amount: 0.12 },
      { at: 900, kind: 'tether', links: ['lane-cond', 'qop-storm'] },
    ],
    afterSettle: [{ at: 500, kind: 'coach', state: 'confirming', focus: ['you'] }],
    layers: { soft: 0.35, crisp: 1, caption: 0.75, ghost: 0 },
    transfer: true,
    restCoach: { state: 'confirming', focus: ['you'] },
  },
];

export function anchorsFor(layout: LayoutId, sceneIdx: number): Record<NodeId, Vec> {
  const out = {} as Record<NodeId, Vec>;
  for (let i = 0; i <= sceneIdx; i++) {
    const a = SCENES[i].anchors;
    for (const id of Object.keys(a) as NodeId[]) {
      const p = a[id];
      if (p) out[id] = mapPoint(layout, p);
    }
  }
  return out;
}

/** First scene in which each node exists. Used by the reduced-motion composition. */
export function nodeFirstScene(id: NodeId): number {
  for (let i = 0; i < SCENES.length; i++) {
    for (const s of SCENES[i].timed) {
      if (s.kind === 'spawn' && s.ids.includes(id)) return i;
    }
  }
  return 0;
}

export function linkFirstScene(linkId: string): number {
  for (let i = 0; i < SCENES.length; i++) {
    const steps = [...SCENES[i].timed, ...SCENES[i].afterSettle];
    for (const s of steps) {
      if (s.kind === 'tether' && s.links.includes(linkId)) return i;
    }
  }
  return 0;
}

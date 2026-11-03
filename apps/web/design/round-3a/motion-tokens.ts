/* DS V1 · Round 3A — motion token PROPOSALS. Nothing here is approved: every value waits for
   Julio's review. Springs are sampled from a damped harmonic oscillator into CSS `linear()` so the
   lab needs no animation dependency (FACT: `linear()` ships in Chromium 113+, Firefox 112+,
   Safari 17.2+). */

export type MotionRegister = "operational" | "expressive";

export type SpringSpec = {
  /** Damping coefficient (mass = 1). */
  damping: number;
  /** Why this spring exists — every token carries a reason. */
  reason: string;
  /** Spring stiffness (mass = 1). */
  stiffness: number;
};

export type SampledSpring = {
  durationMs: number;
  easing: string;
  /** Highest sampled value: > 1 means the curve overshoots its destination. */
  peak: number;
};

/** Settle tolerance: the curve is considered at rest once it stays within 0.4% of 1. */
const REST_TOLERANCE = 0.004;
const SAMPLE_COUNT = 40;

function springPosition({ damping, stiffness }: SpringSpec, seconds: number) {
  const omega = Math.sqrt(stiffness);
  const zeta = damping / (2 * omega);

  if (zeta < 1) {
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    const envelope = Math.exp(-zeta * omega * seconds);
    return 1 - envelope * (Math.cos(damped * seconds) + ((zeta * omega) / damped) * Math.sin(damped * seconds));
  }

  // Critically (or over-) damped springs are treated as critical: no overshoot by construction.
  return 1 - Math.exp(-omega * seconds) * (1 + omega * seconds);
}

function settleSeconds(spec: SpringSpec) {
  let lastOutside = 0;
  for (let ms = 1; ms <= 3000; ms += 1) {
    if (Math.abs(1 - springPosition(spec, ms / 1000)) > REST_TOLERANCE) lastOutside = ms;
  }
  return (lastOutside + 1) / 1000;
}

export function sampleSpring(spec: SpringSpec): SampledSpring {
  const seconds = settleSeconds(spec);
  const points: number[] = [];
  for (let index = 0; index <= SAMPLE_COUNT; index += 1) {
    points.push(index === SAMPLE_COUNT ? 1 : springPosition(spec, (index / SAMPLE_COUNT) * seconds));
  }

  return {
    durationMs: Math.round(seconds * 1000),
    easing: `linear(${points.map((value) => Number(value.toFixed(4))).join(", ")})`,
    peak: Math.max(...points),
  };
}

export const SPRINGS = {
  /** Direct controls: press, toggle, chip. ~2% overshoot, felt rather than seen. */
  snappy: { stiffness: 700, damping: 41, reason: "botones, chips, presión — respuesta inmediata con un mínimo de vida" },
  /** Expressive register only: presence, rewards, shells. ~20% overshoot. */
  elastic: { stiffness: 380, damping: 17.5, reason: "presencia, recompensas, paneles — el registro expresivo" },
  /** Critically damped, slower: panels and large surfaces that must not wobble. */
  soft: { stiffness: 170, damping: 26.2, reason: "superficies grandes, paneles apilados — sin rebote, sin prisa" },
  /** Critically damped, fast: ranked lists and numeric comparison. Never overshoots. */
  settle: { stiffness: 520, damping: 45.6, reason: "rankings y números — overshoot implicaría duda; se mueve claro y se queda" },
} satisfies Record<string, SpringSpec>;

export type SpringName = keyof typeof SPRINGS;

/** Springs that may be applied to ranked or numeric data. Enforced by test: peak must be <= 1. */
export const DATA_SAFE_SPRINGS: SpringName[] = ["settle", "soft"];

export const DURATIONS = {
  instant: 80,
  fast: 160,
  medium: 280,
  slow: 460,
  expressive: 720,
} as const;

export const EASINGS = {
  out: "cubic-bezier(0.2, 0, 0, 1)",
  in: "cubic-bezier(0.4, 0, 1, 1)",
  inOut: "cubic-bezier(0.6, 0, 0.2, 1)",
  stepped: "steps(4, jump-end)",
} as const;

/** Operational amplitude is the expressive amplitude scaled down — same grammar, less travel. */
export const REGISTER_AMPLITUDE: Record<MotionRegister, number> = { operational: 0.4, expressive: 1 };

export const DISTANCES = { micro: 2, short: 6, medium: 16, long: 48 } as const;
export const OPACITY = { rest: 1, soft: 0.56, ghost: 0.18, hidden: 0 } as const;
export const SCALE = { press: 0.96, select: 1.02, pop: 1.08, vanish: 0.4 } as const;
export const BLUR = { enter: 6, exit: 4 } as const;
export const TRAIL = {
  short: { ghosts: 3, lifeMs: 180 },
  spectral: { ghosts: 5, lifeMs: 360 },
} as const;
export const GLOW = {
  live: "0 0 0 1px var(--r3-spec-cyan), 0 0 12px color-mix(in srgb, var(--r3-spec-cyan) 32%, transparent)",
  selected: "0 0 0 1px var(--r3-spec-pink), 0 0 18px color-mix(in srgb, var(--r3-spec-pink) 26%, transparent)",
} as const;
export const PARTICLES = {
  operational: { count: 12, staggerMs: 14, driftPx: 0 },
  expressive: { count: 24, staggerMs: 22, driftPx: 3 },
} as const;

export type TokenRow = { classification: "PROPOSAL"; name: string; reason: string; value: string };

export function motionTokenTable(): TokenRow[] {
  const springRows = (Object.entries(SPRINGS) as [SpringName, SpringSpec][]).map(([name, spec]) => {
    const sampled = sampleSpring(spec);
    const overshoot = Math.max(0, sampled.peak - 1) * 100;
    return {
      classification: "PROPOSAL" as const,
      name: `motion.spring.${name}`,
      reason: spec.reason,
      value: `k=${spec.stiffness} c=${spec.damping} · ${sampled.durationMs}ms · overshoot ${overshoot.toFixed(1)}%`,
    };
  });

  const row = (name: string, value: string, reason: string): TokenRow => ({ classification: "PROPOSAL", name, reason, value });

  return [
    row("motion.duration.instant", `${DURATIONS.instant}ms`, "presión, cambio de color, feedback que no debe esperar"),
    row("motion.duration.fast", `${DURATIONS.fast}ms`, "hover, focus, salida de algo que ya no importa"),
    row("motion.duration.medium", `${DURATIONS.medium}ms`, "selección, cambio de dato, desplazamiento operativo"),
    row("motion.duration.slow", `${DURATIONS.slow}ms`, "paneles, transición de modo de datos"),
    row("motion.duration.expressive", `${DURATIONS.expressive}ms`, "solo registro expresivo: recompensa, presencia, landing"),
    ...springRows,
    row("motion.easing.out", EASINGS.out, "entrada por defecto: llega rápido, frena al final"),
    row("motion.easing.in", EASINGS.in, "salida: acelera y se va, nunca retiene la vista"),
    row("motion.easing.stepped", EASINGS.stepped, "lenguaje pixel: transición por pasos, no suavizada"),
    row("motion.distance.micro", `${DISTANCES.micro}px`, "dirección de un cambio numérico"),
    row("motion.distance.short", `${DISTANCES.short}px`, "entrada operativa, empujón de icono"),
    row("motion.distance.medium", `${DISTANCES.medium}px`, "desplazamiento de foco entre filas"),
    row("motion.distance.long", `${DISTANCES.long}px`, "solo expresivo: presencia que viaja"),
    row("motion.opacity.soft", `${OPACITY.soft}`, "el área que pierde la atención se ablanda, no desaparece"),
    row("motion.opacity.ghost", `${OPACITY.ghost}`, "estela y valor anterior"),
    row("motion.scale.press", `${SCALE.press}`, "compresión al presionar"),
    row("motion.scale.pop", `${SCALE.pop}`, "solo expresivo: reaparición de la presencia"),
    row("motion.blur.enter", `${BLUR.enter}px`, "lo que entra viene de fuera de foco"),
    row("motion.blur.exit", `${BLUR.exit}px`, "lo que sale se desenfoca, no solo se apaga"),
    row("motion.trail.short", `${TRAIL.short.ghosts} fantasmas · ${TRAIL.short.lifeMs}ms`, "operativo: rastro mínimo de un cambio de foco"),
    row("motion.trail.spectral", `${TRAIL.spectral.ghosts} fantasmas · ${TRAIL.spectral.lifeMs}ms`, "presencia espectral que se desplaza"),
    row("motion.glow.live", "1px cian + halo 12px 32%", "solo un feed realmente en vivo"),
    row("motion.glow.selected", "1px rosa + halo 18px 26%", "solo la selección activa"),
    row("motion.particle.operational", `${PARTICLES.operational.count} · stagger ${PARTICLES.operational.staggerMs}ms · deriva ${PARTICLES.operational.driftPx}px`, "evidencia que se reúne; en reposo no deriva"),
    row("motion.particle.expressive", `${PARTICLES.expressive.count} · stagger ${PARTICLES.expressive.staggerMs}ms · deriva ${PARTICLES.expressive.driftPx}px`, "campo expresivo de landing / recompensa"),
    row("motion.register.operational", `amplitud × ${REGISTER_AMPLITUDE.operational}`, "draft en vivo: misma gramática, menos recorrido"),
  ];
}

/** CSS custom properties consumed by `round-3a-labs.css`. Applied on the lab root. */
export function motionCssVars(): Record<`--${string}`, string> {
  const vars: Record<`--${string}`, string> = {
    "--m-instant": `${DURATIONS.instant}ms`,
    "--m-fast": `${DURATIONS.fast}ms`,
    "--m-medium": `${DURATIONS.medium}ms`,
    "--m-slow": `${DURATIONS.slow}ms`,
    "--m-expressive": `${DURATIONS.expressive}ms`,
    "--m-ease-out": EASINGS.out,
    "--m-ease-in": EASINGS.in,
    "--m-ease-in-out": EASINGS.inOut,
    "--m-ease-stepped": EASINGS.stepped,
  };
  for (const [name, spec] of Object.entries(SPRINGS)) {
    const sampled = sampleSpring(spec);
    vars[`--m-spring-${name}`] = sampled.easing;
    vars[`--m-spring-${name}-duration`] = `${sampled.durationMs}ms`;
  }
  return vars;
}

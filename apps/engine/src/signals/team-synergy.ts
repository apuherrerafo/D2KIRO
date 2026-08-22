import type { DraftState, HeroId, TeamSide } from "../draft/reducer";
import type { MetaSnapshot, SignalContribution, SignalScorer } from "./types";

type Capability = "control" | "iniciacion" | "aguante" | "empuje" | "soporte";

const CAPABILITIES: Capability[] = ["control", "iniciacion", "aguante", "empuje", "soporte"];

// Mapeo heurístico de las 5 capacidades del ticket a los roles[] reales que expone OpenDota
// (ver fixtures de TSK-003) -- no hay un mapeo oficial, es una decisión de producto documentada
// aquí. Roles de OpenDota sin correspondencia (Carry, Nuker, Escape, Jungler) no cuentan para
// ninguna de las 5 capacidades rastreadas.
const CAPABILITY_ROLE: Record<Capability, string> = {
  control: "Disabler",
  iniciacion: "Initiator",
  aguante: "Durable",
  empuje: "Pusher",
  soporte: "Support",
};

const CAPABILITY_LABEL: Record<Capability, string> = {
  control: "control",
  iniciacion: "iniciación",
  aguante: "aguante",
  empuje: "empuje",
  soporte: "curación/soporte",
};

function heroCapabilities(meta: MetaSnapshot, hero: HeroId): Set<Capability> {
  const roles = meta.heroes[hero]?.roles ?? [];
  return new Set(CAPABILITIES.filter((cap) => roles.includes(CAPABILITY_ROLE[cap])));
}

function buildExplanation(newlyFilled: Capability[]): string {
  if (newlyFilled.length === 0) return "No aporta una capacidad que el equipo tenga pendiente";
  return `Aporta ${newlyFilled.map((cap) => CAPABILITY_LABEL[cap]).join(" y ")} que el equipo no tiene todavía`;
}

function ownPicks(state: { localSide: TeamSide | "unknown"; picks: Record<TeamSide, HeroId[]> }): HeroId[] {
  return state.localSide === "unknown" ? [] : state.picks[state.localSide];
}

// TSK-060: `covered` no depende del candidato, solo de `state` (vía los picks propios) y `meta`
// (vía `heroCapabilities`) -- a diferencia de counter.ts, acá SÍ hace falta cachear por los dos
// juntos: `teamSynergyScorer` es un singleton de módulo (parte de STATIC_SCORERS), así que el
// mismo objeto `DraftState` podría en teoría verse pasado con un `meta` distinto en llamadas
// distintas a `buildSuggestions` (dos snapshots de meta diferentes sobre el mismo estado, ej. en
// pruebas). Un WeakMap anidado evita servir un `covered` calculado contra el `meta` equivocado.
const coveredCache = new WeakMap<DraftState, WeakMap<MetaSnapshot, Set<Capability>>>();

function cachedCovered(state: DraftState, meta: MetaSnapshot, picks: HeroId[]): Set<Capability> {
  let byMeta = coveredCache.get(state);
  if (!byMeta) {
    byMeta = new WeakMap();
    coveredCache.set(state, byMeta);
  }
  let covered = byMeta.get(meta);
  if (!covered) {
    covered = new Set<Capability>();
    for (const hero of picks) {
      for (const cap of heroCapabilities(meta, hero)) covered.add(cap);
    }
    byMeta.set(meta, covered);
  }
  return covered;
}

export const teamSynergyScorer: SignalScorer = {
  id: "team_synergy",
  score(state, candidate, meta): SignalContribution {
    const picks = ownPicks(state);

    // No hay un equipo propio observado todavía (localSide desconocido o cero picks) -- no existe
    // una "cobertura actual" contra la cual medir qué le falta al equipo, así que se trata como
    // dato insuficiente (null), no como cobertura=0.
    if (picks.length === 0) {
      return {
        signal: "team_synergy",
        raw: null,
        weighted: 0,
        explanation: "Sin picks propios todavía para evaluar sinergia de equipo",
        sampleSize: 0,
      };
    }

    const covered = cachedCovered(state, meta, picks);
    const newlyFilled = [...heroCapabilities(meta, candidate)].filter((cap) => !covered.has(cap));

    return {
      signal: "team_synergy",
      raw: newlyFilled.length / CAPABILITIES.length,
      weighted: 0,
      explanation: buildExplanation(newlyFilled),
      sampleSize: 0,
    };
  },
};

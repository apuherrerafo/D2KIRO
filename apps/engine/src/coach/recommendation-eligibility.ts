import { filledGaps } from "../draft-paths/gaps";
import type { DraftCapabilityGap } from "../draft-paths/types";
import { winrateClearlyAboveEven } from "../signals/patch-meta";
import type { SignalContribution } from "../signals/types";
import { cardContextOf, type CardContext } from "./card-context";
import type { CardCompositionContext } from "./card-critical-gap";
import type { ContextReorderInput } from "./context-reorder";
import type { HeroBadge, HeroCandidate } from "./hero-card";

// CONTRATO DE ELEGIBILIDAD (dueño del producto, 2026-11-03) -- el ÚNICO lugar donde el motor decide si un héroe se muestra como recomendación.
//
//   Un héroe se muestra SOLO si tiene al menos un fundamento estratégico real, verificable y relevante para el estado actual del draft.
//   NO son fundamento, por sí solos: la posición (`position_fit`), ser flex, pertenecer a un pool, la popularidad, cubrir un hueco cualquiera
//   ni una relación curada que solo atribuye la fuente ("Lo dicen: …"). Sin fundamento no hay tarjeta: ni de relleno, ni "exploración".
//
// Lo comparten TODOS los caminos que muestran héroes (decisión V4, tablero del equipo, Coach v3 y la lista del modo en vivo): nadie más decide
// elegibilidad, así que no pueden divergir. Las explicaciones que se muestran salen de estos mismos fundamentos (`describeGrounds`), nunca de
// "la señal más fuerte" ni de una señal que no decidió nada. Pura: sin I/O, sin reloj.

export type GroundKind =
  | "BAN_OPENS" //            los bans abrieron al héroe: se baneó un counter suyo con porqué de Dota
  | "COUNTER_REVEALED" //     le gana a un rival YA revelado (counter curado con porqué)
  | "SYNERGY_PAIR" //         hace pareja curada (con porqué) con un aliado YA elegido
  | "STEAL" //                le quita un counter a un pick tuyo ya elegido
  | "COMPOSITION_CRITICAL" // llena un hueco CRÍTICO y demostrable de la composición (ventana de cierre, picks propios curados)
  | "ARCHETYPE_INTENT" //     la intención de draft que el jugador eligió (`archetype_fit` votó con datos)
  | "PATCH_META"; //          el meta vigente con evidencia suficiente: el winrate supera 50 % con evidencia suficiente (`winrateClearlyAboveEven`)

export interface Ground {
  kind: GroundKind;
  /** Frase llana del fundamento, derivada de lo que de verdad lo habilitó. */
  text: string;
  /** True cuando los chips de contexto de la tarjeta (`CardContext`) ya muestran este fundamento: no se repite como frase. */
  shownByContext: boolean;
}

export interface EligibilityInput {
  context: ContextReorderInput;
  /** Qué le falta críticamente al equipo. Ausente = no se pudo derivar (sin capacidades curadas): la composición nunca cuenta. */
  composition?: CardCompositionContext;
}

export interface Eligibility {
  grounds: Ground[];
  /** El contexto de la tarjeta, ya filtrado a relaciones con porqué (la misma fuente de los chips). */
  context: CardContext;
}

function votedWithData(signal: SignalContribution): boolean {
  return signal.raw !== null && signal.applicable !== false && signal.weighted > 0;
}

const GAP_LABEL: Record<DraftCapabilityGap, string> = {
  initiation: "iniciar peleas",
  catch: "atrapar a un rival",
  waveclear: "waveclear",
  structural_damage: "daño a estructuras",
  teamfight: "teamfight",
  scaling: "scaling",
  damage_mix: "un segundo tipo de daño",
};

function listNaturally(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function signalOf(candidate: HeroCandidate, id: SignalContribution["signal"]): SignalContribution | undefined {
  return candidate.signals.find((signal) => signal.signal === id);
}

function compositionGround(candidate: HeroCandidate, composition: CardCompositionContext | undefined): Ground | null {
  if (!composition || composition.needs.critical.length === 0) return null;
  const capabilities = composition.capabilities.get(candidate.heroId);
  if (!capabilities) return null; // sin capacidades curadas no sabemos qué aporta: nunca se le atribuye
  const filled = filledGaps(capabilities, composition.needs.critical, composition.needs.ownDamageTypes);
  if (filled.length === 0) return null;
  return { kind: "COMPOSITION_CRITICAL", text: `Cubre lo que le falta a tu equipo: ${listNaturally(filled.map((gap) => GAP_LABEL[gap]))}`, shownByContext: false };
}

function metaGround(candidate: HeroCandidate): Ground | null {
  const signal = signalOf(candidate, "patch_meta");
  if (!signal || !votedWithData(signal) || signal.raw === null) return null;
  if (candidate.recommendation.risks.some((risk) => risk.kind === "degraded_meta")) return null; // meta viejo: no es evidencia vigente
  if (!winrateClearlyAboveEven(signal.raw, signal.sampleSize)) return null;
  return { kind: "PATCH_META", text: `${signal.explanation} (${signal.sampleSize.toLocaleString("es-PE")} partidas)`, shownByContext: false };
}

/**
 * Los fundamentos verificables de ESTE héroe en ESTE estado del draft, en orden de concreción (lo más específico primero). Vacío = el héroe
 * no se muestra. Pura.
 */
export function evaluateEligibility(candidate: HeroCandidate, input: EligibilityInput): Eligibility {
  const context = cardContextOf(candidate.heroId, input.context);
  const grounds: Ground[] = [];
  if (context.strengths.length > 0) grounds.push({ kind: "COUNTER_REVEALED", text: "Le gana a lo que el rival ya mostró", shownByContext: true });
  if (context.opening.openedBy.length > 0) grounds.push({ kind: "BAN_OPENS", text: "Los bans lo abren: se baneó lo que lo counterea", shownByContext: true });
  if (context.synergies.length > 0) grounds.push({ kind: "SYNERGY_PAIR", text: "Hace pareja con un aliado ya elegido", shownByContext: true });
  if (context.steals.length > 0) grounds.push({ kind: "STEAL", text: "Le quita un counter a un pick tuyo", shownByContext: true });

  // El counter ESTADÍSTICO (winrate del enfrentamiento contra un rival ya revelado) NO es fundamento: no nombra un mecanismo y, con el umbral actual del
  // scorer (>= 40 partidas y delta contraído >= 0,04), la mayoría es indistinguible del azar (medido: 206 de 282 tarjetas solo-estadística). Un counter
  // cuenta únicamente si es una relación curada con porqué (COUNTER_REVEALED). Decisión conservadora, pendiente de confirmar con el dueño del producto.
  const composition = compositionGround(candidate, input.composition);
  if (composition) grounds.push(composition);
  const intent = signalOf(candidate, "archetype_fit");
  if (intent && votedWithData(intent) && !intent.explanation.startsWith("Sin ")) grounds.push({ kind: "ARCHETYPE_INTENT", text: intent.explanation, shownByContext: false });
  const meta = metaGround(candidate);
  if (meta) grounds.push(meta);
  return { grounds, context };
}

export function isEligible(candidate: HeroCandidate, input: EligibilityInput): boolean {
  return evaluateEligibility(candidate, input).grounds.length > 0;
}

/**
 * La frase de la tarjeta, tomada de sus fundamentos (jamás de "la señal más fuerte"). Si algún fundamento NO lo muestran ya los chips de
 * contexto, esa es la frase; si todos los muestran los chips, la frase se calla (`hide`) para no repetirlos. Con `grounds` vacío no hay tarjeta.
 */
export function describeGrounds(grounds: readonly Ground[]): { rationale: string; hide: boolean } {
  const standalone = grounds.find((ground) => !ground.shownByContext);
  if (standalone) return { rationale: standalone.text, hide: false };
  return { rationale: grounds[0]?.text ?? "", hide: grounds.length > 0 };
}

/**
 * Las etiquetas de una tarjeta, SOLO las que corresponden a un fundamento que de verdad la habilitó (una etiqueta es una explicación
 * mostrada). FLEX y las marcas de pool no son una razón: informan, no se derivan de aquí.
 */
export function badgesFromGrounds(grounds: readonly Ground[]): HeroBadge[] {
  const badges = new Set<HeroBadge>();
  for (const ground of grounds) {
    if (ground.kind === "COUNTER_REVEALED") badges.add("COUNTER");
    if (ground.kind === "SYNERGY_PAIR") badges.add("SYNERGY"); // la composición NO es sinergia: su fundamento va en la frase, sin la etiqueta "Sinergia"
    if (ground.kind === "PATCH_META") badges.add("META");
  }
  return [...badges];
}

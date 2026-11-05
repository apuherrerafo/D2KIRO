import { filledGaps } from "../draft-paths/gaps";
import type { DraftCapabilityGap } from "../draft-paths/types";
import { winrateClearlyAboveEven } from "../signals/patch-meta";
import type { SignalContribution } from "../signals/types";
import { cardContextOf, type CardContext } from "./card-context";
import type { CardCompositionContext } from "./card-critical-gap";
import { banBalanceOf, revealedCounterPenalty, type ContextReorderInput } from "./context-reorder";
import type { HeroBadge, HeroCandidate } from "./hero-card";

// CONTRATO DE ELEGIBILIDAD (dueño del producto, 2026-11-03/04) -- el ÚNICO lugar donde el motor decide si un héroe se muestra y con qué fuerza.
//
//   ELEGIBILIDAD: un héroe se muestra SOLO si tiene al menos un fundamento INDEPENDIENTE, real, verificable y relevante para el estado actual del draft.
//   NO son fundamento, por sí solos: la posición (`position_fit`), ser flex, pertenecer a un pool, la popularidad, cubrir un hueco cualquiera, una
//   relación "Lo dicen: …" sin porqué, la intención del usuario (es una preferencia) ni el counter estadístico (solo complementa).
//
//   FUERZA (distinta de la elegibilidad): un héroe puede tener evidencia para APARECER y no para ser "ELIGE AHORA". Solo un fundamento FUERTE
//   (counter/pareja/robo duros con porqué, una amenaza relevante que de verdad desapareció, un hueco de composición sin margen) habilita la acción
//   principal, el héroe recomendado y la posición destacada. El meta, por sí solo, es DÉBIL: el héroe aparece, pero nunca como acción principal.
//   La fuerza NO cambia el scoring ni el orden de V6: solo decide qué puede ser acción principal.
//
// Lo comparten TODOS los caminos que muestran héroes (decisión V4, tablero del equipo, Coach v3 y la lista del modo en vivo): nadie más decide
// elegibilidad ni fuerza, así que no pueden divergir. Las explicaciones salen de estos mismos fundamentos (`describeGrounds`), nunca de "la señal más
// fuerte" ni de una señal que no decidió nada. Pura: sin I/O, sin reloj.

export type GroundKind =
  | "BAN_OPENS" //            los bans quitaron una amenaza relevante (counter con porqué) y se dice qué otras amenazas quedan
  | "COUNTER_REVEALED" //     le gana a un rival YA revelado (counter curado con porqué)
  | "SYNERGY_PAIR" //         hace pareja curada (con porqué) con un aliado YA elegido
  | "STEAL" //                le quita un counter a un pick tuyo ya elegido
  | "COMPOSITION_CRITICAL" // llena un hueco crítico del equipo cuando los picks que quedan no alcanzan para cubrirlo después
  | "PATCH_META" //           el meta vigente con ventaja sostenida (`winrateClearlyAboveEven`): débil, por sí solo no es acción principal
  | "COUNTER_STATS" //        counter estadístico contra un rival ya revelado: SOLO complementa otro fundamento
  | "ARCHETYPE_INTENT"; //    la intención elegida (`archetype_fit` votó con datos): SOLO complementa otro fundamento (es una preferencia)

/** STRONG/WEAK habilitan por sí solos (WEAK nunca es acción principal); COMPLEMENT solo se muestra si ya hay un fundamento independiente. */
export type GroundStrength = "STRONG" | "WEAK" | "COMPLEMENT";
export type EvidenceStrength = "STRONG" | "WEAK";

export interface Ground {
  kind: GroundKind;
  strength: GroundStrength;
  /** Frase llana del fundamento, derivada de lo que de verdad lo habilitó. */
  text: string;
  /** True cuando los chips de contexto de la tarjeta (`CardContext`) ya muestran este fundamento CON nombres y porqué: no se repite como frase. */
  shownByContext: boolean;
}

export interface EligibilityInput {
  context: ContextReorderInput;
  /** Qué le falta críticamente al equipo. Ausente = no se pudo derivar (sin capacidades curadas): la composición nunca cuenta. */
  composition?: CardCompositionContext;
}

export interface Eligibility {
  /** Vacío = el héroe no se muestra. Los COMPLEMENT solo aparecen si hay al menos un fundamento independiente. */
  grounds: Ground[];
  /** STRONG si algún fundamento independiente es fuerte; WEAK si solo hay débiles; null si no es elegible. */
  strength: EvidenceStrength | null;
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

/**
 * Necesidad de composición CONCRETA: un hueco crítico (iniciar, atrapar, segundo tipo de daño) que ningún aliado ya elegido cubre, con TODOS los
 * picks propios curados (lo desconocido no es carencia), y cuando los picks que quedan NO alcanzan para cubrir todos los huecos abiertos (huecos >=
 * picks restantes: ya no hay margen para dejarlo "para después"). Sin constantes: la fase del draft entra por los picks que quedan. Cubrir un hueco
 * cualquiera, o uno que todavía puede esperar, NO basta.
 */
function compositionGround(candidate: HeroCandidate, composition: CardCompositionContext | undefined): Ground | null {
  if (!composition) return null;
  const { needs } = composition;
  if (!needs.coverageKnown || needs.ownPicksRemaining < 1 || needs.criticalOpen.length < needs.ownPicksRemaining) return null;
  const capabilities = composition.capabilities.get(candidate.heroId);
  if (!capabilities) return null; // sin capacidades curadas no sabemos qué aporta: nunca se le atribuye
  const filled = filledGaps(capabilities, needs.criticalOpen, needs.ownDamageTypes);
  // Parte justa (palomar): si hay más huecos que picks, cada pick debe cargar con ceil(huecos / picks) de ellos. Con 3 huecos y 2 picks, un héroe que
  // solo cubre uno NO resuelve la presión; con huecos == picks basta uno.
  if (filled.length < Math.ceil(needs.criticalOpen.length / needs.ownPicksRemaining)) return null;
  const when = needs.ownPicksRemaining === 1 ? "es tu último pick" : `te quedan ${needs.ownPicksRemaining} picks para ${needs.criticalOpen.length} huecos`;
  return { kind: "COMPOSITION_CRITICAL", strength: "STRONG", text: `Cubre ${listNaturally(filled.map((gap) => GAP_LABEL[gap]))}, que tus aliados ya elegidos no tienen, y ${when}: no hay margen para dejarlo para después`, shownByContext: false };
}

function metaGround(candidate: HeroCandidate): Ground | null {
  const signal = signalOf(candidate, "patch_meta");
  if (!signal || !votedWithData(signal) || signal.raw === null) return null;
  if (candidate.recommendation.risks.some((risk) => risk.kind === "degraded_meta")) return null; // meta viejo: no es evidencia vigente
  if (!winrateClearlyAboveEven(signal.raw, signal.sampleSize)) return null;
  return { kind: "PATCH_META", strength: "WEAK", text: `${signal.explanation} (${signal.sampleSize.toLocaleString("es-PE")} partidas)`, shownByContext: false };
}

/**
 * Un ban NO abre automáticamente a un héroe. La fuerza depende de qué amenaza relevante desapareció y de qué otras permanecen: es FUERTE solo si
 * lo baneado pesa MÁS que lo que sigue libre y probable (counters con porqué o no: una atribución sigue siendo una amenaza que queda, aunque no
 * se pueda citar). Si queda tanto o más libre que lo baneado, el héroe puede aparecer pero el ban no lo sostiene como acción principal.
 */
function banStrength(candidate: HeroCandidate, input: ContextReorderInput): "STRONG" | "WEAK" {
  const { bannedWithWhy, freeProbable } = banBalanceOf(candidate.heroId, input);
  return bannedWithWhy > freeProbable ? "STRONG" : "WEAK";
}

/**
 * Los fundamentos verificables de ESTE héroe en ESTE estado del draft, en orden de concreción (lo más específico primero), y su fuerza. Vacío = el
 * héroe no se muestra. Pura.
 */
export function evaluateEligibility(candidate: HeroCandidate, input: EligibilityInput): Eligibility {
  const context = cardContextOf(candidate.heroId, input.context);
  const independent: Ground[] = [];
  if (context.strengths.length > 0) {
    independent.push({ kind: "COUNTER_REVEALED", strength: context.strengths.some((strength) => strength.level === "hard") ? "STRONG" : "WEAK", text: "Le gana a un rival que ya se ve", shownByContext: true });
  }
  if (context.opening.openedBy.length > 0) {
    independent.push({ kind: "BAN_OPENS", strength: banStrength(candidate, input.context), text: "Se baneó una amenaza suya y se dice qué otras quedan", shownByContext: true });
  }
  if (context.synergies.length > 0) independent.push({ kind: "SYNERGY_PAIR", strength: "STRONG", text: "Hace pareja con un aliado ya elegido", shownByContext: true });
  if (context.steals.length > 0) {
    independent.push({ kind: "STEAL", strength: context.steals.some((steal) => steal.level === "hard") ? "STRONG" : "WEAK", text: "Le quita un counter a un pick tuyo", shownByContext: true });
  }
  const composition = compositionGround(candidate, input.composition);
  if (composition) independent.push(composition);
  const meta = metaGround(candidate);
  if (meta) independent.push(meta);
  if (independent.length === 0) return { grounds: [], strength: null, context };

  // Complementos: refuerzan un fundamento que YA existe; solos no habilitan nada.
  const complements: Ground[] = [];
  const counter = signalOf(candidate, "counter");
  const hasCuratedCounter = context.strengths.length > 0;
  if (counter && input.context.revealedEnemies.size > 0 && !hasCuratedCounter && votedWithData(counter) && (counter.raw ?? 0) > 0 && counter.hasRevealedEnemyCounterEvidence === true && !counter.explanation.startsWith("Sin ")) {
    complements.push({ kind: "COUNTER_STATS", strength: "COMPLEMENT", text: counter.explanation, shownByContext: false });
  }
  const intent = signalOf(candidate, "archetype_fit");
  if (intent && votedWithData(intent) && !intent.explanation.startsWith("Sin ")) complements.push({ kind: "ARCHETYPE_INTENT", strength: "COMPLEMENT", text: intent.explanation, shownByContext: false });

  // Un héroe al que un rival YA revelado le gana (counter curado, con la ponderación de línea de `revealedCounterPenalty`) puede aparecer, pero nunca como
  // recomendación fuerte: lo que lo respalda no puede ignorar lo que ya se ve en contra.
  const threatened = revealedCounterPenalty(candidate.heroId, input.context) > 0;
  const strength: EvidenceStrength = !threatened && independent.some((ground) => ground.strength === "STRONG") ? "STRONG" : "WEAK";
  return { grounds: [...independent, ...complements], strength, context };
}

export function isEligible(candidate: HeroCandidate, input: EligibilityInput): boolean {
  return evaluateEligibility(candidate, input).grounds.length > 0;
}

/**
 * La frase de la tarjeta, tomada de sus fundamentos (jamás de "la señal más fuerte"). Si algún fundamento NO lo muestran ya los chips de contexto
 * (que nombran a los héroes y dan el porqué), esa es la frase; si todos los muestran los chips, la frase se calla (`hide`) para no repetirlos.
 */
export function describeGrounds(grounds: readonly Ground[]): { rationale: string; hide: boolean } {
  // Si hay un fundamento FUERTE, la frase nunca se la queda uno DÉBIL (p. ej. el winrate): sería decir como motivo lo que no decidió. Si el fuerte lo
  // dicen los chips (nombres + porqué), la frase se calla.
  const hasStrong = grounds.some((ground) => ground.strength === "STRONG");
  const standalone = grounds.find((ground) => !ground.shownByContext && (!hasStrong || ground.strength !== "WEAK"));
  if (standalone) return { rationale: standalone.text, hide: false };
  return { rationale: grounds[0]?.text ?? "", hide: grounds.length > 0 };
}

/**
 * Las etiquetas de una tarjeta, SOLO las que corresponden a un fundamento independiente que de verdad la habilitó (una etiqueta es una explicación
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

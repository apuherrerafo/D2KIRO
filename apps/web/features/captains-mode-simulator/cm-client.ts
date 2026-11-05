import { ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";
import type { HeroId } from "@/features/draft/types";
import type { EvidenceStrength, TeamCoachStrength, TeamCoachSynergy } from "@/features/team-coach/types";
import { isEvidenceStrength, isStrength, isSynergy } from "@/features/team-coach/validation";
import { isHeroCard, type CoachHeroCard } from "../random-draft-simulator/coach-client";

// Contrato de elegibilidad en Captains Mode (dueño del producto, 2026-11-04). Espejo a mano de `CaptainsModeOutput`
// (apps/engine/src/coach/captains-mode-output.ts): apps/web nunca importa tipos de apps/engine. Lo único que viaja es lo que el motor ya filtró:
// héroes con un fundamento verificable y su fuerza. El desglose crudo de V6 (señales, razón de posición, confianza) no llega por este camino.

export interface CaptainsModeBanCard {
  heroId: HeroId;
  evidenceStrength: EvidenceStrength;
  /** Picks TUYOS a los que este héroe le gana (con el porqué curado). */
  beatsYourPicks: TeamCoachStrength[];
  /** Picks del RIVAL con los que este héroe hace pareja (con el porqué curado). */
  pairsWithTheirPicks: TeamCoachSynergy[];
  score: number;
}

export interface CaptainsModeOutput {
  schema: "recommendation-output/cm-v1";
  sessionId: string;
  actionKind: "PICK" | "BAN" | null;
  step: number | null;
  picks: CoachHeroCard[];
  bans: CaptainsModeBanCard[];
  /** El héroe recomendado ahora: solo con evidencia FUERTE en el primero de la lista. Null = ninguno se destaca. */
  primaryHeroId: HeroId | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHeroId(value: unknown): value is HeroId {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isBanCard(value: unknown): value is CaptainsModeBanCard {
  return isRecord(value) && isHeroId(value.heroId) && isEvidenceStrength(value.evidenceStrength) && typeof value.score === "number"
    && Array.isArray(value.beatsYourPicks) && value.beatsYourPicks.every(isStrength)
    && Array.isArray(value.pairsWithTheirPicks) && value.pairsWithTheirPicks.every(isSynergy);
}

export function parseCaptainsModeOutput(value: unknown): CaptainsModeOutput | null {
  if (!isRecord(value) || value.schema !== "recommendation-output/cm-v1" || typeof value.sessionId !== "string") return null;
  if (value.actionKind !== null && value.actionKind !== "PICK" && value.actionKind !== "BAN") return null;
  if (value.step !== null && typeof value.step !== "number") return null;
  if (!Array.isArray(value.picks) || !value.picks.every(isHeroCard)) return null;
  if (!Array.isArray(value.bans) || !value.bans.every(isBanCard)) return null;
  if (value.primaryHeroId !== null && !isHeroId(value.primaryHeroId)) return null;
  return value as unknown as CaptainsModeOutput;
}

/** La ÚNICA fuente de recomendaciones de Captains Mode: el motor ya aplicó el contrato de elegibilidad. Solo viaja el sessionId. */
export async function fetchCaptainsModeOutput(sessionId: string, fetchImpl: typeof fetch = fetch): Promise<CaptainsModeOutput> {
  const response = await fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/recommendations?format=cm`);
  if (!response.ok) throw new Error(`captains mode recommendations request failed (${response.status})`);
  const body: unknown = await response.json();
  const parsed = isRecord(body) ? parseCaptainsModeOutput(body.output) : null;
  if (!parsed) throw new Error("invalid captains mode recommendations response");
  return parsed;
}

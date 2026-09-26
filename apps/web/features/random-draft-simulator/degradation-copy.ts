// Player-facing wording for the engine's `RecommendationSetV2.degradations`. The engine authors a
// `detail` for each degradation, but for several of them it is debug text ("V6 degraded flag:
// stale_meta", "confirmaciones de posición contradictorias: []"). The Player never reads engine
// vocabulary: known reasons are translated here, presentation only -- no degradation is added,
// removed or reinterpreted, and role beliefs are untouched.

/** Flags of the legacy V6 mixer (`DegradationFlag`); the engine forwards each as `reason` with a
 * "V6 degraded flag: <flag>" detail. */
const LEGACY_FLAG_COPY: Record<string, string> = {
  stale_meta: "Datos de meta desactualizados",
  partial_signals: "Recomendación con señales parciales",
  unconfirmed_state: "Estado del draft sin confirmar",
  unknown_format: "Formato de draft no reconocido",
  no_signal_available: "Sin señales suficientes para recomendar",
  patch_meta_data_not_ready: "Datos de meta del parche no disponibles (señal no votante)",
};

const ENGINE_INTERNAL_DETAIL = /^V6 degraded flag:/;
const ROLE_CONFLICT_DETAIL = /contradictorias:\s*(.*)$/;

const ROLE_CONFLICT_COPY = "Hay posiciones confirmadas que se contradicen entre sí";
const GENERIC_LIMITED_DATA_COPY = "Recomendación con datos limitados";

export interface DegradationInput {
  reason: string;
  detail: string;
}

function roleConflictCopy(detail: string): string | null {
  const match = ROLE_CONFLICT_DETAIL.exec(detail);
  if (!match) return detail;
  try {
    const conflicts: unknown = JSON.parse(match[1] ?? "");
    if (Array.isArray(conflicts) && conflicts.length === 0) return null;
  } catch {
    // Unparseable list: say something rather than hide a real contradiction.
  }
  return ROLE_CONFLICT_COPY;
}

/** The text the Player reads for one degradation, or `null` when there is nothing worth showing
 * (an empty contradiction list is not information). */
export function playerFacingDegradation(degradation: DegradationInput): string | null {
  const legacy = LEGACY_FLAG_COPY[degradation.reason];
  if (legacy) return legacy;
  if (degradation.reason === "ROLE_ASSIGNMENT_IMPOSSIBLE") return roleConflictCopy(degradation.detail);
  if (ENGINE_INTERNAL_DETAIL.test(degradation.detail)) return GENERIC_LIMITED_DATA_COPY;
  return degradation.detail;
}

const RISK_COPY: Record<string, string> = {
  degraded_meta: "Los datos de meta no están al día; la confianza de esta recomendación puede ser menor",
  low_evidence: "Hay poca evidencia para esta recomendación",
  unresolved_role: "Todavía no hay evidencia de posición para al menos un héroe de esta acción",
};
const ENGINE_INTERNAL_RISK_DETAIL = /stale_meta|snapshot|evidenceCoverage|V6/;

/** The text the Player reads for one `RecommendationV2.risks` entry. `degraded_meta` is always the
 * fixed copy; other kinds keep an already-plain detail and only swap engine vocabulary out. */
export function playerFacingRisk(risk: { kind: string; detail: string }): string {
  if (risk.kind === "degraded_meta") return RISK_COPY.degraded_meta ?? GENERIC_LIMITED_DATA_COPY;
  if (ENGINE_INTERNAL_RISK_DETAIL.test(risk.detail)) return RISK_COPY[risk.kind] ?? GENERIC_LIMITED_DATA_COPY;
  return risk.detail;
}

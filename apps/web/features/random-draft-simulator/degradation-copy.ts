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

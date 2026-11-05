import type { EvidenceStrength } from "../types";

// Elegibilidad != fuerza (contrato de elegibilidad, 2026-11-04): un héroe puede tener evidencia para APARECER y no para ser la acción principal. La marca lo dice sin
// alarmar: es información, no un error. Solo la lleva la evidencia débil (STRONG o sin dato = nada). Color por rol semántico y escala de 4 px.
const LIMITED_MARK = "rounded-md border border-signal-warning px-2 py-1 text-caption text-signal-warning";

export function EvidenceLimitedMark({ strength }: { strength: EvidenceStrength | undefined }) {
  if (strength !== "WEAK") return null;
  return (
    <span className={LIMITED_MARK} data-testid="evidence-limited-mark" title="Tiene evidencia para aparecer, pero no para ser la acción principal">
      Evidencia limitada
    </span>
  );
}

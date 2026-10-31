import type { CardRisk, CardRiskKind } from "../coach-client";
import { playerFacingRisk } from "../degradation-copy";

// Aviso de la tarjeta del Coach (hoy sólo "hueco crítico del equipo"). Se lee tal cual del motor: aquí nada puntúa,
// ordena ni infiere. Sin aviso no se dibuja nada -- una tarjeta sin riesgo se ve exactamente igual que antes.

const RISK_TITLES: Record<CardRiskKind, string> = {
  CRITICAL_GAP: "Hueco crítico del equipo",
};

interface CardRiskNoticeProps {
  risks: readonly CardRisk[] | undefined;
}

interface CardRiskItemProps {
  risk: CardRisk;
}

function CardRiskItem({ risk }: CardRiskItemProps) {
  return (
    <li className="flex flex-col" data-testid="current-decision-risk" data-risk-kind={risk.kind}>
      <span className="text-caption font-semibold text-signal-warning">{RISK_TITLES[risk.kind]}</span>
      <span className="text-caption text-content-muted">{playerFacingRisk(risk)}</span>
    </li>
  );
}

export function CardRiskNotice({ risks }: CardRiskNoticeProps) {
  if (!risks || risks.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-md border border-signal-warning bg-surface-raised p-2" data-testid="current-decision-risks">
      {risks.map((risk) => (
        <CardRiskItem key={risk.kind} risk={risk} />
      ))}
    </ul>
  );
}

import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { BasisSource, CardBasis, CardRisk, CardRiskKind } from "../coach-client";
import { playerFacingRisk } from "../degradation-copy";

// TSK-254 -- what a Coach card is honest about. Both pieces are read verbatim from the V4 card: where its reason
// comes from (a measured statistic, a curated judgement, or an inference) and the risks to weigh before locking the
// hero. Nothing is scored, ranked or inferred here.

const RISK_TITLES: Record<CardRiskKind, string> = {
  countered_by_revealed: "Counter duro ya revelado",
  exposed_to_counter: "Counter duro aún disponible",
  unresolved_role: "Rol sin confirmar",
  low_evidence: "Poca evidencia",
};

function sourceLabel(source: BasisSource): string {
  if (source.kind === "statistical") return source.sampleSize === null ? "estadística" : `estadística (${source.sampleSize} partidas)`;
  if (source.kind === "curated") return "criterio curado";
  return "inferido de la posición";
}

function basisText(basis: CardBasis): string {
  const labels = basis.sources.map(sourceLabel);
  if (basis.kind === "mixed") return `Base mixta: ${labels.join(" + ")}`;
  return `Base: ${labels[0]}`;
}

interface CardBasisLabelProps {
  basis: CardBasis;
}

export function CardBasisLabel({ basis }: CardBasisLabelProps) {
  return (
    <span className="text-caption text-content-muted" data-testid="current-decision-basis" data-basis-kind={basis.kind}>
      {basisText(basis)}
    </span>
  );
}

function heroNames(heroIds: readonly number[], heroCatalog: Map<number, HeroMeta>): string {
  return heroIds.map((heroId) => heroCatalog.get(heroId)?.localizedName ?? `Héroe ${heroId}`).join(", ");
}

interface CardRiskItemProps {
  risk: CardRisk;
  heroCatalog: Map<number, HeroMeta>;
}

function CardRiskItem({ risk, heroCatalog }: CardRiskItemProps) {
  const title = risk.heroIds.length > 0 ? `${RISK_TITLES[risk.kind]}: ${heroNames(risk.heroIds, heroCatalog)}` : RISK_TITLES[risk.kind];
  return (
    <li className="flex flex-col" data-testid="current-decision-risk" data-risk-kind={risk.kind}>
      <span className="text-caption font-semibold text-signal-warning">{title}</span>
      <span className="text-caption text-content-muted">{playerFacingRisk(risk)}</span>
    </li>
  );
}

interface CardRiskListProps {
  risks: readonly CardRisk[];
  heroCatalog: Map<number, HeroMeta>;
}

export function CardRiskList({ risks, heroCatalog }: CardRiskListProps) {
  if (risks.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-md border border-signal-warning bg-surface-raised p-2" data-testid="current-decision-risks">
      {risks.map((risk) => (
        <CardRiskItem key={risk.kind} risk={risk} heroCatalog={heroCatalog} />
      ))}
    </ul>
  );
}

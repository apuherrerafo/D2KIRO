/* LANDING-01B · the product proposition, stated once, in three rules. Rules instead of boxes: the DS
   keeps containers for the protagonist layer, and a statement is not one. */
import { PROPOSITION } from "../copy";
import { LandingSection } from "./LandingSection";

export function PropositionSection() {
  return (
    <LandingSection id="proposition" kicker="What D2KIRO does" title={PROPOSITION.title}>
      <ol className="ld-points">
        {PROPOSITION.points.map((point, index) => (
          <li className="ld-point" key={point.id}>
            <span aria-hidden="true" className="ld-point-index">{String(index + 1).padStart(2, "0")}</span>
            <h3 className="ld-point-title">{point.title}</h3>
            <p className="ld-point-body">{point.body}</p>
          </li>
        ))}
      </ol>
    </LandingSection>
  );
}

/* LANDING-01B · Counterfactual personalization — the ONE object. A draft (persistent), a ranking of three heroes in fixed
   slots, and the player's model. Nothing here is a second card: the same rows are read generically, then through the
   model, and the order is a transform between slots. The view (stage + three 0–1 numbers) is the only input; scroll,
   Storybook and tests all drive it the same way. Colour means one thing: neutral = generic / unchanged · cyan = retained
   context · pink = evidence changing the reading · lime = qualified, usable. */
import type { CSSProperties } from "react";
import { HeroIcon } from "@/design/canonical/hero-media";
import { Glass } from "@/design/canonical/primitives";
import { COUNTERFACTUAL as COPY } from "../copy";
import { MEMORY_SCENES } from "../memory-strip/fake-scenario-memory";
import { polygonPath, smoothPath } from "../memory-strip/geometry";
import { MEMORY_VIEWBOX } from "../memory-strip/types";
import { COUNTERFACTUAL_FIXTURE } from "./fake-scenario-counterfactual";
import { candidateSlots, factTone, modeOfStage, personalReasons, rankHeroes, stageIndex, tagsFor, type RankMode } from "./model";
import type { CounterfactualView } from "./scroll";
import type { CandidateFixture, CandidateTag, CounterfactualFixture, CounterfactualStage, DraftFixture, ModelFact } from "./types";
import "./counterfactual.css";

export interface CounterfactualObjectProps {
  fixture?: CounterfactualFixture;
  view: CounterfactualView;
  reducedMotion?: boolean;
}

const px = (n: number) => String(n);

function DraftStrip({ draft }: { draft: DraftFixture }) {
  return (
    <div className="cf-draft" data-draft-id={draft.id}>
      <p className="cf-draft-context">{draft.context}</p>
      <div className="cf-roster">
        <ul aria-label="Your supports" className="cf-roster-side">
          {draft.allies.map((hero) => <li key={hero.id}><HeroIcon hero={hero.id} name={hero.name} size="md" /></li>)}
          <li className="cf-you"><span>{draft.you}</span></li>
        </ul>
        <span aria-hidden="true" className="cf-vs">vs</span>
        <ul aria-label="Enemy picks" className="cf-roster-side">
          {draft.enemies.map((hero) => <li key={hero.id}><HeroIcon hero={hero.id} name={hero.name} size="md" /></li>)}
        </ul>
      </div>
    </div>
  );
}

function Tag({ tag }: { tag: CandidateTag }) {
  return <li className="cf-tag" data-dashed={tag.dashed ? "true" : "false"} data-factor={tag.id} data-tone={tag.tone}>{tag.text}</li>;
}

function rankLabel(fixture: CounterfactualFixture, hero: string, stage: CounterfactualStage, reorder: number) {
  const slots = candidateSlots(fixture).find((slot) => slot.hero === hero);
  if (!slots) return 1;
  const useTo = stageIndex(stage) >= stageIndex("reorder") && reorder >= 0.5;
  return (useTo ? slots.to : slots.from) + 1;
}

function RankRow({ candidate, fixture, stage, reorder }: { candidate: CandidateFixture; fixture: CounterfactualFixture; stage: CounterfactualStage; reorder: number }) {
  const slot = candidateSlots(fixture).find((entry) => entry.hero === candidate.hero.name);
  const tags = tagsFor(candidate, stage);
  const style = { "--cf-from": px(slot?.from ?? 0), "--cf-to": px(slot?.to ?? 0) } as CSSProperties;
  return (
    <li className="cf-row" data-evidence={candidate.history.evidence} data-hero={candidate.hero.name} data-role={slot?.role ?? "holds"} style={style}>
      <span className="cf-row-icon">
        <span aria-hidden="true" className="cf-rank-no">{rankLabel(fixture, candidate.hero.name, stage, reorder)}</span>
        <HeroIcon alt="" hero={candidate.hero.id} name={candidate.hero.name} size="lg" />
      </span>
      <div className="cf-row-body">
        <p className="cf-row-name">{candidate.hero.name}</p>
        <ul aria-label={`Evidence for ${candidate.hero.name}`} className="cf-tags">
          {tags.map((tag) => <Tag key={`${tag.id}:${tag.tone}:${tag.text}`} tag={tag} />)}
        </ul>
      </div>
    </li>
  );
}

/** The model's contour, from the Player Model scene itself: the same paths, nodes and open region, drawn small. */
function ModelContour({ idle }: { idle: boolean }) {
  const scene = MEMORY_SCENES["player-model"];
  const paths = scene.items.filter((item) => item.kind === "path");
  const nodes = scene.items.filter((item) => item.kind === "node");
  const region = scene.items.find((item) => item.kind === "region");
  const cut = scene.items.find((item) => item.kind === "contradiction");
  return (
    <svg aria-hidden="true" className="cf-contour" data-idle={idle ? "true" : "false"} focusable="false" viewBox={`0 0 ${MEMORY_VIEWBOX.w} ${MEMORY_VIEWBOX.h}`}>
      {region?.kind === "region" && <path className="cf-contour-region" d={polygonPath(region.points)} />}
      {paths.map((item) => item.kind === "path" && <path className="cf-contour-path" d={smoothPath(item.points)} data-relation={item.relation} data-tone={item.tone} key={item.id} />)}
      {nodes.map((item) => item.kind === "node" && <circle className="cf-contour-node" cx={item.at[0]} cy={item.at[1]} data-tone={item.tone} key={item.id} r={14} />)}
      {cut?.kind === "contradiction" && <circle className="cf-contour-cut" cx={cut.at[0]} cy={cut.at[1]} r={16} />}
    </svg>
  );
}

function Fact({ fact, stage }: { fact: ModelFact; stage: CounterfactualStage }) {
  return <li className="cf-fact" data-fact={fact.id} data-tone={factTone(fact.id, stage)}>{fact.text}</li>;
}

function ModelChip({ fixture, stage }: { fixture: CounterfactualFixture; stage: CounterfactualStage }) {
  const idle = stageIndex(stage) < stageIndex("context");
  return (
    <section aria-label={COPY.model.kicker} className="cf-model" data-state={idle ? "idle" : "active"}>
      <div className="cf-model-mark"><ModelContour idle={idle} /></div>
      <div className="cf-model-body">
        <p className="cf-model-head">
          <span className="cf-model-kicker">{COPY.model.kicker}</span>
          <span className="cf-model-state">{idle ? COPY.model.idle : COPY.model.active}</span>
        </p>
        <ul className="cf-facts">
          {fixture.facts.map((fact) => <Fact fact={fact} key={fact.id} stage={stage} />)}
        </ul>
      </div>
    </section>
  );
}

function modeLabel(stage: CounterfactualStage) {
  if (stage === "personal") return COPY.modes.personal;
  if (stage === "generic") return COPY.modes.generic;
  return COPY.modes.mixed;
}

function Copy({ stage }: { stage: CounterfactualStage }) {
  const text = COPY.stages[stage];
  return (
    <div className="cf-copy" data-stage={stage} key={stage}>
      <p className="cf-copy-kicker">{text.kicker}</p>
      <p className="cf-copy-line">{text.line}</p>
      <p className="cf-copy-note">{text.note}</p>
    </div>
  );
}

function readingSummary(fixture: CounterfactualFixture, mode: RankMode) {
  const order = rankHeroes(fixture, mode);
  if (mode === "generic") return `${COPY.modes.generic}: ${order.join(", then ")}.`;
  return `${COPY.modes.personal}: ${order.join(", then ")}. ${order[0]} leads because of ${personalReasons(fixture, order[0]).join(" and ")}.`;
}

export function CounterfactualObject({ fixture = COUNTERFACTUAL_FIXTURE, reducedMotion = false, view }: CounterfactualObjectProps) {
  const { stage } = view;
  const style = { "--cf-ctx": view.context, "--cf-p": view.reorder, "--cf-rein": view.reinterpret } as CSSProperties;
  const mode = modeOfStage(stage);
  const rows = mode === "personal" ? rankHeroes(fixture, "personal") : fixture.candidates.map((candidate) => candidate.hero.name);
  return (
    <div className="cf-host">
      <div className="cf" data-motion={reducedMotion ? "reduced" : "full"} data-stage={stage} style={style}>
        <div className="cf-layout">
          <Copy stage={stage} />
          <Glass className="cf-object" edge={stage === "personal"} surfaceLevel="3">
            <DraftStrip draft={fixture.draft} />
            <p className="cf-mode" data-mode={stage === "personal" ? "personal" : "generic"}>
              <span aria-hidden="true" className="cf-mode-dot" />
              <span className="cf-mode-text" key={modeLabel(stage)}>{modeLabel(stage)}</span>
            </p>
            <div className="cf-rank-host">
              <span aria-hidden="true" className="cf-frame" />
              <ol aria-label={readingSummary(fixture, mode)} className="cf-rank">
                {rows.map((hero) => {
                  const candidate = fixture.candidates.find((entry) => entry.hero.name === hero) as CandidateFixture;
                  return <RankRow candidate={candidate} fixture={fixture} key={hero} reorder={view.reorder} stage={stage} />;
                })}
              </ol>
            </div>
            <ModelChip fixture={fixture} stage={stage} />
          </Glass>
        </div>
        <p className="cf-illustrative">{COPY.illustrative}</p>
      </div>
    </div>
  );
}

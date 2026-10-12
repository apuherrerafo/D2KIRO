/* COUNTERFACTUAL LAB · ONE object being reinterpreted. The draft strip and the three rows never leave: the same rows are read
   for anyone, your games arrive (GATHER) and tie to the rows they speak to (TETHER), then the order settles (SETTLE) and the
   hero that rose is the call. Only the reading changes. Colour: neutral = for anyone · cyan = your evidence · lime = what
   resolves for you · pink = pressure (the hero your games move down). Transform/opacity only. */
"use client";

import { useRef, type CSSProperties } from "react";
import { HeroIcon } from "@/design/canonical/hero-media";
import { Glass } from "@/design/canonical/primitives";
import { useSettleFlip } from "@/design/canonical/motion/flip";
import { useCountTo } from "@/features/landing/hero-story/use-hero-story";
import { HeroCoach } from "../hero-loop/coach/HeroCoach";
import type { CoachCue } from "../hero-loop/loop";
import { rowsAt, signed, type BeatId, type Phase, type Row } from "./model";
import { COPY, DRAFT } from "./scenario";
import "../hero-loop/hero-loop.css";
import "./counterfactual-lab.css";

export type CounterfactualProps = {
  beat: BeatId;
  phase: Phase;
  coach: CoachCue;
  /** false = Coach hidden (?coach=0). */
  showCoach: boolean;
  reduced: boolean;
};

function Draft() {
  return (
    <div aria-label={`Draft, ${DRAFT.seat.label}`} className="cfl-draft" role="group">
      <ul aria-label="Allies" className="cfl-side">
        {DRAFT.allies.map((hero) => <li key={hero}><HeroIcon hero={hero} size="md" /></li>)}
        <li className="cfl-you"><span>You</span><b>{DRAFT.seat.label}</b></li>
      </ul>
      <span aria-hidden="true" className="cfl-vs">vs</span>
      <ul aria-label="Enemies" className="cfl-side">
        {DRAFT.enemies.map((hero) => <li key={hero}><HeroIcon hero={hero} size="md" /></li>)}
      </ul>
    </div>
  );
}

function RowView({ row, phase, reduced, index }: { row: Row; phase: Phase; reduced: boolean; index: number }) {
  const shown = useCountTo(row.fit, 800, reduced);
  const lead = row.rank === 1;
  const tether = row.evidenceShown ? (row.deltaShown ? (row.gamesDelta > 0 ? "resolved" : "pressure") : row.tone === "none" ? "none" : "evidence") : "off";
  return (
    <li
      className="cfl-row"
      data-flip-key={row.hero}
      data-hero={row.hero}
      data-lead={lead ? "true" : "false"}
      data-personal={phase === "personal" ? "true" : "false"}
      data-rank={row.rank}
      data-tether={tether}
      style={{ "--cfl-i": index } as CSSProperties}
    >
      <i aria-hidden="true" className="cfl-tether" />
      <span aria-hidden="true" className="cfl-rank">{row.rank}</span>
      <span className="cfl-icon"><HeroIcon hero={row.hero} size="lg" /></span>
      <div className="cfl-main">
        <p className="cfl-name">
          <span>{row.hero}</span>
          {lead && <em className="cfl-tag" data-kind={phase === "personal" ? "call" : "top"} key={phase === "personal" ? "call" : "top"}>{phase === "personal" ? COPY.call : COPY.topRead}</em>}
        </p>
        <p className="cfl-signal">{row.signal}</p>
        <p className="cfl-chips">
          <span className="cfl-chip" data-on={row.evidenceShown ? "true" : "false"} data-tone={row.tone}>{row.evidence}</span>
          {row.deltaShown && (
            <span className="cfl-chip cfl-delta" data-dir={row.gamesDelta > 0 ? "up" : "down"}>{`${signed(row.gamesDelta)} · ${COPY.cause}`}</span>
          )}
        </p>
      </div>
      <span className="cfl-score" data-moving={shown !== row.fit ? "true" : "false"}>
        <i>{COPY.fit}</i>
        <b>{shown}</b>
      </span>
    </li>
  );
}

function ModePill({ phase }: { phase: Phase }) {
  return (
    <p className="cfl-mode" data-phase={phase}>
      <span aria-hidden="true" className="cfl-mode-dot" />
      <span className="cfl-mode-text" key={phase}>{COPY.modes[phase]}</span>
    </p>
  );
}

function summary(phase: Phase, rows: Row[]) {
  const order = rows.map((r) => `${r.hero} FIT ${r.fit}`).join(", ");
  return `${COPY.modes[phase]}: ${order}.`;
}

export function Counterfactual({ beat, phase, coach, showCoach, reduced }: CounterfactualProps) {
  const rows = rowsAt(phase);
  const list = useRef<HTMLOListElement>(null);
  useSettleFlip(list, rows.map((r) => r.hero).join(">"), reduced);
  const quiet = beat === "quiet";
  return (
    <section aria-labelledby="cfl-title" className="cfl" data-beat={beat} data-motion={reduced ? "reduced" : "full"} data-phase={phase} data-testid="counterfactual">
      <header className="cfl-head">
        <p className="cfl-kicker">{COPY.kicker}</p>
        <h2 className="cfl-title" id="cfl-title">{COPY.title}</h2>
      </header>
      <Glass className="cfl-object" edge={phase === "personal"} surfaceLevel="3">
        <Draft />
        <ModePill phase={phase} />
        <ol aria-label={summary(phase, rows)} className="cfl-rows" ref={list}>
          {rows.map((row, index) => <RowView index={index} key={row.hero} phase={phase} reduced={reduced} row={row} />)}
        </ol>
      </Glass>
      <div className="cfl-foot" data-quiet={quiet ? "true" : "false"}>
        {showCoach && (
          <div className="cfl-coach" data-testid="cfl-coach">
            <HeroCoach beatKey={beat} cue={coach} mode={reduced ? "static" : "sprite"} />
          </div>
        )}
        <div className="cfl-caption" key={phase} data-testid="cfl-caption">
          <p className="cfl-line">{COPY.lines[phase]}</p>
          {phase === "personal" && <p className="cfl-note">{COPY.note}</p>}
        </div>
      </div>
      <p className="cfl-illustrative">{COPY.illustrative}</p>
    </section>
  );
}

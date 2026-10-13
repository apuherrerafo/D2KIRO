/* LANDING V2 · 4 · PROPOSITION. The page lets go of motion here: no second demo, just what stays on screen while you draft,
   in three promises with one small product fragment each. Every number comes from the same story fixture the Hero plays
   (draft A for the pick and the games, draft B for the "guessing" case), so the page cannot contradict itself. One reveal
   peak at most: the fragments fade in together once. The Coach is a small, still presence beside the third promise. */
"use client";

import { useRef } from "react";
import { HeroIcon } from "@/design/canonical/hero-media";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { LandingSection } from "@/features/landing/components/LandingSection";
import { useSeen } from "@/features/landing/hooks";
import { CANDIDATES, DRAFT } from "../counterfactual-lab/scenario";
import { rankAt } from "../hero-loop/loop";
import { stillUrl } from "../hero-loop/coach/coach-renderer";
import { PROPOSITION } from "./copy";
import { LOOP_SCENARIOS } from "./story/scenarios";

const A = LOOP_SCENARIOS[0];
const B = LOOP_SCENARIOS[1];

/** The personal read of draft A, best first: the pick and its two backups. */
const PICKS = rankAt(A, A.steps.length);
/** Draft B has nothing of the player's behind it: the leader of the draft read alone. */
const GUESS = rankAt(B, B.steps.length)[0];

function PickFragment() {
  return (
    <ol aria-label={PROPOSITION.promises[0].title} className="lv2-frag lv2-frag-picks">
      {PICKS.map((row, index) => (
        <li data-call={index === 0 ? "true" : "false"} key={row.hero}>
          <HeroIcon hero={row.hero} size="md" />
          <span className="lv2-frag-name">{row.hero}</span>
          <em className="lv2-frag-tag">{index === 0 ? PROPOSITION.call : PROPOSITION.backup}</em>
          <span className="lv2-frag-fit"><i>FIT</i><b>{row.fit}</b></span>
        </li>
      ))}
    </ol>
  );
}

function YoursFragment() {
  return (
    <div className="lv2-frag lv2-frag-yours" role="group" aria-label={PROPOSITION.promises[1].title}>
      <div className="lv2-frag-block">
        <p className="lv2-frag-label">{PROPOSITION.draft}</p>
        <ul className="lv2-frag-icons">
          {DRAFT.allies.map((hero) => <li key={hero}><HeroIcon hero={hero} size="sm" /></li>)}
          <li aria-hidden="true" className="lv2-frag-vs">vs</li>
          {DRAFT.enemies.map((hero) => <li key={hero}><HeroIcon hero={hero} size="sm" /></li>)}
        </ul>
        <p className="lv2-frag-seat">{PROPOSITION.seatLabel}: {DRAFT.seat.label}</p>
      </div>
      <div className="lv2-frag-block">
        <p className="lv2-frag-label">{PROPOSITION.games}</p>
        <ul className="lv2-frag-chips">
          {CANDIDATES.map((c) => (
            <li key={c.hero}>
              <span>{c.hero}</span>
              <em className="lv2-chip" data-tone={c.tone}>{c.evidence}</em>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function GuessFragment() {
  return (
    <div className="lv2-frag lv2-frag-guess" role="group" aria-label={PROPOSITION.promises[2].title}>
      <p className="lv2-frag-label">{B.seat.label}</p>
      <div className="lv2-frag-row">
        <HeroIcon hero={GUESS.hero} size="md" />
        <span className="lv2-frag-name">{GUESS.hero}</span>
        <span className="lv2-frag-fit"><i>FIT</i><b>{GUESS.fit}</b></span>
      </div>
      <p className="lv2-frag-marks">
        <em className="lv2-chip" data-tone="draft">{PROPOSITION.draftReadOnly}</em>
        <em className="lv2-chip" data-tone="none">{PROPOSITION.noHistory}</em>
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a 512px pre-rendered still, shown small and still */}
      <img alt="" aria-hidden="true" className="lv2-frag-coach" height={512} src={stillUrl({ aim: "left", state: "watching" })} width={512} />
    </div>
  );
}

const FRAGMENTS = [PickFragment, YoursFragment, GuessFragment] as const;

export function PropositionSection() {
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const seen = useSeen(host, reduced);
  return (
    <LandingSection id="proposition" kicker={PROPOSITION.kicker} lede={PROPOSITION.lede} title={PROPOSITION.title}>
      <div className="lv2-prop" data-seen={seen ? "true" : "false"} ref={host}>
        <ol aria-label={PROPOSITION.title} className="lv2-promises">
          {PROPOSITION.promises.map((promise, index) => {
            const Fragment = FRAGMENTS[index];
            return (
              <li className="lv2-promise" key={promise.id} style={{ "--lv2-i": index } as React.CSSProperties}>
                <span aria-hidden="true" className="ld-point-index">{String(index + 1).padStart(2, "0")}</span>
                <h3 className="ld-point-title">{promise.title}</h3>
                <p className="ld-point-body">{promise.body}</p>
                <Fragment />
              </li>
            );
          })}
        </ol>
        <p className="ld-illustrative">{PROPOSITION.fitNote} {PROPOSITION.illustrative}.</p>
      </div>
    </LandingSection>
  );
}

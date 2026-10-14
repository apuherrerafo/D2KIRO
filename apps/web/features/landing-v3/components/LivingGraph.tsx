/* LANDING V3 · 4 · THE LIVING DECISION GRAPH, the page's one expressive peak. A sticky stage: scroll selects the beat (01..06),
   each beat plays by itself. One persistent Draft A. Reduced motion = three understandable stills (for anyone → your games enter → for you),
   chosen by CSS the moment the page paints and built when the page hydrates. */
"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { BEATS, GRAPH } from "../copy";
import { NARROW_QUERY, useMediaQuery, useNearOnce, useReducedMotion } from "../hooks";
import { BEAT_COUNT, STILL_BEATS } from "../graph/model";
import { makeStage } from "../graph/stage";
import { useStoryController } from "../graph/use-story-controller";

const TONE_VAR: Record<string, string> = { cyan: "var(--cyan)", pink: "var(--pink)", faint: "var(--faint-line)", lime: "var(--lime)" };
const CAPTION_SWAP_MS = 200;

/** The caption lags the beat by one short fade, so the words never change under the reader's eye (reduced motion: no fade, no lag). */
function useCaption(beat: number, reduced: boolean): { shown: number; swapping: boolean } {
  const [shown, setShown] = useState(1);
  const swapping = !reduced && beat !== shown;
  useEffect(() => {
    if (reduced || beat === shown) return;
    const timer = window.setTimeout(() => setShown(beat), CAPTION_SWAP_MS);
    return () => window.clearTimeout(timer);
  }, [beat, shown, reduced]);
  return { shown: reduced ? beat : shown, swapping };
}

function Legend() {
  return (
    <ul aria-label={GRAPH.legendLabel} className="legend">
      {GRAPH.legend.map((item) => (
        <li key={item.label}>
          <i className={item.style === "solid" ? undefined : item.style} style={{ "--c": TONE_VAR[item.tone] } as CSSProperties} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Reduced motion: the same stage, drawn three times as a still. */
function StillStates({ narrow, reduced }: { narrow: boolean; reduced: boolean }) {
  const hosts = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => {
    if (!reduced) return;
    const stages = STILL_BEATS.map((beat, i) => {
      const host = hosts.current[i];
      if (!host) return null;
      const stage = makeStage(host, narrow ? "tall" : "wide", true, true);
      stage.setBeat(beat, true);
      return stage;
    });
    return () => stages.forEach((stage) => stage?.destroy());
  }, [reduced, narrow]);
  return (
    <div className="wrap story-static" data-testid="graph-stills">
      {STILL_BEATS.map((beat, i) => (
        <figure className="rm-fig" key={beat}>
          <figcaption>
            <p className="kicker"><b>0{i + 1}</b> / 03 · {GRAPH.stillLabels[i]}</p>
            <p className="st-title">{BEATS[beat - 1].title}</p>
            <p className="st-sub">{BEATS[beat - 1].sub}</p>
            <p className="note" style={{ marginTop: 14 }}>Illustrative draft</p>
          </figcaption>
          <div className={`rm-host ${narrow ? "tall" : ""}`} ref={(node) => void (hosts.current[i] = node)} />
        </figure>
      ))}
    </div>
  );
}

export function LivingGraph() {
  const reduced = useReducedMotion();
  const narrow = useMediaQuery(NARROW_QUERY);
  const story = useRef<HTMLDivElement>(null);
  const stick = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const near = useNearOnce(story);
  const { beat, goto } = useStoryController({ story, stick, host, active: near, narrow, reduced });
  const { shown, swapping } = useCaption(beat, reduced);

  function handleRail(event: MouseEvent<HTMLButtonElement>) {
    goto(Number(event.currentTarget.dataset.beat));
  }
  const caption = BEATS[shown - 1];

  return (
    <section aria-labelledby="graph-title" className="graph-sec" data-testid="graph" id="graph">
      <h2 className="sr-only" id="graph-title">{GRAPH.title}</h2>
      <div className="story" data-k={beat} data-testid="graph-story" id="story" ref={story}>
        <div className="stick" ref={stick}>
          <div className="wrap st-in">
            <div className="st-head">
              <div aria-live="polite" className={`st-cap${swapping ? " swap" : ""}`}>
                <p className="kicker"><b>{caption.n}</b> / 0{BEAT_COUNT} · <span>{caption.k}</span></p>
                <p className="st-title" data-testid="graph-caption">{caption.title}</p>
                <p className="st-sub">{caption.sub}</p>
              </div>
              <ol aria-label={GRAPH.railLabel} className="st-rail">
                {BEATS.map((b, i) => (
                  <li key={b.n}>
                    <button
                      aria-current={beat === i + 1 ? "step" : undefined}
                      aria-label={`Beat ${i + 1}: ${b.k}`}
                      className="rail-b"
                      data-beat={i + 1}
                      data-done={beat > i + 1 ? "" : undefined}
                      data-tone={b.tone}
                      onClick={handleRail}
                      type="button"
                    >
                      {b.n}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
            <div className="st-stage" data-testid="graph-stage" ref={host} />
            <div className="st-foot">
              <Legend />
              <p className="note">{GRAPH.note}</p>
            </div>
          </div>
          <span aria-hidden="true" className="st-drop" />
        </div>
      </div>
      <StillStates narrow={narrow} reduced={reduced} />
    </section>
  );
}

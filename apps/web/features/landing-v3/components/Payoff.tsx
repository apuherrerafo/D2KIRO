/* LANDING V3 · 5 · PAYOFF. "Same draft. Different player. Different pick." The graph is not replayed: this is its result, as a card
   the lime thread runs into. Queen of Pain #1 → #2 (84 → 83) · Puck #2 → #1 (82 → 88) · Void Spirit #3 → #3 (77). */
import type { CSSProperties } from "react";
import { HeroIcon } from "@/design/canonical/hero-media";
import { RankMove } from "@/design/canonical/primitives/Delta";
import { Glass } from "@/design/canonical/primitives/Glass";
import { PAYOFF, TRUST } from "../copy";
import { HEROES, ranking, signed, type Candidate } from "../fixture";

type Move = "up" | "down" | "same";

/* RankMove's own screen-reader text is Spanish; this page is English, so it is hidden and spoken here instead. */
function rankSpeech(c: Candidate, move: Move) {
  const by = Math.abs(c.you.slot - c.anyone.slot);
  if (move === "same") return `stays at rank ${c.you.slot + 1}`;
  return `moves ${move} ${by} ${by === 1 ? "place" : "places"}`;
}

function moveOf(c: Candidate): Move {
  if (c.you.slot < c.anyone.slot) return "up";
  if (c.you.slot > c.anyone.slot) return "down";
  return "same";
}

/** "was 82" / "was 84 · −1" / "no history yet": what the personal reading did to this hero's score (the lift shows in the reasons). */
function wasLine(c: Candidate): string {
  if (!c.games) return PAYOFF.noHistory;
  const loss = c.games.delta < 0 ? ` · ${signed(c.games.delta)}` : "";
  return `${PAYOFF.was} ${c.anyone.fit}${loss}`;
}

function PayRow({ c }: { c: Candidate }) {
  const move = moveOf(c);
  const win = c.you.slot === 0;
  const hero = HEROES[c.hero];
  return (
    <li className={`pay-row${win ? " win" : ""}`}>
      <div className="pr-main">
        <span className="rk">#{c.you.slot + 1}</span>
        <HeroIcon hero={hero.name} lit={win} size="lg" />
        <span className="nm">
          <b>{hero.name}</b>
          <span className={`mv2 ${move}`}>
            {move === "same" ? <span aria-hidden="true">=</span> : <span aria-hidden="true"><RankMove by={Math.abs(c.you.slot - c.anyone.slot)} dir={move} /></span>}
            <span className="cx-sr">{rankSpeech(c, move)}</span>
            <span>#{c.anyone.slot + 1} → #{c.you.slot + 1}</span>
          </span>
        </span>
        <span className="fit"><i>FIT</i><b>{c.you.fit}</b><em className="was">{wasLine(c)}</em></span>
      </div>
      {win && (
        <ul aria-label={PAYOFF.whyLabel} className="why">
          {TRUST.proof.slice(0, 3).map((reason, i) => (
            <li key={reason.key}>{reason.line}{i === 2 && c.games && <em>{signed(c.games.delta)}</em>}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function Payoff() {
  return (
    <section aria-labelledby="payoff-title" className="payoff" id="payoff">
      <div className="wrap payoff-wrap" id="payoff-wrap">
        <span aria-hidden="true" className="payoff-line" id="payoff-line" />
        <div className="pay-grid">
          <div className="pay-copy">
            <div>
              <p className="kicker">{PAYOFF.kicker}</p>
              <h2 className="h2" id="payoff-title"><span>{PAYOFF.lineOne}</span><span>{PAYOFF.lineTwo}</span><span className="lime">{PAYOFF.lineThree}</span></h2>
            </div>
            <p className="lede">{PAYOFF.lede}</p>
            <ol aria-label={PAYOFF.stepsLabel} className="steps">
              {PAYOFF.steps.map((step) => (
                <li key={step.title} style={step.tone ? ({ "--c": `var(--${step.tone})` } as CSSProperties) : undefined}>
                  <div><b>{step.title}</b><span>{step.body}</span></div>
                </li>
              ))}
            </ol>
            <div aria-hidden="true" className="pay-coach">
              {/* eslint-disable-next-line @next/next/no-img-element -- fixed pre-rendered raster */}
              <img alt="" height={120} loading="lazy" src="/coach-web-pack/memory/pointing-rd.webp" width={120} />
              <span className="state-pill"><i style={{ background: "var(--lime)" }} />Pointing</span>
            </div>
          </div>
          <div id="pay-card" data-testid="payoff-card">
            <Glass className="pay-card" edge surfaceLevel="4">
              <div className="pay-top"><span className="kicker">{PAYOFF.cardKicker}</span><span className="note">{PAYOFF.illustrative}</span></div>
              <ol className="pay-rows">{ranking("you").map((c) => <PayRow c={c} key={c.id} />)}</ol>
              <p className="note pay-foot">{PAYOFF.fitNote}</p>
            </Glass>
          </div>
        </div>
      </div>
    </section>
  );
}

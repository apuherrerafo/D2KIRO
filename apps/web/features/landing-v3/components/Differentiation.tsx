/* LANDING V3 · 3 · DIFFERENTIATION. "The meta knows the game. D2KIRO knows your game." The generic read comes first; the figure
   (a client island) shows Draft A's ranking for anyone with "your games" starting to connect. No comparison table, no brand named. */
import { DIFF } from "../copy";
import { DiffFigure } from "./DiffFigure";

export function Differentiation() {
  return (
    <section aria-labelledby="diff-title" className="diff">
      <div className="wrap">
        <p className="kicker">{DIFF.kicker}<b>{DIFF.kickerPlayer}</b></p>
        <h2 className="statement" id="diff-title"><span>{DIFF.lineOne}</span><span className="second">{DIFF.lineTwo}</span></h2>
        <div className="diff-grid">
          <div className="ctx">
            <div className="ctx-item"><h3>{DIFF.anyoneTitle}</h3><p>{DIFF.anyoneBody}</p></div>
            <div className="ctx-item player"><h3>{DIFF.gamesTitle}</h3><p>{DIFF.gamesBody}</p></div>
          </div>
          <DiffFigure />
        </div>
      </div>
    </section>
  );
}

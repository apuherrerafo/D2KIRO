/* LANDING V3 · the Hero's product view: the draft, the evidence chips and the unresolved Top 3 for Draft A.
   It is server-rendered and static; the Hero stage (a client island) measures it and walks the Coach around it. */
import { HERO } from "../copy";
import { HEROES, ranking } from "../fixture";
import { SUB } from "../graph/model";
import { MotionToggle } from "./MotionToggle";
import { Tile } from "./Tile";

const CHIPS = [
  { tone: "c", key: "COUNTER", text: "vs Axe" },
  { tone: "c", key: "COUNTER", text: "vs Slark" },
  { tone: "c", key: "SYNERGY", text: "Your supports" },
  { tone: "p", key: "YOUR GAMES", text: "Not read yet" },
] as const;

function railState(index: number): "done" | "now" | undefined {
  if (index < 2) return "done";
  if (index === 2) return "now";
  return undefined;
}

function EmptySlots({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => <span aria-hidden="true" className="tile empty" key={i} />);
}

export function ProductCard() {
  return (
    <div aria-label={HERO.productLabel} className="product">
      <ol aria-label={HERO.railLabel} className="rail">
        {HERO.rail.map((step, i) => <li data-s={railState(i)} key={step}>{step}</li>)}
      </ol>
      <div className="product-body">
        <div className="coach-zone">
          {/* static placeholder until the stage has measured; the same still the Coach player shows first, so there is never a blank Coach */}
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed pre-rendered raster */}
          <img alt={HERO.coachAlt} fetchPriority="high" height={200} src="/coach-web-pack/hero/watching-c.webp" width={200} />
          <div className="coach-state"><span className="state-pill"><i />Watching</span></div>
        </div>
        <div className="product-main">
          <div className="card draft">
            <div className="draft-head">{HERO.cardHead} <span>{HERO.cardSeat}</span></div>
            <div className="draft-row"><span>{HERO.enemy}</span>
              <div className="slots"><Tile hero="AX" /><Tile hero="SL" /><EmptySlots count={3} /></div>
            </div>
            <div className="draft-row"><span>{HERO.team}</span>
              <div className="slots">
                <span className="tile you" title="You, mid">YOU<br />MID</span>
                <Tile hero="ES" /><Tile hero="CM" /><EmptySlots count={2} />
              </div>
            </div>
          </div>
          <div className="chips">
            {CHIPS.map((chip) => <span className={`chip ${chip.tone}`} key={chip.text}><b>{chip.key}</b>{chip.text}</span>)}
          </div>
          <ol aria-label={HERO.rankLabel} className="rank">
            {ranking("anyone").map((c) => (
              <li className="card" key={c.id}>
                <span className="rk">#{c.anyone.slot + 1}</span>
                <Tile hero={c.hero} size="lg" />
                <span className="nm"><b>{HEROES[c.hero].name}</b><small>{SUB[c.id][0][0]}</small></span>
                <span className="fit"><i>FIT</i><b>{c.anyone.fit}</b></span>
              </li>
            ))}
          </ol>
          <div className="rank-foot">
            <span className="pending"><i />{HERO.pending}</span>
            <span className="illus">{HERO.illustrative}</span>
            <MotionToggle />
          </div>
        </div>
      </div>
    </div>
  );
}

/* LANDING V3 · 7 · BUILT FOR YOUR NEXT DRAFT. The practical / search-facing chapter: concise editorial rows in plain words, calm, no motion.
   It covers what D2KIRO reads and gives (draft context, ally/enemy picks, role, counters, synergy, personalised recommendations, why they
   change, the Top 3) and what it is built around, without promising anything that is not shipped. */
import { PRACTICAL } from "../copy";

function Body({ text, em }: { text: string; em?: string }) {
  if (!em || !text.includes(em)) return <>{text}</>;
  const [before, after] = text.split(em);
  return <>{before}<em>{em}</em>{after}</>;
}

export function Practical() {
  return (
    <section aria-labelledby="prac-title" className="practical" id="practical">
      <div className="wrap prac-grid">
        <div>
          <p className="kicker">{PRACTICAL.kicker}</p>
          <h2 className="h2" id="prac-title">{PRACTICAL.title}</h2>
          <p className="lede">{PRACTICAL.lede}</p>
        </div>
        <dl className="qa">
          {PRACTICAL.rows.map((row) => (
            <div key={row.term}>
              <dt>{row.term}</dt>
              <dd><Body em={"em" in row ? row.em : undefined} text={row.body} /></dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

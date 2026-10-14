/* LANDING V3 · 8 · FAQ. Five useful questions as native <details> (keyboard and screen-reader friendly, no script). The FAQPage JSON-LD in
   the page head is generated from the same items. */
import { FAQ } from "../copy";

export function Faq() {
  return (
    <section aria-labelledby="faq-title" className="faq" id="faq">
      <div className="wrap faq-grid">
        <div>
          <p className="kicker">{FAQ.kicker}</p>
          <h2 className="h2" id="faq-title">{FAQ.title}</h2>
        </div>
        <div className="faq-list">
          {FAQ.items.map((item) => (
            <details key={item.q}><summary>{item.q}</summary><p>{item.a}</p></details>
          ))}
        </div>
      </div>
    </section>
  );
}

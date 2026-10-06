/* Delta + rank movement (Council B + C, CONSENSUS).
   A value delta is a SIGN and a number in a trailing cell: `+2,4`, `−0,8` (U+2212), `0,0`. The sign is
   the colour-blind-safe cue; colour is a tint. No ▲/▼ font glyphs — none of the eight local families
   contains U+25B2/U+25BC, so they rendered through an OS fallback.
   A rank movement is different (a "+2" is ambiguous when rank 3 → 1 lowers the number): it gets a
   drawn 6 × 5 px CSS mark plus the count, and an accessible sentence. */

export type DeltaDirection = "up" | "down" | "flat";

/* Number punctuation is LOCALE-AWARE (Julio, Canonical V1.1 human lock #4): the decimal mark comes from the
   viewer's locale through Intl, never from a constant. The product language is Spanish, so `es` is the
   default; pass another BCP 47 tag to change it. Only the sign is ours: a true minus (U+2212). Terminal
   abbreviations (conf. / edge.NN / n=) are never restored — see Master D. */
export const DEFAULT_LOCALE = "es";
const MINUS = "−";

export function formatDecimal(value: number, digits = 1, locale: string = DEFAULT_LOCALE) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits, useGrouping: false }).format(Math.abs(value));
}

export function formatSigned(value: number, digits = 1, locale: string = DEFAULT_LOCALE) {
  if (value === 0) return formatDecimal(0, digits, locale);
  const sign = value > 0 ? "+" : MINUS;
  return `${sign}${formatDecimal(value, digits, locale)}`;
}

export function directionOf(value: number): DeltaDirection {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

function DeltaUnit({ unit }: { unit?: string }) {
  if (!unit) return null;
  return <span className="cx-delta-unit">{unit}</span>;
}

export function Delta({ digits = 1, locale, unit, value }: { digits?: number; locale?: string; unit?: string; value: number }) {
  return (
    <span className="cx-delta" data-dir={directionOf(value)}>
      {formatSigned(value, digits, locale)}
      <DeltaUnit unit={unit} />
    </span>
  );
}

const RANK_WORDS: Record<Exclude<DeltaDirection, "flat">, string> = { up: "sube", down: "baja" };

export function RankMove({ by, dir }: { by: number; dir: Exclude<DeltaDirection, "flat"> }) {
  const places = by === 1 ? "puesto" : "puestos";
  return (
    <span className="cx-rank" data-dir={dir}>
      <i aria-hidden="true" className="cx-rank-mark" />
      <span aria-hidden="true">{by}</span>
      <span className="cx-sr">{`${RANK_WORDS[dir]} ${by} ${places}`}</span>
    </span>
  );
}

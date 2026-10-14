/* LANDING V3 · a hero monogram tile (never game art). Size is a CSS modifier: "sm" | "lg" | none. */
import { HEROES, type HeroKey } from "../fixture";

export function Tile({ hero, size }: { hero: HeroKey; size?: "sm" | "lg" }) {
  const className = ["tile", `t-${hero.toLowerCase()}`, size].filter(Boolean).join(" ");
  return <span className={className} title={HEROES[hero].name}>{hero}</span>;
}

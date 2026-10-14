/* LANDING V3 · Draft A, the ONE persistent illustrative draft every chapter reads.
   You: Position 2 / Mid · Enemies: Axe, Slark · Supports: Earth Spirit, Crystal Maiden.
   FOR ANYONE  #1 Queen of Pain 84 · #2 Puck 82 · #3 Void Spirit 77
   YOUR GAMES  Puck +6 (often played) · Queen of Pain −1 (some history) · Void Spirit (no history yet)
   FOR YOU     #1 Puck 88 · #2 Queen of Pain 83 · #3 Void Spirit 77
   Illustrative: none of these numbers is a statistic. Hero art is the canonical HeroIcon / HeroPortrait media (real Dota portraits). */

export type HeroKey = "AX" | "SL" | "ES" | "CM" | "QP" | "PK" | "VS";

export interface Hero {
  key: HeroKey;
  /** Canonical hero name: resolves through `getCanonicalHero`, so the DOM (HeroIcon) and the SVG figures read the same portrait. */
  name: string;
}

export const HEROES: Record<HeroKey, Hero> = {
  AX: { key: "AX", name: "Axe" },
  SL: { key: "SL", name: "Slark" },
  ES: { key: "ES", name: "Earth Spirit" },
  CM: { key: "CM", name: "Crystal Maiden" },
  QP: { key: "QP", name: "Queen of Pain" },
  PK: { key: "PK", name: "Puck" },
  VS: { key: "VS", name: "Void Spirit" },
};

export const SEAT = { position: 2, lane: "Mid" } as const;
export const ENEMIES: readonly HeroKey[] = ["AX", "SL"];
export const SUPPORTS: readonly HeroKey[] = ["ES", "CM"];

export type CandidateId = "qop" | "puck" | "vs";

export interface Candidate {
  id: CandidateId;
  hero: HeroKey;
  /** FOR ANYONE score and 0-based slot. */
  anyone: { fit: number; slot: number };
  /** FOR YOU score and 0-based slot, once the player's games have entered. */
  you: { fit: number; slot: number };
  /** The effect of the player's games on this hero; null = no history yet. */
  games: { delta: number; label: "Often played" | "Some history" } | null;
}

export const CANDIDATES: readonly Candidate[] = [
  { id: "qop", hero: "QP", anyone: { fit: 84, slot: 0 }, you: { fit: 83, slot: 1 }, games: { delta: -1, label: "Some history" } },
  { id: "puck", hero: "PK", anyone: { fit: 82, slot: 1 }, you: { fit: 88, slot: 0 }, games: { delta: 6, label: "Often played" } },
  { id: "vs", hero: "VS", anyone: { fit: 77, slot: 2 }, you: { fit: 77, slot: 2 }, games: null },
];

export function candidate(id: CandidateId): Candidate {
  const found = CANDIDATES.find((c) => c.id === id);
  if (!found) throw new Error(`unknown candidate ${id}`);
  return found;
}

/** "+6" / "−1" with a true minus sign, as printed on the page. */
export function signed(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return "0";
}

/** The two rankings, best first. */
export function ranking(kind: "anyone" | "you"): Candidate[] {
  return [...CANDIDATES].sort((a, b) => a[kind].slot - b[kind].slot);
}

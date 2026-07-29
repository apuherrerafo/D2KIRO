// Mismo shape que el contrato de dominio de apps/engine (SPEC.md §9.4/§9.5) -- `hero`, no
// `heroId`: el borde de la API ya traduce el nombre de columna interno, esto es lo que el
// servidor devuelve/espera tal cual.
export interface HeroPoolEntry {
  hero: number;
  source: "manual" | "calculated";
  personalWinrate: number | null;
  personalGames: number;
  updatedAt: string;
}

// Cuerpo del PUT -- sin `updatedAt`, el servidor siempre estampa el suyo (TSK-020).
export interface HeroPoolPutEntry {
  hero: number;
  source: "manual" | "calculated";
  personalWinrate: number | null;
  personalGames: number;
}

export interface CalculatePoolResult {
  proposed: HeroPoolEntry[];
  baselineWinrate: number;
  consideredHeroes: number;
  windowDays: number;
}

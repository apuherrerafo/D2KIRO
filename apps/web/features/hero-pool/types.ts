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

// TSK-025 (SPEC.md §9.6): los estados del flujo de "calcular desde mis partidas", explicados en
// llano -- mismo estándar que los 6 estados de la vista de draft de fase 1, ninguno se calla.
export type CalculateStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "invalid_account" }
  | { kind: "in_progress" }
  | { kind: "unavailable" }
  | { kind: "proposal"; result: CalculatePoolResult };

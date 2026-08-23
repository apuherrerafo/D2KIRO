// Los 4 atributos nativos de Dota 2 (incluye Universal, vigente desde 7.33) -- mismo orden en
// que la interfaz oficial del juego los muestra en la pantalla de selección de héroe.
export type HeroAttribute = "str" | "agi" | "int" | "all";

export const ATTRIBUTE_ORDER: HeroAttribute[] = ["str", "agi", "int", "all"];

export const ATTRIBUTE_LABELS: Record<HeroAttribute, string> = {
  str: "Fuerza",
  agi: "Agilidad",
  int: "Inteligencia",
  all: "Universal",
};

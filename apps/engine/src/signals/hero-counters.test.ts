import { expect, test } from "bun:test";
import { loadHeroCounters, parseHeroCounters } from "./hero-counters";

// Smoke test contra el archivo real -- estructural, no de contenido (familia S9,
// testing-seams.md): verifica que carga y tiene forma válida, nunca un counter puntual de un
// héroe (eso se rompería en silencio cada vez que se cura el archivo tras un parche).
test("loadHeroCounters() carga el archivo real: entradas válidas, sin víctimas ni vs duplicados", () => {
  const counters = loadHeroCounters();

  expect(counters.size).toBeGreaterThan(0);
  for (const [victim, entries] of counters) {
    expect(Number.isInteger(victim)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
    const seen = new Set<number>();
    for (const entry of entries) {
      expect(["hard", "medium"]).toContain(entry.level);
      expect(typeof entry.why).toBe("string");
      expect(entry.why.trim().length).toBeGreaterThan(0);
      expect(seen.has(entry.vs)).toBe(false);
      seen.add(entry.vs);
    }
  }
});

// El resto usa parseHeroCounters con fixtures sintéticos -- nunca el archivo real (familia S9):
// la lógica de validación de borde no puede depender de qué counters estén curados hoy.

test("parseHeroCounters conserva las entradas válidas keyed por víctima", () => {
  const raw = {
    "59": [
      { vs: 68, level: "hard", why: "Ice Blast bloquea toda tu curación" },
      { vs: 36, level: "medium", why: "Heartstopper Aura castiga tu vida alta" },
    ],
    "1": [{ vs: 104, level: "hard", why: "Duel te obliga a pelear sin Blink" }],
  };

  const result = parseHeroCounters(raw);

  expect(result.get(59)).toEqual([
    { vs: 68, level: "hard", why: "Ice Blast bloquea toda tu curación" },
    { vs: 36, level: "medium", why: "Heartstopper Aura castiga tu vida alta" },
  ]);
  expect(result.get(1)).toEqual([{ vs: 104, level: "hard", why: "Duel te obliga a pelear sin Blink" }]);
});

test("parseHeroCounters descarta cada forma de entrada malformada sin tirar el resto", () => {
  const raw = {
    "59": [
      { vs: 68, level: "hard", why: "válida" },
      { vs: 36, level: "lethal", why: "level fuera de la unión" },
      { vs: 37, level: "medium", why: "" },
      { vs: 37, level: "medium", why: "   " },
      { vs: 2.5, level: "hard", why: "vs no entero" },
      { vs: 999999, level: "hard", why: "vs desconocido (no está en CURATED_HERO_IDS)" },
      { vs: 26, why: "sin level" },
      { level: "hard", why: "sin vs" },
      "no es un objeto",
      null,
      { vs: 68, level: "medium", why: "vs duplicado -- se descarta, gana la primera" },
    ],
    "not-a-hero": [{ vs: 68, level: "hard", why: "clave de víctima no numérica" }],
    "999999": [{ vs: 68, level: "hard", why: "víctima desconocida" }],
    "88": "no es un array",
    "90": [{ vs: 26, level: "banana", why: "sola entrada, inválida" }],
  };

  const result = parseHeroCounters(raw);

  expect([...result.keys()]).toEqual([59]);
  expect(result.get(59)).toEqual([{ vs: 68, level: "hard", why: "válida" }]);
});

test("parseHeroCounters con la raíz corrupta devuelve un Map vacío sin lanzar", () => {
  expect(parseHeroCounters(null).size).toBe(0);
  expect(parseHeroCounters(undefined).size).toBe(0);
  expect(parseHeroCounters([]).size).toBe(0);
  expect(parseHeroCounters("nope").size).toBe(0);
  expect(parseHeroCounters(42).size).toBe(0);
  expect(parseHeroCounters({}).size).toBe(0);
});

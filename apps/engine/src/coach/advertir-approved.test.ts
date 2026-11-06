import { describe, expect, test } from "bun:test";
import { ADVERTIR_APPROVED_SCHEMA, advertirKey, parseAdvertirApproved } from "./advertir-approved";

// El filtro de ADVERTIR se valida en el borde (mismo criterio que loadHeroCounters): archivo roto -> vacío (la sección no avisa nada), entrada
// rota -> se descarta sola. Fixtures inline: nunca se lee advertir-approved.json real. Los ids son ids de héroe válidos del juego (2 Axe,
// 12 Phantom Lancer, 50 Dazzle, 7 Earthshaker), no dependen del contenido del archivo.

const valid = (relations: unknown[]) => ({ schema: ADVERTIR_APPROVED_SCHEMA, relations });
const entry = (counter: unknown, victim: unknown, status: unknown = "VALIDATED_HARD") => ({ counter, victim, status });

describe("parseAdvertirApproved", () => {
  test("un archivo válido da las claves counter>víctima de las relaciones VALIDATED_HARD", () => {
    const approved = parseAdvertirApproved(valid([entry(7, 12), entry(2, 50)]));
    expect([...approved].sort()).toEqual([advertirKey(2, 50), advertirKey(7, 12)].sort());
  });

  test("raíz rota, esquema distinto o sin lista -> vacío (fail-safe: no se avisa nada), nunca lanza", () => {
    for (const raw of [null, undefined, 42, "x", [], {}, { schema: "otro/v1", relations: [entry(2, 50)] }, { schema: ADVERTIR_APPROVED_SCHEMA, relations: "x" }]) {
      expect(parseAdvertirApproved(raw).size).toBe(0);
    }
  });

  test("solo VALIDATED_HARD habilita: CONDITIONAL, MEDIUM o sin estado se descartan (nunca ensanchan el filtro)", () => {
    const approved = parseAdvertirApproved(valid([entry(2, 50, "CONDITIONAL"), entry(2, 12, "MEDIUM"), entry(7, 12, undefined), entry(7, 12)]));
    expect([...approved]).toEqual([advertirKey(7, 12)]);
  });

  test("entradas rotas se descartan solas: héroe desconocido, no entero, mismo héroe en ambos lados, no objeto", () => {
    const approved = parseAdvertirApproved(valid([entry(99999, 12), entry("2", 50), entry(2.5, 50), entry(12, 12), null, "x", entry(2, 50)]));
    expect([...approved]).toEqual([advertirKey(2, 50)]);
  });

  test("la clave conserva la dirección", () => {
    expect(advertirKey(2, 50)).toBe("2>50");
    expect(advertirKey(2, 50)).not.toBe(advertirKey(50, 2));
  });
});

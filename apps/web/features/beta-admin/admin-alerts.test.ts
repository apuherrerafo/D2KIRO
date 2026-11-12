import { describe, expect, test } from "bun:test";
import { BASELINE_KEY, claimFreshRequests, decideAlerts, readBaseline, readSoundEnabled, writeSoundEnabled, type KeyValueStore, type PendingRequest } from "./admin-alerts";

function request(ref: string, at: number): PendingRequest {
  return { ref, personaName: ref, avatarUrl: null, at, message: null };
}

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

describe("avisos del administrador: qué es nuevo", () => {
  test("la primera vez solo fija la marca: las solicitudes viejas nunca suenan", () => {
    const decision = decideAlerts([request("a", 100), request("b", 200)], null);
    expect(decision.fresh).toEqual([]);
    expect(decision.nextBaseline).toBe(200);
  });

  test("una solicitud posterior a la marca es nueva; la ya avisada no", () => {
    const decision = decideAlerts([request("a", 100), request("b", 300)], 200);
    expect(decision.fresh.map((item) => item.ref)).toEqual(["b"]);
    expect(decision.nextBaseline).toBe(300);
    expect(decideAlerts([request("a", 100), request("b", 300)], 300).fresh).toEqual([]);
  });

  test("aprobar o rechazar (la lista se achica) nunca baja la marca ni hace sonar", () => {
    const decision = decideAlerts([request("a", 100)], 300);
    expect(decision.fresh).toEqual([]);
    expect(decision.nextBaseline).toBe(300);
  });

  test("refrescar la página: la marca guardada evita repetir el sonido", () => {
    const store = memoryStore();
    expect(claimFreshRequests(store, [request("a", 100)])).toEqual([]);
    expect(claimFreshRequests(store, [request("a", 100), request("b", 200)]).map((item) => item.ref)).toEqual(["b"]);
    // «recarga»: mismos datos, misma marca guardada
    expect(claimFreshRequests(store, [request("a", 100), request("b", 200)])).toEqual([]);
  });

  test("dos pestañas con el mismo almacenamiento: solo la primera avisa", () => {
    const store = memoryStore();
    claimFreshRequests(store, []);
    const firstTab = claimFreshRequests(store, [request("n", 500)]);
    const secondTab = claimFreshRequests(store, [request("n", 500)]);
    expect(firstTab).toHaveLength(1);
    expect(secondTab).toHaveLength(0);
  });

  test("un almacenamiento que falla no rompe nada", () => {
    const broken: KeyValueStore = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readBaseline(broken)).toBeNull();
    expect(readSoundEnabled(broken)).toBe(false);
    expect(() => writeSoundEnabled(broken, true)).not.toThrow();
    expect(claimFreshRequests(broken, [request("a", 1)])).toEqual([]);
  });

  test("una marca corrupta se trata como ausente", () => {
    const store = memoryStore();
    store.data.set(BASELINE_KEY, "no-es-un-numero");
    expect(readBaseline(store)).toBeNull();
  });

  test("el sonido empieza apagado y solo se enciende al activarlo", () => {
    const store = memoryStore();
    expect(readSoundEnabled(store)).toBe(false);
    writeSoundEnabled(store, true);
    expect(readSoundEnabled(store)).toBe(true);
    writeSoundEnabled(store, false);
    expect(readSoundEnabled(store)).toBe(false);
  });
});

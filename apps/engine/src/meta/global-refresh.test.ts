import { describe, expect, test } from "bun:test";
import { GLOBAL_META_REFRESH_CHECK_MS, createGlobalMetaRefresh } from "./global-refresh";

describe("política de refresco global de meta", () => {
  test("sin meta fresca inicia una sincronización al arrancar y programa revisiones periódicas", async () => {
    let scheduled: (() => void) | undefined;
    let runs = 0;
    const policy = createGlobalMetaRefresh({
      getState: async () => ({ isStale: true, isRunning: false }),
      runSync: async () => { runs++; },
      setIntervalImpl: (callback, delay) => {
        expect(delay).toBe(GLOBAL_META_REFRESH_CHECK_MS);
        scheduled = callback;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalImpl: () => undefined,
    });

    await policy.refreshIfNeeded();
    await policy.start();

    expect(scheduled).toBeDefined();
    expect(runs).toBe(2);
    policy.stop();
  });

  test("no sincroniza si el catálogo está fresco o ya hay una corrida global activa", async () => {
    let runs = 0;
    const fresh = createGlobalMetaRefresh({
      getState: async () => ({ isStale: false, isRunning: false }),
      runSync: async () => { runs++; },
    });
    const running = createGlobalMetaRefresh({
      getState: async () => ({ isStale: true, isRunning: true }),
      runSync: async () => { runs++; },
    });

    expect(await fresh.refreshIfNeeded()).toBe(false);
    expect(await running.refreshIfNeeded()).toBe(false);
    expect(runs).toBe(0);
  });

  test("una revisión lenta no puede solaparse con otra", async () => {
    let resolveSync: (() => void) | undefined;
    let runs = 0;
    const policy = createGlobalMetaRefresh({
      getState: async () => ({ isStale: true, isRunning: false }),
      runSync: () => new Promise<void>((resolve) => { runs++; resolveSync = resolve; }),
    });

    const first = policy.refreshIfNeeded();
    expect(await policy.refreshIfNeeded()).toBe(false);
    resolveSync?.();
    expect(await first).toBe(true);
    expect(runs).toBe(1);
  });
});

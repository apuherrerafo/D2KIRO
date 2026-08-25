export const GLOBAL_META_REFRESH_CHECK_MS = 60 * 60 * 1000;

interface GlobalMetaRefreshState {
  isStale: boolean;
  isRunning: boolean;
}

interface GlobalMetaRefreshDeps {
  getState: () => Promise<GlobalMetaRefreshState>;
  runSync: () => Promise<void>;
  setIntervalImpl?: (callback: () => void, delay: number) => ReturnType<typeof setInterval>;
  clearIntervalImpl?: (timer: ReturnType<typeof setInterval>) => void;
}

// Coordina únicamente el trabajo de fondo. El sync concreto se inyecta para que el scheduler se
// pruebe sin red ni SQLite; runMetaSync sigue siendo la única escritura real de meta.
export function createGlobalMetaRefresh({
  getState,
  runSync,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
}: GlobalMetaRefreshDeps) {
  let isRefreshing = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function refreshIfNeeded(): Promise<boolean> {
    if (isRefreshing) return false;
    isRefreshing = true;
    try {
      const state = await getState();
      if (!state.isStale || state.isRunning) return false;
      await runSync();
      return true;
    } catch {
      // runMetaSync registra su propio error y mantiene el último snapshot útil. Un error del
      // refresco jamás debe tumbar el proceso que atiende drafts.
      return false;
    } finally {
      isRefreshing = false;
    }
  }

  async function start(): Promise<void> {
    await refreshIfNeeded();
    if (timer !== undefined) return;
    timer = setIntervalImpl(() => { void refreshIfNeeded(); }, GLOBAL_META_REFRESH_CHECK_MS);
  }

  function stop(): void {
    if (timer === undefined) return;
    clearIntervalImpl(timer);
    timer = undefined;
  }

  return { refreshIfNeeded, start, stop };
}

"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { isFlightRecorderBuilt, isFlightRecorderEnabled } from "./config";
import { downloadJsonFile, exportFilename, type DownloadFile } from "./download";
import { flightRecorder } from "./recorder";
import { readRenderedUi, uiSignature } from "./ui-probe";

// Arma la grabadora (sólo con el doble interruptor), vigila lo que la pantalla muestra y exporta el JSON.

export interface UseFlightRecorderPanelOptions {
  /** Pruebas: reemplazan el flag de build. */
  built?: boolean;
  /** Pruebas: reemplazan `window.location.search`. */
  search?: string;
  download?: DownloadFile;
}

export interface FlightRecorderPanelState {
  enabled: boolean;
  entryCount: number;
  exportJson(): void;
  clear(): void;
}

const UI_ATTRIBUTES = ["data-state-identity", "data-status", "data-revision", "data-hero-id", "data-rank", "data-state", "data-recommended-position", "data-target-position", "data-viewed-position"];

function seedOf(): string | null {
  const start = flightRecorder.entries().find((entry) => entry.kind === "session_start");
  const config = start?.data.config;
  if (typeof config !== "object" || config === null) return null;
  const seed = (config as Record<string, unknown>).draftSeed;
  return typeof seed === "string" ? seed : null;
}

function userAgentFamily(): string | null {
  if (typeof navigator === "undefined") return null;
  return /(Edg|Firefox|Chrome|Safari)/.exec(navigator.userAgent)?.[1] ?? null;
}

function subscribe(listener: () => void): () => void {
  return flightRecorder.subscribe(listener);
}

function currentVersion(): number {
  return flightRecorder.version();
}

function isArmed(): boolean {
  return flightRecorder.isArmed();
}

function neverArmedOnServer(): boolean {
  return false;
}

export function useFlightRecorderPanel(options: UseFlightRecorderPanelOptions = {}): FlightRecorderPanelState {
  const built = options.built ?? isFlightRecorderBuilt();
  const download = options.download ?? downloadJsonFile;
  const searchOverride = options.search;
  // The recorder itself is the source of truth for "enabled": the panel shows exactly while it is armed.
  const enabled = useSyncExternalStore(subscribe, isArmed, neverArmedOnServer);
  useSyncExternalStore(subscribe, currentVersion, currentVersion);

  useEffect(function armRecorder() {
    const search = searchOverride ?? window.location.search;
    if (!isFlightRecorderEnabled(search, built)) return undefined;
    flightRecorder.arm();
    return function disarmRecorder() {
      flightRecorder.disarm();
    };
  }, [built, searchOverride]);

  useEffect(function watchRenderedUi() {
    if (!enabled) return undefined;
    let lastSignature: string | null = null;
    let frame: number | null = null;
    function probe(): void {
      frame = null;
      const snapshot = readRenderedUi(document);
      // Nothing on screen before the first board/decision is noise; once something was shown, its disappearance IS data.
      if (snapshot.board === null && snapshot.decision === null && lastSignature === null) return;
      const signature = uiSignature(snapshot);
      if (signature === lastSignature) return;
      lastSignature = signature;
      flightRecorder.record("ui_render", { afterTransitionSeq: flightRecorder.lastTransitionSeq(), board: snapshot.board, decision: snapshot.decision });
    }
    function schedule(): void {
      if (frame === null) frame = requestAnimationFrame(probe);
    }
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: UI_ATTRIBUTES });
    schedule();
    return function stopWatching() {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled]);

  const exportJson = useCallback(function exportJson(): void {
    const payload = flightRecorder.buildExport({ flagEnabled: true, userAgentFamily: userAgentFamily() });
    download(exportFilename(seedOf(), new Date()), JSON.stringify(payload, null, 2));
  }, [download]);

  const clear = useCallback(function clear(): void {
    flightRecorder.reset();
  }, []);

  return { enabled, entryCount: flightRecorder.count(), exportJson, clear };
}

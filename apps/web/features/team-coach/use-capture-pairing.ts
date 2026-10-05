"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchCapturePairing, issueCapturePairing, revokeCapturePairing } from "./client";
import { CAPTURE_PAIRING_POLL_MS } from "./constants";
import type { CapturePairingCode } from "./types";

// Overwolf automatic capture -- the pairing the Player drives from /live-draft:
//   "Conectar captura automática" -> a one-time code (shown here, typed once into the Overwolf app)
//   -> the adapter redeems it -> `paired` flips by itself (this hook polls while it waits).
// The code is the only secret this hook ever holds; the adapter's credential never reaches the browser.

export type CapturePairingStatus = "loading" | "ready" | "failed";

export interface CapturePairingView {
  status: CapturePairingStatus;
  paired: boolean;
  /** The code just issued, until it is redeemed or replaced. */
  code: CapturePairingCode | null;
  /** The last action (issue / revoke) failed. */
  actionFailed: boolean;
  busy: boolean;
}

export interface UseCapturePairingOptions {
  fetchImpl?: typeof fetch;
  pollMs?: number;
}

export interface UseCapturePairingResult extends CapturePairingView {
  start(): Promise<void>;
  unpair(): Promise<void>;
}

const INITIAL: CapturePairingView = { status: "loading", paired: false, code: null, actionFailed: false, busy: false };

export function useCapturePairing(options: UseCapturePairingOptions = {}): UseCapturePairingResult {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollMs = options.pollMs ?? CAPTURE_PAIRING_POLL_MS;
  const [view, setView] = useState<CapturePairingView>(INITIAL);

  const read = useCallback(async function read(): Promise<void> {
    try {
      const state = await fetchCapturePairing(fetchImpl);
      // A redeemed code is spent: stop showing it.
      setView((previous) => ({ ...previous, status: "ready", paired: state.paired, code: state.paired ? null : previous.code }));
    } catch {
      setView((previous) => {
        if (previous.status === "ready") return previous;
        return { ...previous, status: "failed" };
      });
    }
  }, [fetchImpl]);

  useEffect(function loadOnce() {
    let cancelled = false;
    fetchCapturePairing(fetchImpl).then(
      function applyState(state) {
        if (!cancelled) setView((previous) => ({ ...previous, status: "ready", paired: state.paired }));
      },
      function applyFailure() {
        if (!cancelled) setView((previous) => ({ ...previous, status: "failed" }));
      },
    );
    return function cancelLoad() {
      cancelled = true;
    };
  }, [fetchImpl]);

  // Only while a code is waiting to be redeemed: the page learns about the pairing by asking.
  const waiting = view.code !== null && !view.paired;
  useEffect(function waitForAdapter() {
    if (!waiting) return undefined;
    const timer = setInterval(function pollPairing() {
      void read();
    }, pollMs);
    return function stopWaiting() {
      clearInterval(timer);
    };
  }, [waiting, pollMs, read]);

  const start = useCallback(async function start(): Promise<void> {
    setView((previous) => ({ ...previous, busy: true, actionFailed: false }));
    try {
      const code = await issueCapturePairing(fetchImpl);
      setView((previous) => ({ ...previous, status: "ready", code, paired: false, busy: false }));
    } catch {
      setView((previous) => ({ ...previous, busy: false, actionFailed: true }));
    }
  }, [fetchImpl]);

  const unpair = useCallback(async function unpair(): Promise<void> {
    setView((previous) => ({ ...previous, busy: true, actionFailed: false }));
    try {
      await revokeCapturePairing(fetchImpl);
      setView((previous) => ({ ...previous, status: "ready", paired: false, code: null, busy: false }));
    } catch {
      setView((previous) => ({ ...previous, busy: false, actionFailed: true }));
    }
  }, [fetchImpl]);

  return { ...view, start, unpair };
}

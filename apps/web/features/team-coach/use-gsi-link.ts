"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGsiLink, revokeGsiLink } from "./client";
import { GSI_LINK_POLL_MS, GSI_LINK_REFRESH_MS } from "./constants";
import type { GsiLinkView } from "./types";

// TSK-219 -- the account's Dota link as /live-draft sees it. Read once on load; after "Descargar
// configuración D2KIRO" it is re-read every GSI_LINK_POLL_MS until the NEW link shows up (the download
// is a plain form POST, so the page learns about it only by asking). Never holds the link's token.

/** Give up waiting for a download after this many polls (~2 min); the Player can always reload. */
const MAX_LINK_POLLS = 60;

export interface GsiLinkState {
  status: "loading" | "ready" | "failed";
  link: GsiLinkView | null;
}

function keepLastKnown(previous: GsiLinkState): GsiLinkState {
  if (previous.status === "ready") return previous;
  return { status: "failed", link: null };
}

export interface UseGsiLinkOptions {
  fetchImpl?: typeof fetch;
  pollMs?: number;
  /** How often a linked tab re-reads the link (the engine slides its expiry). */
  refreshMs?: number;
}

export interface UseGsiLinkResult {
  state: GsiLinkState;
  /** True between a download and the new link appearing. */
  awaitingDownload: boolean;
  /** Call when the cfg download starts: watch for the link it creates. */
  expectNewLink(): void;
  disconnect(): Promise<void>;
  reload(): Promise<void>;
}

export function useGsiLink(options: UseGsiLinkOptions = {}): UseGsiLinkResult {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollMs = options.pollMs ?? GSI_LINK_POLL_MS;
  const refreshMs = options.refreshMs ?? GSI_LINK_REFRESH_MS;
  const [state, setState] = useState<GsiLinkState>({ status: "loading", link: null });
  // `undefined` = not waiting; otherwise the session id the download must replace (null = none yet).
  const [replacing, setReplacing] = useState<string | null | undefined>(undefined);
  const pollsRef = useRef(0);

  const reload = useCallback(async function reload(): Promise<void> {
    try {
      const link = await fetchGsiLink(fetchImpl);
      setState({ status: "ready", link });
    } catch {
      setState(keepLastKnown);
    }
  }, [fetchImpl]);

  useEffect(function loadOnce() {
    let cancelled = false;
    fetchGsiLink(fetchImpl).then(
      function applyLink(link) {
        if (!cancelled) setState({ status: "ready", link });
      },
      function applyFailure() {
        if (!cancelled) setState(keepLastKnown);
      },
    );
    return function cancelLoad() {
      cancelled = true;
    };
  }, [fetchImpl]);

  // Waiting ends by itself when the link the download created shows up (derived, not stored).
  const replaced = replacing !== undefined && state.link !== null && state.link.sessionId !== replacing;
  const awaitingDownload = replacing !== undefined && !replaced;

  useEffect(function waitForNewLink() {
    if (!awaitingDownload) return undefined;
    const timer = setInterval(function pollLink() {
      pollsRef.current += 1;
      if (pollsRef.current > MAX_LINK_POLLS) {
        setReplacing(undefined);
        return;
      }
      void reload();
    }, pollMs);
    return function stopWaiting() {
      clearInterval(timer);
    };
  }, [awaitingDownload, pollMs, reload]);

  // Sliding expiration lives on the engine: keep the tab's copy of expiresAt current while a link exists.
  const linked = state.link !== null;
  useEffect(function refreshWhileLinked() {
    if (!linked) return undefined;
    const timer = setInterval(function refreshLink() {
      void reload();
    }, refreshMs);
    return function stopRefreshing() {
      clearInterval(timer);
    };
  }, [linked, refreshMs, reload]);

  const expectNewLink = useCallback(function expectNewLink(): void {
    pollsRef.current = 0;
    setReplacing(state.link?.sessionId ?? null);
  }, [state.link]);

  const disconnect = useCallback(async function disconnect(): Promise<void> {
    try {
      await revokeGsiLink(fetchImpl);
      setReplacing(undefined);
      setState({ status: "ready", link: null });
    } catch {
      await reload();
    }
  }, [fetchImpl, reload]);

  return { state, awaitingDownload, expectNewLink, disconnect, reload };
}

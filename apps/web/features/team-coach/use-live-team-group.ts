"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPartyPresets, putLiveTeamGroup } from "./client";
import { LIVE_PRESET_APPLY_FAILED, LIVE_PRESET_REFUSALS, LIVE_PRESET_STORAGE_KEY } from "./constants";
import type { LivePartyPreset, LiveTeamContext } from "./types";

// Live Dota + Party 5: which of the account's team presets the live Team Coach uses. The choice is
// remembered in this browser (a convenience: it survives a reload, an engine restart and a rotated Dota
// link) and re-applied whenever the ENGINE reports a different preset than the chosen one -- the engine's
// status is the truth shown on screen, the stored id is only the wish. The id never leaves this hook's
// storage and the engine's PUT; the screen only ever shows the preset's name.

export type PresetListState = "loading" | "ready" | "failed";
type PresetStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;

export interface UseLiveTeamGroupOptions {
  sessionId: string;
  /** What the engine's live status says is applied (undefined: no status for this session read yet). */
  teamContext: LiveTeamContext | undefined;
  fetchImpl?: typeof fetch;
  storage?: PresetStorage;
}

export interface UseLiveTeamGroupResult {
  listState: PresetListState;
  presets: LivePartyPreset[];
  /** The preset the Player chose (id), whether or not the engine applied it yet. */
  chosenId: number | null;
  applying: boolean;
  /** Plain-language reason the last selection was not applied; null when fine. */
  notice: string | null;
  select(teamGroupId: number | null): void;
}

function defaultStorage(): PresetStorage {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readChosen(storage: PresetStorage): number | null {
  try {
    const raw = storage?.getItem(LIVE_PRESET_STORAGE_KEY) ?? null;
    const id = raw === null ? Number.NaN : Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function writeChosen(storage: PresetStorage, id: number | null): void {
  try {
    if (id === null) storage?.removeItem(LIVE_PRESET_STORAGE_KEY);
    else storage?.setItem(LIVE_PRESET_STORAGE_KEY, String(id));
  } catch {
    // Storage blocked (private window): the choice still works for this visit.
  }
}

export function useLiveTeamGroup({ sessionId, teamContext, fetchImpl, storage: storageOption }: UseLiveTeamGroupOptions): UseLiveTeamGroupResult {
  const doFetch = fetchImpl ?? fetch;
  const [storage] = useState<PresetStorage>(() => (storageOption === undefined ? defaultStorage() : storageOption));
  const [listState, setListState] = useState<PresetListState>("loading");
  const [presets, setPresets] = useState<LivePartyPreset[]>([]);
  const [chosenId, setChosenId] = useState<number | null>(() => readChosen(storage));
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // One automatic attempt per (session, chosen preset) until the engine confirms it: never a retry loop.
  const attemptedRef = useRef<string | null>(null);

  useEffect(function loadPresets() {
    let cancelled = false;
    fetchPartyPresets(doFetch).then(
      function applyList(list) {
        if (cancelled) return;
        setPresets(list);
        setListState("ready");
      },
      function listFailed() {
        if (!cancelled) setListState("failed");
      },
    );
    return function stopLoading() {
      cancelled = true;
    };
  }, [doFetch]);

  const apply = useCallback(async function apply(teamGroupId: number | null): Promise<void> {
    setApplying(true);
    try {
      const result = await putLiveTeamGroup(teamGroupId, doFetch);
      if (teamGroupId !== null && !result.applied) {
        // The preset is gone / not usable: forget the wish so the screen and the engine agree (no preset).
        setChosenId(null);
        writeChosen(storage, null);
        setNotice(LIVE_PRESET_REFUSALS[result.reason ?? "not_found"] ?? LIVE_PRESET_APPLY_FAILED);
        return;
      }
      setNotice(null);
    } catch {
      setNotice(LIVE_PRESET_APPLY_FAILED);
    } finally {
      setApplying(false);
    }
  }, [doFetch, storage]);

  // A remembered preset that no longer exists (deleted, or another account's): treated as "none", derived -- not stored.
  const chosenKnown = listState !== "ready" || chosenId === null || presets.some((preset) => preset.id === chosenId);
  const effectiveId = chosenKnown ? chosenId : null;

  useEffect(function forgetMissingPreset() {
    if (!chosenKnown) writeChosen(storage, null);
  }, [chosenKnown, storage]);

  useEffect(function reconcileWithEngine() {
    if (teamContext === undefined || effectiveId === null || listState !== "ready") return;
    if (teamContext.teamGroupId === effectiveId) {
      attemptedRef.current = null;
      return;
    }
    const key = `${sessionId}:${effectiveId}`;
    if (attemptedRef.current === key) return;
    attemptedRef.current = key;
    void apply(effectiveId);
  }, [apply, effectiveId, listState, sessionId, teamContext]);

  const select = useCallback(function select(teamGroupId: number | null): void {
    setChosenId(teamGroupId);
    writeChosen(storage, teamGroupId);
    setNotice(null);
    attemptedRef.current = teamGroupId === null ? null : `${sessionId}:${teamGroupId}`;
    void apply(teamGroupId);
  }, [apply, sessionId, storage]);

  const shownNotice = chosenKnown ? notice : (LIVE_PRESET_REFUSALS.not_found ?? null);
  return { listState, presets, chosenId: effectiveId, applying, notice: shownNotice, select };
}

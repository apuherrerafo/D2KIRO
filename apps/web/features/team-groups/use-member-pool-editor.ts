"use client";

import { useState } from "react";
import type { HeroId } from "@/features/draft/types";
import { useSaveMemberPositionPoolMutation } from "@/lib/engine-api";
import { MAX_COMPANION_POOL_SIZE } from "./constants";
import { describeSaveFailure, editKey, pendingLegacyPool, poolAtSeat, sameHeroes, type SaveFailure } from "./pool-editor";
import { SEATS } from "./position-assignment";
import type { MemberPositionPool, Seat, TeamMemberEntry } from "./types";

// State of the pool editor of ONE saved person. Unsaved edits are kept per (person, seat): changing seat, a rejected
// save or a refetch of the saved team never drops them, and never moves them to another pool.

export interface MemberPoolEditorState {
  seat: Seat;
  stored: MemberPositionPool | null;
  /** The heroes on screen for this seat: the unsaved edit if there is one, else the saved pool, else `null` (no pool). */
  shown: HeroId[] | null;
  hasUnsavedEdit: boolean;
  /** Every position of this person with an unsaved edit -- not only the one on screen. */
  dirtySeats: Seat[];
  isDeferred: boolean;
  isSaving: boolean;
  failure: SaveFailure | null;
  savedNotice: string | null;
  legacyPool: HeroId[] | null;
  selectSeat: (seat: Seat) => void;
  createNow: () => void;
  createLater: () => void;
  addHero: (hero: HeroId) => void;
  removeHero: (hero: HeroId) => void;
  discardEdit: () => void;
  save: () => Promise<void>;
  confirmLegacy: () => Promise<void>;
}

export function useMemberPoolEditor(teamGroupId: number, member: TeamMemberEntry, initialSeat: Seat): MemberPoolEditorState {
  const [seat, setSeat] = useState<Seat>(initialSeat);
  const [edits, setEdits] = useState<Record<string, HeroId[]>>({});
  const [deferred, setDeferred] = useState<Record<string, true>>({});
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [savePool, { isLoading: isSaving }] = useSaveMemberPositionPoolMutation();

  const key = editKey(member.id, seat);
  const stored = poolAtSeat(member, seat);
  const edit = edits[key];
  const shown = edit ?? stored?.heroPool ?? null;

  function clearNotices() {
    setFailure(null);
    setSavedNotice(null);
  }

  function dropEdit() {
    setEdits((current) => Object.fromEntries(Object.entries(current).filter(([editKeyOf]) => editKeyOf !== key)));
  }

  function setEdit(heroes: HeroId[]) {
    setEdits((current) => ({ ...current, [key]: heroes }));
    clearNotices();
  }

  function selectSeat(next: Seat) {
    setSeat(next);
    clearNotices();
  }

  function createNow() {
    setEdit([]);
  }

  function createLater() {
    setDeferred((current) => ({ ...current, [key]: true }));
  }

  function addHero(hero: HeroId) {
    const current = shown ?? [];
    if (current.includes(hero) || current.length >= MAX_COMPANION_POOL_SIZE) return;
    setEdit([...current, hero]);
  }

  function removeHero(hero: HeroId) {
    setEdit((shown ?? []).filter((id) => id !== hero));
  }

  function discardEdit() {
    dropEdit();
    clearNotices();
  }

  // Compare-and-set: `expectedVersion` is the version on screen (0 = none yet). A rejection keeps the edit in place.
  async function write(heroPool: HeroId[], successNotice: string): Promise<void> {
    clearNotices();
    try {
      await savePool({ teamGroupId, memberId: member.id, position: seat, heroPool, expectedVersion: stored?.version ?? 0 }).unwrap();
    } catch (error) {
      setFailure(describeSaveFailure(error));
      return;
    }
    dropEdit();
    setSavedNotice(successNotice);
  }

  async function save() {
    if (edit === undefined) return;
    await write(edit, "Pool guardado.");
  }

  async function confirmLegacy() {
    const legacy = pendingLegacyPool(member);
    if (legacy === null) return;
    await write(legacy, "Lista antigua confirmada como pool de esta posición.");
  }

  const hasUnsavedEdit = edit !== undefined && (stored === null || !sameHeroes(edit, stored.heroPool));
  const dirtySeats = SEATS.filter((candidate) => {
    const pending = edits[editKey(member.id, candidate)];
    if (pending === undefined) return false;
    const saved = poolAtSeat(member, candidate);
    return saved === null || !sameHeroes(pending, saved.heroPool);
  });

  return {
    seat, stored, shown, hasUnsavedEdit, dirtySeats,
    isDeferred: deferred[key] === true,
    isSaving, failure, savedNotice,
    legacyPool: pendingLegacyPool(member),
    selectSeat, createNow, createLater, addHero, removeHero, discardEdit, save, confirmLegacy,
  };
}

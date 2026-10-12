/* HERO-LOOP LAB · D2KIRO continues, the match changes. One stage, never unmounted:
   draft → reveal → evidence → recommendation → lock → settle → carry → relax → NEXT DRAFT (picks hidden again).
   Three consecutive drafts pass through it: A personal evidence changes the order, B no personal evidence (draft read
   only), C later in the draft (more, and contradicting, information). Recent calls persists across them: that is the
   continuity between matches. FIT is a recommendation score, never a win rate.
   Motion speaks the shared language: GATHER · ATTRACT · TETHER · SETTLE · TRANSFER · SCATTER, and REPEL only for a
   contradiction. Nothing morphs into anything else: a hero is acquired, moved, or removed.
   The stage is decorative to assistive tech (`aria-hidden`) and summarised once in words. */
"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { HeroIcon } from "@/design/canonical/hero-media";
import { Glass } from "@/design/canonical/primitives";
import { useSettleFlip } from "@/design/canonical/motion/flip";
import { useCountTo } from "@/features/landing/hero-story/use-hero-story";
import { HeroCoach, type CoachMode } from "./coach/HeroCoach";
import type { StageQuality } from "./coach/live-stage";
import { PHASES, draftNumber, recentCalls, winnerOf, type CardRow, type LoopFrame, type Marker } from "./loop";
import { HERO_LOOP_COPY, LOOP_SCENARIOS } from "./scenarios";
import type { HeroLoopClock } from "./use-hero-loop";
import { BEATS_BY_SCENARIO } from "./beats";
import "./hero-loop.css";

const CELLS = 16;
const COUNT_MS = 600;
const FLIGHT_MS = 900;
const FLIGHT_EASE = "cubic-bezier(.22, .8, .24, 1)";
/* The carry handoff, on the flight's own clock (ms from the carry beat): the destination ICON is already there as the hero
   arrives, the label resolves on landing, and the flier is removed only after the destination has taken over. At every
   instant at least one of {flier, destination icon} is fully visible. */
const HANDOFF_ICON_MS = FLIGHT_MS - 200;
const HANDOFF_LABEL_MS = FLIGHT_MS;
const HANDOFF_FLIER_OFF_MS = FLIGHT_MS + 80;
const LOCK_FADE_MS = 260;

function cellStyle(index: number): CSSProperties {
  /* A fixed scramble of 0..15: the dissolve order looks random and is identical on every pass. */
  return { "--hl-k": String((index * 7 + 3) % CELLS) } as CSSProperties;
}

/** GATHER: a tile is acquired — a pixel grid dissolves in a scrambled order while the art gathers in. Re-key to replay. */
function Acquire({ children, delay = 0, on }: { children: ReactNode; delay?: number; on: boolean }) {
  return (
    <span className="hl-px" data-on={on ? "true" : "false"} style={{ "--hl-d": `${delay}ms` } as CSSProperties}>
      <span className="hl-px-art">{children}</span>
      <span aria-hidden="true" className="hl-px-cells">
        {Array.from({ length: CELLS }, (_, index) => <i key={index} style={cellStyle(index)} />)}
      </span>
    </span>
  );
}

// ------------------------------------------------------------------ the draft

function metaFor(frame: LoopFrame, next: boolean): string {
  const { phase } = frame.beat;
  if (phase === "draft") return next ? "Next draft · picks hidden" : "Picks locked · enemy hidden";
  if (phase === "reveal") return "Enemy picks revealed";
  if (phase === "evidence") return frame.arriving ? frame.arriving.label : "";
  if (phase === "recommendation") return `Your turn · ${frame.scenario.seat.label}`;
  if (phase === "lock") return "Call made";
  if (phase === "settle") return `Locking into ${frame.scenario.seat.label}`;
  if (phase === "carry") return "Saved to Recent calls";
  return "Draft complete";
}

function EnemySeat({ armed, cycle, frame, index }: { armed: boolean; cycle: number; frame: LoopFrame; index: number }) {
  const enemy = frame.enemies[index];
  const focus = frame.arriving?.kind === "enemy" && frame.arriving.label.endsWith(enemy.hero);
  return (
    <li className="hl-seat" data-focus={focus ? "true" : "false"} data-hidden={enemy.visible ? "false" : "true"} data-seat="enemy">
      {enemy.visible ? (
        <Acquire delay={index * 120} key={`v-${frame.scenario.id}-${enemy.hero}`} on>
          <HeroIcon hero={enemy.hero} size="md" />
        </Acquire>
      ) : (
        <Acquire delay={260 + index * 170} key={`h-${cycle}-${frame.scenario.id}-${index}`} on={armed}>
          <span className="hl-seat-hidden">?</span>
        </Acquire>
      )}
    </li>
  );
}

function OpenSeat({ armed, delay }: { armed: boolean; delay: number }) {
  return (
    <li className="hl-seat" data-empty="true">
      <Acquire delay={delay} on={armed}><span className="hl-seat-open" /></Acquire>
    </li>
  );
}

function AllySeat({ armed, cycle, hero, index, focus, scenarioId }: { armed: boolean; cycle: number; focus: boolean; hero: string; index: number; scenarioId: string }) {
  return (
    <li className="hl-seat" data-focus={focus ? "true" : "false"}>
      <Acquire delay={520 + index * 140} key={`a-${cycle}-${scenarioId}-${hero}`} on={armed}><HeroIcon hero={hero} size="md" /></Acquire>
    </li>
  );
}

/** The seat the call lands in: an open target until the lock, then the hero that arrived. */
function YouSeat({ frame, winner }: { frame: LoopFrame; winner: string }) {
  return (
    <li className="hl-seat" data-placed={frame.seated ? "true" : "false"} data-seat="you" data-target={frame.locked && !frame.seated ? "true" : "false"} data-you="true">
      <span className="hl-seat-open hl-you-open">{`Pos ${frame.scenario.seat.position}`}</span>
      <span className="hl-you-art"><HeroIcon hero={winner} size="md" /></span>
    </li>
  );
}

function DraftBlock({ armed, cycle, draft, frame, winner }: { armed: boolean; cycle: number; draft: number; frame: LoopFrame; winner: string }) {
  const s = frame.scenario;
  const next = draft > 1 && frame.beat.phase === "draft";
  const meta = metaFor(frame, next);
  const enemySlots = 5 - s.enemies.length;
  return (
    <section className="hl-block hl-draft" data-next={next ? "true" : "false"} data-on={armed ? "true" : "false"}>
      <header className="hl-block-head">
        <span className="hl-block-title" key={draft}>{`Draft ${draft}`}</span>
        <span className="hl-block-meta" data-next={next ? "true" : "false"} data-turn={frame.beat.phase === "recommendation" ? "true" : "false"} key={meta}>{meta}</span>
      </header>
      <ul aria-hidden="true" className="hl-bans">
        {s.bans.map((hero, index) => <li key={`${cycle}-${s.id}-${hero}`}><Acquire delay={index * 50} on={armed}><HeroIcon banned hero={hero} size="xs" /></Acquire></li>)}
      </ul>
      <ul className="hl-row hl-row--enemy">
        <li className="hl-row-label">Enemy</li>
        {s.enemies.map((enemy, index) => <EnemySeat armed={armed} cycle={cycle} frame={frame} index={index} key={enemy.hero} />)}
        {Array.from({ length: enemySlots }, (_, i) => <OpenSeat armed={armed} delay={420 + i * 80} key={`o-${i}`} />)}
      </ul>
      <ul className="hl-row hl-row--allies">
        <li className="hl-row-label">Team</li>
        {s.allies.map((seat, index) => {
          if (seat.you) return <YouSeat frame={frame} key={seat.position} winner={winner} />;
          if (seat.hero) return <AllySeat armed={armed} cycle={cycle} focus={frame.arriving?.kind === "synergy"} hero={seat.hero} index={index} key={seat.position} scenarioId={s.id} />;
          return <OpenSeat armed={armed} delay={520 + index * 140} key={seat.position} />;
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ evidence

const KIND_LABEL: Record<Marker["kind"], string> = { enemy: "Counter", synergy: "Synergy", personal: "You" };

/** One slot per piece of evidence the pass will bring (pending = a quiet dot), so "more information" is visible as more slots. */
function Evidence({ frame }: { frame: LoopFrame }) {
  const steps = frame.scenario.steps;
  return (
    <ul aria-hidden="true" className="hl-evidence" data-count={steps.length} data-scatter={frame.relaxed ? "true" : "false"}>
      {steps.map((step, index) => {
        const marker = frame.markers[index];
        if (!marker) return <li className="hl-slot" data-state="pending" key={`${frame.scenario.id}-${step.id}`}><i /></li>;
        return (
          <li
            className="hl-marker"
            data-absent={marker.absent ? "true" : "false"}
            data-kind={marker.kind}
            data-state={marker.state}
            key={`${frame.scenario.id}-${marker.id}`}
            style={{ "--hl-sx": `${(((index * 5 + 2) % 7) - 3) * 9}px`, "--hl-sy": `${-18 - ((index * 3) % 4) * 7}px`, "--hl-sr": `${(((index * 3 + 1) % 5) - 2) * 7}deg` } as CSSProperties}
          >
            <span className="hl-marker-kind">{KIND_LABEL[marker.kind]}</span>
            <span className="hl-marker-label">{marker.absent ? HERO_LOOP_COPY.noPersonal : marker.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ the cards

function signed(value: number) {
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}

/** Why this card moved, in words: `+6 · Your games · Often played`. A number never appears without its cause. */
function CardCause({ frame, row }: { frame: LoopFrame; row: CardRow }) {
  if (frame.applied === 0 || row.cause === null) return <span className="hl-card-reason">Fits {frame.scenario.seat.label}</span>;
  const dir = row.lastDelta > 0 ? "up" : row.lastDelta < 0 ? "down" : "flat";
  const tail = [row.cause, row.detail].filter(Boolean).join(" · ");
  return (
    <span className="hl-card-reason hl-card-reason--cause" data-dir={dir} key={`${row.cause}-${row.lastDelta}-${row.fit}`}>
      {row.lastDelta !== 0 && <><b>{signed(row.lastDelta)}</b>{" · "}</>}
      {tail}
    </span>
  );
}

function Card({ armed, cycle, frame, reduced, row }: { armed: boolean; cycle: number; frame: LoopFrame; reduced: boolean; row: CardRow }) {
  const shown = useCountTo(row.fit, COUNT_MS, reduced);
  const arriving = frame.arriving;
  const hit = arriving !== null && row.lastDelta !== 0;
  const tether = arriving !== null ? (row.lastDelta !== 0 ? arriving.kind : "none") : frame.locked && row.champion && frame.scenario.personal ? "held" : "none";
  const launched = row.champion && frame.placing;
  const gone = row.champion && frame.carried;
  return (
    <li
      className="hl-card"
      data-champion={row.champion ? "true" : "false"}
      data-flip-key={`${frame.scenario.id}-${row.hero}`}
      data-gone={gone ? "true" : "false"}
      data-hit={hit ? (row.lastDelta > 0 ? "up" : "down") : "none"}
      data-hero={row.hero}
      data-launched={launched ? "true" : "false"}
      data-rank={row.rank}
      data-ready={armed ? "true" : "false"}
      data-repelled={row.repelled ? "true" : "false"}
      data-tether={tether}
      style={{ "--hl-i": String(row.rank - 1) } as CSSProperties}
    >
      <span aria-hidden="true" className="hl-card-edge" />
      <span aria-hidden="true" className="hl-card-tether" />
      <span className="hl-card-rank">#{row.rank}</span>
      <span className="hl-card-icon"><Acquire delay={(row.rank - 1) * 140} key={`${cycle}-${frame.scenario.id}-${row.hero}`} on={armed}><HeroIcon hero={row.hero} size="lg" /></Acquire></span>
      <span className="hl-card-main">
        <span className="hl-card-name">{row.hero}</span>
        <CardCause frame={frame} row={row} />
      </span>
      <span className="hl-card-score" data-moving={shown !== row.fit ? "true" : "false"}><i className="hl-card-fit">FIT</i><b>{shown}</b></span>
    </li>
  );
}

function TopThree({ armed, cycle, frame, reduced }: { armed: boolean; cycle: number; frame: LoopFrame; reduced: boolean }) {
  const list = useRef<HTMLOListElement>(null);
  useSettleFlip(list, `${frame.scenario.id}:${frame.rows.map((row) => row.hero).join(",")}`, reduced);
  return (
    <ol aria-hidden="true" className="hl-cards" ref={list}>
      {frame.rows.map((row) => <Card armed={armed} cycle={cycle} frame={frame} key={`${frame.scenario.id}-${row.hero}`} reduced={reduced} row={row} />)}
    </ol>
  );
}

// ------------------------------------------------------------------ the call

function Confidence({ frame }: { frame: LoopFrame }) {
  const level = frame.confidence === "high" ? 3 : frame.confidence === "medium" ? 2 : 1;
  return (
    <span aria-hidden="true" className="hl-conf" data-level={frame.confidence}>
      <span className="hl-conf-pips">{[1, 2, 3].map((n) => <i data-on={n <= level ? "true" : "false"} key={n} />)}</span>
      <span className="hl-conf-label">{frame.confidence === "high" ? "High confidence" : frame.confidence === "medium" ? "Medium confidence" : "Low confidence"}</span>
    </span>
  );
}

function lockLabel(frame: LoopFrame, winner: string) {
  if (frame.seated) return `${winner} locked · Pos ${frame.scenario.seat.position}`;
  if (frame.placing) return `${winner} → Pos ${frame.scenario.seat.position}`;
  return `Lock ${winner}`;
}

/** The pill that fades out keeps the words it had: it never shows the next draft's hero while it is still visible. */
function useHeldLabel(label: string, live: boolean): string {
  const [held, setHeld] = useState(label);
  useEffect(() => {
    const timer = window.setTimeout(() => setHeld(label), live ? 0 : LOCK_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [label, live]);
  return live ? label : held;
}

function Call({ frame, winner }: { frame: LoopFrame; winner: string }) {
  const lock = useHeldLabel(lockLabel(frame, winner), frame.decided);
  return (
    <div aria-hidden="true" className="hl-call">
      <div className="hl-call-top">
        <Confidence frame={frame} />
        {frame.draftOnly && <span className="hl-tag" data-testid="draft-only">{HERO_LOOP_COPY.draftReadOnly}</span>}
        {frame.personalFlipped && frame.decided && <span className="hl-tag hl-tag--you" data-testid="personal-flip">Your history changed the order</span>}
      </div>
      <ul className="hl-why" data-on={frame.decided ? "true" : "false"}>
        {frame.scenario.why.map((reason, index) => <li key={`${frame.scenario.id}-${reason}`} style={{ "--hl-i": String(index) } as CSSProperties}><i className="hl-tick" />{reason}</li>)}
      </ul>
      <span className="hl-lock" data-done={frame.seated ? "true" : "false"} data-on={frame.decided ? "true" : "false"} data-pressed={frame.locked ? "true" : "false"}>{lock}</span>
    </div>
  );
}

// ------------------------------------------------------------------ TRANSFER

/** A hero physically leaves one place and travels into another. It exists only while it travels. It is drawn at the larger
    of the two sizes and only ever scaled DOWN, so it stays sharp, never exceeds its origin, and lands exactly on its target. */
function Flight({ fromSel, host, hero, toSel }: { fromSel: string; hero: string; host: RefObject<HTMLElement | null>; toSel: string }) {
  const flier = useRef<HTMLSpanElement>(null);
  // a passive effect, not a layout one: on a first mount the parent's ref is attached only after its children's layout effects.
  // The flier stays invisible (CSS) until it has been placed on its origin.
  useEffect(() => {
    const root = host.current;
    const element = flier.current;
    if (!root || !element || typeof element.animate !== "function") return;
    const origin = root.getBoundingClientRect();
    const from = root.querySelector(fromSel)?.getBoundingClientRect();
    const to = root.querySelector(toSel)?.getBoundingClientRect();
    if (!from || !to || from.width === 0 || to.width === 0) return;
    const side = Math.max(from.width, to.width);
    element.style.setProperty("--hl-fly-size", `${side}px`);
    element.style.left = `${from.left - origin.left}px`;
    element.style.top = `${from.top - origin.top}px`;
    element.style.opacity = "1";
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    const s0 = from.width / side;
    const s1 = to.width / side;
    const at = (t: number, lift = 0) => `translate(${dx * t}px, ${dy * t + lift}px) scale(${s0 + (s1 - s0) * t})`;
    const motion = element.animate([{ transform: at(0) }, { offset: 0.5, transform: at(0.5, -8) }, { transform: at(1) }], { duration: FLIGHT_MS, easing: FLIGHT_EASE, fill: "both" });
    return () => motion.cancel();
  }, [fromSel, host, toSel]);
  return (
    <span aria-hidden="true" className="hl-fly" data-testid="flight" ref={flier}>
      <HeroIcon hero={hero} size="lg" />
    </span>
  );
}

// ------------------------------------------------------------------ Recent calls: a compact trace on the stage edge

type Call = ReturnType<typeof recentCalls>[number];

type Handoff = { stage: "pending" | "icon" | "full"; flierAlive: boolean };

/** The carry's destination follows the flight's timeline explicitly (state, not a CSS delay coupled to mount time). */
function useCarryHandoff(carrying: boolean, reduced: boolean, key: string): Handoff {
  const [seen, setSeen] = useState<{ key: string; step: number }>({ key: "", step: 0 });
  const live = carrying && !reduced;
  useEffect(() => {
    if (!live) return;
    const timers = [HANDOFF_ICON_MS, HANDOFF_LABEL_MS, HANDOFF_FLIER_OFF_MS].map((ms, i) => window.setTimeout(() => setSeen({ key, step: i + 1 }), ms));
    return () => timers.forEach(window.clearTimeout);
  }, [key, live]);
  if (!live) return { stage: "full", flierAlive: false };
  const step = seen.key === key ? seen.step : 0;
  return { stage: step === 0 ? "pending" : step === 1 ? "icon" : "full", flierAlive: step < 3 };
}

/** Absent until the first call has been carried; then the newest call lands on top and the older ones step down (max 3). */
function RecentCalls({ handoff, items, reduced }: { handoff: Handoff["stage"]; items: readonly Call[]; reduced: boolean }) {
  const list = useRef<HTMLOListElement>(null);
  useSettleFlip(list, items.map((item) => item.id).join(","), reduced);
  if (items.length === 0) return null;
  return (
    <aside aria-hidden="true" className="hl-trace" data-testid="recent-calls">
      <span className="hl-trace-title">Recent calls</span>
      <ol className="hl-trace-list" ref={list}>
        {items.map((item, index) => (
          <li className="hl-trace-item" data-flip-key={item.id} data-landing={index === 0 ? handoff : "full"} data-newest={index === 0 ? "true" : "false"} key={item.id}>
            <span className="hl-trace-art"><HeroIcon hero={item.hero} size="sm" /></span>
            <span className="hl-trace-text"><b>{item.hero}</b><i>{`Pos ${item.position}`}</i></span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

// ------------------------------------------------------------------ the stage

export type HeroLoopProps = {
  clock: HeroLoopClock;
  coachMode: CoachMode;
  quality: StageQuality;
  /** Show the Recent calls trace (lab toggle). */
  calls: boolean;
  reduced: boolean;
};

export function HeroLoop({ calls, clock, coachMode, quality, reduced }: HeroLoopProps) {
  const { frame, armed, beat, position } = clock;
  const inner = useRef<HTMLDivElement>(null);
  const winner = winnerOf(frame.scenario);
  const items = recentCalls(LOOP_SCENARIOS, position, BEATS_BY_SCENARIO[position.scenario]);
  const draft = draftNumber(position, LOOP_SCENARIOS.length);
  const beatKey = `${position.cycle}:${frame.scenario.id}:${beat.id}`;
  const phaseIndex = PHASES.indexOf(beat.phase);
  const handoff = useCarryHandoff(frame.carrying, reduced, beatKey);

  return (
    <div
      className="hl"
      data-applied={frame.applied}
      data-beat={beat.id}
      data-confidence={frame.confidence}
      data-cycle={position.cycle}
      data-motion={reduced ? "reduced" : "full"}
      data-phase={beat.phase}
      data-calls={calls ? "on" : "off"}
      data-draft={draft}
      data-pressure={beat.verb === "REPEL" ? "true" : "false"}
      data-resolved={frame.decided && frame.scenario.personal ? "true" : "false"}
      data-scenario={frame.scenario.id}
      data-testid="hero-loop"
      data-verb={beat.verb ?? "none"}
    >
      <Glass className="hl-panel" surfaceLevel="3">
        <div aria-hidden="true" className="hl-field"><i data-field="evidence" /><i data-field="pressure" /><i data-field="resolved" /></div>
        <div className="hl-inner" ref={inner}>
          <ol aria-hidden="true" className="hl-progress">
            {PHASES.map((phase, index) => <li data-state={index < phaseIndex ? "done" : index === phaseIndex ? "now" : "next"} key={phase}><span className="hl-progress-bar" /><span className="hl-progress-label">{phase}</span></li>)}
          </ol>
          <div className="hl-layout">
            <div className="hl-coach-col">
              <HeroCoach beatKey={beatKey} cue={frame.coach} mode={coachMode} quality={quality} />
            </div>
            <div className="hl-board">
              <DraftBlock armed={armed} cycle={position.cycle} draft={draft} frame={frame} winner={winner} />
              <Evidence frame={frame} />
              <TopThree armed={armed} cycle={position.cycle} frame={frame} reduced={reduced} />
              <Call frame={frame} winner={winner} />
            </div>
            {calls && <RecentCalls handoff={handoff.stage} items={items} reduced={reduced} />}
          </div>
          {frame.placing && !reduced && <Flight fromSel=".hl-card[data-champion='true'] .hl-card-icon .chm-icon" hero={winner} host={inner} key={`p-${beatKey}`} toSel=".hl-seat[data-you='true'] .hl-you-art .chm-icon" />}
          {frame.carrying && handoff.flierAlive && !reduced && calls && <Flight fromSel=".hl-seat[data-you='true'] .hl-you-art .chm-icon" hero={winner} host={inner} key={`c-${beatKey}`} toSel=".hl-trace-item[data-newest='true'] .hl-trace-art" />}
        </div>
      </Glass>
      <p className="hl-sr">{frame.scenario.summary}</p>
    </div>
  );
}

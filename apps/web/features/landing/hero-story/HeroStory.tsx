/* LANDING-01C · the hero's product story, ~13 s, no click needed, told as ONE blind Ranked All Pick round
   from the Pos 2 Mid seat:
   our two supports are locked, the enemy's two picks are HIDDEN → the enemy picks are revealed (the new
   information) → counter A, counter B, team synergy and the player's own context arrive one by one, and each
   moves the Mid scores by a named amount → the Top 3 settles on a call → LOCK → the hero travels into Pos 2.
   Every score change on screen is the sum of reasons that have already arrived; there is no number that moves
   "because the animation says so". The interface shell never unmounts: the next pass swaps the DATA in place.
   The stage is decorative to assistive tech (`aria-hidden`) and summarised once in words. */
"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { HeroIcon } from "@/design/canonical/hero-media";
import { ActionQuiet, Delta, Glass } from "@/design/canonical/primitives";
import { useSettleFlip } from "@/design/canonical/motion/flip";
import { D2Icon } from "@/design/round-3b/icons";
import { SkinStage } from "@/design/canonical/motion/skin";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import {
  HERO_STORY,
  candidateOf,
  enemyOfStage,
  fitAt,
  rankAt,
  type StoryCandidate,
  type StoryScenario,
  type StorySignal,
  type StorySignalId,
} from "../product-state/fake-scenario-hero";
import { flagsFor, momentOf, useCountTo, useHeroStory, type HeroStoryStep, type StoryFlags, type StoryStep } from "./use-hero-story";
import "./hero-story.css";

const MOMENTS = ["Picks", "Reveal", "Analysis", "Call", "Lock"] as const;
const COUNT_MS = 600;
const CELLS = 16;
const FLIGHT_MS = 900;
const FLIGHT_EASE = "cubic-bezier(.22, .8, .24, 1)";

/** A signal node is lit once the information it reads has arrived. Position and meta are the baseline already inside the starting scores. */
const NODE_LIT_AT: Readonly<Record<StorySignalId, number>> = { position: 0, meta: 0, counter: 1, synergy: 3, history: 4 };
const NODE_LIVE_STAGES: Readonly<Record<StorySignalId, readonly string[]>> = { position: [], meta: [], counter: ["enemyA", "enemyB"], synergy: ["synergy"], history: ["pool"] };

function cellStyle(index: number): CSSProperties {
  /* A fixed scramble of 0..15: the dissolve order looks random and is identical on every pass. */
  const order = (index * 7 + 3) % CELLS;
  return { "--hs-k": String(order) } as CSSProperties;
}

/** Acquisition effect: the tile is covered by a pixel grid that dissolves in a scrambled order while the image gathers in.
    A tile that changes hero is re-keyed by its caller, so a swap replays the acquisition in place. */
function PixelIn({ children, delay = 0, on }: { children: ReactNode; delay?: number; on: boolean }) {
  return (
    <span className="hs-px" data-on={on ? "true" : "false"} style={{ "--hs-d": `${delay}ms` } as CSSProperties}>
      <span className="hs-px-art">{children}</span>
      <span aria-hidden="true" className="hs-px-cells">
        {Array.from({ length: CELLS }, (_, index) => <i key={index} style={cellStyle(index)} />)}
      </span>
    </span>
  );
}

function StoryProgress({ moment }: { moment: number }) {
  return (
    <ol className="hs-progress">
      {MOMENTS.map((label, index) => (
        <li data-state={index < moment ? "done" : index === moment ? "now" : "next"} key={label}>
          <span className="hs-progress-bar" />
          <span className="hs-progress-label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

function StoryControl({ finished, onReplay, onToggle, paused }: { finished: boolean; onReplay: () => void; onToggle: () => void; paused: boolean }) {
  if (finished) return <ActionQuiet onPress={onReplay}>Replay</ActionQuiet>;
  return <ActionQuiet onPress={onToggle}>{paused ? "Resume" : "Pause"}</ActionQuiet>;
}

function metaFor(step: StoryStep): string {
  if (step === "picks") return "Round 1 · picks locked";
  if (step === "reveal") return "Enemy picks revealed";
  return `Your turn · ${HERO_STORY.youLabel}`;
}

/** Which seat of the draft is the cause of what is arriving right now (drives the focus ring). */
function enemyFocus(step: StoryStep, index: number) {
  if (step === "reveal") return true;
  return (step === "counterA" && index === 0) || (step === "counterB" && index === 1);
}

/** Round 1 is blind: until the reveal the enemy's pick is a concealed slot. The swap to the hero is covered by the pixel acquisition. */
function EnemyTile({ cycle, flags, hero, index }: { cycle: number; flags: StoryFlags; hero: string; index: number }) {
  if (!flags.revealed) {
    return (
      <PixelIn delay={260 + index * 170} key={`h-${cycle}-${hero}`} on={flags.armed}>
        <span className="hs-seat-hidden">?</span>
      </PixelIn>
    );
  }
  return (
    <PixelIn delay={index * 160} key={`r-${hero}`} on>
      <HeroIcon hero={hero} size="md" />
    </PixelIn>
  );
}

function EnemySeat({ cycle, flags, hero, index, step }: { cycle: number; flags: StoryFlags; hero: string; index: number; step: StoryStep }) {
  return (
    <li className="hs-seat" data-focus={enemyFocus(step, index) ? "true" : "false"} data-hidden={flags.revealed ? "false" : "true"}>
      <EnemyTile cycle={cycle} flags={flags} hero={hero} index={index} />
    </li>
  );
}

function OpenSeat({ delay, flags, label }: { delay: number; flags: StoryFlags; label: string }) {
  return (
    <li className="hs-seat" data-empty="true">
      <PixelIn delay={delay} on={flags.armed}><span className="hs-seat-open">{label}</span></PixelIn>
    </li>
  );
}

function AllySeat({ cycle, flags, hero, index, step }: { cycle: number; flags: StoryFlags; hero: string; index: number; step: StoryStep }) {
  return (
    <li className="hs-seat" data-focus={step === "synergy" ? "true" : "false"}>
      <PixelIn delay={520 + index * 160} key={`a-${cycle}-${hero}`} on={flags.armed}><HeroIcon hero={hero} size="md" /></PixelIn>
    </li>
  );
}

/** Pos 2: empty until the call is locked; the chosen hero lands here. The target ring appears when the lock is pressed. */
function YouSeat({ flags, hero }: { flags: StoryFlags; hero: string }) {
  return (
    <li className="hs-seat" data-placed={flags.placed ? "true" : "false"} data-target={flags.pressed && !flags.placed ? "true" : "false"} data-you="true">
      <span className="hs-seat-open hs-you-open">You · Pos 2 Mid</span>
      <span className="hs-you-art"><HeroIcon hero={hero} size="md" /></span>
    </li>
  );
}

function DraftBlock({ cycle, flags, scenario, step, winner }: { cycle: number; flags: StoryFlags; scenario: StoryScenario; step: StoryStep; winner: string }) {
  const on = flags.armed;
  return (
    <section className="hs-block hs-draft" data-on={on ? "true" : "false"}>
      <header className="hs-block-head">
        <span className="hs-block-title">Draft</span>
        <span className="hs-block-meta" data-turn={flags.revealed && step !== "reveal" ? "true" : "false"} key={metaFor(step)}>{metaFor(step)}</span>
      </header>
      <ul aria-hidden="true" className="hs-bans">
        {scenario.bans.map((hero, index) => <li key={`${cycle}-${hero}`}><PixelIn delay={index * 50} on={on}><HeroIcon banned hero={hero} size="xs" /></PixelIn></li>)}
      </ul>
      <ul className="hs-row hs-row--enemy">
        <li className="hs-row-label">Enemy</li>
        <EnemySeat cycle={cycle} flags={flags} hero={scenario.enemies[0]} index={0} step={step} />
        <EnemySeat cycle={cycle} flags={flags} hero={scenario.enemies[1]} index={1} step={step} />
        <OpenSeat delay={420} flags={flags} label="" />
        <OpenSeat delay={500} flags={flags} label="" />
        <OpenSeat delay={580} flags={flags} label="" />
      </ul>
      <ul className="hs-row hs-row--allies">
        <li className="hs-row-label">Team</li>
        {scenario.allies.map((seat, index) => {
          if (seat.you) return <YouSeat flags={flags} hero={winner} key={seat.position} />;
          if (seat.hero) return <AllySeat cycle={cycle} flags={flags} hero={seat.hero} index={index} key={seat.position} step={step} />;
          return <OpenSeat delay={520 + index * 160} flags={flags} key={seat.position} label="" />;
        })}
      </ul>
    </section>
  );
}

function YouBlock({ flags }: { flags: StoryFlags }) {
  return (
    <section className="hs-block hs-you" data-on={flags.applied >= 4 ? "true" : "false"}>
      <header className="hs-block-head"><span className="hs-block-title">You</span></header>
      <ul className="hs-chips">
        {HERO_STORY.context.map((item, index) => (
          <li className="hs-chip" key={item.id} style={{ "--hs-i": String(index) } as CSSProperties}>{item.label}</li>
        ))}
      </ul>
    </section>
  );
}

function liveOf(id: StorySignalId, flags: StoryFlags) {
  return flags.stage !== null && NODE_LIVE_STAGES[id].includes(flags.stage);
}

function Lanes({ flags }: { flags: StoryFlags }) {
  return (
    <>
      {HERO_STORY.signals.map((signal, index) => (
        <span aria-hidden="true" className="hs-lane" data-lane={signal.id} data-live={liveOf(signal.id, flags) ? "true" : "false"} data-lit={flags.applied >= NODE_LIT_AT[signal.id] ? "true" : "false"} key={signal.id} style={{ "--hs-i": String(index) } as CSSProperties}><i className="hs-beam" /></span>
      ))}
    </>
  );
}

/** What a node reads right now: the counter node names the enemy the current reason is about. */
function nodeValue(signal: StorySignal, scenario: StoryScenario, applied: number) {
  if (signal.id !== "counter") return signal.value;
  if (applied >= 2) return `vs ${scenario.enemies[0]} + ${scenario.enemies[1]}`;
  return `vs ${scenario.enemies[0]}`;
}

function SignalNodes({ flags, scenario }: { flags: StoryFlags; scenario: StoryScenario }) {
  return (
    <>
      {HERO_STORY.signals.map((signal, index) => {
        const lit = flags.applied >= NODE_LIT_AT[signal.id];
        return (
          <li className="hs-node" data-lit={lit ? "true" : "false"} data-live={liveOf(signal.id, flags) ? "true" : "false"} data-node={signal.id} key={signal.id} style={{ "--hs-i": String(index) } as CSSProperties}>
            <span className="hs-node-ring" />
            <span className="hs-node-label"><span className="hs-long">{signal.label}</span><span className="hs-short">{signal.short}</span></span>
            <span className="hs-node-value">{nodeValue(signal, scenario, flags.applied)}</span>
            <i className="hs-stub"><i className="hs-beam" /></i>
          </li>
        );
      })}
    </>
  );
}

/** The one line that says what information just entered D2KIRO. */
function noteFor(step: StoryStep, scenario: StoryScenario): string {
  if (step === "picks") return "Enemy picks hidden";
  if (step === "reveal") return "New enemy data";
  if (step === "counterA") return `Counter · vs ${enemyOfStage(scenario, "enemyA")}`;
  if (step === "counterB") return `Counter · vs ${enemyOfStage(scenario, "enemyB")}`;
  if (step === "synergy") return "Team synergy · your supports";
  if (step === "pool") return "Your context";
  if (step === "decide") return "Mid recommendation recalculated";
  if (step === "lock") return "Call made";
  if (step === "place") return "Locking into Pos 2";
  return "Pos 2 locked";
}

function Bus({ scenario, step }: { scenario: StoryScenario; step: StoryStep }) {
  const note = noteFor(step, scenario);
  return (
    <div aria-hidden="true" className="hs-bus">
      <span className="hs-bus-note" key={note}>{note}</span>
      <i className="hs-bus-line"><i className="hs-beam hs-beam--x" /></i>
      <i className="hs-bus-drop"><i className="hs-beam" /></i>
    </div>
  );
}

function signed(value: number) {
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}

/** The reasons that have arrived for this candidate, each with its own signed amount. The last one is marked new. */
function Reasons({ candidate, flags }: { candidate: StoryCandidate; flags: StoryFlags }) {
  if (flags.applied === 0) return <span className="hs-card-reason">{candidate.why}</span>;
  return (
    <span className="hs-card-reasons">
      {candidate.reasons.slice(0, flags.applied).map((reason) => (
        <span className="hs-reason" data-dir={reason.delta > 0 ? "up" : "down"} data-new={flags.stage === reason.stage ? "true" : "false"} key={reason.stage}>
          {reason.text} <b>{signed(reason.delta)}</b>
        </span>
      ))}
    </span>
  );
}

function ScoreDelta({ delta }: { delta: number }) {
  if (delta === 0) return <span className="hs-card-delta" />;
  return <span className="hs-card-delta" key={delta}><Delta digits={0} locale="en" unit="" value={delta} /></span>;
}

function Card({ candidate, champion, flags, rank, reduced }: { candidate: StoryCandidate; champion: boolean; flags: StoryFlags; rank: number; reduced: boolean }) {
  const target = fitAt(candidate, flags.applied);
  const shown = useCountTo(target, COUNT_MS, reduced);
  const delta = target - candidate.base;
  const launched = champion && flags.placing;
  return (
    <li className="hs-card" data-champion={champion ? "true" : "false"} data-flip-key={candidate.hero} data-launched={launched ? "true" : "false"} data-rank={rank} data-ready={flags.armed ? "true" : "false"} style={{ "--hs-i": String(rank - 1) } as CSSProperties}>
      <span aria-hidden="true" className="hs-card-edge" />
      <span className="hs-card-rank">#{rank}</span>
      <span className="hs-card-icon"><PixelIn delay={(rank - 1) * 140} on={flags.armed}><HeroIcon hero={candidate.hero} size="lg" /></PixelIn></span>
      <span className="hs-card-main">
        <span className="hs-card-name">{candidate.hero}</span>
        <Reasons candidate={candidate} flags={flags} />
      </span>
      <ScoreDelta delta={delta} />
      <span className="hs-card-score" data-moving={shown !== target ? "true" : "false"}>{shown}</span>
    </li>
  );
}

function TopThree({ flags, reduced, scenario }: { flags: StoryFlags; reduced: boolean; scenario: StoryScenario }) {
  const list = useRef<HTMLOListElement>(null);
  const rows = rankAt(scenario, flags.applied);
  useSettleFlip(list, rows.map((row) => row.hero).join(","), reduced);
  return (
    <ol aria-hidden="true" className="hs-cards" ref={list}>
      {rows.map((row, index) => <Card candidate={candidateOf(scenario, row.hero)} champion={flags.decided && index === 0} flags={flags} key={`${row.hero}`} rank={index + 1} reduced={reduced} />)}
    </ol>
  );
}

function lockLabel(flags: StoryFlags, winner: string) {
  if (flags.placed) return `${winner} locked · Pos 2`;
  if (flags.placing) return `${winner} → Pos 2`;
  return `Lock ${winner}`;
}

/** The call, then the act: the reasons resolve, then the button is pressed. */
function Call({ flags, scenario, winner }: { flags: StoryFlags; scenario: StoryScenario; winner: string }) {
  return (
    <div aria-hidden="true" className="hs-call">
      <ul className="hs-why" data-on={flags.decided ? "true" : "false"}>
        {scenario.decision.map((reason, index) => (
          <li key={reason} style={{ "--hs-i": String(index) } as CSSProperties}>
            <D2Icon name="confirm" playing={flags.decided} size={14} />
            <span>{reason}</span>
          </li>
        ))}
      </ul>
      <span className="hs-lock" data-on={flags.decided ? "true" : "false"} data-pressed={flags.pressed ? "true" : "false"} data-done={flags.placed ? "true" : "false"}>
        {lockLabel(flags, winner)}
      </span>
    </div>
  );
}

/** The chosen hero physically leaves the recommendation and travels into its seat. It exists only while it travels. */
function Flight({ hero, host }: { hero: string; host: RefObject<HTMLElement | null> }) {
  const flier = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const root = host.current;
    const element = flier.current;
    if (!root || !element || typeof element.animate !== "function") return;
    const origin = root.getBoundingClientRect();
    const from = root.querySelector(".hs-card[data-champion='true'] .hs-card-icon")?.getBoundingClientRect();
    const to = root.querySelector(".hs-seat[data-you='true']")?.getBoundingClientRect();
    if (!from || !to) return;
    element.style.left = `${from.left - origin.left}px`;
    element.style.top = `${from.top - origin.top}px`;
    element.style.width = `${from.width}px`;
    element.style.height = `${from.height}px`;
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    const scale = to.width / from.width;
    const motion = element.animate(
      [
        { transform: "translate(0px, 0px) scale(1)" },
        { offset: 0.45, transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 14}px) scale(${1 + (scale - 1) * 0.5})` },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
      ],
      { duration: FLIGHT_MS, easing: FLIGHT_EASE, fill: "both" },
    );
    return () => motion.cancel();
  }, [host]);
  return (
    <span aria-hidden="true" className="hs-fly" ref={flier}>
      <HeroIcon hero={hero} size="lg" />
    </span>
  );
}

export type HeroStoryProps = {
  onStep?: (step: StoryStep) => void;
  /** Freezes the canonical story at one moment for deterministic visual review. */
  reviewStep?: HeroStoryStep;
};

export function HeroStory({ onStep, reviewStep }: HeroStoryProps) {
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const story = useHeroStory(host, reduced, reviewStep);
  const flags = flagsFor(story.step, story.armed);
  const scenario = HERO_STORY.scenarios[story.cycle % HERO_STORY.scenarios.length];
  const winner = rankAt(scenario, 4)[0].hero;
  useEffect(() => onStep?.(story.step), [onStep, story.step]);

  return (
    <div className="hs-host" data-paused={story.paused ? "true" : "false"} ref={host}>
      <SkinStage center className="hs-field" ghost="">
        <div
          className="hs"
          data-decided={flags.decided ? "true" : "false"}
          data-flow={flags.stage !== null ? "true" : "false"}
          data-motion={reduced ? "reduced" : "full"}
          data-revealed={flags.revealed ? "true" : "false"}
          data-step={story.step}
          data-testid="hero-story"
        >
          <span aria-hidden="true" className="hs-spectrum" />
          <Glass className="hs-panel" surfaceLevel="3">
            <span aria-hidden="true" className="hs-ambient" />
            <div className="hs-inner" ref={inner}>
              <div className="hs-head" aria-hidden="true">
                <StoryProgress moment={momentOf(story.step)} />
              </div>
              <div className="hs-grid" aria-hidden="true">
                <div className="hs-area-draft"><DraftBlock cycle={story.cycle} flags={flags} scenario={scenario} step={story.step} winner={winner} /></div>
                <div className="hs-area-you"><YouBlock flags={flags} /></div>
                <div className="hs-lanes"><Lanes flags={flags} /></div>
                <ul className="hs-nodes">
                  <SignalNodes flags={flags} scenario={scenario} />
                </ul>
                <div className="hs-feed" data-lit={flags.applied >= 4 ? "true" : "false"} data-live={flags.stage === "pool" ? "true" : "false"}><i className="hs-beam" /></div>
                <div className="hs-area-bus"><Bus scenario={scenario} step={story.step} /></div>
                <div className="hs-area-top"><TopThree flags={flags} reduced={reduced} scenario={scenario} /></div>
                <div className="hs-area-why"><Call flags={flags} scenario={scenario} winner={winner} /></div>
              </div>
              {flags.placing && !reduced && <Flight hero={winner} host={inner} />}
            </div>
          </Glass>
        </div>
        <p className="ld-sr">{scenario.summary}</p>
      </SkinStage>
      {reviewStep === undefined && <div className="hs-control">
        <StoryControl finished={story.finished} onReplay={story.replay} onToggle={story.toggle} paused={story.paused} />
      </div>}
    </div>
  );
}

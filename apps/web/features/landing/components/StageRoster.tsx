/* LANDING-01B · the draft's people: bans, your five seats, the enemy picks. Pure presentation of a
   `DraftFrame`; every hero is the canonical media primitive (HeroDraftSlot / HeroIcon). */
import { HeroDraftSlot, HeroIcon, type DraftSlotState } from "@/design/canonical/hero-media";
import { POSITION_NAMES, positionLabel, type DraftFrame, type Seat } from "../product-state/types";

export function BanRow({ bans }: { bans: readonly string[] }) {
  return (
    <ul aria-label="Banned heroes" className="ld-bans">
      {bans.map((hero) => (
        <li key={hero}><HeroIcon banned hero={hero} size="xs" /></li>
      ))}
    </ul>
  );
}

/** A default (thin-evidence) view never marks a seat "recommended": that notch is reserved for a strategic call. */
function seatState(seat: Seat, previewsCall: boolean): DraftSlotState {
  if (seat.locked) return "confirmed";
  if (previewsCall) return "recommended";
  return "unknown";
}

function SeatSlot({ frame, seat }: { frame: DraftFrame; seat: Seat }) {
  const onTheClock = frame.onTheClock === seat.position;
  const callHero = frame.top3[0]?.hero ?? null;
  const previewsCall = onTheClock && frame.basis === "STRATEGIC";
  const hero = seat.hero ?? (previewsCall ? callHero : null);
  return (
    <li className="ld-seat" data-clock={onTheClock ? "true" : "false"} data-position={seat.position}>
      <HeroDraftSlot hero={hero} position={seat.position} showRole showStateBadge={hero !== null} size="sm" state={seatState(seat, previewsCall)} />
    </li>
  );
}

/** Your five seats, Pos 1 → Pos 5. The seat on the clock previews the call as a recommended slot. */
export function TeamColumn({ frame }: { frame: DraftFrame }) {
  return (
    <ol aria-label="Your team" className="ld-seats">
      {frame.allies.map((seat) => <SeatSlot frame={frame} key={seat.position} seat={seat} />)}
    </ol>
  );
}

function EnemyPick({ hero, index }: { hero: string | null; index: number }) {
  if (hero === null) return <li className="ld-enemy" data-empty="true"><span className="ld-enemy-empty" aria-label={`Enemy pick ${index + 1}, not revealed`}>Not revealed</span></li>;
  return (
    <li className="ld-enemy" data-empty="false">
      <HeroIcon hero={hero} size="md" />
      <span className="ld-enemy-name">{hero}</span>
    </li>
  );
}

export function EnemyColumn({ frame }: { frame: DraftFrame }) {
  return (
    <ol aria-label="Enemy picks" className="ld-enemies">
      {frame.enemies.map((hero, index) => <EnemyPick hero={hero} index={index} key={`${index}-${hero ?? "empty"}`} />)}
    </ol>
  );
}

function RosterIcon({ hero, position }: { hero: string | null; position: number }) {
  if (hero === null) return <li className="ld-roster-icon" data-empty="true"><span aria-label={`Pos ${position}, open`} /></li>;
  return <li className="ld-roster-icon"><HeroIcon hero={hero} size="md" /></li>;
}

/** Compact two-sided strip used where the full columns do not fit (the hero). */
export function RosterStrip({ frame }: { frame: DraftFrame }) {
  return (
    <div className="ld-roster">
      <ul aria-label="Your team" className="ld-roster-side">
        {frame.allies.map((seat) => <RosterIcon hero={seat.hero} key={seat.position} position={seat.position} />)}
      </ul>
      <span aria-hidden="true" className="ld-roster-vs">vs</span>
      <ul aria-label="Enemy picks" className="ld-roster-side">
        {frame.enemies.map((hero, index) => <RosterIcon hero={hero} key={`${index}-${hero ?? "empty"}`} position={index + 1} />)}
      </ul>
    </div>
  );
}

export function seatCaption(frame: DraftFrame) {
  if (frame.onTheClock === null) return "No seat on the clock";
  return `On the clock: ${positionLabel(frame.onTheClock)}`;
}

export function openSeats(frame: DraftFrame) {
  return frame.allies.filter((seat) => !seat.locked).map((seat) => `${seat.position} ${POSITION_NAMES[seat.position]}`);
}

import type { LiveEngineStatus } from "./live-store";
import type { LiveCaptureStatus, LiveConnection } from "./types";

// /live-draft "Diagnóstico de conexión": what the server already knows about this account's Dota link,
// reduced to an ALLOWLIST of capability/status facts -- so the Player can paste it into a chat and we can
// tell, after a real Ranked All Pick, what Dota did and did not send. Pure.
//
// Built field by field from the parsed live status; nothing is spread or passed through. Never the session
// id, a hero, a timestamp, an account, a player name, a match id, a token or any raw GSI value: none of
// them is read here, so none can reach the panel or the copied text.

export type Presence = "YES" | "PARTIAL" | "NO";

/**
 * `live`: the engine answered the last status poll. `last_known`: it did not, so connection and packet age
 * are the last successful reading, not a current one. `none`: no status was ever read for this link.
 */
export type DiagnosticReading = "live" | "last_known" | "none";

export interface DiagnosticRow {
  key: string;
  label: string;
  presence: Presence;
}

/** A structural finding: the section / roster shape was seen (present) or never seen (absent). Never a value. */
export interface StructureRow {
  key: string;
  label: string;
  present: boolean;
}

export interface LiveDiagnostics {
  engine: LiveEngineStatus;
  dotaLink: boolean;
  reading: DiagnosticReading;
  connection: LiveConnection | "none";
  firstGsiPacket: boolean;
  /** Server-measured ms since the last GSI update; null before the first one. */
  lastUpdateAgeMs: number | null;
  remoteGsiHttps: boolean;
  gsiPhase: string;
  gameState: string;
  draftPhase: string;
  captureHealth: string;
  captureDetail: string;
  counts: { bans: number; picks: number; deferredPicks: number; rejectedFacts: number };
  draft: DiagnosticRow[];
  telemetry: DiagnosticRow[];
  /** What Dota ever sent, by STRUCTURE (sections, roster-like shapes). Capability discovery: none of it is verified as usable for coaching. */
  structure: StructureRow[];
  /** Party 5 preset applied to the live session: how many of the five positions carry a pool (never ids or names). */
  partyPoolPositions: number;
}

interface RowSpec {
  key: string;
  label: string;
}

const DRAFT_ROWS: readonly (RowSpec & { field: "side" | "ownHero" | "bans" | "allyPicks" | "enemyPicks" | "progression" })[] = [
  { key: "side", label: "Bando", field: "side" },
  { key: "ownHero", label: "Tu héroe", field: "ownHero" },
  { key: "bans", label: "Bans", field: "bans" },
  { key: "allyPicks", label: "Picks aliados", field: "allyPicks" },
  { key: "enemyPicks", label: "Picks rivales", field: "enemyPicks" },
  { key: "progression", label: "Progresión de picks", field: "progression" },
];

/** Engine capability labels (gsi-normalize.ts TELEMETRY_PROBES + registry GSI_ITEM_CHANGES) per row. */
const TELEMETRY_ROWS: readonly (RowSpec & { labels: readonly string[] })[] = [
  { key: "clock", label: "Reloj / tiempo de juego", labels: ["clock_time", "game_time"] },
  { key: "heroLevel", label: "Nivel del héroe", labels: ["hero_level"] },
  { key: "hpMana", label: "Vida / maná", labels: ["hero_health", "hero_mana"] },
  { key: "alive", label: "Vivo / muerto", labels: ["hero_alive"] },
  { key: "kda", label: "K/D/A", labels: ["kda"] },
  { key: "lhDn", label: "LH / DN", labels: ["last_hits", "denies"] },
  { key: "gold", label: "Oro", labels: ["gold"] },
  { key: "gpmXpm", label: "GPM / XPM", labels: ["gpm", "xpm"] },
  { key: "netWorth", label: "Net worth", labels: ["net_worth"] },
  { key: "items", label: "Ítems", labels: ["items"] },
  { key: "itemChanges", label: "Cambios de ítems", labels: ["item_changes"] },
  { key: "abilities", label: "Habilidades", labels: ["abilities", "ability_levels"] },
  { key: "cooldowns", label: "Cooldowns", labels: ["ability_cooldowns", "item_cooldowns"] },
];

/** Engine structural labels (gsi-normalize.ts GSI_STRUCTURE_LABELS) -> report key. Anything else the engine sends is ignored. */
const STRUCTURE_ROWS: readonly (RowSpec & { engineLabel: string })[] = [
  { key: "provider", label: "Sección provider", engineLabel: "section.provider" },
  { key: "map", label: "Sección map", engineLabel: "section.map" },
  { key: "player", label: "Sección player", engineLabel: "section.player" },
  { key: "hero", label: "Sección hero", engineLabel: "section.hero" },
  { key: "abilities", label: "Sección abilities", engineLabel: "section.abilities" },
  { key: "items", label: "Sección items", engineLabel: "section.items" },
  { key: "draft", label: "Sección draft", engineLabel: "section.draft" },
  { key: "draft.team2", label: "draft → team2", engineLabel: "draft.team2" },
  { key: "draft.team3", label: "draft → team3", engineLabel: "draft.team3" },
  { key: "draft.slots", label: "draft → slots de pick/ban", engineLabel: "draft.pick_ban_slots" },
  { key: "allplayers", label: "Sección allplayers", engineLabel: "section.allplayers" },
  { key: "roster.teamKeyed", label: "Estructura por equipos (team2/team3)", engineLabel: "roster.team_keyed" },
  { key: "roster.entries", label: "Entradas tipo jugador", engineLabel: "roster.player_entries" },
  { key: "roster.multi", label: "Varias entradas tipo jugador (2 o más)", engineLabel: "roster.multi_entries" },
  { key: "roster.full", label: "Diez entradas tipo jugador", engineLabel: "roster.full_entries" },
  { key: "roster.heroFields", label: "Entradas con campo de héroe", engineLabel: "roster.hero_fields" },
  { key: "roster.teamFields", label: "Entradas con campo de equipo", engineLabel: "roster.team_fields" },
];

const GAME_STATE = /^DOTA_GAMERULES_STATE_[A-Z_]{1,48}$/;
const MACHINE_CODE = /^[A-Z][A-Z_]{0,47}$/;
const GSI_PHASES = new Set(["idle", "loading", "draft", "match"]);
const DRAFT_PHASES = new Set(["waiting", "hero_selection", "ended"]);
const CAPTURE_HEALTH = new Set(["unknown", "ok", "degraded", "lost"]);

function presenceOf(seen: boolean): Presence {
  if (seen) return "YES";
  return "NO";
}

function telemetryPresence(observed: ReadonlySet<string>, labels: readonly string[]): Presence {
  const present = labels.filter((label) => observed.has(label)).length;
  if (present === 0) return "NO";
  if (present === labels.length) return "YES";
  return "PARTIAL";
}

function readingOf(engine: LiveEngineStatus, status: LiveCaptureStatus | null): DiagnosticReading {
  if (status === null) return "none";
  if (engine === "ok") return "live";
  return "last_known";
}

function count(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/** Only an allowlisted shape survives; anything else is reported as "other" / "none", never echoed. */
function allowed(value: string | null | undefined, valid: (candidate: string) => boolean): string {
  if (value === null || value === undefined) return "none";
  if (valid(value)) return value;
  return "other";
}

export interface LiveDiagnosticsInput {
  engine: LiveEngineStatus;
  /** The account has an active Dota link (its cfg always points at the https site). */
  dotaLink: boolean;
  /** The live status of THAT link's session, or null when none was read yet. */
  status: LiveCaptureStatus | null;
}

export function buildLiveDiagnostics({ engine, dotaLink, status }: LiveDiagnosticsInput): LiveDiagnostics {
  const gsi = status?.gsi ?? null;
  const observed = new Set(gsi?.telemetry ?? []);
  const structureSeen = new Set(gsi?.structure ?? []);
  const age = gsi?.lastPacketAgeMs;
  const draftSeen = {
    side: gsi?.draft.side === true,
    ownHero: gsi?.draft.ownHero === true,
    bans: gsi?.draft.bans === true,
    allyPicks: gsi?.draft.allyPicks === true,
    enemyPicks: gsi?.draft.enemyPicks === true,
    progression: gsi?.draftProgression === true,
  };
  return {
    engine,
    dotaLink,
    reading: readingOf(engine, status),
    connection: status?.connection ?? "none",
    firstGsiPacket: gsi !== null,
    lastUpdateAgeMs: typeof age === "number" && Number.isFinite(age) ? Math.max(0, Math.round(age)) : null,
    remoteGsiHttps: dotaLink && engine === "ok" && gsi?.active === true,
    gsiPhase: allowed(gsi?.phase, (value) => GSI_PHASES.has(value)),
    gameState: allowed(gsi?.gameState, (value) => GAME_STATE.test(value)),
    draftPhase: allowed(status?.draftPhase, (value) => DRAFT_PHASES.has(value)),
    captureHealth: allowed(status?.captureHealth, (value) => CAPTURE_HEALTH.has(value)),
    captureDetail: allowed(status?.captureDetail, (value) => MACHINE_CODE.test(value)),
    counts: {
      bans: count(status?.bans ?? 0),
      picks: count(status?.picks ?? 0),
      deferredPicks: count(status?.deferredPicks ?? 0),
      rejectedFacts: count(status?.rejectedFacts ?? 0),
    },
    draft: DRAFT_ROWS.map((row) => ({ key: row.key, label: row.label, presence: presenceOf(draftSeen[row.field]) })),
    telemetry: TELEMETRY_ROWS.map((row) => ({ key: row.key, label: row.label, presence: telemetryPresence(observed, row.labels) })),
    structure: STRUCTURE_ROWS.map((row) => ({ key: row.key, label: row.label, present: structureSeen.has(row.engineLabel) })),
    partyPoolPositions: Object.values(status?.teamContext?.positions ?? {}).filter(Boolean).length,
  };
}

function yesNo(value: boolean): Presence {
  return presenceOf(value);
}

function structureText(present: boolean): string {
  if (present) return "present";
  return "absent";
}

/** A roster-like shape (several player-like entries carrying hero fields) exists in the payloads: a lead to verify, not a usable source. */
export function rosterCandidate(diagnostics: Pick<LiveDiagnostics, "structure">): boolean {
  const seen = (key: string) => diagnostics.structure.some((row) => row.key === key && row.present);
  return seen("roster.multi") && seen("roster.heroFields");
}

/** The text "Copiar diagnóstico" puts on the clipboard: stable keys, no identifiers. */
export function formatLiveDiagnosticReport(diagnostics: LiveDiagnostics): string {
  const lines = [
    "D2KIRO LIVE DIAGNOSTIC",
    `engine: ${diagnostics.engine}`,
    `dotaLink: ${yesNo(diagnostics.dotaLink)}`,
    `reading: ${diagnostics.reading}`,
    `connection: ${diagnostics.connection}`,
    `firstGsiPacket: ${yesNo(diagnostics.firstGsiPacket)}`,
    `lastUpdateAgeMs: ${diagnostics.lastUpdateAgeMs ?? "n/a"}`,
    `remoteGsiHttps: ${yesNo(diagnostics.remoteGsiHttps)}`,
    `gsi.phase: ${diagnostics.gsiPhase}`,
    `gsi.gameState: ${diagnostics.gameState}`,
    `draftPhase: ${diagnostics.draftPhase}`,
    `captureHealth: ${diagnostics.captureHealth}`,
    `captureDetail: ${diagnostics.captureDetail}`,
    `counts.bans: ${diagnostics.counts.bans}`,
    `counts.picks: ${diagnostics.counts.picks}`,
    `counts.deferredPicks: ${diagnostics.counts.deferredPicks}`,
    `counts.rejectedFacts: ${diagnostics.counts.rejectedFacts}`,
    "",
    ...diagnostics.draft.map((row) => `draft.${row.key}: ${row.presence}`),
    "",
    ...diagnostics.telemetry.map((row) => `telemetry.${row.key}: ${row.presence}`),
    "",
    // Structure = which sections / shapes Dota sent. "present" is NOT "usable for coaching" until verified.
    ...diagnostics.structure.map((row) => `structure.${row.key}: ${structureText(row.present)}`),
    `structure.rosterCandidate: ${structureText(rosterCandidate(diagnostics))} (unverified)`,
    "",
    `party.poolPositions: ${diagnostics.partyPoolPositions}/5`,
  ];
  return `${lines.join("\n")}\n`;
}

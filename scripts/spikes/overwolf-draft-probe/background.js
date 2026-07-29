// Paso 0 del addendum (2026-07-28) de docs/agents/architecture.md.
// Spike desechable — NO es parte del producto, no pasa por @redteam/@shipcheck.
// Objetivo: confirmar los 2 criterios de éxito documentados en architecture.md:
//   (1) roster/bans/draft del GEP traen heroId/team en vivo durante una partida propia.
//   (2) un pick_revert provocado a propósito se distingue de un pick nuevo en los datos crudos.
// Los nombres exactos de campo dentro de roster/bans/draft (team_slot vs index, hero vs
// heroId) no están confirmados hasta correr esto — por eso cada actualización se vuelca
// completa y cruda (RAW), y el diff de abajo es solo una ayuda de lectura, no la fuente
// de verdad.

const LOG_FILE = "overwolf-appdata:/draft-probe.log";

let lastPlayers = [];
let lastBans = [];
let lastDraft = [];

function timestamp() {
  return new Date().toISOString();
}

function log(line) {
  const withTs = `[${timestamp()}] ${line}`;
  console.log(withTs);
  overwolf.io.writeFileContents(
    LOG_FILE,
    withTs + "\n",
    overwolf.io.enums.eEncoding.UTF8,
    true,
    () => {}, // best-effort; la consola (paso 6 del README) es la fuente confiable
  );
}

function keyOf(item, idx) {
  if (item.team_slot !== undefined) return `slot${item.team_slot}`;
  if (item.index !== undefined) return `idx${item.index}`;
  if (item.steamId !== undefined) return `steam${item.steamId}`;
  return `pos${idx}`;
}

function heroOf(item) {
  return item.heroId ?? item.hero ?? null;
}

// Compara dos snapshots consecutivos de un mismo array (roster.players, roster.bans o
// roster.draft) y señala 3 casos: entrada nueva, entrada removida, entrada cambiada en el
// mismo slot. El tercer caso es la señal que el adapter overwolf (Paso 1A) necesita para
// distinguir un pick_reverted de un hero_picked nuevo.
function diffArray(prevArr, currArr, label) {
  const prevMap = new Map((prevArr || []).map((item, idx) => [keyOf(item, idx), item]));
  const currMap = new Map((currArr || []).map((item, idx) => [keyOf(item, idx), item]));

  for (const [key, currItem] of currMap) {
    const prevItem = prevMap.get(key);
    if (!prevItem) {
      log(`[DIFF ${label}] NUEVO slot=${key} -> ${JSON.stringify(currItem)}`);
      continue;
    }
    if (JSON.stringify(prevItem) === JSON.stringify(currItem)) continue;

    const prevHero = heroOf(prevItem);
    const currHero = heroOf(currItem);
    const heroChanged = prevHero !== null && currHero !== null && prevHero !== currHero;
    const flag = heroChanged
      ? " <<< POSIBLE REVERT: el héroe cambió en el mismo slot"
      : "";
    log(
      `[DIFF ${label}] CAMBIÓ slot=${key}: ${JSON.stringify(prevItem)} -> ${JSON.stringify(currItem)}${flag}`,
    );
  }

  for (const [key, prevItem] of prevMap) {
    if (!currMap.has(key)) {
      log(`[DIFF ${label}] DESAPARECIÓ slot=${key} (era ${JSON.stringify(prevItem)})`);
    }
  }
}

function safeParse(value) {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch (_e) {
    return null;
  }
}

function onInfoUpdate(update) {
  log(`[RAW info_update] ${JSON.stringify(update)}`);

  const roster = update && update.info && update.info.roster;
  if (!roster) return;

  if (roster.players !== undefined) {
    const players = safeParse(roster.players);
    if (players) {
      diffArray(lastPlayers, players, "roster.players");
      lastPlayers = players;
    }
  }
  if (roster.bans !== undefined) {
    const bans = safeParse(roster.bans);
    if (bans) {
      diffArray(lastBans, bans, "roster.bans");
      lastBans = bans;
    }
  }
  if (roster.draft !== undefined) {
    const draft = safeParse(roster.draft);
    if (draft) {
      diffArray(lastDraft, draft, "roster.draft");
      lastDraft = draft;
    }
  }
}

function onNewEvent(e) {
  log(`[RAW event] ${JSON.stringify(e)}`);
}

function setFeatures() {
  overwolf.games.events.setRequiredFeatures(["roster", "match_state_changed", "match_info"], (info) =>
    log(`[setRequiredFeatures] ${JSON.stringify(info)}`),
  );
}

overwolf.games.events.onInfoUpdates2.addListener(onInfoUpdate);
overwolf.games.events.onNewEvents.addListener(onNewEvent);

overwolf.games.onGameLaunched.addListener((game) => {
  log(`[game launched] ${JSON.stringify(game)}`);
  setFeatures();
});

overwolf.games.getRunningGameInfo((game) => {
  if (game && game.isRunning) {
    log(`[game ya estaba corriendo] ${JSON.stringify(game)}`);
    setFeatures();
  } else {
    log("Esperando a que Dota 2 arranque...");
  }
});

log("=== dota2coach draft probe iniciado (Paso 0, architecture.md addendum 2026-07-28) ===");

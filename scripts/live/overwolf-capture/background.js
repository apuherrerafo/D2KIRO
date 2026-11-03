// D2KIRO live capture -- Overwolf background window (the only file that touches `overwolf.*`).
//
// Reads ONLY the local config written by `bun run dev:live` (local/dota-live-capture.json, gitignored),
// subscribes to the official Dota 2 Game Events Provider, and POSTs draft-event/v1 envelopes to the
// local engine (http://127.0.0.1:<port>/ingest/draft-event, header x-capture-token). No memory reading,
// no OCR, no hooking, no change to the Dota client: Overwolf GEP only. The token is never logged.

import {
  DOTA2_GAME_CLASS_ID,
  REQUIRED_FEATURES,
  buildHeroNameIndex,
  createCaptureState,
  createEnvelopeFactory,
  handleInfoUpdate,
  handleNewEvents,
  hasGameStateIntegration,
  healthPayload,
  parseCaptureConfig,
  setDotaRunning,
  setGsiStatus,
} from "./capture-core.js";

const CONFIG_PATH = "local/dota-live-capture.json";
const HEARTBEAT_MS = 5_000;
const FEATURE_RETRY_MS = 2_000;
const MAX_FEATURE_RETRIES = 10;

let config = null;
let envelope = null;
const state = createCaptureState();
const ctx = { heroIdByName: new Map() };
const queue = [];
let sending = false;
let featuresSet = false;

function log(message) {
  console.log(`[d2kiro-capture ${new Date().toISOString()}] ${message}`);
}

async function loadConfig() {
  try {
    const response = await fetch(CONFIG_PATH, { cache: "no-store" });
    const parsed = parseCaptureConfig(await response.json());
    if (!parsed) log("config inválida: corré `bun run dev:live` y recargá la extensión");
    return parsed;
  } catch {
    log("sin config local: corré `bun run dev:live` y recargá la extensión");
    return null;
  }
}

async function loadHeroCatalog() {
  try {
    const response = await fetch(`${config.engineUrl}/api/heroes`, { cache: "no-store" });
    ctx.heroIdByName = buildHeroNameIndex(await response.json());
    log(`catálogo de héroes: ${ctx.heroIdByName.size} nombres`);
  } catch {
    log("no se pudo leer el catálogo de héroes del motor; se usarán sólo heroId numéricos");
  }
}

function enqueue(payloads) {
  if (!envelope || payloads.length === 0) return;
  for (const payload of payloads) {
    // Never pile up heartbeats while the engine is down: only the newest one matters.
    if (payload.type === "capture_health" && queue.length > 0 && queue[queue.length - 1].payload.type === "capture_health") queue.pop();
    queue.push(envelope(payload));
    if (payload.type !== "capture_health") log(`evento ${payload.type}${payload.hero ? ` hero=${payload.hero}` : ""}${payload.side ? ` side=${payload.side}` : ""}${payload.position ? ` pos=${payload.position}` : ""}`);
  }
  void pump();
}

async function pump() {
  if (sending) return;
  sending = true;
  let backoffMs = 1_000;
  while (queue.length > 0) {
    const next = queue[0];
    try {
      const response = await fetch(`${config.engineUrl}/ingest/draft-event`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-capture-token": config.captureToken },
        body: JSON.stringify(next),
      });
      if (response.status === 429 || response.status >= 500) throw new Error(`engine ${response.status}`);
      if (response.status === 401) log("el motor rechazó el token de captura: reiniciá `bun run dev:live` y recargá la extensión");
      queue.shift(); // 2xx or a definitive 4xx: retrying the same envelope would not change the answer.
      backoffMs = 1_000;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 10_000);
    }
  }
  sending = false;
}

function checkGameStateIntegration() {
  overwolf.games.getGameInfo(DOTA2_GAME_CLASS_ID, (result) => {
    const enabled = hasGameStateIntegration(result);
    if (enabled === false) log("FALTA -gamestateintegration en las Launch Options de Dota 2 -- captura deshabilitada");
    if (enabled === null) log("Overwolf no informó la línea de comando de Dota; se continúa sin verificar -gamestateintegration");
    enqueue(setGsiStatus(state, enabled, ctx));
  });
}

function setFeatures(attempt = 1) {
  overwolf.games.events.setRequiredFeatures(REQUIRED_FEATURES, (result) => {
    if (result?.success) {
      featuresSet = true;
      log(`features GEP activas: ${REQUIRED_FEATURES.join(", ")}`);
      return;
    }
    if (attempt < MAX_FEATURE_RETRIES) setTimeout(() => setFeatures(attempt + 1), FEATURE_RETRY_MS);
    else log(`no se pudieron activar las features GEP: ${JSON.stringify(result?.error ?? result)}`);
  });
}

function onDotaRunning() {
  setDotaRunning(state, true);
  enqueue([healthPayload(state)]);
  if (!featuresSet) setFeatures();
  checkGameStateIntegration();
}

function isDota(gameInfo) {
  return Math.floor((gameInfo?.id ?? 0) / 10) === DOTA2_GAME_CLASS_ID || gameInfo?.classId === DOTA2_GAME_CLASS_ID;
}

async function main() {
  config = await loadConfig();
  if (!config) return;
  const runId = Math.random().toString(36).slice(2, 10);
  envelope = createEnvelopeFactory({ sessionId: config.sessionId, runId, now: Date.now });
  await loadHeroCatalog();

  overwolf.games.events.onInfoUpdates2.addListener((update) => enqueue(handleInfoUpdate(state, update, ctx)));
  overwolf.games.events.onNewEvents.addListener((update) => enqueue(handleNewEvents(state, update, ctx)));
  overwolf.games.onGameInfoUpdated.addListener((event) => {
    if (!isDota(event?.gameInfo) || !(event.runningChanged || event.gameChanged)) return;
    if (event.gameInfo.isRunning) {
      onDotaRunning();
      return;
    }
    setDotaRunning(state, false);
    featuresSet = false;
    enqueue([healthPayload(state)]);
  });
  overwolf.games.getRunningGameInfo((gameInfo) => {
    if (gameInfo?.isRunning && isDota(gameInfo)) onDotaRunning();
    else log("esperando a Dota 2...");
  });
  setInterval(() => enqueue([healthPayload(state)]), HEARTBEAT_MS);
  enqueue([healthPayload(state)]);
  log(`captura lista para la sesión ${config.sessionId}`);
}

void main();

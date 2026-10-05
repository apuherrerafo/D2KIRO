// D2KIRO live capture -- Overwolf background window (the only file that touches `overwolf.*`).
//
// Two ways to reach D2KIRO, one capture core:
//   CLOUD (the normal one): the Player pairs this app once with a one-time code from /live-draft ("Conectar
//     captura automática"). The code is exchanged for a scoped credential (stored in this app's localStorage,
//     12 h) and every batch of draft facts is POSTed over HTTPS to the site, which feeds the Player's OWN live
//     session. The credential can submit draft facts to that session and nothing else.
//   LOCAL (development): `bun run dev:live` writes local/dota-live-capture.json for a local engine on 127.0.0.1.
//
// Only the official Overwolf Game Events Provider is used: no memory reading, no OCR, no hooking, no change to
// the Dota client. Identity in a GEP roster (steam id, names, rank) is dropped on arrival (capture-core.js) and is
// never sent, stored or logged. The credential and the pairing code are never logged.

import {
  DOTA2_GAME_CLASS_ID,
  MAX_BATCH_EVENTS,
  REQUIRED_FEATURES,
  batchUrl,
  buildBatch,
  buildHeroNameIndex,
  capturePresence,
  createCaptureState,
  createCloudEventFactory,
  createEnvelopeFactory,
  handleInfoUpdate,
  handleNewEvents,
  hasGameStateIntegration,
  healthPayload,
  heroesUrl,
  pairUrl,
  parseCaptureConfig,
  parseCredentialResponse,
  parsePairingCode,
  parseSiteUrl,
  parseStoredCredential,
  setDotaRunning,
  setGsiStatus,
} from "./capture-core.js";

const CONFIG_PATH = "local/dota-live-capture.json";
const CREDENTIAL_KEY = "d2kiro.capture.credential";
const SITE_KEY = "d2kiro.capture.site";
const HEARTBEAT_MS = 5_000;
const FEATURE_RETRY_MS = 2_000;
const MAX_FEATURE_RETRIES = 10;
/** Facts queued while unpaired / offline are bounded: a draft is ~60 facts, so this never drops a real one. */
const MAX_QUEUE = 500;
const PAIR_WINDOW = "pair";

let transport = null; // { kind: "cloud", credential } | { kind: "local", config } | null (unpaired)
let makeEvent = createCloudEventFactory({ runId: Math.random().toString(36).slice(2, 10), now: Date.now });
const state = createCaptureState();
const ctx = { heroIdByName: new Map() };
const queue = [];
let sending = false;
let featuresSet = false;

function log(message) {
  console.log(`[d2kiro-capture ${new Date().toISOString()}] ${message}`);
}

function readStoredCredential() {
  try {
    return parseStoredCredential(JSON.parse(localStorage.getItem(CREDENTIAL_KEY) ?? "null"), Date.now());
  } catch {
    return null;
  }
}

function clearCredential() {
  try {
    localStorage.removeItem(CREDENTIAL_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

async function loadLocalConfig() {
  try {
    const response = await fetch(CONFIG_PATH, { cache: "no-store" });
    return parseCaptureConfig(await response.json());
  } catch {
    return null;
  }
}

function openPairWindow() {
  overwolf.windows.obtainDeclaredWindow(PAIR_WINDOW, (result) => {
    if (result?.success) overwolf.windows.restore(result.window.id, () => undefined);
  });
}

async function loadHeroCatalog() {
  if (!transport) return;
  try {
    const url = transport.kind === "cloud" ? heroesUrl(transport.credential) : `${transport.config.engineUrl}/api/heroes`;
    const headers = transport.kind === "cloud" ? { "x-capture-credential": transport.credential.token } : {};
    const response = await fetch(url, { cache: "no-store", headers });
    ctx.heroIdByName = buildHeroNameIndex(await response.json());
    log(`catálogo de héroes: ${ctx.heroIdByName.size} nombres`);
  } catch {
    log("no se pudo leer el catálogo de héroes; se usarán sólo heroId numéricos");
  }
}

function enqueue(payloads) {
  if (payloads.length === 0) return;
  for (const payload of payloads) {
    // Never pile up heartbeats while the site is unreachable or unpaired: only the newest one matters.
    if (payload.type === "capture_health" && queue.length > 0 && queue[queue.length - 1].payload.type === "capture_health") queue.pop();
    queue.push(makeEvent(payload));
    if (queue.length > MAX_QUEUE) queue.shift();
    if (payload.type !== "capture_health") log(`evento ${payload.type}${payload.hero ? ` hero=${payload.hero}` : ""}${payload.side ? ` side=${payload.side}` : ""}${payload.position ? ` pos=${payload.position}` : ""}`);
  }
  void pump();
}

function localRequest(event) {
  return {
    url: `${transport.config.engineUrl}/ingest/draft-event`,
    headers: { "content-type": "application/json", "x-capture-token": transport.config.captureToken },
    body: JSON.stringify(event),
    count: 1,
  };
}

function cloudRequest() {
  const events = queue.slice(0, MAX_BATCH_EVENTS);
  return {
    url: batchUrl(transport.credential),
    headers: { "content-type": "application/json", "x-capture-credential": transport.credential.token },
    body: JSON.stringify(buildBatch(events, capturePresence(state))),
    count: events.length,
  };
}

function onCredentialRefused() {
  log("el sitio rechazó la credencial de captura (vencida, revocada o reemplazada): hay que emparejar de nuevo desde /live-draft");
  clearCredential();
  transport = null;
  openPairWindow();
}

async function pump() {
  if (sending || !transport) return;
  sending = true;
  let backoffMs = 1_000;
  while (queue.length > 0 && transport) {
    const request = transport.kind === "cloud" ? cloudRequest() : localRequest(queue[0]);
    try {
      const response = await fetch(request.url, { method: "POST", headers: request.headers, body: request.body });
      if (response.status === 429 || response.status >= 500) throw new Error(`site ${response.status}`);
      if (response.status === 401) {
        if (transport.kind === "cloud") onCredentialRefused();
        else log("el motor rechazó el token de captura: reiniciá `bun run dev:live` y recargá la extensión");
        // Facts stay queued after a refused credential: a fresh pairing delivers them (the engine dedupes).
        if (!transport) break;
      }
      queue.splice(0, request.count); // 2xx or a definitive 4xx: retrying the same batch would not change the answer.
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

/** Always listening, paired or not: a draft already in progress is caught up the moment the pairing completes. */
function startListening() {
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
}

/**
 * Called by the pairing window (pair.js) through `overwolf.windows.getMainWindow()`. Exchanges the one-time code
 * for the scoped credential and starts delivering for it. Returns a short, Player-readable result -- never the
 * credential, the code or any server text.
 */
async function pairWithCode(siteInput, codeInput) {
  const siteUrl = parseSiteUrl(siteInput);
  if (siteUrl === null) return { ok: false, message: "La dirección del sitio debe empezar con https://" };
  const code = parsePairingCode(codeInput);
  if (code === null) return { ok: false, message: "El código tiene 8 letras y números (por ejemplo ABCD-2345)." };
  try {
    const response = await fetch(pairUrl(siteUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    if (response.status === 401) return { ok: false, message: "Código inválido, vencido o ya usado. Generá uno nuevo en /live-draft." };
    if (response.status === 429) return { ok: false, message: "Demasiados intentos. Esperá un minuto y probá de nuevo." };
    if (!response.ok) return { ok: false, message: "El sitio no pudo emparejar ahora. Probá de nuevo en unos segundos." };
    const credential = parseCredentialResponse(await response.json(), siteUrl);
    if (credential === null) return { ok: false, message: "El sitio respondió algo inesperado. No se emparejó." };
    localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(credential));
    localStorage.setItem(SITE_KEY, siteUrl);
    transport = { kind: "cloud", credential };
    log("emparejado con el sitio: la captura automática está activa");
    await loadHeroCatalog();
    enqueue([healthPayload(state)]);
    return { ok: true, message: "Emparejado. Volvé a /live-draft: dice «Captura automática lista»." };
  } catch {
    return { ok: false, message: "No se pudo contactar al sitio. Revisá la dirección y tu conexión." };
  }
}

/** The site the Player used last time (the pairing window pre-fills it). */
function lastSite() {
  try {
    return localStorage.getItem(SITE_KEY) ?? "";
  } catch {
    return "";
  }
}

async function main() {
  const credential = readStoredCredential();
  if (credential) {
    transport = { kind: "cloud", credential };
    log("credencial de captura encontrada: captura automática activa");
  } else {
    const config = await loadLocalConfig();
    if (config) {
      transport = { kind: "local", config };
      makeEvent = createEnvelopeFactory({ sessionId: config.sessionId, runId: Math.random().toString(36).slice(2, 10), now: Date.now });
      log(`captura local lista para la sesión ${config.sessionId}`);
    }
  }
  if (!transport) {
    log("sin emparejar: abriendo la ventana de emparejamiento");
    openPairWindow();
  }
  await loadHeroCatalog();
  startListening();
}

// Launching the app by hand (Overwolf dock / "Load unpacked") always shows the pairing window, so a Player can
// re-pair after a credential expires. A launch triggered by Dota starting stays minimized (manifest launch_events).
overwolf.extensions.onAppLaunchTriggered.addListener((event) => {
  if (event?.origin !== "gamelaunchevent") openPairWindow();
});

window.pairWithCode = pairWithCode;
window.lastSite = lastSite;
void main();

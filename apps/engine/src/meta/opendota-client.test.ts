import { expect, test } from "bun:test";
import { OpenDotaClient, OpenDotaRequestError } from "./opendota-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

test("getHeroes reintenta tras 429 y devuelve el resultado cuando OpenDota responde 200", async () => {
  const calls: string[] = [];
  const sleeps: number[] = [];
  let attempt = 0;

  const fetchImpl = (async (url: string) => {
    calls.push(url);
    attempt++;
    if (attempt < 3) return jsonResponse({}, 429);
    return jsonResponse([{ id: 1 }]);
  }) as typeof fetch;

  const client = new OpenDotaClient({
    fetchImpl,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });

  const result = await client.getHeroes();

  expect(result).toEqual([{ id: 1 }]);
  expect(calls).toHaveLength(3);
  expect(sleeps).toEqual([1000, 4000]);
});

test("getHeroes agota los 3 reintentos y lanza OpenDotaRequestError si OpenDota sigue en 429", async () => {
  const fetchImpl = (async () => jsonResponse({}, 429)) as unknown as typeof fetch;
  const sleeps: number[] = [];

  const client = new OpenDotaClient({
    fetchImpl,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });

  await expect(client.getHeroes()).rejects.toThrow(OpenDotaRequestError);
  expect(sleeps).toEqual([1000, 4000, 16000]);
});

test("getMatchups reintenta ante una falla de red (OpenDota caído) y se recupera", async () => {
  let attempt = 0;
  const fetchImpl = (async () => {
    attempt++;
    if (attempt === 1) throw new Error("network down");
    return jsonResponse([{ hero_id: 2, games_played: 10, wins: 5 }]);
  }) as unknown as typeof fetch;

  const client = new OpenDotaClient({ fetchImpl, sleepImpl: async () => {} });

  const result = await client.getMatchups(1);

  expect(result).toEqual([{ hero_id: 2, games_played: 10, wins: 5 }]);
});

test("getHeroStats lanza de inmediato ante un error que no es 429 (ej. 500), sin reintentar", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return jsonResponse({}, 500);
  }) as typeof fetch;

  const client = new OpenDotaClient({ fetchImpl, sleepImpl: async () => {} });

  await expect(client.getHeroStats()).rejects.toThrow(OpenDotaRequestError);
  expect(calls).toHaveLength(1);
});

// TSK-018 (fase 1b): mismo patrón de clase que los tres métodos de arriba -- getJson/
// fetchWithRetry ya cubiertos, esta prueba solo confirma la URL construida y el default de días.
test("getPlayerHeroes construye la URL con el account_id y la ventana de días por defecto (90)", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return jsonResponse([{ hero_id: 1, games: 5, win: 2 }]);
  }) as typeof fetch;

  const client = new OpenDotaClient({ fetchImpl, sleepImpl: async () => {} });
  const result = await client.getPlayerHeroes("123456789");

  expect(calls).toEqual(["https://api.opendota.com/api/players/123456789/heroes?date=90"]);
  expect(result).toEqual([{ hero_id: 1, games: 5, win: 2 }]);
});

test("getPlayerHeroes respeta un days explícito distinto del default", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return jsonResponse([]);
  }) as typeof fetch;

  const client = new OpenDotaClient({ fetchImpl, sleepImpl: async () => {} });
  await client.getPlayerHeroes("1", { days: 30 });

  expect(calls).toEqual(["https://api.opendota.com/api/players/1/heroes?date=30"]);
});

// scripts/fetch-pro-drafts.ts (Fase 5): getJson/fetchWithRetry ya cubiertos arriba -- estas 3
// pruebas solo confirman la URL construida por cada método nuevo, mismo criterio que
// getPlayerHeroes. El candado real (429 → reintento) es el que faltaba antes de agregar estos
// métodos: el script tenía su propio fetch sin reintento y un 429 real lo tumbó en producción.

test("getProMatches sin cursor pide la primera página, sin query string", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return jsonResponse([{ match_id: 1 }]);
  }) as typeof fetch;

  const client = new OpenDotaClient({ fetchImpl, sleepImpl: async () => {} });
  const result = await client.getProMatches();

  expect(calls).toEqual(["https://api.opendota.com/api/proMatches"]);
  expect(result).toEqual([{ match_id: 1 }]);
});

test("getProMatches con cursor arma less_than_match_id para paginar hacia atrás", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return jsonResponse([]);
  }) as typeof fetch;

  const client = new OpenDotaClient({ fetchImpl, sleepImpl: async () => {} });
  await client.getProMatches(8960577698);

  expect(calls).toEqual(["https://api.opendota.com/api/proMatches?less_than_match_id=8960577698"]);
});

test("getMatchDetail pide el detalle completo de un match_id puntual", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return jsonResponse({ patch: 60, radiant_win: true });
  }) as typeof fetch;

  const client = new OpenDotaClient({ fetchImpl, sleepImpl: async () => {} });
  const result = await client.getMatchDetail(8960577698);

  expect(calls).toEqual(["https://api.opendota.com/api/matches/8960577698"]);
  expect(result).toEqual({ patch: 60, radiant_win: true });
});

test("getPatchConstants pide constants/patch sin parámetros", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return jsonResponse([{ id: 60, name: "7.41", date: "2026-03-24T00:50:59.580Z" }]);
  }) as typeof fetch;

  const client = new OpenDotaClient({ fetchImpl, sleepImpl: async () => {} });
  const result = await client.getPatchConstants();

  expect(calls).toEqual(["https://api.opendota.com/api/constants/patch"]);
  expect(result).toEqual([{ id: 60, name: "7.41", date: "2026-03-24T00:50:59.580Z" }]);
});

// scripts/fetch-daily-pro-drafts.ts: mismo criterio que getPatchConstants -- solo confirma la URL,
// getJson/fetchWithRetry ya cubiertos arriba.
test("getLeagues pide /leagues sin parámetros", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return jsonResponse([{ leagueid: 226, tier: "professional", name: "CIS Dota 2 League" }]);
  }) as typeof fetch;

  const client = new OpenDotaClient({ fetchImpl, sleepImpl: async () => {} });
  const result = await client.getLeagues();

  expect(calls).toEqual(["https://api.opendota.com/api/leagues"]);
  expect(result).toEqual([{ leagueid: 226, tier: "professional", name: "CIS Dota 2 League" }]);
});

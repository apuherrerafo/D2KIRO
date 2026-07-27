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

import { expect, test } from "bun:test";
import { OpenDotaClient, OpenDotaRequestError, parseRateLimitHeaders } from "./opendota-client";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

test("429 con Retry-After espera la señal del servidor y luego devuelve el resultado", async () => {
  const calls: string[] = [];
  const sleeps: number[] = [];
  let attempt = 0;

  const fetchImpl = (async (url: string) => {
    calls.push(url);
    attempt++;
    if (attempt === 1) return jsonResponse({}, 429, { "Retry-After": "30" });
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
  expect(calls).toHaveLength(2);
  expect(sleeps).toEqual([30_000]);
});

test("429 sin Retry-After usa una espera conservadora de una ventana completa", async () => {
  const sleeps: number[] = [];
  let attempt = 0;
  const client = new OpenDotaClient({
    fetchImpl: (async () => {
      attempt++;
      return attempt === 1 ? jsonResponse({}, 429) : jsonResponse([{ id: 1 }]);
    }) as unknown as typeof fetch,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });

  await expect(client.getHeroes()).resolves.toEqual([{ id: 1 }]);
  expect(sleeps).toEqual([60_000]);
});

test("Retry-After malformado usa el fallback conservador", async () => {
  const sleeps: number[] = [];
  let attempt = 0;
  const client = new OpenDotaClient({
    fetchImpl: (async () => {
      attempt++;
      return attempt === 1
        ? jsonResponse({}, 429, { "Retry-After": "not-a-delay" })
        : jsonResponse([{ id: 1 }]);
    }) as unknown as typeof fetch,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });

  await client.getHeroes();
  expect(sleeps).toEqual([60_000]);
});

test("una respuesta 200 no introduce una espera de rate limit", async () => {
  const sleeps: number[] = [];
  const client = new OpenDotaClient({
    fetchImpl: (async () => jsonResponse([{ id: 1 }], 200, {
      "X-Rate-Limit-Remaining-Minute": "39",
      "X-Rate-Limit-Remaining-Day": "2999",
    })) as unknown as typeof fetch,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });

  await expect(client.getHeroes()).resolves.toEqual([{ id: 1 }]);
  expect(sleeps).toEqual([]);
});

test("parsea de forma segura Retry-After, reset y cuotas restantes", () => {
  const nowMs = Date.UTC(2026, 8, 8, 12, 0, 0);
  const parsed = parseRateLimitHeaders(
    new Headers({
      "Retry-After": "15",
      "X-Rate-Limit-Reset": String(nowMs / 1000 + 45),
      "X-Rate-Limit-Remaining-Minute": "0",
      "X-Rate-Limit-Remaining-Day": "2980",
    }),
    nowMs,
  );

  expect(parsed).toEqual({
    retryAfterMs: 15_000,
    resetAfterMs: 45_000,
    remainingMinute: 0,
    remainingDay: 2980,
  });
  expect(parseRateLimitHeaders(new Headers({
    "Retry-After": "bogus",
    "X-Rate-Limit-Reset": "also-bogus",
    "X-Rate-Limit-Remaining-Minute": "-1",
    "X-Rate-Limit-Remaining-Day": "NaN",
  }), nowMs)).toEqual({});
  expect(parseRateLimitHeaders(new Headers({ "Retry-After": "0" }), nowMs)).toEqual({});
  expect(parseRateLimitHeaders(
    new Headers({ "Retry-After": new Date(nowMs + 30_000).toUTCString() }),
    nowMs,
  )).toEqual({ retryAfterMs: 30_000 });
  expect(parseRateLimitHeaders(
    new Headers({ "X-Rate-Limit-Reset-After": "25" }),
    nowMs,
  )).toEqual({ resetAfterMs: 25_000 });
});

test("429 usa reset futuro cuando Retry-After no está disponible", async () => {
  const sleeps: number[] = [];
  let attempt = 0;
  const nowMs = Date.UTC(2026, 8, 8, 12, 0, 0);
  const client = new OpenDotaClient({
    fetchImpl: (async () => {
      attempt++;
      return attempt === 1
        ? jsonResponse({}, 429, { "X-Rate-Limit-Reset": String(nowMs / 1000 + 40) })
        : jsonResponse([{ id: 1 }]);
    }) as unknown as typeof fetch,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
    nowImpl: () => nowMs,
  });

  await client.getHeroes();
  expect(sleeps).toEqual([40_000]);
});

test("cada petición a OpenDota lleva un timeout para que una sincronización no quede running", async () => {
  let signal: AbortSignal | undefined;
  const client = new OpenDotaClient({
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return jsonResponse([]);
    }) as typeof fetch,
  });

  await client.getHeroes();
  expect(signal).toBeInstanceOf(AbortSignal);
});

test("getHeroes agota los 3 reintentos ante 429 repetidos, sin dormir tras el intento final", async () => {
  const sleeps: number[] = [];
  let attempts = 0;

  const client = new OpenDotaClient({
    fetchImpl: (async () => {
      attempts++;
      return jsonResponse({}, 429);
    }) as unknown as typeof fetch,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });

  await expect(client.getHeroes()).rejects.toThrow(OpenDotaRequestError);
  expect(attempts).toBe(4);
  expect(sleeps).toEqual([60_000, 60_000, 60_000]);
});

test("getMatchups reintenta ante una falla de red (OpenDota caído) y se recupera", async () => {
  let attempt = 0;
  const sleeps: number[] = [];
  const fetchImpl = (async () => {
    attempt++;
    if (attempt === 1) throw new Error("network down");
    return jsonResponse([{ hero_id: 2, games_played: 10, wins: 5 }]);
  }) as unknown as typeof fetch;

  const client = new OpenDotaClient({
    fetchImpl,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });

  const result = await client.getMatchups(1);

  expect(result).toEqual([{ hero_id: 2, games_played: 10, wins: 5 }]);
  expect(sleeps).toEqual([1000]);
});

test("timeout seguido de 429 conserva backoff de red y luego respeta el fallback de cuota", async () => {
  const sleeps: number[] = [];
  let attempt = 0;
  const client = new OpenDotaClient({
    fetchImpl: (async () => {
      attempt++;
      if (attempt === 1) throw new DOMException("timed out", "TimeoutError");
      if (attempt === 2) return jsonResponse({}, 429);
      return jsonResponse([{ id: 1 }]);
    }) as unknown as typeof fetch,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });

  await expect(client.getHeroes()).resolves.toEqual([{ id: 1 }]);
  expect(sleeps).toEqual([1000, 60_000]);
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

test("getExplorer codifica la consulta SQL como parámetro", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return jsonResponse({ rows: [{ hero_id: 1, vs_hero_id: 2, games: 300, wins: 160 }] });
  }) as typeof fetch;

  const client = new OpenDotaClient({ fetchImpl, sleepImpl: async () => {} });
  const result = await client.getExplorer("SELECT 1 WHERE games >= 200");

  expect(new URL(calls[0]!).pathname).toBe("/api/explorer");
  expect(new URL(calls[0]!).searchParams.get("sql")).toBe("SELECT 1 WHERE games >= 200");
  expect(result).toEqual({ rows: [{ hero_id: 1, vs_hero_id: 2, games: 300, wins: 160 }] });
});

test("429 aplica el límite operativo a Retry-After, fechas y reset headers", async () => {
  const nowMs = Date.UTC(2026, 8, 8, 12, 0, 0);
  const cases: Array<[string, HeadersInit, number]> = [
    ["Retry-After 30", { "Retry-After": "30" }, 30_000],
    ["Retry-After 120", { "Retry-After": "120" }, 120_000],
    ["Retry-After oversized", { "Retry-After": "121" }, 60_000],
    ["Retry-After timer ceiling", { "Retry-After": "2147483" }, 60_000],
    ["Retry-After huge", { "Retry-After": "999999999" }, 60_000],
    ["Retry-After zero", { "Retry-After": "0" }, 60_000],
    ["Retry-After negative", { "Retry-After": "-1" }, 60_000],
    ["Retry-After malformed", { "Retry-After": "NaN" }, 60_000],
    ["Retry-After decimal", { "Retry-After": "120.001" }, 60_000],
    ["Retry-After HTTP-date", { "Retry-After": new Date(nowMs + 30_000).toUTCString() }, 30_000],
    ["Retry-After expired HTTP-date", { "Retry-After": new Date(nowMs - 1_000).toUTCString() }, 60_000],
    ["Retry-After oversized HTTP-date", { "Retry-After": new Date(nowMs + 300_000).toUTCString() }, 60_000],
    ["reset-after 30", { "X-Rate-Limit-Reset-After": "30" }, 30_000],
    ["reset-after 120", { "X-Rate-Limit-Reset-After": "120" }, 120_000],
    ["reset-after oversized", { "X-Rate-Limit-Reset-After": "121" }, 60_000],
    ["reset-after malformed", { "X-Rate-Limit-Reset-After": "1e2" }, 60_000],
    ["reset epoch 30", { "X-Rate-Limit-Reset": String(nowMs / 1000 + 30) }, 30_000],
    ["reset epoch 120", { "X-Rate-Limit-Reset": String(nowMs / 1000 + 120) }, 120_000],
    ["reset epoch oversized", { "X-Rate-Limit-Reset": String(nowMs / 1000 + 121) }, 60_000],
    ["reset epoch past", { "X-Rate-Limit-Reset": String(nowMs / 1000 - 1) }, 60_000],
    ["reset epoch milliseconds", { "X-Rate-Limit-Reset": String(nowMs) }, 60_000],
    ["malformed Retry-After defers to reset-after", { "Retry-After": "garbage", "X-Rate-Limit-Reset-After": "30" }, 30_000],
    ["valid Retry-After wins over reset-after", { "Retry-After": "30", "X-Rate-Limit-Reset-After": "120" }, 30_000],
  ];

  for (const [name, headers, expectedDelay] of cases) {
    const sleeps: number[] = [];
    let attempt = 0;
    const client = new OpenDotaClient({
      fetchImpl: (async () => {
        attempt++;
        return attempt === 1 ? jsonResponse({}, 429, headers) : jsonResponse([{ id: 1 }]);
      }) as unknown as typeof fetch,
      sleepImpl: async (ms) => { sleeps.push(ms); },
      nowImpl: () => nowMs,
    });

    await expect(client.getHeroes(), name).resolves.toEqual([{ id: 1 }]);
    expect(sleeps, name).toEqual([expectedDelay]);
  }
});
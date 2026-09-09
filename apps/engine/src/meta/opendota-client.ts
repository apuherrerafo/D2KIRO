const BASE_URL = "https://api.opendota.com/api";
const NETWORK_RETRY_DELAYS_MS = [1000, 4000, 16000];
const RATE_LIMIT_FALLBACK_WAIT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RATE_LIMIT_WAIT_MS = 120_000;

type FetchImpl = typeof fetch;
type Clock = () => number;

export interface OpenDotaClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: Clock;
}

export interface OpenDotaRateLimitMetadata {
  retryAfterMs?: number;
  resetAfterMs?: number;
  remainingMinute?: number;
  remainingDay?: number;
}

function parseNonNegativeInteger(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function secondsToTimerDelay(seconds: number): number | undefined {
  const milliseconds = seconds * 1000;
  return milliseconds > 0 && milliseconds <= MAX_RATE_LIMIT_WAIT_MS ? milliseconds : undefined;
}

function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (value === null) return undefined;
  const seconds = parseNonNegativeInteger(value);
  if (seconds !== undefined) return secondsToTimerDelay(seconds);

  const retryAtMs = Date.parse(value);
  if (!Number.isFinite(retryAtMs)) return undefined;
  const delayMs = Math.ceil(retryAtMs - nowMs);
  return delayMs > 0 && delayMs <= MAX_RATE_LIMIT_WAIT_MS ? delayMs : undefined;
}

function parseResetAfter(headers: Headers, nowMs: number): number | undefined {
  const resetAfterSeconds = parseNonNegativeInteger(headers.get("x-rate-limit-reset-after"));
  if (resetAfterSeconds !== undefined) return secondsToTimerDelay(resetAfterSeconds);

  // X-Rate-Limit-Reset es inequívoco sólo cuando representa un epoch Unix futuro.
  const resetEpochSeconds = parseNonNegativeInteger(headers.get("x-rate-limit-reset"));
  if (resetEpochSeconds === undefined) return undefined;
  const delayMs = Math.ceil(resetEpochSeconds * 1000 - nowMs);
  return delayMs > 0 && delayMs <= MAX_RATE_LIMIT_WAIT_MS ? delayMs : undefined;
}

export function parseRateLimitHeaders(headers: Headers, nowMs = Date.now()): OpenDotaRateLimitMetadata {
  const metadata: OpenDotaRateLimitMetadata = {};
  const retryAfterMs = parseRetryAfter(headers.get("retry-after"), nowMs);
  const resetAfterMs = parseResetAfter(headers, nowMs);
  const remainingMinute = parseNonNegativeInteger(headers.get("x-rate-limit-remaining-minute"));
  const remainingDay = parseNonNegativeInteger(headers.get("x-rate-limit-remaining-day"));

  if (retryAfterMs !== undefined) metadata.retryAfterMs = retryAfterMs;
  if (resetAfterMs !== undefined) metadata.resetAfterMs = resetAfterMs;
  if (remainingMinute !== undefined) metadata.remainingMinute = remainingMinute;
  if (remainingDay !== undefined) metadata.remainingDay = remainingDay;
  return metadata;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenDotaRequestError extends Error {
  readonly url: string;
  readonly status?: number;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = "OpenDotaRequestError";
    this.url = url;
    this.status = status;
  }
}

export class OpenDotaClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchImpl;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly nowImpl: Clock;

  constructor(options: OpenDotaClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
    this.nowImpl = options.nowImpl ?? Date.now;
  }

  getHeroes(): Promise<unknown> {
    return this.getJson("/heroes");
  }

  getMatchups(heroId: number): Promise<unknown> {
    return this.getJson(`/heroes/${heroId}/matchups`);
  }

  getHeroStats(): Promise<unknown> {
    return this.getJson("/heroStats");
  }

  // TSK-018 (fase 1b): mismo patrón que los tres métodos de arriba -- devuelve `unknown` a
  // propósito, la validación vive en el borde (validation.ts), nunca aquí. `accountId` debe llegar
  // ya validado (isValidSteamAccountId) por el llamador -- esta función no lo valida ni lo loguea.
  getPlayerHeroes(accountId: string, options?: { days?: number }): Promise<unknown> {
    const days = options?.days ?? 90;
    return this.getJson(`/players/${accountId}/heroes?date=${days}`);
  }

  // scripts/fetch-pro-drafts.ts (ingesta manual del corpus del KNN, Fase 5): mismos 3 métodos,
  // mismo patrón -- reutilizan getJson/fetchWithRetry en vez de que el script reimplemente su
  // propio fetch sin reintento (el bug real que motivó agregar estos métodos acá: un 429 de
  // OpenDota tumbaba el script entero en vez de reintentar con espera creciente).
  getProMatches(lessThanMatchId?: number): Promise<unknown> {
    const query = lessThanMatchId ? `?less_than_match_id=${lessThanMatchId}` : "";
    return this.getJson(`/proMatches${query}`);
  }

  getMatchDetail(matchId: number): Promise<unknown> {
    return this.getJson(`/matches/${matchId}`);
  }

  getPatchConstants(): Promise<unknown> {
    return this.getJson("/constants/patch");
  }

  // scripts/fetch-daily-pro-drafts.ts (ingesta incremental por torneo): lista completa de
  // ligas/torneos con su `tier` real -- fuente para distinguir Tier 1 (`"premium"`) de Tier 2
  // (`"professional"`), verificado contra la API real antes de escribir el script (10108 ligas,
  // tiers reales: `professional`/`excluded`/`premium`/`amateur`/`null`, sin campo de fecha).
  getLeagues(): Promise<unknown> {
    return this.getJson("/leagues");
  }

  // Explorador SQL para scripts offline de agregación. La consulta se codifica como parámetro
  // mediante URLSearchParams; nunca se construye una URL concatenando datos de usuarios.
  getExplorer(sql: string): Promise<unknown> {
    return this.getJson(`/explorer?${new URLSearchParams({ sql }).toString()}`);
  }

  private async getJson(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const response = await this.fetchWithRetry(url);
    if (!response.ok) {
      throw new OpenDotaRequestError(`OpenDota respondió ${response.status} en ${path}`, url, response.status);
    }
    return response.json();
  }

  // Máximo 3 reintentos además del original. Errores de red conservan 1s/4s/16s;
  // un 429 usa Retry-After, luego reset inequívoco y, si faltan, una ventana de 60s.
  private async fetchWithRetry(url: string): Promise<Response> {
    let lastError: unknown;
    let response: Response | null = null;

    for (let attempt = 0; attempt <= NETWORK_RETRY_DELAYS_MS.length; attempt++) {
      try {
        response = await this.fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        lastError = undefined;
      } catch (error) {
        lastError = error;
        response = null;
      }

      const rateLimit = response === null ? undefined : parseRateLimitHeaders(response.headers, this.nowImpl());
      if (response !== null && response.status !== 429) return response;

      const isLastAttempt = attempt === NETWORK_RETRY_DELAYS_MS.length;
      if (isLastAttempt) break;

      const delayMs = response?.status === 429
        ? rateLimit?.retryAfterMs ?? rateLimit?.resetAfterMs ?? RATE_LIMIT_FALLBACK_WAIT_MS
        : NETWORK_RETRY_DELAYS_MS[attempt]!;
      await this.sleepImpl(delayMs);
    }

    if (response) return response;
    throw new OpenDotaRequestError(
      `OpenDota no respondió tras ${NETWORK_RETRY_DELAYS_MS.length} reintentos en ${url}: ${String(lastError)}`,
      url,
    );
  }
}

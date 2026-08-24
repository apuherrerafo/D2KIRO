const BASE_URL = "https://api.opendota.com/api";
const RETRY_DELAYS_MS = [1000, 4000, 16000];

type FetchImpl = typeof fetch;

export interface OpenDotaClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  sleepImpl?: (ms: number) => Promise<void>;
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

  constructor(options: OpenDotaClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
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

  private async getJson(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const response = await this.fetchWithRetry(url);
    if (!response.ok) {
      throw new OpenDotaRequestError(`OpenDota respondió ${response.status} en ${path}`, url, response.status);
    }
    return response.json();
  }

  // Reintento con espera creciente (1s, 4s, 16s), máximo 3 reintentos además del intento
  // original — tanto un 429 como una excepción de red (caída/sin internet) cuentan igual.
  private async fetchWithRetry(url: string): Promise<Response> {
    let lastError: unknown;
    let response: Response | null = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        response = await this.fetchImpl(url);
        lastError = undefined;
      } catch (error) {
        lastError = error;
        response = null;
      }

      if (response !== null && response.status !== 429) return response;

      const isLastAttempt = attempt === RETRY_DELAYS_MS.length;
      if (isLastAttempt) break;

      await this.sleepImpl(RETRY_DELAYS_MS[attempt]!);
    }

    if (response) return response;
    throw new OpenDotaRequestError(
      `OpenDota no respondió tras ${RETRY_DELAYS_MS.length} reintentos en ${url}: ${String(lastError)}`,
      url,
    );
  }
}

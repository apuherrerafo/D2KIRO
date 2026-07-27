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

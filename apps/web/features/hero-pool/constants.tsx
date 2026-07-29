// "Hasta 5" es un techo, no un piso (SPEC.md §9.4) -- se aplica tanto a la edición manual como a
// lo que devuelve "calcular desde mis partidas".
export const MAX_POOL_SIZE = 5;

export const EMPTY_POOL_MESSAGE =
  "Aún no configuraste tu pool de héroes. Añadí hasta 5 a mano, o ingresá tu cuenta de Steam y calculá los tuyos desde tus partidas recientes.";

export const POOL_FULL_MESSAGE = "Ya tenés 5 héroes en tu pool -- quitá uno para poder añadir otro.";

// TSK-029: constante compartida en vez de repetir el literal en cada `setSaveMessage(...)` y en
// la comparación que decide mostrar el link a /draft -- un typo en una sola copia rompería ese
// link en silencio.
export const POOL_SAVED_MESSAGE = "Pool guardado.";

// TSK-030 (SPEC.md §9.7): misma clave literal que ya usa apps/engine/src/db/queries.test.ts vía
// /api/settings -- primer dato personal del proyecto, nunca se loguea ni se eco en un error.
export const STEAM_ACCOUNT_ID_KEY = "steam_account_id";

// TSK-033: mismo default que el servidor (server/app.ts) si no se manda `days` -- mantenerlos
// sincronizados a mano evita que "90 días" signifique algo distinto en cada lado.
export const DEFAULT_CALCULATE_WINDOW_DAYS = 90;
export const CALCULATE_WINDOW_OPTIONS = [30, 60, 90, 180, 365] as const;

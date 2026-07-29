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

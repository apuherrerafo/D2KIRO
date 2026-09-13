## REGLAS DE FASE 5 (Auth & Personal Hero Pool multi-usuario) — desde `docs/specs/SPEC.md` §12
Generadas por `/rulebook`, quinta ejecución del proyecto. Alcance: login real con Steam (OpenID
2.0), esquema multi-cuenta, y personalización de `hero_pool_fit` por usuario real — no solo el
propio desarrollador. Detalle completo de `security.md`/`web.md`/`testing-seams.md` sigue en
`.claude/rules/` (secciones "Fase 5"); el de `engine.md` se movió íntegro a este mismo archivo
(R0.4 Task 24, ver más abajo) — esta sección son los puntos que no se pueden violar sin romper el
contrato, resumidos:

- **`apps/engine` sigue en `127.0.0.1`, sin excepción.** El callback de Steam OpenID necesita una
  URL pública — solo puede terminar en `apps/web`. `apps/engine` nunca ve el login directamente,
  solo el `accountId` ya verificado vía `x-account-token`.
- **`check_authentication` de Steam es obligatorio, no opcional.** Sin esa verificación server-a-
  servidor, cualquiera puede fabricar un "login exitoso" con el `steamid64` que quiera — es la
  vulnerabilidad real y documentada de `passport-steam`, la librería más popular para esto. Por eso
  el protocolo se implementa a mano, sin Passport.
- **La conversión SteamID64 → Steam32 exige `BigInt`, nunca aritmética `Number`.** El offset
  (`76561197960265728`) excede `Number.MAX_SAFE_INTEGER` — con `Number()` la resta pierde precisión
  y mapea al usuario a la cuenta de otra persona, **sin ningún error**. Prueba dedicada obligatoria.
- **`buildMetaSnapshot(db, accountId)` — `accountId` es obligatorio, nunca opcional con default.**
  Evita el mismo tipo de bug silencioso que dejó `hero_pool_fit` inerte desde Fase 1b hasta TSK-064.
- **El cache de meta está partido en dos capas** (compartida + overlay por cuenta), nunca un
  `Map<accountId, MetaSnapshot>` de snapshots completos — medido contra la base real: lo que varía
  por cuenta son 5 filas y un número, no las 17 000 filas de meta pública.
- **`accountId` nunca se acepta desde el cuerpo o el query de una request** — sale exclusivamente
  del token verificado (`x-account-token` en HTTP, `accountToken` en el `hello` de WebSocket).
- **`PRAGMA foreign_keys` sigue apagado** — el aislamiento entre cuentas lo da el `WHERE
  account_id = ?` de cada query, nunca la constraint de la FK.
- **`hero_pool` pasa a PK compuesta `(accountId, heroId)`; `team_groups` gana `accountId` nullable
  (sin cirugía de PK); `team_members` hereda el scope vía `teamGroupId`, sin columna propia.**
- **Basic Auth (`proxy.ts`) se retira por completo** — el login de Steam es el único gate de acceso
  al sitio. Nunca conviven los dos mecanismos.
- **Ningún `accountId`/Steam32 se loguea, se ecoa en un error, ni aparece en `journal.md`/tickets**
  — regla de 1b, ahora vale para todas las cuentas, no solo la del desarrollador.
- **Fase 5 no expone el WebSocket del motor a la red** — decisión explícita de alcance, no una
  laguna. Un usuario remoto tiene cuenta y pool guardado, pero las sugerencias en vivo siguen
  dependiendo del motor local del propio visitante.
- **Dos secretos nuevos, ambos `process.env`**: `SESSION_SECRET` (`iron-session`) e
  `INTERNAL_AUTH_SECRET` (HMAC del token interno). Steam OpenID no exige credencial del sitio.
- **`iron-session` es la única dependencia de producción nueva** — pasa por `/gear-up`/`@depcheck`.


---

## Detalle histórico completo (movido desde `.claude/rules/engine.md` — R0.4 Task 24)

## Fase 5 — Auth & Personal Hero Pool multi-usuario — SPEC.md §12

- **`PRAGMA foreign_keys` sigue apagado.** Las FK de `accounts`/`hero_pool`/`team_groups` son
  documentación del modelo, no una defensa en runtime — el aislamiento real entre cuentas lo da
  exclusivamente el `WHERE account_id = ?` de cada query. Nunca asumir que la constraint impide
  nada.
- **`hero_pool` pasa a PK compuesta `(accountId, heroId)`** vía migración `0006` (tabla-nueva/
  copiar/drop/rename — SQLite no soporta `ALTER TABLE` para cambiar una PK). `team_groups` gana
  `accountId` como columna **nullable** (migración `0007`) — no necesita cirugía de PK porque ya
  tiene `id` autoincremental propio; `team_members` no gana columna propia, hereda el scope vía su
  `teamGroupId` existente.
- **`buildMetaSnapshot(db, accountId)` — `accountId: AccountId | null` es obligatorio, nunca
  opcional con default.** Un parámetro opcional con default `null` dejaría que cualquier llamador
  nuevo que se olvide de pasarlo obtenga silenciosamente "sin pool" — el mismo tipo de bug invisible
  que ya costó una fase entera (`hero_pool_fit` inerte desde 1b hasta TSK-064). Que rompa la
  compilación es la funcionalidad, no un defecto a suavizar.
- **El cache de `MetaSnapshot` está partido en dos capas, nunca un solo `Map<accountId,
  MetaSnapshot>`.** Capa compartida (`sharedSnapshot`: `heroes`/`hero_matchups`/`hero_patch_stats`,
  idéntica para todas las cuentas) + capa por cuenta (`accountOverlays: Map<AccountId,
  AccountMetaOverlay>`: solo `hero_pool`/`personal_baseline_winrate`). Invalidación separada por
  responsabilidad: fin de `runMetaSync` invalida solo la capa compartida (nunca los overlays — una
  sync de meta no cambia el pool de nadie); `PUT /api/hero-pool` de la cuenta X invalida solo
  `accountOverlays.delete(X)` (nunca el mapa entero — ninguna otra sesión activa paga un recálculo
  ajeno).
- **`x-account-token` — contrato exacto**: `{accountId}.{issuedAtMs}.{nonce}.{firmaHMAC}`, HMAC-
  SHA256 sobre `"d2k-account-token/v1|" + payload` con `INTERNAL_AUTH_SECRET`. Verificación en
  **este orden exacto, sin saltarse ninguno**: forma → firma (comparación en tiempo constante) →
  ventana (60 s + 5 s de tolerancia de reloj) → rango del `accountId` (Steam32 válido) → nonce (un
  solo uso, store en memoria con evicción oportunista, mismo patrón que `SessionStore.evictStale`).
  El token se **acuña únicamente en `apps/web`** (`proxy.ts`/`GET /api/auth/engine-token`) —
  `apps/engine` solo verifica, nunca firma.
- **`accountId` nunca se acepta desde el cuerpo o el query string de una request.** Sale
  exclusivamente del token verificado (`x-account-token` en HTTP, `accountToken` en el `hello` de
  WebSocket). `POST /api/hero-pool/calculate` pierde el campo `accountId` de su contrato — el Steam32
  sale del token, el cuerpo queda en `{ days?: number }`.
- **`calculationInProgress` es `Set<AccountId>`, nunca un booleano por proceso.** Con varios
  usuarios, un booleano global le devolvería `409` a todos por el cálculo de uno solo.
- **`SessionStore` gana `ownerAccountId: AccountId | null` por sesión.** Lo fija el primer `hello`
  autenticado; un `hello` de otra cuenta sobre una sesión que ya tiene dueño se rechaza, nunca
  reasigna el dueño. `POST /ingest/draft-event` (capturador, `x-capture-token`) no fija dueño — no
  representa a una persona logueada.
- **Ninguna ruta de cuenta responde con el `accountId` en un mensaje de error.** Los 5 errores de
  token (`missing_account_token`, `invalid_account_token`, `expired_account_token`,
  `replayed_account_token`, `unknown_account`) nunca incluyen el valor — misma regla de 1b
  (`account_id` nunca se ecoa en un error), ahora vale para todas las cuentas, no solo la del
  desarrollador.
- **`apps/engine` sigue atado a `127.0.0.1`, sin excepción.** El callback de Steam OpenID necesita
  una URL pública — solo puede terminar en `apps/web`. `apps/engine` nunca ve el flujo de login
  directamente, solo recibe el `accountId` ya verificado vía el token.
- **Fase 5 no expone el WebSocket del motor a la red** — decisión explícita, no una laguna. Un
  usuario remoto logueado tiene cuenta y `hero_pool` guardado, pero las sugerencias en vivo siguen
  requiriendo el motor local del propio visitante, sin cambios respecto a hoy.


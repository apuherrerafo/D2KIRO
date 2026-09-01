## REGLAS DE FASE 5 (Auth & Personal Hero Pool multi-usuario) — desde `docs/specs/SPEC.md` §12
Generadas por `/rulebook`, quinta ejecución del proyecto. Alcance: login real con Steam (OpenID
2.0), esquema multi-cuenta, y personalización de `hero_pool_fit` por usuario real — no solo el
propio desarrollador. Detalle completo en `.claude/rules/` (secciones "Fase 5" en `engine.md`,
`security.md`, `web.md`, `testing-seams.md`) — esta sección son los puntos que no se pueden violar
sin romper el contrato, resumidos:

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


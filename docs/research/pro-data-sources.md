# Matriz de fuentes — datos profesionales Tier 1 (Fase 7)

> Documento de investigación (`docs/research/`), congelado como ancla de auditoría de Fase 7
> (`TSK-147`, `SPEC.md` §14.2, Gate 1 ticket 2). A diferencia de `pro-drafter-spec-v1.md`, este
> documento **no es especulativo**: cada afirmación con número lleva su marca de procedencia
> (**medido**, con fecha, o **documentado, sin verificar**) y ninguna fila omite la columna
> "campos que NO aporta" — es el criterio de aceptación duro del ticket. No decide arquitectura ni
> define tipos (eso es `TSK-148`); decide únicamente qué fuente aporta qué, con qué confianza.

## 1. Decisiones de fuente, cerradas

- **Todo el trabajo de Fase 7 usa exclusivamente OpenDota.** Cero secreto nuevo, cero dependencia
  nueva, cero scraping. Coherente con `security.md` (Fase 6 y anteriores).
- **STRATZ no entra.** Descartado dos veces por costo/beneficio (Fase 1b: `architecture.md`
  líneas 309-340; Fase 3: comparación de curación manual vs. API, 6-8h una vez + 12-18h/año de
  mantenimiento contra una GraphQL con límite gratuito y un secreto nuevo). Si algún día se
  prioriza, pasa por `/gear-up`/`@depcheck` y exige `STRATZ_API_KEY` (`process.env`, nunca en el
  repo).
- **Dota2ProTracker no se amplía.** Bloquea `WebFetch`/`curl` simple con `403` de Cloudflare
  (**medido**, ver §2.5) y no declara licencia de reuso. Sigue congelado como origen histórico de
  `hero-positions.json` (Fase 3), curado a mano vía navegador real, nunca automatizado.
- **Liquipedia queda fuera del camino base de esta fase.** Licencia CC-BY-SA 3.0: exige
  atribución **y** compartir-igual sobre el contenido derivado, lo que podría alcanzar al
  artefacto compilado (`pro-patterns.json`, `TSK-155`). Aportaría tier declarado por la escena,
  fechas reales de torneo y región — pero `league.tier` de OpenDota ya cubre la mayor parte de ese
  valor con licencia limpia. **Decisión 4 de `SPEC.md` §14.10: esta fila queda planteada, no
  resuelta — solo se activa con aprobación explícita del usuario, en un campo aparte y con
  atribución.**

## 2. Matriz de fuentes

### 2.1 OpenDota — `GET /api/matches/{id}`

La fuente base de toda la fase. **Medido** en vivo el 2026-08-27 contra una muestra de 14 partidas
profesionales recientes (`league.tier: "professional"`, patch 60 = "7.41") más 2 partidas
adicionales de una liga `premium` (The International 2026) — 16 partidas en total.

| Columna | Valor |
|---|---|
| **Campos que aporta** | `picks_bans[]` completo con `order` (0–23) e `is_pick`/`hero_id`/`team`; `players[].position_est` (1–5), `lane_role`, `is_roaming`, `net_worth`, `rank_tier`, `account_id`; `league.tier`, `leagueid`, `league.name`; `radiant_team_id`/`dire_team_id` + nombres; `patch` (id numérico), `start_time`, `game_mode`, `radiant_win`; `od_data.has_gcdata`/`has_parsed` |
| **Campos que NO aporta** | Región real del torneo (`region` viene `null` en partidas LAN — **medido**, TI 2026, 2/2). Tiempos por turno (`draft_timings` vino **vacío en 14/14** — **medido**). Tier competitivo declarado por la escena (solo expone `league.tier` de OpenDota, ver §2.2). Ránking/leaderboard de cuentas — `rank_tier` es por jugador y topa en 80 (Immortal), no hay "top N" derivable. |
| **API** | REST, `GET`, sin autenticación, sin API key |
| **Estabilidad** | Alta — endpoint ya en producción en este repo (`meta/opendota-client.ts`), sin cambios de contrato observados |
| **Límites** | ~60 req/min y ~2.000 llamadas/día sin key — **documentado, sin verificar** (cifra pública citada por la comunidad OpenDota, no medida por este proyecto). Filtra por User-Agent: un `GET` con `urllib` puro devolvió **403** (**medido**, 2026-08-27); `curl` y el `fetch` de Bun pasan sin problema. |
| **Coste** | 0 |
| **Licencia** | Datos derivados de la API pública de Dota 2 (Valve) vía OpenDota; el código cliente de OpenDota es MIT. **Verificar los términos vigentes antes de publicar cualquier dataset derivado de este endpoint** — no aplica al consumo interno de esta fase (fuera de alcance de `TSK-147`, ver el ticket) |
| **Riesgo de scraping** | Ninguno — es una API pública documentada, no scraping |
| **Cobertura de drafts** | Total para partidas de liga con `has_gcdata: true` — **medido**: 14/14 partidas de la muestra tenían `picks_bans` con 24 turnos completos |
| **Calidad de posiciones** | `position_est` es una **estimación** de OpenDota (derivada de `lane_role` + `is_roaming` + orden de `net_worth`), no verdad de campo — **medido**: dos jugadores del mismo equipo con idéntico `lane_role: 3` recibieron `position_est` 3 y 4, desempatados solo por `net_worth` (21.345 vs 12.418). Es el único dato de posición **profesional** disponible sin STRATZ; su confianza se mide en `TSK-153`, no aquí. |
| **Procesamiento offline** | Sí, 100% — un script manual (`TSK-150`) pagina y guarda, nunca se llama desde `apps/engine` |

### 2.2 OpenDota — `GET /api/proMatches` y `GET /api/leagues`

| Columna | Valor |
|---|---|
| **Campos que aporta** | `/proMatches`: `match_id`, `leagueid`, `league_name`, `start_time`, `radiant_team_id`/`dire_team_id` + nombres, `radiant_win`, `series_id`, paginación por cursor (`less_than_match_id`). `/leagues`: `leagueid`, `tier`, `name` para el catálogo completo de ligas |
| **Campos que NO aporta** | `/leagues` **no tiene ningún campo de fecha** — **medido**, 2026-08-27, sobre las 10.117 filas reales devueltas. No hay forma de ordenar torneos cronológicamente desde ese endpoint solo; la fecha de un torneo se **deriva** cruzando con el `start_time` de sus partidas en `/proMatches` (confianza `medium`, nunca "la fecha oficial"). Tampoco expone premio, formato del torneo, ni roster declarado de los equipos. |
| **API** | REST, `GET`, sin autenticación |
| **Estabilidad** | Alta |
| **Límites** | Mismos que §2.1 — **documentado, sin verificar** |
| **Coste** | 0 |
| **Licencia** | Misma que §2.1 |
| **Riesgo de scraping** | Ninguno |
| **Cobertura de drafts** | `/proMatches` es el índice completo de partidas profesionales — no un draft en sí, sino la lista para paginar hacia `/matches/{id}` |
| **Calidad de posiciones** | No aplica (no expone datos de jugador) |
| **Procesamiento offline** | Sí, 100% |
| **Datos medidos adicionales** | `/leagues`: **10.117 ligas** con tier real. Distribución: `premium` **214**, `professional` **2.475**, `excluded` **7.264**, `amateur` **59**, `null` (sin tier) **105** — **medido**, 2026-08-27. `/proMatches`: de las últimas 100 partidas devueltas, **66 pertenecen a una sola liga `premium`** (The International 2026) — **medido**, 2026-08-27. Es el dato que justifica la métrica de diversidad de torneos de `TSK-160` (umbral propuesto de sesgo: 40% de concentración). |

### 2.3 OpenDota Explorer (`GET /api/explorer?sql=...`)

| Columna | Valor |
|---|---|
| **Campos que aporta** | SQL de solo lectura sobre `public_matches` — rosters completos (`radiant_team`/`dire_team`), `avg_rank_tier`, `start_time`, `radiant_win`, agregable por héroe |
| **Campos que NO aporta** | **Ningún detalle por jugador** — `public_matches` no tiene `picks_bans` con orden, ni `position_est`, ni `lane_role`. **No sirve para drafts profesionales ni para posiciones** — es exclusivamente pubs de alto MMR. Ya lo confirmó `TSK-137`: la corrida real produjo solo **102–104 pares válidos** de matchup, sin ningún dato de draft ni de posición. |
| **API** | REST, `GET`, SQL como parámetro vía `URLSearchParams` (nunca concatenación) |
| **Estabilidad** | Media — tiene timeout de lectura propio; joins pesados contra `matches`/`player_matches` ya lo agotaron en intentos previos del proyecto (documentado en `fetch-expanded-matchups.ts`) |
| **Límites** | Cuenta contra la misma cuota que el resto de la API — **documentado, sin verificar** un número exacto |
| **Coste** | 0 |
| **Licencia** | Misma que §2.1 |
| **Riesgo de scraping** | Ninguno — es la misma API pública, con un modo de consulta SQL |
| **Cobertura de drafts** | **Ninguna** — no expone `picks_bans` |
| **Calidad de posiciones** | **Ninguna** — `public_matches` no tiene columna de posición ni de jugador individual |
| **Procesamiento offline** | Sí, 100% (ya en uso por `scripts/fetch-expanded-matchups.ts`, opt-in vía `--write-db`) |

### 2.4 STRATZ (GraphQL) — descartada, documentada por completitud

| Columna | Valor |
|---|---|
| **Campos que aportaría** | Matchups segmentados por posición — la única fuente conocida que resuelve ese hueco sin curación manual |
| **Campos que NO aporta** | Nada del resto de esta fase depende de STRATZ; no se evaluó más allá de este punto porque ya fue descartada dos veces (ver §1) |
| **API** | GraphQL, requiere API key |
| **Estabilidad** | Media — **documentado, sin verificar** en esta sesión (última verificación registrada: Fase 3, `architecture.md`) |
| **Límites** | ~10.000 requests/día en el tier gratuito — **documentado, sin verificar**, cifra heredada de la investigación de Fase 1b/Fase 3 |
| **Coste** | 0 en el tier gratuito, requiere registro y `API_KEY` |
| **Licencia** | Términos propios de STRATZ; investigación previa del proyecto (Fase 3) concluyó que permiten cache local — **documentado, sin verificar** en esta sesión |
| **Riesgo de scraping** | Ninguno (API oficial) |
| **Cobertura de drafts** | No evaluada — fuera de alcance por la decisión de §1 |
| **Calidad de posiciones** | Alta, según la investigación previa del proyecto — **documentado, sin verificar** en esta sesión |
| **Procesamiento offline** | Sí, según el mismo precedente |

### 2.5 Dota2ProTracker — descartada para esta fase, congelada como origen histórico

| Columna | Valor |
|---|---|
| **Campos que aportaría** | Presencia por posición en pubs de bracket alto (7000+ MMR), ya usado para curar `hero-positions.json` (Fase 3) |
| **Campos que NO aporta** | Ningún dato de drafts profesionales ni de torneos — es exclusivamente estadística de pubs de alto MMR, no de la escena competitiva |
| **API** | Ninguna — solo interfaz web |
| **Estabilidad** | Baja para acceso automatizado — un `GET` simple (`WebFetch`/`curl` sin navegador) devolvió **403 de Cloudflare** (**medido**, sesión de Fase 3, reconfirmado sin cambios en esta auditoría). Solo un navegador real (Playwright) con pausas entre páginas consecutivas pasa el bloqueo. |
| **Límites** | Sin límite publicado, pero el bloqueo de ráfagas es el límite real de facto |
| **Coste** | 0 |
| **Licencia** | **Sin licencia de reuso declarada** en el sitio — riesgo, no solo molestia técnica |
| **Riesgo de scraping** | **Alto** — requiere sortear activamente una protección anti-bot, no es una API pública ofrecida para consumo programático |
| **Cobertura de drafts** | Ninguna |
| **Calidad de posiciones** | Alta, pero de **pubs**, no de partidas profesionales — no resuelve el problema de esta fase |
| **Procesamiento offline** | Manual únicamente (navegador real, a mano, nunca automatizado — mismo procedimiento documentado en `signals/hero-positions.ts`) |

### 2.6 Liquipedia — fuera del camino base, planteada para decisión futura

| Columna | Valor |
|---|---|
| **Campos que aportaría** | Tier declarado por la propia escena competitiva (no una aproximación vía `league.tier` de OpenDota), fechas reales de inicio/fin de torneo, región real, premio, roster declarado de cada equipo |
| **Campos que NO aporta** | Ningún dato de picks/bans ni de orden de draft — Liquipedia documenta resultados y metadata de torneos, no el contenido pick-por-pick de cada partida |
| **API** | API de parse/REST propia (`liquipedia.net/dota2/api.php`), con reglas de uso |
| **Estabilidad** | Alta para la API oficial |
| **Límites** | User-Agent descriptivo obligatorio + orden de ~30 segundos entre peticiones de tipo "parse" — **documentado, sin verificar** en esta sesión (cifra pública de sus reglas de API, no medida acá) |
| **Coste** | 0 |
| **Licencia** | **CC-BY-SA 3.0** — exige atribución **y** que cualquier obra derivada se comparta bajo la misma licencia. Es la razón concreta por la que queda fuera del camino base (§1): el share-alike podría alcanzar al artefacto compilado de esta fase (`pro-patterns.json`) |
| **Riesgo de scraping** | Bajo, si se usa la API oficial en vez de parsear HTML |
| **Cobertura de drafts** | Ninguna (ver arriba) |
| **Calidad de posiciones** | No aplica — no expone datos de jugador por partida |
| **Procesamiento offline** | Sí, si se decide usar en el futuro |

## 3. Afirmaciones explícitamente prohibidas en cualquier trabajo posterior de esta fase

- ❌ **"Top 500 europeo" o cualquier leaderboard de cuentas.** No derivable de ninguna fuente
  evaluada — `rank_tier` es un valor por jugador que topa en 80 (Immortal), sin ranking numerado.
- ❌ **"Tier 1" como la taxonomía real de la escena competitiva.** Ninguna fuente del camino base
  la expone. Se usa `premium`/`professional`, tal cual los nombra OpenDota, **y se nombra así en
  el dato** — la equivalencia informal con "Tier 1"/"Tier 2" vive en documentación de producto,
  nunca en el nombre de un campo o de una constante de código.
- ❌ **Región del torneo.** `region` viene `null` en partidas LAN (medido). Se marca `"unknown"`
  explícito; nunca se infiere del nombre de la liga ni de ningún otro campo.
- ❌ **Tiempos por turno del draft.** `draft_timings` llegó vacío en el 100% de la muestra medida.

## 4. Qué queda para tickets posteriores

- El contrato de tipos (`ProSourceRef`, `ProTournament`, `ProDraft`, etc.) y el esquema de
  `pro-drafts.sqlite` — `TSK-148`.
- La ingesta real de torneos y drafts contra estas fuentes — `TSK-149`/`TSK-150`.
- Verificar los términos de uso vigentes de OpenDota **antes de publicar** cualquier dataset
  derivado (no antes de consumirlo para uso interno) — explícitamente fuera de alcance de
  `TSK-147`.
- La decisión sobre Liquipedia (§1, Decisión 4 de `SPEC.md` §14.10) — pendiente de aprobación
  explícita del usuario, no se resuelve en este documento.

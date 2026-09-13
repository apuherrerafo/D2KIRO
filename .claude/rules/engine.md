---
description: Reglas del motor de sugerencias y el servidor Bun (apps/engine) — SPEC.md §C2-C4, §3, §5
globs: apps/engine/**/*.ts
alwaysApply: false
---

Fuente: `docs/specs/SPEC.md` (contrato de desarrollo, gana sobre cualquier otra interpretación).

**R0.4 Task 24 (2026-09-13):** las fases cerradas que antes vivían enteras aquí (1b, 2, 3, 4, 4.2,
4.3, 5, 6, 8) se movieron a `docs/rules-archive/fase-N.md` — nada vinculante se perdió, sólo se
dejó de inyectar en cada turno. Fase 9 y 9.1 siguen aquí porque `CLAUDE.md` las trata como fase en
curso, no cerrada.

## Motor de sugerencias (C3) — nunca red en el camino caliente
- Ningún código bajo `apps/engine/src/suggestions/` (o carpeta equivalente del motor) hace
  `fetch`/HTTP. Todo lo que el motor necesita ya está en SQLite antes del primer pick.
- Un `SignalScorer` (S3) es una función pura: entrada `(DraftState, HeroId, MetaSnapshot)`, salida
  `SignalContribution`. Nunca I/O, nunca lanza sin ser capturado por el llamador.
- `raw: null` significa "sin datos suficientes" — nunca se traduce a `0` ni `0.5`. Su peso se
  redistribuye proporcionalmente entre las señales con dato.
- Si un scorer lanza una excepción, esa señal cuenta como `raw: null`; las otras tres se calculan
  igual. Una señal rota nunca tira el motor completo.
- El cálculo completo se corta a los 500 ms duros (presupuesto normal: 300 ms). Si se corta, se
  devuelve lo que haya con `degraded: 'partial_signals'` — nunca se bloquea el push.
- Sin candidatos válidos → `suggestions: []` + flag explícito, no una excepción.
- `SCORING_WEIGHTS_V1` vive en un único archivo, versionado por nombre. Debe existir una prueba
  unitaria que verifique que los 4 pesos suman exactamente `1.0`.

## Reductor de estado (C2) — `applyDraftEvent`
- Firma pura: `(state: DraftState, envelope: DraftEventEnvelope) => { state, rejected? }`. Sin
  `Date.now()`, `crypto.randomUUID()` ni ningún reloj/generador propio dentro — se inyectan como
  parámetros si la función los necesita.
- `eventId` repetido → se descarta en silencio (`duplicate_event`), nunca se re-aplica.
- `seq <= lastSeq` → se rechaza (`stale_seq`), **salvo** `pick_reverted`, que siempre se evalúa.
- Un evento rechazado nunca lanza ni corrompe el estado — se devuelve `RejectionReason` y el
  estado anterior sigue siendo válido.
- `format: 'unknown'` es un estado legítimo — el motor sigue sugiriendo igual, nunca lo bloquea.
- No se modela la tabla de turnos de Valve (orden exacto de bans de All Pick 7.35d) como lógica
  del reductor — vive como datos (`DraftFormat`), nunca como código que la adivine.

## Persistencia (C4) — SQLite/Drizzle
- Toda query pasa por Drizzle. Cero SQL concatenado, cero `db.execute()` con strings interpolados
  desde input externo.
- Toda respuesta de OpenDota se valida en el borde antes de escribir en SQLite — es input externo,
  igual que un formulario.
- La sincronización de cada tabla (S6) es transaccional: una escritura parcial nunca deja el cache
  a medias.
- 429 de OpenDota → reintento con espera creciente (1s, 4s, 16s), máximo 3 intentos. Si falla,
  `meta_sync.status = 'failed'` y se sigue sirviendo el cache viejo — un draft nunca se queda sin
  sugerencias por una API de terceros caída.

## Servidor Bun — HTTP + WebSocket
- `apps/engine` escucha únicamente en `127.0.0.1`. Un binding a `0.0.0.0` es FAIL automático.
- `POST /ingest/draft-event` exige la cabecera `x-capture-token` (generada en runtime, leída de
  `process.env`, nunca hardcodeada) y limita a 20 eventos/segundo por sesión — el exceso se
  descarta con `429`.
- Tras cada evento aplicado, el orden de push por WebSocket es siempre `draft_state` primero,
  `suggestions` después — el tablero nunca espera al motor para reflejar el estado real. Ningún
  otro tipo de mensaje se suma a este push automático sin una decisión explícita (ver `draft_paths`
  abajo, que deliberadamente queda afuera).
- Al reconectar (`hello`), el servidor responde siempre con una instantánea completa
  (`snapshot`), nunca con deltas.

## Fase 9 — V6-medido → V6-contextual (SPEC.md §15)

Programa 9.0→9.5. **Sólo 9.0 está especificada a nivel ejecutable**; 9.1 tiene el mecanismo fijado
con números diferidos a su gate; 9.2–9.5 son conceptuales (cada una abre su `/blueprint` angosto).

### 9.0 — regla dura: no se toca el motor

- **9.0 no cambia una línea de `apps/engine/src/**` ni de `apps/web/src/**`.** Criterio de
  aceptación verificable con `git diff --name-only`. No toca `signals/`, `weights.ts`, `mix.ts`,
  `RAW_RANGE`, `SignalId`, `SCORING_WEIGHTS_V6`. `ENABLE_PRO_DRAFTER` y el comportamiento de
  producción quedan idénticos.
- **`scripts/eval/**` y `scripts/stats/**` nunca se importan desde `apps/`.** Verificable
  mecánicamente. Son runners offline; leer código del motor como import (para medirlo) está
  permitido, escribir en él no.
- **`pro-drafts.sqlite` y `dota2coach.sqlite` se abren `readonly: true`** desde todo script de
  Fase 9. Un guard aborta si detecta una ingesta escribiendo el mismo archivo (regla que ya existía
  para el backfill, ahora mecánica).
- **Ninguna prueba abre `pro-drafts.sqlite`, `dota2coach.sqlite`, `eval/golden/` real ni un JSON de
  `data/generated/`** — fixtures inline. Mismo criterio literal que S9/S10 desde Fase 2 (costuras
  S15–S19, ver `testing-seams.md`).

### Reconstrucción de `DraftState` desde el corpus (S15)

- El replay (`buildReplayCases`) es **función pura**: `(ProDraftTurn[], meta) => ReplayCase[]`, sin
  I/O.
- `state.localSide` = **el equipo que actúa en ese turno**, para que `observedDraftFacts()` devuelva
  `ownPicks`/`revealedEnemyPicks` correctos sin tocar el motor.
- `state.banned` / `state.picks` = **exactamente** el prefijo `[0, turnIndex)`. **Ninguna filtración
  de turno futuro** — es la única fuga posible en este diseño y se prueba explícitamente.
- 9.0 evalúa **sólo los turnos `is_pick = 1`**. Los bans se reconstruyen como estado, no se predicen
  (el motor no tiene recomendador de ban con el flag apagado).
- Draft con shape inválido (≠24 turnos, héroe repetido, `team` fuera de `{0,1}`) → **se descarta con
  motivo registrado**, nunca se repara.

### Realidad del corpus (medida 2026-08-29, no estimada — SPEC §15.1)

- **2.164** drafts con shape válido (de 2.179). Los 826 `tier_not_accepted` **entran** al backtest
  con `tier` como covariable — es política de curación de Fase 7, no un defecto de dato.
- **Mono-parche**: `patch = 60` en los 2.179. El eje `patch` del fallback jerárquico de calibración
  (9.1) **nace inerte**; sólo `global` y `bracket` (8, balanceados) estratifican.
- `hero_matchups`: `p50 = 54`, `p90 = 175`, **máx 712** partidas por par. En 9.2 el término `δ_AB`
  del Empirical Bayes quedará fuertemente encogido y el orden lo dominarán los efectos principales —
  **resultado esperado, no fallo**.
- **No existe snapshot de meta point-in-time.** El backtest es un instrumento **comparativo**
  (V6 vs V6+cambio sobre el mismo snapshot), **nunca predictivo**. El valor absoluto de cualquier
  métrica no es interpretable sin sus baselines.

### 9.1+ (mecanismo fijado, números diferidos)

- **`SignalContribution` gana `normalized: number | null` y `evidenceConfidence: number` (aditivo)**
  — ningún campo actual se borra. Espejo en `apps/web` en el mismo cambio (ver `web.md`).
- **`raw: null` sigue siendo sagrado**: nunca se convierte en 0, 0.5 ni 50. Cambia cómo se propaga
  su ausencia (fin de la redistribución candidate-specific), no que se rellene.
- **Calibración** `N(x) = clamp((x − P05)/(P95 − P05), 0, 1)` con fallback jerárquico
  `global → bracket`, percentiles **congelados sobre el split de train**. Candado de regresión
  obligatorio: calibración desactivada + opciones legacy ⇒ `mixScore` reproduce V6 **exacto**.
- **Loader de calibración (S18)**: `data/generated/*.json` es input externo. Validado en el borde;
  corrupto/ausente/forma inesperada → **degrada al mecanismo V6 actual**, nunca lanza, nunca inyecta
  magnitudes arbitrarias. Mismo criterio literal que `loadHeroPositions()`/`loadHeroCounters()`.
  Se carga **una vez al iniciar el módulo** (patrón `MODULE_HERO_*`), nunca por llamada.
- `SCORING_WEIGHTS_V7` **sólo en 9.5**, regularizado hacia V6, con el split congelado de §15.4.3.
  V1–V6 congeladas por nombre.

## Fase 9.1 — comparabilidad + calibración empírica (SPEC.md §16)

9.1 **sí toca `apps/engine/src/signals/`** (a diferencia de 9.0). Cambia el mecanismo de
normalización y de mezcla. **No toca `weights.ts`** — `SCORING_WEIGHTS_V6` sigue activa; V7 es 9.5.
`counter` NO se parte en 3 (eso es 9.3). Empirical Bayes es 9.2. Gating contextual es 9.3.

- **`raw: null` sigue sagrado** — nunca 0/0.5/50. 9.1 agrega un campo `contribution` separado y un
  relleno `μ` que **jamás** se escribe en `raw`. El desglose de una señal sin dato sigue diciendo
  "sin datos suficientes".
- **`SignalContribution` gana `normalized: number | null` y `evidenceConfidence: number`**
  (aditivo, ningún campo se borra). El contrato `SignalScorer.score()` **no cambia de firma** —
  esos dos campos los agrega `mix.ts`/`enrich()` después de llamar a cada scorer.
  - `normalized = raw === null ? null : clamp((raw − p05)/(p95 − p05), 0, 1) * 100`, con
    `p05`/`p95` de `data/generated/percentiles.json` (`byBracket` del estado si existe, si no
    `global`, si no falta el archivo → `RAW_RANGE[signal]`).
  - `evidenceConfidence`: estadísticas (`counter`/`patch_meta`/`position_fit`) →
    `raw === null ? 0 : sampleSize/(sampleSize + K)` con `K_position_fit=200`, `K_counter=20`,
    `K_patch_meta=200` (arranque, QA-tuneable). Categóricas (`team_synergy`/`hero_pool_fit`/
    `archetype_fit`) → `raw === null ? 0 : 1`.
- **Calibración empírica (S18)**: `loadCalibration()` valida en el borde (esquema, `p05 < p95`,
  no NaN, `SignalId` conocido); archivo corrupto/ausente/forma inesperada → **fallback a
  `RAW_RANGE`**, byte-idéntico a V6, **nunca lanza**. Se carga **una vez al iniciar el módulo**
  (patrón `MODULE_HERO_*`). Los percentiles se congelan sobre folds de **train** del `split.json`
  de 9.0 — nunca el fold held-out.
- **Fin de la redistribución candidate-specific → mezcla por estado** (`mix.ts`):
  1. `A(S)` = señales estructuralmente aplicables al estado `S`, **igual para todo candidato de
     `S`**: `position_fit` siempre (salvo `localSide === "unknown"`); `counter` si hay rivales
     revelados o un counter curado sobre un baneado; `team_synergy` si hay picks propios;
     `patch_meta` si hay calibración de `patch_meta`; `hero_pool_fit` si `meta.heroPool` no vacío;
     `archetype_fit` si hay `archetypeIntent`.
  2. `wᵢ' = SCORING_WEIGHTS_V6[i] / Σ_{j∈A(S)} SCORING_WEIGHTS_V6[j]` — **mismo denominador para
     todo candidato de `S`**.
  3. `μᵢ(S)` = media de `normalizedᵢ(h)` sobre los candidatos de `S` con `rawᵢ(h) ≠ null`.
     Si ninguno tiene dato → `μᵢ(S) = 50` (**único lugar donde aparece un neutro, nunca en `raw`**).
  4. `contributionᵢ(h)`: `i ∉ A(S)` → 0; `rawᵢ(h) ≠ null` → `wᵢ'·normalizedᵢ(h)`;
     `rawᵢ(h) = null` → `wᵢ'·μᵢ(S)`.
  5. `score(h) = Σ contributionᵢ(h)` ∈ `[0, 100]`.
- **`EvidenceCoverage(h) = Σ_{i∈A(S), rawᵢ(h)≠null} wᵢ'`**; **`GuessingIndex(h) = 1 − EvidenceCoverage(h)`**.
  `computeConfidence` pasa a derivarse de `EvidenceCoverage`: `alta` si `≥ 0.75` y meta no stale;
  `media` si `≥ 0.5` o meta stale; `baja` si `< 0.5` (umbrales de arranque).
- **`Suggestion` gana `evidenceCoverage` y `guessingIndex` (0–1).** **No se renderiza en 9.1** (UI
  diferida, D4) — sólo el tipo y los reportes de eval.
- **Candado de regresión cero (obligatorio)**: con `loadCalibration()` en fallback + `A(S)` =
  "señales con `raw ≠ null` para el candidato" (legacy) + sin usar `μᵢ(S)`, `mixScore` y
  `buildSuggestions` reproducen V6 **byte a byte**. Prueba con números concretos en `mix.test.ts`.
- Presupuesto intacto: 300 ms / corte 500 ms. `μᵢ(S)` exige una segunda pasada por candidato por
  estado — despreciable con ~110 candidatos × 6 señales.

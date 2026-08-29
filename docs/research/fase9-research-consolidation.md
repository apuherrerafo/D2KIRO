# Fase 9 — Consolidación de investigación (3 informes externos)

**Fuente**: 3 informes que el usuario encargó y pasó los días 2026-08-28 / 2026-08-29.
**Propósito**: entrada única y durable para el `/pre-flight` y el `/blueprint` de Fase 9.
**Regla**: nada de lo investigado se pierde. Cada idea tiene una disposición explícita —
`CORE` (entra, con sub-fase), `DIFERIDO` (entra después, fuera de Fase 9), `DESCARTADO`
(no se hace, con motivo). Este archivo no decide: lista y ordena para que el `/pre-flight`
cierre las bifurcaciones y el `/blueprint` (Opus, una vez) sintetice.

---

## 0. Los tres documentos

| ID | Título | Eje | Núcleo |
|---|---|---|---|
| **R1** | "Deep research report" (ChatGPT) | Rigor estadístico del motor | Calibración escala-antes-de-pesos; percentiles empíricos congelados; Empirical Bayes *offline* para matchups; backtest sobre 2.179 drafts pro; comparabilidad de `raw:null`; los pesos se ajustan AL FINAL. Mantra: **"V6-medido, no V7-pesos"**. |
| **R2** | "Propuesta de Arquitectura para un Motor de Drafting Contextual de Dota 2" | Arquitectura del motor | Evolución V1 estático → V2 contextual → V3 decisión secuencial. `DraftState` rico e inmutable; *gating* contextual de pesos sobre features interpretables; partir `counter` en 3 señales; Flexibility / Branch-Survival / Team-Needs; Golden Dataset; métricas anti-mal-pick. |
| **R3** | "AI Engineering Harness para dota2coach" | Proceso de desarrollo asistido por IA | Claude Code nativo antes que infra propia; jerarquía de autoridad L0–L6; 6 subagentes; hooks deterministas; *worktree isolation*; el harness de evaluación como capa defensiva donde una política determinista (no la IA) decide PASS/FAIL; frontera `data/curated` vs `data/generated`; ADRs. "El repositorio es la memoria del proyecto." |

---

## 1. Convergencias — donde 2+ informes coinciden (la señal más fuerte)

| Idea | R1 | R2 | R3 | Disposición |
|---|:-:|:-:|:-:|---|
| **Fundación de evaluación offline ANTES de tocar una fórmula de scoring** | ✓ backtest MVP | ✓ prioridad P0 | ✓ capa defensiva central | **CORE 9.0** — bloqueante para todo lo demás |
| **Percentiles empíricos reemplazan la normalización lineal de `RAW_RANGE`** | ✓ p5/p95 sobre train, congelados | ✓ `N(x)=clamp((x−P05)/(P95−P05),0,1)` con *fallback* jerárquico | — | **CORE 9.1** |
| **Dejar de redistribuir pesos por candidato cuando una señal es `raw:null`** | ✓ rompe comparabilidad (`position_fit` 34,2 %→50,6 % según cuántas señales se abstienen; no MAR, Rubin 1976) | ✓ mismo diagnóstico | — | **CORE 9.1** |
| **Partir `counter` en 3 señales** (observado / cobertura de amenaza / vulnerabilidad) | — | ✓ `observed_counter`, `threat_coverage = Σ P(e·D)·Matchup(h,e)`, `counter_vulnerability = Σ P(e·D)·Severity(e→h)` | — | **CORE 9.3** |
| **Los pesos se ajustan AL FINAL, regularizados hacia V6** | ✓ 6 no-negativos, suman 1, penalizados hacia V6, *split* por partida/torneo/tiempo | ✓ prioridad P3 | — | **CORE 9.5** |
| **Procedencia/metadata en cada dataset; lo generado nunca pisa lo curado** | ✓ *provenance check* del endpoint de OpenDota | ✓ `patchValidated` en la KB de counters | ✓ `data/{curated,generated,schemas,metadata}` + hook anti-sobreescritura | **CORE 9.0** |
| **Golden Dataset etiquetado a mano** | ✓ escenarios con pick relevante único | ✓ estructura `{draftStateId, acceptable[], excellent[], bad[], reasoningTags[]}` | ✓ `eval/golden/` | **CORE 9.0** |
| **NO sobre-ingeniería**: sin RL, sin *deep learning*, sin minimax, sin predicción del siguiente pick, sin *counterfactual winrate*, sin MCMC/Stan en producción | ✓ | ✓ lista explícita de "qué NO hacer" | ✓ sin LangGraph/CrewAI/AutoGen, sin Memory-MCP | **DESCARTADO — límite duro de alcance de Fase 9** |
| **Métrica = "Acuerdo con el pick profesional", NO "precisión". El pick del equipo ganador no es causal** | ✓ nombrado explícito | ✓ complementado con *Bad Pick Rate* y *Constraint Violation Rate → ~0* | — | **CORE 9.0 — definición de métrica antes de medir** |
| **Estabilidad vs reactividad medidas como par** | ✓ *null-perturbation baseline* para fijar umbrales | ✓ Jaccard@K + Kendall-Tau (estabilidad) vs ScoreDelta/RankDelta/TopKEntryRate (reactividad) | — | **CORE 9.0** |

---

## 2. R1 — Rigor estadístico (idea por idea)

| # | Idea de R1 | Disposición | Sub-fase | Nota |
|---|---|---|---|---|
| R1-1 | **Escala-antes-de-pesos**: la pendiente efectiva de una señal es `100·w/(b−a)`. Con los `RAW_RANGE` actuales, `counter` tiene peso efectivo ~90 y `patch_meta` ~29,25 — los límites del rango dominan en silencio a los pesos declarados en `SCORING_WEIGHTS_V6`. | **CORE** | 9.1 | Es el hallazgo que justifica tocar `RAW_RANGE`. Hay que medir la pendiente efectiva real de las 6 señales y documentarla. |
| R1-2 | **Calibración por percentiles empíricos**: correr los scorers sobre datos reales, tomar p5/p95 de la salida `raw` observada, **congelarlos sobre el split de train**. | **CORE** | 9.1 | Reemplaza los comentarios "no medido contra datos reales" que hoy están en el código. |
| R1-3 | **Empirical Bayes jerárquico ligero para matchups, OFFLINE**: `winrate(A vs B) ≈ μ_bp + α_A + β_B + δ_AB`. **NO** MCMC/Stan en producción — se calcula fuera, se emite un JSON, el motor sólo hace *lookup*. | **CORE** | 9.2 | Ataca directo el problema "1.171 de 15.984 matchups (7,3 %) tienen ≥200 partidas". El *shrinkage* de `pro/shrinkage.ts` (TSK-165) es el precursor; esto lo formaliza. |
| R1-4 | **`raw:null` rompe la comparabilidad**: la redistribución proporcional actual hace que el peso efectivo de una señal dependa de cuántas *otras* señales votaron para *ese* candidato → dos héroes no se comparan en la misma escala. No es *Missing At Random*. | **CORE** | 9.1 | Par con R2-4. La solución (peso fijo + término de cobertura de evidencia) se decide en `/pre-flight`. |
| R1-5 | **`EvidenceCoverage = Σ wᵢqᵢ / Σ wᵢ`** y **`GuessingIndex = 1 − EvidenceCoverage`** por sugerencia (`qᵢ` = 1 si la señal *i* tuvo datos, 0 si no). | **CORE** | 9.1 | Sustituye la señal implícita que hoy da `degraded: partial_signals`. Candidato a mostrarse en la UI (decisión de `/pre-flight`). |
| R1-6 | **Provenance check del endpoint `/heroes/{id}/matchups` de OpenDota**: ¿sobre qué población está calculado ese winrate? (rango de MMR, parche, modo). Documentarlo antes de confiar en él. | **CORE** | 9.0 | Va al `metadata/` de la frontera curated/generated de R3. |
| R1-7 | **Backtest MVP sobre los 2.179 drafts pro**: Recall@1/3/5/10 + MRR. *Bootstrap* a nivel de draft y a nivel de torneo (no a nivel de turno). Baselines obligatorios: sólo-`position_fit`, sólo-`patch_meta`, V6-sin-`counter`. | **CORE** | 9.0 | El corazón de 9.0. Requiere el *backfill* de slots Dire (TSK-174/179) resuelto o un *split* que lo tolere. |
| R1-8 | **NDCG aporta poco con un solo pick relevante por estado** — no priorizarlo. | **CORE** (como decisión de qué NO medir) | 9.0 | R2 lo incluye igual; se puede reportar como secundario, no como métrica de barra. |
| R1-9 | **"Professional Pick Agreement", no "Draft Accuracy"**. El pick del equipo ganador **no es causal** del resultado. | **CORE** | 9.0 | Definición de framing. Evita sobre-interpretar el backtest. |
| R1-10 | **Ablación por señal**: `contribuciónᵢ(h,S) = Score(h,S) − Score₋ᵢ(h,S)`. | **CORE** | 9.0 | Herramienta de diagnóstico, va junto al backtest. |
| R1-11 | **Baseline de null-perturbation para umbrales de estabilidad**: perturbar entradas dentro del ruido esperado y medir cuánto se mueve el Top-K "sin motivo" → ese es el piso. | **CORE** | 9.0 | Par con R2 (Jaccard/Kendall). |
| R1-12 | **El *drift* lo gobiernan los parches** — versionar todo dataset por parche; re-calibrar en cada parche grande. | **CORE** | 9.0 (política) | Ya es práctica implícita (`hero-positions.json` se regenera por parche); ahora explícita y con metadata. |
| R1-13 | **Los pesos se ajustan AL FINAL**: 6 no-negativos, suman 1, término de penalización hacia V6, validación *split* por partida / torneo / tiempo. Nunca ajustar pesos y fórmulas a la vez. | **CORE** | 9.5 | `SCORING_WEIGHTS_V7` nace aquí, no antes. Todo cambio de fórmula previo se mide con V6. |
| R1-14 | **Mantra "V6-medido, no V7-pesos"**: la Fase 9 primero *mide* V6 con rigor; sólo cuando cada cambio de fórmula supere a V6-medido en el backtest congelado se toca el vector de pesos. | **CORE** | transversal | Es el criterio de aceptación de toda la fase. |

---

## 3. R2 — Motor de drafting contextual (idea por idea)

| # | Idea de R2 | Disposición | Sub-fase | Nota |
|---|---|---|---|---|
| R2-1 | **Evolución en 3 saltos**: V1 estático (hoy) → **V2 contextual** (pesos que responden al estado) → V3 decisión secuencial (valor de la rama). | **CORE hasta V2** / **V3 DIFERIDO** | 9.3 = V2; V3 fuera de Fase 9 | V3 (evaluar el árbol de picks futuros) roza "predicción del siguiente pick" — se pospone explícitamente. |
| R2-2 | **`DraftState` rico e inmutable**: `decisionContext`, `inferredRoles`, `roleEntropy`, `ownNeeds`, `enemyThreats`, `knownInformationRatio`. Derivados puros del estado actual. | **CORE** | 9.3 | Extiende el `DraftState` actual sin romper `applyDraftEvent` (sigue puro). Los derivados se calculan en una capa aparte, no en el reductor. |
| R2-3 | **Gating contextual**: `W_s(D) = BaseWeight_s · ContextGate_s(D)`, donde `ContextGate` depende de **features interpretables** (entropía de rol, ratio de información conocida, needs), **nunca del número de turno**. | **CORE** | 9.3 | Este es el salto V2. `BaseWeight` = `SCORING_WEIGHTS_V7` de 9.5; el *gate* es multiplicativo y acotado. |
| R2-4 | **No redistribuir pesos candidate-specific** (mismo punto que R1-4). Cada señal reporta 4 campos separados: `raw` / `normalized` / `evidenceConfidence` / `contribution`. | **CORE** | 9.1 | Cambia el contrato `SignalContribution`. Espejo obligatorio en `apps/web`. |
| R2-5 | **Normalización `N(x) = clamp((x−P05)/(P95−P05), 0, 1)`** con *fallback* jerárquico: global → parche → parche+bracket → parche+bracket+rol. | **CORE** | 9.1 | Implementación concreta de R1-2. El *fallback* jerárquico cubre el caso "poco dato en ese corte". |
| R2-6 | **MMR ≠ maestría**: `PlayerHeroReliability` — cuántas partidas recientes con ese héroe, no sólo el MMR de la cuenta. | **DIFERIDO** | post-9 | Toca `hero_pool_fit` y datos por cuenta. Valioso pero ortogonal al núcleo de calibración; se hace después con su propio ticket. |
| R2-7 | **Flexibility explícita**: `RoleEntropy × RemainingDraftDepth × EnemyUncertainty`. | **CORE** (mínimo) | 9.4 | Alimenta el Top-K estratégico. Versión mínima en 9.4; refinamiento diferido. |
| R2-8 | **Branch Survival**: penalizar picks que se auto-limitan (revelan compromiso sin necesidad). | **DIFERIDO** | post-9 | Depende de R2-1 V3. Fuera de Fase 9. |
| R2-9 | **Team Needs dinámicos**: `NeedFit = Σ Need_c(D) · Capability(h,c)`, con `Need_c` recalculado por estado. | **CORE** | 9.3 | Reutiliza `capabilities.json` (S9) y el trabajo de `draft-paths/`. No inventa dato nuevo. |
| R2-10 | **Capability Model ordinal mínimo (0–3)** por héroe y categoría. | **CORE** (reusar) | 9.3 | Ya existe en `capabilities.json` como booleanos/niveles. Se formaliza a escala 0–3 donde haga falta, sin curación nueva masiva. |
| R2-11 | **KB de counters enriquecida**: `type` ∈ {mechanical, lane, strategic, tempo, itemization, numerical} + `mechanism` (texto) + `patchValidated` (bool). | **CORE** | 9.3 | Extiende `hero-counters.json` (Fase 8). Aditivo: los campos nuevos son opcionales, el loader los valida en el borde. |
| R2-12 | **Definición de "hard counter"** = mecanismo identificado **+** confianza curada **+** posterior estadístico compatible. **NUNCA** `delta ≥ X %` a secas. | **CORE** | 9.3 | Cambia cómo `counter.ts` decide `level: "hard"`. Coherente con Fase 8 (curado tiene prioridad). |
| R2-13 | **Golden Dataset** `{draftStateId, acceptable[], excellent[], bad[], reasoningTags[]}`. | **CORE** | 9.0 | Estructura canónica. Vive en `eval/golden/`. |
| R2-14 | **Métricas**: Recall@K, NDCG@K, Pairwise Accuracy, **Bad Pick Rate**, **Constraint Violation Rate → ~0**. | **CORE** | 9.0 | *Constraint Violation Rate* (¿sugirió un héroe baneado/pickeado/rol imposible?) debe ser cero — es un gate, no una métrica ponderada. |
| R2-15 | **Estabilidad** (Jaccard@K, Kendall-Tau entre estados consecutivos) **vs reactividad** (ScoreDelta, RankDelta, TopKEntryRate ante un pick rival nuevo). | **CORE** | 9.0 | Par con R1-11. |
| R2-16 | **Prioridades P0→P3**: P0 fundación de eval → P1 fundamentos estadísticos → P2 inteligencia contextual → P3 Top-K estratégico. | **CORE** | mapa de fases | Coincide casi 1:1 con 9.0→9.1→9.3→9.4. |
| R2-17 | **Qué NO hacer**: minimax, DL, RL, predicción del siguiente pick, *counterfactual winrate*. | **DESCARTADO** | — | Límite duro. Coincide con R1 y R3. |

---

## 4. R3 — AI Engineering Harness (idea por idea)

| # | Idea de R3 | Disposición | Sub-fase | Nota |
|---|---|---|---|---|
| R3-1 | **Cuatro palancas**: controlar CONTEXTO + AUTORIDAD + AISLAMIENTO + VERIFICACIÓN. | **CORE** (marco) | 9.0 | Lente para evaluar todo lo demás del harness. |
| R3-2 | **"El repositorio es la memoria del proyecto"** — decisiones y estado viven en archivos versionados, no en la cabeza de un agente ni en un journal en prosa. | **CORE** | 9.0 | Motiva los ADRs (R3-5). Este mismo archivo es una aplicación de la regla. |
| R3-3 | **Usar Claude Code nativo antes que infra propia**: `CLAUDE.md` < 200 líneas, `.claude/rules/` path-scoped, Skills, subagentes, Hooks deterministas, *worktree isolation*, MCPs con privilegio mínimo por agente. | **CORE parcial** | 9.0 | El proyecto ya tiene ~70 %. `CLAUDE.md` hoy pasa MUY de 200 líneas → **partir a `.claude/rules/` y adelgazar** es un ítem de 9.0. |
| R3-4 | **Jerarquía de autoridad L0–L6**: L0 Contratos Duros > L1 ADR > L2 Arquitectura > L3 SPEC > L4 Código > L5 Investigación > L6 Memoria de agente. | **CORE** | 9.0 | Formaliza y ordena lo que hoy está implícito (`SPEC.md` > `architecture.md` > código; `journal.md` append-only). |
| R3-5 | **ADRs** en `docs/adr/` — una decisión arquitectónica por archivo, inmutable, con contexto y consecuencias. | **CORE** | 9.0 | Hoy las decisiones grandes viven diluidas en `journal.md` + bloques "REGLAS DE FASE X" de `CLAUDE.md`. Fase 9 estrena `docs/adr/` y migra las decisiones clave de 9.x ahí. |
| R3-6 | **6 subagentes**: project-architect, dota-domain-researcher, data-stat-engineer, implementation-engineer (`isolation: worktree`), evaluation-engineer, spec-warden. | **CORE parcial** | 9.0 | Mapear contra los 5 actuales (Warden/Artisan/Chronicle/Tracer/Sentinel). Gap real: **`evaluation-engineer`** (no hay equivalente) y **`data-stat-engineer`**. `/pre-flight` decide si se crean 2 nuevos o se amplía el rol de Warden. |
| R3-7 | **Memory MCP = NO**. | **DESCARTADO** | — | El repo es la memoria (R3-2). Coherente con la memoria de archivos que ya usa el proyecto. |
| R3-8 | **Claude Agent SDK (TypeScript)** en `tools/ai-harness/` para automatización de CI **más adelante** — nunca dentro de `apps/engine`. | **DIFERIDO** | post-9 | El propio R3 lo pone como "later". Fase 9 no lo construye; sólo reserva el nombre de carpeta en la estructura. |
| R3-9 | **NO LangGraph / CrewAI / AutoGen**. | **DESCARTADO** | — | Límite duro. |
| R3-10 | **`TASK.yaml` con `write_scope`** por tarea; dos tareas son paralelizables sólo si `writeScope(A) ∩ writeScope(B) = ∅` **y** no hay dependencia semántica. | **CORE** (adaptado) | 9.0 | Adaptar al frontmatter de `TSK-XXX.md` actual: añadir `write_scope:` y un hook PreToolUse que rechace escrituras fuera de él. Habilita worktrees paralelos con seguridad. |
| R3-11 | **El harness de evaluación es la capa defensiva central**: una **política determinista (no la IA)** decide PASS/FAIL contra el backtest y el Golden Dataset. | **CORE** | 9.0 | Es la misma idea que `verify-simplicity.sh` como gate, extendida a métricas de calidad del motor. Un script, no un juicio del agente. |
| R3-12 | **MCPs con privilegio mínimo por agente**: Context7 (docs de librería al día), Firecrawl (investigación de parches), GitHub, Playwright — cada uno *scoped* al agente que lo necesita. | **CORE parcial** | 9.0 | **Context7**: alto valor (Next.js/Bun — ver `apps/web/AGENTS.md`), conectar antes de `/rulebook`. **Firecrawl**: útil para curación de counters/parches; evaluar en `/pre-flight`. GitHub/Playwright: no prioritarios ahora. |
| R3-13 | **Estructura de carpetas**: `docs/{architecture,domain,data,evaluation,adr}/`, `work/{active,done}/`, `eval/{golden,scenarios,regression,baselines}/`, `data/{curated,generated,schemas,metadata}/`. | **CORE parcial** | 9.0 | Adoptar `eval/` y `data/{curated,generated,metadata}/` (convergen con R1/R2). `docs/adr/` (R3-5). **NO** migrar `docs/agents/tasks/` a `work/active/` — el sistema Kanban actual + `hub.html` funciona; sería churn sin beneficio. |
| R3-14 | **"Capability does not imply availability"** — tener un MCP/tool configurado no significa que un agente deba poder usarlo; se declara explícito por agente. | **CORE** | 9.0 | El proyecto ya declara `tools:` mínimas por agente; extender a MCPs. |
| R3-15 | **Rollout del harness en fases V1→V4** (empezar mínimo, endurecer). | **CORE** (criterio) | 9.0 | Fase 9 monta V1–V2 del harness (eval + rules + ADRs + write_scope). V3–V4 (SDK/CI) diferidos. |

---

## 5. Tensiones y bifurcaciones a resolver en `/pre-flight`

1. **¿Fase 9 = un programa (9.0–9.5) o una sola fase grande?** Recomendación de este documento: programa, con 9.0 *mergeado y validado* antes de tocar scoring.
2. **`RAW_RANGE` está casi congelado por contrato.** Reemplazarlo por percentiles empíricos (R1-2/R2-5) necesita bendición explícita del usuario y probablemente un ADR (R3-5) que lo registre.
3. **Partir `counter` en 3 (R2-3): ¿en 9.3, o antes?** Cambia `SignalId` + estrena `SCORING_WEIGHTS_V7` → arrastra el espejo de `apps/web` y todos los candados de suma-1.0. Depende de que 9.0 y 9.1 estén cerrados.
4. **`SignalContribution` gana campos (`normalized`, `evidenceConfidence`) (R2-4).** Es un cambio de contrato transversal. ¿Se hace de una en 9.1 o incremental?
5. **`EvidenceCoverage` / `GuessingIndex` (R1-5): ¿se muestran en la UI del draft** o quedan sólo como diagnóstico interno del backtest?
6. **Harness — cuánto se adopta ahora**: ¿`eval/` + `docs/adr/` + `data/{curated,generated}` + `write_scope` + hook (sí, convergen) — y se crean `evaluation-engineer` + `data-stat-engineer` como agentes nuevos, o se amplía Warden? ¿Se parte `CLAUDE.md`?
7. **MCPs**: Context7 sí (antes de `/rulebook`). ¿Firecrawl entra en Fase 9 para curación de counters/parches, o se difiere?
8. **Backfill de slots Dire (TSK-174/179)**: ¿el backtest de 9.0 espera a que esté completo, o se define un *split* que tolere el corpus parcial actual (2.179 drafts, slots incompletos)?
9. **`V3` de R2 (decisión secuencial / branch survival)**: confirmar que queda **fuera** de Fase 9 (roza "predicción del siguiente pick", que los 3 informes descartan).

---

## 6. Restricciones del repo que ninguna investigación puede violar

- `apps/engine` sólo escucha en `127.0.0.1`. Bind a `0.0.0.0` = FAIL automático.
- **Cero red en el camino caliente del draft.** Todo cálculo estadístico (Empirical Bayes, percentiles, backtest) es *offline*, fuera de `apps/engine`, y emite JSON que el motor lee.
- Presupuesto de cálculo: 300 ms normal, corte duro a 500 ms.
- `raw: null` **nunca** se convierte en 0 / 0.5 / 50. Su tratamiento cambia (R1-4/R2-4) pero la regla dura sigue.
- Cero dependencias de producción nuevas sin `/gear-up` o `@depcheck`. Sin STRATZ. Sin *scraping* de Dotabuff. Sin Python en el runtime.
- Datos generados **nunca** sobrescriben JSON curado revisado por humano (ahora con hook, R3-13).
- `SCORING_WEIGHTS_V1`–`V6` congeladas por nombre; `V7` nace sólo en 9.5.
- Un `SignalScorer` que lanza excepción no tira el motor (cuenta como `raw: null`).
- `account_id` / Steam32 nunca en logs, errores, `journal.md` ni tickets.
- `applyDraftEvent` sigue puro (sin I/O, sin reloj propio). Los derivados de `DraftState` (R2-2) viven en una capa aparte.
- No tocar `.codex/`, SQLite local ni artefactos temporales en commits.
- No correr el *backfill* mientras TSK-174 escribe la misma SQLite.

---

## 7. Mapa de fases propuesto (BORRADOR para `/blueprint` — no vinculante)

| Sub-fase | Nombre | Entrega | Convergencia |
|---|---|---|---|
| **9.0** | Fundación de evaluación + harness V1 | Backtest reproducible sobre 2.179 drafts pro (Recall@k, MRR, baselines); Golden Dataset inicial en `eval/golden/`; `data/{curated,generated,metadata}/` con procedencia; `docs/adr/`; `write_scope` + hook; `CLAUDE.md` partido; política determinista PASS/FAIL. **Nada de scoring cambia aquí.** | R1-7·9, R2-13·16, R3-2·5·11·13 |
| **9.1** | Comparabilidad + calibración empírica | Percentiles empíricos p5/p95 congelados reemplazan `RAW_RANGE` lineal; fin de la redistribución candidate-specific; `SignalContribution` gana `normalized` / `evidenceConfidence`; `EvidenceCoverage` / `GuessingIndex`. Se mide contra V6. | R1-1·2·4·5, R2-4·5 |
| **9.2** | Modelo bayesiano de matchups (offline) | Empirical Bayes jerárquico `μ_bp+α_A+β_B+δ_AB` calculado fuera, emitido como JSON; el motor hace *lookup*. *Provenance check* de OpenDota cerrado. | R1-3·6 |
| **9.3** | Inteligencia contextual (V2) | `DraftState` enriquecido (derivados puros); *gating* contextual `W_s(D)=BaseWeight·ContextGate(D)` sobre features interpretables; `counter` partido en 3; KB de counters enriquecida (type/mechanism/patchValidated); Team Needs dinámicos. | R2-1·2·3·9·11·12 |
| **9.4** | Top-K estratégico | Flexibility explícita (mínima); diversificación del Top-K con criterio; *Bad Pick Rate* y *Constraint Violation Rate* como gates. | R2-7·14 |
| **9.5** | Ajuste de pesos — AL FINAL | `SCORING_WEIGHTS_V7` ajustado con regularización hacia V6, validación *split* por partida/torneo/tiempo. Sólo entra si supera a V6-medido en el backtest congelado. | R1-13·14, R2-16 |

**Diferido explícitamente fuera de Fase 9**: R2-1 (V3 secuencial), R2-6 (`PlayerHeroReliability`), R2-8 (Branch Survival), R3-8 (SDK en `tools/ai-harness/`), R3-15 (harness V3–V4 / CI).
**Descartado**: RL, DL, minimax, predicción del siguiente pick, *counterfactual winrate*, MCMC/Stan en prod, LangGraph/CrewAI/AutoGen, Memory MCP.

---

## 8. Trazabilidad — regla mecánica (nada se pierde en silencio)

Cada idea de §2/§3/§4 tiene un ID estable (`R1-1` … `R3-15`). Ese ID **debe aparecer** en el
artefacto que la consume, según su disposición:

| Disposición | Dónde tiene que aparecer el ID | Verificación |
|---|---|---|
| **CORE** | En el cuerpo de al menos un ticket `docs/agents/tasks/TSK-XXX.md` de Fase 9 (campo o texto "implementa: Rx-y"), y antes en `architecture.md §Fase 9` / `SPEC.md §15`. | Al cerrar `/rulebook`: toda fila CORE de este doc tiene ≥1 ticket que la nombra. Si alguna no, o se degrada a DIFERIDO con motivo, o falta un ticket. |
| **DIFERIDO** | Una línea en `docs/agents/PROGRESS.md` (sección "Diferido post-Fase 9") o un ticket `state: backlog` con su ID y la condición que lo desbloquea. | Nunca desaparece: si no está en un ticket, está en PROGRESS con fecha. |
| **DESCARTADO** | Un ADR en `docs/adr/` **o** la sección "Fuera de alcance" de `SPEC.md §15`, con el motivo (1–2 líneas). | El `/blueprint` lista los 8 descartes con su razón; no se omite ninguno "por obvio". |

**Cierre de Fase 9**: este documento se revisa una última vez — cada ID CORE marcado `done` con el
TSK que lo entregó, cada DIFERIDO con su ubicación, cada DESCARTADO con su ADR/sección. Recién ahí
el documento pasa de "entrada de planificación" a "registro histórico" y no se toca más.

---

## 9. Refinamientos del `/pre-flight` (2026-08-29, Sonnet)

Decisiones que ajustan disposiciones de §2/§3/§4. La fuente formal es `architecture.md §Fase 9`.

- **Estructura**: programa **9.0→9.5**, 9.0 (fundación de evaluación) bloqueante — se mergea y
  valida antes de tocar cualquier fórmula de scoring. (Confirma R2-16.)
- **RAW_RANGE (R1-1/R1-2/R2-5)**: dirección comprometida a percentiles empíricos; el **cutover
  exacto ocurre en el gate de 9.1** con la pendiente efectiva real de las 6 señales medida en 9.0.
  Se registra en un ADR.
- **Harness (R3)**: **paquete completo** — además de `eval/` + `docs/adr/` +
  `data/{curated,generated,metadata}/` + hook anti-sobreescritura, entra `write_scope` por ticket
  + hook de scope + 2 agentes nuevos (`evaluation-engineer`, `data-stat-engineer`) + partir
  `CLAUDE.md` moviendo los bloques `## REGLAS DE FASE X` a `.claude/rules/fase-N.md` (reversible,
  cero cambio de contenido). Sube R3-3/R3-6/R3-10 de "CORE parcial" a "CORE".
- **EvidenceCoverage / GuessingIndex (R1-5)**: se construye la métrica en 9.x (backtest + logs);
  **mostrarla en la UI es follow-up**, decisión posterior al QA. No agrega diseño de UI al camino
  crítico.
- **Métrica titular — corrige R1-8/R1-9/R2-14**: dos benchmarks separados.
  1. **Engine Quality** (principal) sobre el Golden Dataset graduado: titular **NDCG@5**,
     acompañantes obligatorios **Bad Pick Rate@5** y **Pairwise Accuracy**. NDCG@5 sí aplica acá
     porque hay relevancia graduada (varios `excellent`/`acceptable`) — la objeción de R1-8 valía
     para el backtest de un solo pick relevante, no para esto.
  2. **Professional Pick Agreement** (secundario) sobre los 2.179 drafts pro: Recall@1/3/5/10 +
     MRR. Se puede comunicar "Professional Pick Agreement @3" — **nunca** "accuracy" ni "qué tan
     bueno es el motor". El pick pro observado **no es ground truth** (hero pool, comfort, scrims,
     estrategia no observable).
  Ambos benchmarks se reportan **segmentados por contexto de decisión** (opening / blind response
  / response / closing) — un promedio global esconde fallos por contexto.
- **Golden Dataset**: ~30 estados para el MVP, **estratificados y de alto valor** (no aleatorios),
  cubriendo opening/blind/response/closing + hard counter, flexibilidad, role scarcity, team
  needs, composición, punishability y escenarios donde el motor falló históricamente. **Multi-label**:
  varios héroes `excellent`/`acceptable`/`bad` por estado + `reasoning tags`. Prioridad: cobertura
  estratégica y detección de regresiones, no significancia estadística. Escala a 60/100+ tras
  validar harness y esquema de labels. **9.0 incluye una herramienta de selección asistida** de
  los estados más informativos a partir de drafts reales + escenarios sintéticos — el usuario no
  los inventa todos a mano.
- **Backfill Dire (TSK-174/179)**: el backtest de 9.0 **no espera** — tolera el corpus actual
  (2.179 drafts, slots Dire incompletos) reportando por completitud de slot; se re-corre cuando
  TSK-179 aterrice.
- **Precondición**: commitear Fase 8 (TSK-183→192 + fix `validation.ts`) antes de arrancar 9.0 —
  el baseline "V6-medido" necesita un árbol limpio.

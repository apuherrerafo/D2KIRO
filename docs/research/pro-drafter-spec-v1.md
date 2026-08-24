# Pro-Drafter Engine Specification v1.0

> Documento de investigación (`docs/research/`), no de contrato (`docs/specs/`). No pasó por
> `/pre-flight` ni `/blueprint` — es insumo para una futura ejecución de ambos, no una
> especificación cerrada. Ningún número ni interfaz de acá es vinculante para `apps/engine` hasta
> que pase por ese proceso. Ver `CLAUDE.md` §"Fase 4" para el estado real y activo del motor hoy
> (`SCORING_WEIGHTS_V5`, sub-ticket 4.1 de `archetype_fit`).

## 1. Executive Summary & Runtime Constraints

- **Target Latency:** < 10ms end-to-end execution per pick query.
- **Environment:** Pure TypeScript / Bun local execution, SQLite local database, zero hot network
  calls — mismo principio ya vigente en `apps/engine` ("cero red en el camino caliente"), no una
  relajación nueva.
- **Architectural Pillars:**
  1. Compositional Similarity (Pro Drafts KNN / RAG via Inverted Index).
  2. Stochastic 2v2 Lane Phase Simulator (5-Dimension Interactions).
  3. Rival Intent Decoder & Flex-Pick Inferrer (Bayesian Belief Propagation).
  4. Offline Weight Auto-Tuning Pipeline (Top-3 Softmax Loss Calibration).

Cada pilar es candidato a `SignalScorer` nuevo (contrato S3) o a capa paralela (estatus de
`draft-paths/`, fuera de `SCORING_WEIGHTS_*`) — cuál de las dos cosas es cada uno se decide en
`/blueprint`, no acá.

---

## 2. Component Specifications & Mathematical Models

### 2.1 Compositional Similarity: Inverted Index Weighted Jaccard

- **Algorithm:** Inverted index de bitmasks hero/tag con distancia Jaccard ponderada por rol,
  sobre un corpus de drafts profesionales (picks/bans agregados, dato público, sin PII).
- **Formula:**

  $$\text{sim}(D, C) = \frac{\sum_{i \in D \cap C} w_i}{\sum_{i \in D \cup C} w_i}, \quad w_i = \alpha_{\text{role}} \cdot \beta_{\text{hero}} \cdot \gamma_{\text{side}}$$

- **TypeScript Interface Contract:**

  ```typescript
  interface DraftCandidate {
    readonly draftId: string;
    readonly patch: string;
    readonly radiantHeroes: readonly HeroId[];
    readonly direHeroes: readonly HeroId[];
    readonly winningSide: "radiant" | "dire";
  }

  interface InMemoryDraftIndex {
    readonly corpusSize: number;
    readonly patch: string;
    readonly postings: ReadonlyMap<HeroId, Uint32Array>;
    candidatesFor(partialDraft: readonly HeroId[]): readonly DraftCandidate[];
  }

  interface WeightedJaccardEngine {
    similarity(own: readonly HeroId[], c: DraftCandidate, w: JaccardWeights): number;
    nearestNeighbors(
      own: readonly HeroId[], k: number, w: JaccardWeights,
    ): readonly { candidate: DraftCandidate; sim: number }[];
  }

  interface JaccardWeights {
    readonly alphaRole: (heroId: HeroId, position: 1 | 2 | 3 | 4 | 5) => number;
    readonly betaHero: (heroId: HeroId) => number;
    readonly gammaSide: (side: "radiant" | "dire") => number;
  }
  ```

- **Target Latency:** 0.9 ms – 1.8 ms for up to 5,000 active candidates.

### 2.2 2v2 Lane Phase Stochastic Simulator

- **Vector Attributes (5D per hero):**

  $$\vec{h} = [\text{Sustain}, \text{KillPressure}, \text{HarassRange}, \text{DispelSave}, \text{CreepControl}] \in [0, 1]^5$$

  Curado a mano por héroe — mismo patrón de fuente que `capabilities.json`/`hero-positions.json`:
  archivo estático versionado, validado en el borde, nunca SQLite ni red.

- **Lane Score Function:**

  $$\text{LineScore}(A_1, A_2, E_1, E_2) = \sigma\left(\sum_{k=1}^5 \omega_k \cdot \Phi_k(A_1, A_2, E_1, E_2)\right)$$

- **TypeScript Interface Contract:**

  ```typescript
  interface HeroLineProfile {
    readonly heroId: HeroId;
    readonly sustain: number;
    readonly killPressure: number;
    readonly harassRange: number;
    readonly dispelSave: number;
    readonly creepControl: number;
  }

  interface LaneInteractionResult {
    readonly laneScore: number; // [0,1], >0.5 favorece al par propio
    readonly perDimension: Readonly<Record<
      "sustain" | "killPressure" | "harassRange" | "dispelSave" | "creepControl", number
    >>;
    readonly confidence: "full" | "partial_signals";
  }

  function evaluateLane2v2(
    ally: readonly [HeroLineProfile, HeroLineProfile],
    enemy: readonly [HeroLineProfile, HeroLineProfile],
    weights: readonly [number, number, number, number, number],
  ): LaneInteractionResult;
  ```

- **Nota de alcance:** asume asignación de línea 2v2 ya resuelta. Inferir esa asignación durante
  el draft es un problema distinto, fuera de este documento.

### 2.3 Rival Intent Decoder & Flex-Pick Denial Engine

- **Bayesian Model:** Belief propagation sobre posiciones 1..5 para cada héroe rival sin rol
  confirmado ("flex pick").
- **Denial Score Formula:**

  $$\text{DenialScore}(h^*, F) = \sum_{p} P(\text{Pos}_F = p) \cdot \text{MatchupWinrate}(h^*, F, p) + \beta \cdot \text{EarlyPressure}(h^*) \cdot H(F)$$

  $H(F)$ es la entropía de la distribución de posición del héroe flex.

- **TypeScript Interface Contract:**

  ```typescript
  interface PositionDistribution {
    readonly heroId: HeroId;
    readonly probabilities: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>;
    readonly entropy: number; // bits, 0 = certero, log2(5) ~= 2.32 = máxima incertidumbre
  }

  interface FlexInferenceResult {
    readonly rivalHeroId: HeroId;
    readonly distribution: PositionDistribution;
    readonly isFlex: boolean;
  }

  function calculateDenialScore(
    candidateHero: HeroId,
    flexHero: FlexInferenceResult,
    matchupWinrate: (a: HeroId, b: HeroId, position: 1 | 2 | 3 | 4 | 5) => number | null,
    earlyPressure: (heroId: HeroId) => number,
    beta: number,
  ): number;
  ```

- **Dependencia no resuelta:** `MatchupWinrate` por posición requiere matchups segmentados por
  rol — dato que el proyecto no sincroniza hoy (misma dependencia condicional de STRATZ ya
  documentada desde fase 1b). Este pilar la hereda, no la resuelve.

### 2.4 Offline Weight Auto-Tuning Pipeline

- **Loss Function:** Top-3 Softmax Cross-Entropy con regularización L1/L2:

  $$\mathcal{L}(\mathbf{w}) = -\frac{1}{N} \sum_{d \in D} \log \left( \frac{\sum_{k \in \text{Top3}} \exp(S(h_k^* \mid \mathbf{w}))}{\sum_{j=1}^{120} \exp(S(h_j \mid \mathbf{w}))} \right) + \lambda_1 \|\mathbf{w}\|_1 + \lambda_2 \|\mathbf{w}\|_2^2$$

  $D$ es el corpus profesional de 2.1; $h_k^*$ son los picks reales del draft.

- **Export Format:** JSON de pesos pre-calculados, consumible por `apps/engine` en $O(1)$ —
  **nunca reemplaza** `SCORING_WEIGHTS_V5` directamente. Propone una versión candidata
  (`SCORING_WEIGHTS_V6` hipotética); promoverla a activa sigue siendo decisión manual con su
  propio `/blueprint`.

- Corre fuera de `apps/engine`, a mano, en la máquina del desarrollador — mismo estatus que el
  regenerador de `hero-positions.json` (Fase 3): nunca programado, nunca automático.

---

## 3. Integration Pipeline & Execution Flow

Pipeline secuencial en runtime (< 3.2 ms promedio total), dentro del mismo proceso `apps/engine`,
sin I/O de red en ningún paso:

```
Input State
    -> Feature Extractor        (DraftState -> vectores 5D por héroe candidato)
    -> KNN Matcher               (S2.1 -- similitud contra corpus profesional, top-K)
    -> Lane Simulator             (S2.2 -- evaluateLane2v2 sobre líneas conocidas/inferidas)
    -> Flex Intent Engine         (S2.3 -- calculateDenialScore sobre flex picks rivales)
    -> Weighted Signal Merger     (mismo mecanismo de mix.ts: raw -> [0,1] -> ponderado;
                                    raw:null se redistribuye proporcionalmente)
    -> Top 3 Recommendations
```

Cada pilar (2.1–2.3) entra como `SignalScorer` (S3: función pura, nunca I/O, una excepción
capturada no tira el motor) o como capa paralela no ponderada — decisión de `/blueprint`, por
pilar. El pipeline de auto-tuning (2.4) no aparece acá: no corre en el camino caliente, es insumo
para los pesos, no un paso de la ejecución por pick.

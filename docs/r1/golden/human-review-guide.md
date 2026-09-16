# R1 Golden v1 — guía de revisión humana (32 quality cases)

**Estado:** ninguno de los 32 casos de `quality-cases-template.json` tiene todavía una revisión
humana. Este documento es el protocolo que un revisor calificado sigue para cerrarlos —
`scripts/r1/certify.ts` nunca cuenta un caso como revisado sin que el archivo tenga, para ese
`id`, un objeto `humanReview.reviewerSignoff` completo (ver §4 abajo).

## 0. Qué NO es esto

- No es LLM-as-judge. Un panel de modelos etiquetando estos 32 casos (aunque sea "para ayudar")
  no cuenta como revisión humana bajo ningún concepto — la corrección del usuario que abrió este
  slice es explícita en este punto. Si en algún momento se usa un LLM como *apoyo* de lectura
  (por ejemplo, para resumir un `RecommendationSet/v2` largo), el campo `reviewerSignoff` debe
  igual reflejar una persona real que leyó, decidió y firma — nunca el modelo.
- No es el Golden Dataset de Fase 9 (`eval/golden/dataset.json`, 30 casos, panel de LLMs,
  TSK-206). Ese dataset mide el motor V6 offline sobre drafts profesionales reales; éste mide la
  calidad de producto de R1 (protocolo + RecommendationSet/v2 + UI) sobre estados sintéticos
  deterministas. Son dos artefactos distintos, con dueños distintos, que no se sustituyen entre sí.

## 1. Quién puede revisar

Un revisor calificado es alguien con:
- Conocimiento profundo y actual de Dota 2 competitivo (drafting, matchups, roles/flex, el parche
  vigente del proyecto — ver `CURRENT_PATCH` en `apps/engine/src/server/routes/meta.ts`).
- Capacidad de leer un `RecommendationSet/v2` crudo (JSON) sin necesitar la UI — la revisión
  evalúa la RECOMENDACIÓN real que el motor calculó, no una paráfrasis de segunda mano.

No hace falta ser parte del equipo de ingeniería del proyecto. Sí hace falta declarar identidad
real (§4) — nunca un revisor anónimo.

## 2. Cómo reproducir el estado de un caso

Cada entrada de `quality-cases-template.json` tiene un `sourceSpec` — una receta determinista,
no un blob pre-capturado. Para materializarla:

1. **Casos AP** (`ruleset: "dota2/ranked-all-pick"`): abrir `/simulator` (vía `bun run dev:mvp` o
   el harness E2E), elegir Ranked All Pick, `partySize` y `localSide` según el `sourceSpec`, y
   escribir el `seed` exacto en el campo "Semilla del draft". Jugar hasta el punto que describe
   `step` (por ejemplo "segundo slot de ronda 1, nada revelado del rival todavía" = clickear un
   héroe y detenerse antes del segundo). El estado y el `RecommendationSet/v2` que ve la UI en ese
   punto exacto es el que se revisa.
2. **Casos CM** (`ruleset: "dota2/captains-mode"`): mismo simulador, modo Captain's Mode,
   `localSide`/`firstPickSide` según el `sourceSpec`, jugar hasta el `step` (número de paso)
   descrito.
3. El `RecommendationSet/v2` completo es visible haciendo `GET
   /engine/api/session/protocol/:sessionId/recommendations` mientras la sesión está en ese punto
   (mismo request que el Copilot ya hace) — es la fuente de verdad para la revisión, no una
   captura de pantalla.

Esto es intencional: el paso de captura queda para cuando un revisor humano real esté disponible,
en vez de que este agente fabrique 32 snapshots congelados que nadie verificó.

## 3. Qué evalúa la revisión (por caso)

Para el `recommendations[0]` (la recomendación top-1) del estado reproducido:

| Campo a completar | Qué responde |
|---|---|
| `verdict` | `"excellent"` \| `"acceptable"` \| `"bad"` — juicio del revisor sobre si ES la jugada correcta en ese momento del draft, no si el número de `score` es alto. |
| `dotaJustification` | 2–4 oraciones, en términos de Dota real (curva de poder, línea, timing de objetivos, composición) — nunca una paráfrasis del texto que ya genera el motor. |
| `intendedPositions` | Qué posición(es) 1–5 tendría sentido para el héroe recomendado en este draft, independientemente de lo que diga `roleImpact` — el revisor decide primero, después compara. |
| `roleImpactAgreement` | `"agrees"` \| `"disagrees"` \| `"partially"` — ¿el `roleImpact` que el motor calculó coincide con el juicio del revisor en `intendedPositions`? |
| `opponentResponseAssessment` | Si `deferred.opponentResponse` trae una acción: ¿es una respuesta plausible de verdad para un rival competente, o es ruido? `"plausible"` \| `"implausible"` \| `"not_applicable"` (NOT_COMPUTED/NO_LEGAL_RESPONSE). |
| `stealEvidenceAssessment` | Si `deferred.steal.status === "MATERIALIZED"`: ¿el héroe robado era de verdad valioso para el rival en ese punto, o es un falso positivo? `"real_steal"` \| `"false_positive"` \| `"not_applicable"`. |
| `risksAssessment` | Por cada entrada de `recommendations[0].risks`: ¿el riesgo señalado es real y relevante, o ruido? Lista de `{ kind, agrees: boolean, note }`. |
| `notes` | Cualquier otra cosa que un lector futuro necesite para entender el veredicto. |

**Regla dura:** si `verdict` es `"bad"`, `dotaJustification` es obligatorio y debe explicar
específicamente QUÉ hubiera sido mejor — un "bad" sin alternativa concreta no es una revisión
útil, se devuelve al revisor.

## 4. Identidad y firma del revisor (obligatorio, sin excepción)

Cada caso revisado agrega, dentro de su objeto `humanReview`, un `reviewerSignoff`:

```json
{
  "reviewerName": "Nombre real, verificable",
  "reviewerContact": "email o método de contacto real",
  "reviewedAt": "2026-MM-DDTHH:MM:SSZ",
  "reviewMethod": "manual_dota_expert_review",
  "sourceStateHash": "<stateIdentity o perspectiveIdentity del RecommendationSet/v2 revisado, tal cual lo emitió el motor>",
  "signatureNote": "Confirmo que revisé el RecommendationSet/v2 real de este caso, en el estado descrito por sourceSpec, y que el verdict/justificación de arriba son mi juicio, no el de un modelo de lenguaje."
}
```

`sourceStateHash` es lo que ata la revisión a un estado EXACTO (nunca "un draft parecido") —
usa `stateIdentity`/`perspectiveIdentity`, los mismos hashes deterministas que ya expone
`RecommendationSet/v2.basedOn` (identity-hash.ts). Un caso sin `sourceStateHash` no es
verificable y no cuenta como cerrado.

## 5. Cuándo el conjunto de 32 cuenta como completo

`qualityGolden` pasa de `HUMAN_GATE` a `PASS` únicamente cuando los 32 casos de
`quality-cases-template.json` tienen `humanReview` no nulo con `reviewerSignoff` completo —
verificado mecánicamente por `scripts/r1/golden-status.ts` (ver `docs/r1/golden/schema.md`).
Un subconjunto revisado (por ejemplo 20/32) sigue reportando `HUMAN_GATE`, nunca `PASS` parcial —
"casi completo" no es lo mismo que completo, y este programa no inventa un umbral de aprobación
parcial que nadie pidió.

# Política híbrida de revisión (opción B, decidida por el propietario el 2026-11-13)

**R-001 sigue ABIERTO y NO aceptado (issue #130).** Esta política no lo cierra ni lo acepta: lo hace explícito y limita dónde puede usarse una revisión solo-Claude.

## Qué es cada cosa
- **Revisión INTERNA**: una pasada de Claude con contexto nuevo (sin historial del autor), con un prompt versionado en `docs/reviews/prompts/`. Comparte modelo y puntos ciegos con quien escribió el código. **Nunca se llama "independiente".** Registro: `reviewer.provider = "claude-internal"`, con `promptId`, `promptSha256` e `isolation: "fresh-context"`.
- **Revisión independiente**: otro proveedor (`openai`, `google`, ...) o una persona (`human:<login>`). Un registro `anthropic` cuenta como la **misma familia que Claude**.

## Reglas (las aplica `scripts/ci/verify-review-evidence.ts`, leyendo política y prompts de la rama predeterminada, nunca del PR)
| Cambio | Exigido |
|---|---|
| **Estándar** (resto) | 2 familias distintas, **o** 2 pasadas internas con prompts distintos (`security` y `correctness`). Si pasa solo por internas, el gate lo dice: "INTERNA, no independiente". |
| **Crítico** (autenticación, scoring activo, CI/compuertas/hooks, secretos de arranque, la propia política y sus prompts) | Al menos **un revisor externo a Claude** (otro proveedor o `human:<login>`) **más** una pasada Claude. Dos pasadas internas **no** bastan. |

Rutas críticas: `docs/reviews/policy.json` (`criticalPaths`). Cambiar la política o un prompt es, a su vez, un cambio crítico.

## Qué garantiza y qué no
- Garantiza: la evidencia está ligada al diff exacto y al head vigente (hash recalculado con git), el prompt es el versionado en `master` (hash), la salida cruda es íntegra y sus hallazgos coinciden con el registro.
- **No** garantiza independencia ni que Claude no tenga un punto ciego. No autentica quién escribió la salida cruda (R-001).
- Sin política válida en `master` el verificador cae a la regla anterior (2 proveedores distintos). Nunca se relaja en silencio.

## Cómo registrar una pasada interna
```
bun run scripts/ci/record-review.ts --internal security --tool "claude-code" --model <id> --raw <salida> --base <sha-base>
bun run scripts/ci/record-review.ts --internal correctness --tool "claude-code" --model <id> --raw <salida> --base <sha-base>
```
Cada pasada se lanza en un subagente nuevo cuyo prompt es exactamente el archivo versionado.

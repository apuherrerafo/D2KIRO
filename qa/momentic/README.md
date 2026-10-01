# Momentic Product Oracles

Definiciones deterministas de los oráculos de producto contra staging. Todo lo versionado aquí es
no secreto; el estado de autenticación vive **fuera** del repo.

## Categoría: validación del producto desplegado, no suite hermética

Estos oráculos usan **red real contra el deploy de staging** a propósito: validan el producto
desplegado, igual que `bun run qa:staging-smoke`. Es la excepción acotada que define
`.claude/rules/invariantes.md` (sección Pruebas) a "cero red real" — que sigue rigiendo sin
excepción para toda la suite hermética de `bun run test`.

- Se corren **sólo** con un comando explícito (ver "Correr"); `bun run test` nunca los ejecuta.
- El estado de auth y cualquier secreto quedan fuera del repo.

## Qué está versionado

- `momentic.config.yaml` (raíz) — configuración del proyecto Momentic, genérica.
- `qa/momentic/modules/authenticated-staging.module.yaml` — carga el estado de auth y abre `/simulator`.
- `qa/momentic/product-oracle/*.test.yaml` — los oráculos.

## Qué NO está versionado (a propósito)

`.qa-auth/staging-storage-state.json` — cookies reales de sesión (Steam + `d2k_session`).
Está en `.gitignore`. Nunca se commitea, ni se copia a otro lugar del repo.

## Bootstrap de auth (una vez por máquina, o cuando expira la sesión)

```
bun run qa:staging-auth
```

Abre un navegador en `/login` de staging; iniciá sesión con Steam. Al detectar sesión válida escribe
`.qa-auth/staging-storage-state.json`. En un checkout/worktree nuevo, copiá ese archivo al mismo
path relativo (`<raíz del repo>/.qa-auth/`) antes de correr los tests.

## Correr

```
npx momentic run qa/momentic/product-oracle/party5-first-human-pick.test.yaml
npx momentic run qa/momentic/product-oracle/party5-single-decision-surface.test.yaml
```

Sin `--auto-heal`: los oráculos deben fallar si el producto se desvía, no repararse solos.
`momentic` no es dependencia del repo; `npx` lo resuelve al ejecutar.

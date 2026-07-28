# MEMORY.md — vista comprimida y regenerable de `journal.md`

Regenerado por `/helm` el 2026-07-28 a partir de `journal.md` completo (238 líneas, eventos
evt-20260726-001 a evt-20260727-067). Esta vista es descartable y regenerable — la fuente de
verdad sigue siendo `journal.md` (append-only, nunca se comprime ni se borra).

## Estado del proyecto

**Los 15 tickets de fase 1 (TSK-001 a TSK-015) están `done`.** Backlog de fase 1 en cero. El
camino completo existe y está verificado de punta a punta contra procesos reales corriendo (no
solo pruebas unitarias): capturador (simulador + entrada manual) → reductor puro → motor de
sugerencias → servidor Bun (HTTP + WebSocket) → vista de draft en vivo + páginas del sitio.

## Arquitectura construida (por pieza)

- **C2 — Reductor** (`apps/engine/src/draft/reducer.ts`, TSK-004 + fix de TSK-013):
  `applyDraftEvent` puro, contrato `draft-event/v1`. `quality.unconfirmed` se popula cuando
  `confidence < 0.6` (gap real de SPEC.md línea 127 que TSK-004 no cubrió originalmente, cerrado
  en TSK-013).
- **C3 — Motor de sugerencias** (`apps/engine/src/signals/`, TSK-005 a TSK-009): 4
  `SignalScorer` (`counter` 0.40, `patch_meta` 0.25, `team_synergy` 0.20, `role_gap` 0.15,
  `SCORING_WEIGHTS_V1` suma 1.0 verificado) + `mix.ts` (candidatos → mezcla con redistribución
  proporcional de peso en `null` → orden top-3 → explicación). `MetaSnapshot` se definió aquí por
  primera vez (no existía en SPEC.md como interfaz concreta) y creció de forma aditiva con cada
  señal (matchups → patchStats → roles).
- **C4 — Persistencia** (`apps/engine/src/db/`, TSK-002 + `meta/`, TSK-003 +
  `meta/provider.ts`, TSK-015 + `db/queries.ts` settings, TSK-014): esquema Drizzle/SQLite,
  sincronización con OpenDota, puente SQLite→`MetaSnapshot` (hueco real dejado por TSK-002,
  cerrado como TSK-015), y `settings` (tabla existía desde TSK-002 sin rutas hasta TSK-014).
- **Servidor Bun** (`apps/engine/src/server/`, TSK-010 + fix CORS de TSK-014): 8 rutas HTTP +
  `/ws/draft`, token de captura generado en runtime, rate limit 20 eventos/seg, validación de
  `DraftEventEnvelope`/`ClientMessage` en el borde, CORS con allowlist localhost-only
  (`corsHeaders()` en `apps/engine/src/server/app.ts`).
- **apps/web** (TSK-012 a TSK-014): vista de draft en vivo (6 estados S5, WebSocket + Zustand,
  única excepción a RTK Query), entrada manual + camino de degradación, 3 páginas normales del
  sitio con RTK Query real (`/meta`, `/heroes`, `/settings`).
- **Simulador** (`apps/engine/src/simulator/`, TSK-011 — construido en una sesión paralela
  dentro del mismo hilo): reproduce guiones de draft grabados (Captain Mode + All Pick) emitiendo
  el contrato real hacia `/ingest/draft-event`.

## Patrones operativos establecidos

- **Codex sin créditos, confirmado 2/2 en TSK-002/003** → desde TSK-004 en adelante, todo ticket
  con `preferred_tool: codex` se asigna directo a `claude-code` sin pasar por el ciclo
  dispatch-Codex-Handoff (ahorra una vuelta innecesaria; ver `[[user_frontend_conventions]]`
  para el resto de convenciones del usuario).
- **Excepción de 200 líneas**: cuando un ticket la va a superar, `@build` pregunta ANTES de
  empezar (`AskUserQuestion`) — la respuesta consistente del usuario ha sido "completo, pedir
  excepción al cerrar" (TSK-003/004/009/010/012/013/014). Nunca asumir la respuesta de antemano.
- **Gaps de planificación descubiertos en construcción, no al crear el ticket** → se presentan al
  usuario con `AskUserQuestion` (arreglar dentro del ticket actual vs. crear uno aparte).
  Precedente: TSK-015 (SqliteMetaProvider, se creó ticket aparte), gap de `unconfirmed` (TSK-013,
  se arregló dentro), gap de `settings` (TSK-014, se arregló dentro).
- **"Verificar por ejecución" significa reproducir las condiciones reales del cliente, no solo
  que el servidor responda** — lección explícita de TSK-014: un smoke test con `curl` no detecta
  problemas de CORS porque `curl` no aplica same-origin policy; hace falta simular un navegador
  real (cabecera `Origin`) para que un hallazgo así aparezca. Ese patrón de prueba quedó fijado
  en `apps/engine/src/server/app.test.ts` (3 tests de CORS explícitos, origin local/remoto).

## Hallazgos de seguridad reales de `@redteam` (todos resueltos, ninguno pendiente)

1. **TSK-003** — URL de imagen de héroe vulnerable a host-injection `userinfo@host`
   (`@evil.example/x`). 2 rondas, corregido con `SAFE_RELATIVE_IMG_PATH`.
2. **TSK-010** — mensaje WebSocket (`hello`) confiado con un cast `as` sin validar runtime;
   `sessionId` no-string podía corromper un `DraftState`. 2 rondas, corregido con
   `isValidClientMessage`.
3. **TSK-012** — mismo patrón que TSK-010 pero del lado cliente (`store.ts`), combinado con
   ausencia total de error boundary en `apps/web` → riesgo real de pantalla en blanco. 2 rondas,
   corregido con `validation.ts` + `app/draft/error.tsx`.
4. **TSK-014** — `apps/engine` no mandaba headers CORS ni manejaba `OPTIONS`: ninguna de las 3
   páginas nuevas habría funcionado desde un navegador real pese a que todo el resto de las
   pruebas pasara limpio. Corregido con un allowlist localhost-only (`ALLOWED_ORIGIN_PATTERN =
   /^http:\/\/(127\.0\.0\.1|localhost):\d+$/`), nunca un origin remoto.

## Gaps de infraestructura del propio ecosistema, corregidos en el camino

`scripts/verify-simplicity.sh` tuvo **4 rondas de fixes reales**, todos con `@redteam`/aprobación
del usuario:
1. `git diff ... HEAD` abortaba en un repo sin commits (TSK-001).
2. Ciego a archivos untracked — el gate de archivos/líneas era un no-op para código nuevo
   (TSK-002).
3. Sección de secretos (4) seguía ciega a untracked incluso después del fix #2, porque el fix de
   archivos/líneas nunca se replicó ahí (encontrado y corregido en TSK-010).
4. Sección de dependencias apuntaba a un `package.json` de raíz que no existe en este monorepo —
   nunca se había disparado desde TSK-001 (encontrado y corregido en TSK-012).

Otros bugs reales de infraestructura (no del gate) encontrados durante smoke tests:
- `db/client.ts` no creaba el directorio `data/` contenedor → el servidor nunca arrancaba en un
  checkout limpio (TSK-010, `mkdirSync(dirname(DB_PATH), { recursive: true })`).
- `db/migrate.ts` tenía el mismo bug que `client.ts` pero en un archivo separado que no
  reutilizaba el fix (encontrado en TSK-014, corregido reusando `db/client.ts`).
- El patrón clásico `useRef` para inicializar un store de Redux una sola vez dispara
  `react-hooks/refs` en la versión de este proyecto — corregido con `useState(() => ...)`
  (TSK-014; `apps/web/AGENTS.md` ya advertía sobre breaking changes de esta versión de Next.js).

## Decisiones de diseño no especificadas en SPEC.md, documentadas para referencia futura

- `unknown_hero` (reductor) valida solo forma (entero positivo) — no tiene catálogo de héroes
  inyectado. La validación real contra el catálogo sigue sin dueño explícito (candidato: ingesta
  S1 o el paso CANDIDATOS de C3).
- `weighted` de cada `SignalContribution` siempre es `0` — la mezcla/redistribución real es
  responsabilidad exclusiva de `mix.ts` (TSK-009), nunca de un scorer individual.
- "Bracket bajo/medio" (patch_meta) = mitad inferior de la escalera de 8 de OpenDota
  (herald/guardian/crusader/archon), sin taxonomía oficial de Valve.
- Mapeo de las 5 capacidades de `team_synergy` a `roles[]` de OpenDota (control→Disabler,
  iniciación→Initiator, aguante→Durable, empuje→Pusher, soporte→Support) — decisión de producto
  sin fuente oficial.
- `RAW_RANGE` de `mix.ts` (rangos de normalización 0-100 por señal) — calibración razonada, no
  medida contra datos reales de producción todavía.
- CORS: el binding a `127.0.0.1` sigue siendo el perímetro de seguridad real; el allowlist de
  origin solo destraba la llamada cross-port legítima de `apps/web`, nunca un origin remoto.

## Notas abiertas / deuda técnica conocida (ninguna bloqueante)

- I/O repetida de meta (`buildMetaSnapshot`+`getMetaFreshness`) en cada evento de draft aceptado
  — candidato de optimización futura (cachear `MetaSnapshot`), no duele hoy en SQLite local.
  (TSK-010)
- `runSimulator` no valida que `speed` sea positivo (`speed: 0` colgaría `sleep` para siempre) —
  no explotable hoy porque no hay punto de entrada externo (CLI/HTTP) que reciba `speed` desde
  fuera. (TSK-011)
- Sin auditoría formal de `ux-senior` en ningún ticket de frontend — el agente exige un archivo
  de "screen contract" local que no existe todavía (candidato para Fase 2 de `/design-forge`).
  (TSK-012+)
- Botón "Corregir" (picks sin confirmar) no tiene estado de error visible propio si la corrección
  falla por red — se registra en consola, decisión de alcance proporcional. (TSK-013)
- Componentes de página de TSK-014 no tienen pruebas con librería de renderizado de React (mismo
  criterio que TSK-012/013: evita otra dependencia nueva) — verificados con smoke tests reales
  contra el servidor vivo.

## Referencias

Ver `[[user_frontend_conventions]]` y `[[dota2coach-overwolf-stack]]` en la memoria de usuario
para preferencias de stack ya confirmadas (Next.js App Router se mantiene, no Vite+React).

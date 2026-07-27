# CHANGELOG — Ecosistema Caveman

## v1.1.0 — Cierre de ciclo profesional

### Añadido
- **Agente nuevo: Sentinel** (`claude-sonnet-5`) — gate de seguridad obligatorio antes de deploy. Rol "revisa", bloqueante.
- **Skill nueva: `/castoff`** — gate de pre-deploy: seguridad, dependencias, migraciones, variables de entorno, confirmación explícita antes de desplegar.
- **Bloque 4 de seguridad en `/pre-flight`** — la seguridad se decide en el diseño, no se añade al final.
- **Gate de seguridad bloqueante en `@redteam`** — antes era 1 de 5 dimensiones ponderadas; ahora es un check binario que rechaza de inmediato si falla, independientemente de las demás.
- **`journal.md`** como fuente de verdad append-only para la memoria (sustituye la edición directa de `MEMORY.md`).
- **Check WIP=1** en `scripts/verify-simplicity.sh`.
- **Check append-only** para `journal.md` y `ledger.md` en `scripts/verify-simplicity.sh` (bloquea cualquier diff que borre líneas).
- **`scripts/hub.ts`** — tablero Kanban HTML generado en Bun sin dependencias, leyendo el frontmatter de los tickets como única fuente de verdad.
- Tabla de agentes con modelo y responsabilidad exacta en `CLAUDE.md` y `docs/SETUP.md`.
- Carpeta `skills-extra/` para utilidades opcionales no cargadas por defecto.

### Corregido
- Model strings inválidos en los 4 agentes originales (`claude-haiku-4-5-20250514` no existe; `claude-sonnet-4-20250514` desactualizado) → ahora `claude-sonnet-5` y `claude-haiku-4-5-20251001`.
- `scripts/verify-simplicity.sh`: `FILES_TOUCHED` no se calculaba, el conteo de líneas usaba una posición de campo frágil (`awk '{print $4}'`), y la detección de dependencias solo veía la aparición de la clave `dependencies`, no una línea añadida dentro de un bloque existente (falso negativo garantizado).
- Límite de líneas nuevas inconsistente entre `CLAUDE.md` (200) y `@build` (100) → unificado a 200, con `verify-simplicity.sh` como fuente única de verdad.
- `install.sh` detectaba el entorno (Kiro/Cursor/Claude Code) pero no generaba nada específico para Cursor o Kiro → ahora genera `.cursor/rules/caveman.mdc` y `.kiro/steering/*.md` de verdad.
- `install.sh` no era idempotente ni versionado (sobrescribía sin avisar, sin forma de saber qué versión había) → ahora usa `.setup-version` y pide confirmación en actualizaciones.
- Excepción de migraciones de Drizzle documentada explícitamente (antes chocaba de forma silenciosa con el límite de "1 archivo").

### Fusionado
- `@router` + `/dispatch` → una sola skill `/dispatch` con modo automático (antes `@router`) y modo manual.

### Eliminado
- `/mission-control` — prometía costes de tokens que el agente no puede conocer con precisión, y duplicaba `scripts/hub.ts`.

### Movido a `skills-extra/` (opcionales, no se cargan por defecto)
- `/teach-me`
- `/transcript-grab`
- `@clean-sweep`
- `/skillmap`

### Pendiente (decisión del usuario)
- Ejecutar la investigación de skills faltantes en repositorios reales (Matt Pocock, Adi Osmani, Superpowers, comunidad Claude Code) — ver prompt de investigación entregado en el mensaje de cierre.

## v1.2.0 — Cierre final

### Renombrado (neuromarketing, inglés)
Todos los agentes y skills core/extra pasaron de identificadores en español a nombres en inglés memorables, con un hilo temático náutico/de vuelo (helm, castoff, pre-flight, compass). Ver tabla completa en `docs/SETUP.md`. Sin cambios de comportamiento — solo identificadores y referencias cruzadas, verificado que no quedaron huérfanas.

### Añadido
- **`/compass`** — skill guía: mapa interactivo del ecosistema para cuando no te acuerdas qué usar. No ejecuta nada, solo orienta.
- **Política de modelos por niveles** en `CLAUDE.md`: Opus exclusivo de la cadena `/kickoff → /pre-flight → /blueprint`; todo lo demás en Sonnet sin excepción; regla simétrica para Codex/GPT.
- **Campo `tool`** en el frontmatter de cada ticket (`claude-code` / `codex` / `kiro-nativo`), asignado por `/grill-me`, visible como tag en `hub.ts`.
- **Patrón "Handoff"** en `/dispatch`: degradación controlada cuando se agotan créditos de una herramienta, con registro en `journal.md`.
- **`AGENTS.md`** generado automáticamente en `install.sh` como espejo portable de `CLAUDE.md`.
- Hook sugerido (no confirmado al 100%, documentado con la salvedad) para `.kiro/hooks/`.

### Rechazado explícitamente (con razón documentada)
- Escalar Security Auditor/Sentinel u otros agentes a Opus — decisión final: Opus vive solo en la cadena de planificación inicial, nunca en agentes que corren de forma continua.

## v1.3.0 — Ronda de revisión externa (DeepSeek, Kimi, Gemini, GPT)

### Estructural
- **Split `tool` → `preferred_tool` + `assigned_tool`**: la intención de `/grill-me` ya no es la decisión final; `/dispatch` decide `assigned_tool` justo antes de ejecutar según condiciones reales.
- **WIP=1 por `assigned_tool`, no global**: corrige una tensión real con el sistema multi-herramienta — Claude Code, Codex, Kiro nativo y Hermes pueden tener cada uno una tarea activa en paralelo.
- **Capa de 6 alias** (`/start /plan /build /fix /review /ship`) resuelta internamente por `/dispatch` — reduce la superficie que el usuario debe memorizar de 25 nombres a 6, sin duplicar skills.
- **Checklist de riesgo verificable para Opus**, consolidando Opus-Emergency + Blueprint v2 + gatillos adicionales (trust boundary, migración irreversible, auth/permisos, motor de DB, discrepancia SPEC/código).

### Seguridad
- **Independencia real de Sentinel**: entrada limitada al diff (no la conversación completa), presunción de inseguro por defecto.
- Gates específicos del stack: migraciones destructivas de Drizzle sin rollback, SQL crudo vía `db.execute()`, XSS de fragmentos HTMX, CORS wildcard en producción.
- **Checklist obligatorio de seguridad operacional para `/nightwatch`/Hermes** — usuario sin sudo, worktree aislado, límites de recursos, cero secretos de producción, salida solo como patch revisable, kill switch. El hueco más serio detectado en toda la revisión externa.

### Memoria y observabilidad
- `docs/agents/CHECKPOINT.json`: estado efímero separado de `journal.md` (cwd, comando de test, PID, hash de commit).
- `docs/agents/models.yaml`: checklist central de archivos a tocar cuando cambie un nombre de modelo (no es indirección real — límite técnico documentado).
- Partición de `journal.md` a los ~500 registros (`journal-YYYY-MM.md`), con `event:`/`schema:v1` por línea. `hub.ts` lee todas las particiones.
- `@root-cause`/`Tracer` ahora reciben contexto real de ejecución cuando el ticket viene de Codex, y un payload sintético (no crudo) al activarse tras 3 fallos.

### Diseño
- Tokens (`tokens.css`/clases daisyUI) obligatorios desde el día 1, no solo en Fase 2 — evita la deuda de inconsistencia visual.
- Transición Fase 1→2 redefinida: sobreescribir el theme, no migrar componentes uno por uno.
- Escalada opcional a Playwright+Docker para regresión visual real, sin imponerlo por defecto.
- Manejo explícito de estados de error en endpoints HTMX (`@build`).

### Verificado
- `crw-mcp` confirmado real en el registro de npm (v0.28.0, AGPL-3.0) — corrige el escepticismo previo basado en un repo con forma de placeholder.

### Descartado
- Wikilinks `[[...]]` estilo Obsidian — puramente cosmético para una app que el usuario no usa; cero beneficio funcional.

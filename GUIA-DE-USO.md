# Guía Práctica — Ecosistema Caveman

<!-- test/ci-indexing: cambio trivial para disparar el pipeline de CI (TSK-118). Sin contenido real. -->

**Si solo vas a recordar una cosa de este documento**: `/start` · `/plan` · `/build` · `/fix` · `/review` · `/ship` — y `/compass` cuando no sepas cuál toca. `/dispatch` decide internamente cuál de las 25 skills específicas corresponde. La tabla de abajo es la referencia completa para cuando quieras el detalle, no algo que tengas que memorizar.

## El flujo, de principio a fin

| Momento | Qué usar | Modelo |
|---|---|---|
| Ideas sueltas, sin proyecto todavía | `/start` (→ `/kickoff`) | Sonnet |
| Ya con brief, planificando arquitectura | `/plan` (→ `/pre-flight`, preguntas) | Sonnet |
| Arquitectura decidida, sintetizar | `/plan` (→ `/blueprint`) | **Opus — única vez en todo el proyecto** |
| Traducir spec a reglas ejecutables | `/plan` (→ `/rulebook`) | Sonnet |
| A partir de aquí, todo | Sonnet, sin excepción (salvo gatillo de riesgo, ver abajo) | Sonnet |
| Repo que YA existe, no es nuevo | `/start` (→ `/onboarding`) | Sonnet |
| Ideas divergentes sin filtrar | `/brainstorm` | Sonnet |
| Ideas a tickets con MoSCoW | `/grill-me` (asigna `preferred_tool` a cada ticket) | Sonnet |
| Ver el plan / cerrar sesión | `/helm` | Sonnet |
| No sabes qué hacer | `/dispatch` (decide solo) o `/compass` (te explica el mapa) | Sonnet |
| Vas a implementar | `/build` (→ `@build`, TDD: test que falla antes que el código) | Sonnet |
| Hay un bug | `/fix` (→ `@root-cause`, exige reproducción determinista) | Sonnet |
| Terminaste una tarea Must-have | `/review` (→ `@redteam`: Standards + Spec, gate de seguridad bloqueante) | Sonnet |
| Vas a cerrar y desplegar | `/ship` (→ `@shipcheck` → `/castoff`, invoca a Sentinel) | Sonnet |
| Algo falla 3 veces | Se activa solo: **Tracer** (con resumen del error, no el proyecto entero) | Sonnet |
| Sesión pesada / mucho contexto | `/evolve` (handoff a `journal.md` + `CHECKPOINT.json`, luego `/clear`) | Sonnet |
| Deuda técnica, código enredado | `/foundation-check` | Sonnet |
| Traer una página de referencia (UI/negocio) | `/scout` | Sonnet |
| Sin créditos en la herramienta asignada | Dilo directo: "no tengo créditos en X" — se reasigna sin fricción (patrón Handoff) | — |
| Trabajo largo que puede esperar a mañana | `/nightwatch` (solo si tú lo pides, nunca de oficio; checklist de seguridad obligatorio para Hermes) | — |

## Herramienta por ticket: intención vs. decisión real
Cada ticket tiene `preferred_tool` (lo que `/grill-me` propuso al crearlo) y `assigned_tool` (lo que `/dispatch` decide justo antes de ejecutar, según alcance, sensibilidad y créditos disponibles). Si el ticket es de `codex`/`kiro-nativo`/`hermes-vps`, su descripción debe bastarse sola — esas herramientas no leen `journal.md`.

## Los 5 agentes, en una frase cada uno
**Warden** prueba y verifica · **Artisan** construye interfaces · **Chronicle** recuerda todo (`journal.md`, en Haiku) · **Tracer** investiga fallos repetidos · **Sentinel** bloquea deploys inseguros (recibe solo el diff, presume inseguro hasta que se demuestre lo contrario).

## Reglas que nunca se negocian
- **WIP = 1 por herramienta** (`assigned_tool`), no global — Claude Code, Codex, Kiro y Hermes pueden tener cada uno una tarea activa a la vez.
- 3 archivos / 200 líneas por tarea (excepción documentada: migraciones de Drizzle).
- Sin dependencias nuevas sin pasar por `/gear-up` o `@depcheck`.
- `journal.md`/`ledger.md` son append-only — nunca se reescriben (se particionan por mes si crecen mucho).
- **Opus solo en `/blueprint`**, una vez. Excepción solo con gatillo de riesgo verificable (cambio de auth/permisos, migración irreversible, cambio de motor de DB, 2 fallos de `@root-cause` en la capa de dominio, o más del 40% de tickets requiriendo reescribir la arquitectura). Si no hay un gatillo de esa lista, "parece que hace falta Opus" es señal de planificación floja, no una razón válida.
- Gate de seguridad en `/review` y `/ship`: si falla, el ticket queda `blocked` — no se reintenta solo, decides tú.
- Tokens de diseño (`tokens.css`/daisyUI) desde el día 1 — no se relaja ni en prototipo rápido.

## Kiro / Cursor / Codex / Hermes, en una frase
Kiro y Cursor son el editor; Claude Code es el motor que entiende este ecosistema; Codex es mano de obra para tareas acotadas y autocontenidas; Hermes (VPS) es para trabajo largo desatendido, solo si tú lo pides. Si la tarea necesita memoria del proyecto o un gate de seguridad, es `claude-code` — sin excepción.

## ¿Perdido?
Escribe `/compass`. Siempre. Y si le vas a pasar este documento a otro LLM para que te guíe: dile que respete las reglas de arriba tal cual, especialmente la de Opus — es la que más dinero cuesta si se ignora.

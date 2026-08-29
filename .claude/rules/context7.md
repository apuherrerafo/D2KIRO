Fuente: informe #3 "AI Engineering Harness" (`docs/research/fase9-research-consolidation.md`, R3-12).
Context7 = MCP para recuperar documentación de librería **al día**. Privilegio mínimo por agente.

## Qué es
- Servidor MCP declarado en `.mcp.json` (raíz del repo, project-scoped, versionado).
- Dos herramientas: `mcp__context7__resolve-library-id` (nombre → ID de librería) y
  `mcp__context7__get-library-docs` (ID + pregunta → fragmentos de doc actuales).
- Autenticación: `CONTEXT7_API_KEY` en el entorno del shell que lanza `claude` (ver `.env.example`).
  Sin la variable, el servidor corre igual en modo anónimo (límite de tasa más bajo).
- CLI equivalente para uso manual desde terminal: `npx ctx7 library <nombre>` /
  `npx ctx7 docs <libraryId> "<pregunta>"`. `npx ctx7 login` regenera el token.

## Cuándo se usa
- **Sólo** en `/rulebook` e implementación (`@build`, Artisan), cuando hay que confirmar la API
  real y vigente de una librería del stack — sobre todo **Next.js** (`/vercel/next.js`) y
  **Bun** (`/oven-sh/bun`), donde el conocimiento base suele estar desactualizado
  (ver `apps/web/AGENTS.md`: "This is NOT the Next.js you know").
- Antes de escribir código que dependa de un contrato de API que no está verificado en el repo.

## Cuándo NO se usa
- **Nunca en el camino caliente** del motor: `apps/engine` no llama a la red, y esto es una
  herramienta de tiempo de desarrollo, no de runtime. No aparece en ningún import de `apps/`.
- No para lógica de dominio de Dota 2 (eso es investigación curada, no doc de librería).
- No como sustituto de leer el código real del repo o los tipos ya definidos.
- No en `/pre-flight` ni `/blueprint` — ahí se deciden cosas, no se consulta API de terceros.

## Alcance por agente (privilegio mínimo — R3-14 "Capability does not imply availability")
- **Artisan** (UI): tiene `mcp__context7` en su `tools:` — construye pantallas con Next/React/
  Tailwind/shadcn y necesita la API vigente.
- **Warden / Chronicle / Tracer / Sentinel**: NO lo tienen. Ejecutan pruebas, documentan o
  analizan — no escriben integración contra librerías.
- La sesión principal lo tiene disponible para el paso `/rulebook`.
- Cuando la Fase 9.0 formalice el roster de agentes (informe #3), el futuro
  `implementation-engineer` hereda este acceso; el resto no.

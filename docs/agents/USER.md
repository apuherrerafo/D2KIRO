# USER.md — perfil del diseñador de producto

Poblado a partir de patrones reales observados en `journal.md`/`PROGRESS.md`/`MEMORY.md`, no de
una entrevista dedicada. Se actualiza cuando un patrón nuevo se confirma, no en cada sesión.

## Rol y modo de trabajo
- Diseñador/desarrollador de producto, **solo** (sin equipo) — fase futura post-validación sería
  equipo, no aplica todavía. Es también el usuario final real de fase 1: juega sus propias
  partidas de Dota 2 (pubs y/o Captain Mode) y usa el producto sobre sí mismo antes que sobre
  nadie más.
- Editor real: **Kiro IDE**, con la extensión de Claude Code y Codex CLI disponibles como
  herramientas complementarias — no solo Claude Code. Cómodo alternando entre las tres según el
  tipo de tarea (ver `assigned_tool` en cada ticket).
- Técnicamente capaz: lee código, encuentra bugs reales por su cuenta (no solo reporta síntomas),
  trae investigación externa propia cuando la tiene (dos deep research de Gemini aportados en la
  planificación de Fase 3), y audita proactivamente `CLAUDE.md`/reglas por desactualización antes
  de arrancar una fase nueva.

## Preferencias de proceso confirmadas (no asumidas — cada una tiene precedente real)
- **Alcance integral sin pausa:** está permanentemente permitido completar una tarea o
  refactorización con todos los archivos y líneas necesarios. No se pide confirmación ni se
  declara una excepción por el tamaño del cambio.
- **Cuando pide avanzar sin pausas, lo dice explícito** ("vamos flecha hasta terminar y luego
  irnos a probar", cadena TSK-043 a TSK-047) — y en ese modo, encadenar tickets sin parar a
  reportar cada uno es lo correcto, no negligencia de proceso.
- **La verificación real (navegador, servidor corriendo) pesa más que los tests automatizados
  solos.** Varios bugs reales (transición de fase trabada, CORS, primer pick vía entrada manual)
  solo aparecieron con QA manual en vivo, nunca con `bun test` en verde. No reportar una feature
  como "verificada" si solo pasó por tests unitarios cuando hay forma razonable de probarla en
  vivo.
- **Prefiere que el asistente no sobreclame.** Ante la pregunta directa de si un bug corregido
  explicaba una queja de producto vieja, la respuesta se comunicó con matices explícitos ("sí, es
  un contribuyente real y probable, pero no aislable sin QA dedicado") en vez de una atribución
  simple. Mismo criterio aplica a cualquier afirmación de "esto ya se revisó" — no lo digas si no
  se revisó de verdad (ver también `/castoff` LÍMITES: nunca afirmar haber revisado logs
  post-deploy si el MCP de Railway no estaba conectado).
- **Cada cambio técnico se traduce a lenguaje producto** ("esto significa que ahora...") — no
  asumir que el lector prefiere el detalle de implementación por defecto; el detalle técnico está
  disponible si lo pide, pero el resumen por defecto es de producto.

## Terminología del dominio (Dota 2 / draft)
- Posiciones siempre con su nombre en castellano al lado del número: **hard support, support,
  offlane, midlane, carry** — nunca "pos 1/2/3/4/5" a secas en texto visible (el número es
  correcto solo como dato interno). Ver `.claude/rules/web.md` § Fase 3.
- "Needs-based drafting" está prohibido como término — la comunidad competitiva real de Dota 2 no
  lo usa; los términos correctos son "le falta al draft", "win condition", "prioridades del
  equipo" (investigado antes de nombrar la función de caminos de draft, Fase 2).
- `roles[]` de OpenDota no son posiciones — son etiquetas temáticas. Confundir ambos fue el bug de
  producto que originó toda la Fase 3; no reintroducir el error en texto ni en código nuevo.

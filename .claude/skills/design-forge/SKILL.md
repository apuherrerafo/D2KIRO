---
name: design-forge
description: Sistema de diseño completo: entrevista, generación de tokens y linter visual.
---

# /design-forge — Orquestador de Diseño

## PROPÓSITO
Crear y mantener el sistema de diseño del proyecto.

## REGLAS

### Día 1 — tokens mínimos, siempre (no es opcional, no espera a Fase 2)
Antes de escribir la primera pantalla, genera un `tokens.css` mínimo: 4-6 colores, una escala de espaciado, una familia tipográfica. No es el design system completo — es la barrera contra la deuda de inconsistencia visual que se acumula cuando 20-30 pantallas terminan con estilos ligeramente distintos porque nadie fijó esto desde el inicio. `@redteam` (pasada Standards) rechaza valores de color/espaciado hardcodeados fuera de `tokens.css` en cualquier fase — esto no se relaja nunca, ni en prototipo rápido.

### Fase 1 — Prototipo (por defecto, mientras el proyecto no esté sólido)
- No diseñes tokens desde cero todavía. **Para el stack por defecto (Bun + HTMX, sin React)**: usa **daisyUI** como base — son clases semánticas de Tailwind puro, sin JS de cliente, compatible de forma nativa con `hx-get`/`hx-post` porque el estado sigue viviendo en el servidor. Es el equivalente real a shadcn para este stack, no una aproximación.
- **Disciplina desde el primer componente**: usa las clases semánticas de daisyUI (`btn-primary`, `card`, etc.) desde ya, nunca CSS suelto "por ahora". Esto es lo que hace que la Fase 2 sea un cambio de theme, no una reescritura — si se rompe la disciplina aquí, se pierde esa ventaja.
- **Si el proyecto sí corre React** (porque `/gear-up` eligió esa alternativa explícitamente): ahí sí shadcn/ui es la opción correcta — no antes.
- Si el usuario ya trajo referencias con `/scout`, ajusta la base elegida a esas referencias en vez de empezar en blanco.
- El objetivo de esta fase es avanzar rápido sin gastar tiempo de diseño en decisiones que todavía pueden cambiar.

### Fase 2 — Handoff a Design System propio (cuando el usuario lo pida, típicamente al ver tracción real)
- Entrevista de diseño: ¿Sector o personalidad visual? ¿Colores principales? ¿Tipografía? ¿Referentes visuales (usa lo capturado con `/scout` si existe)? ¿Restricciones (accesibilidad, dark mode, dispositivos)?
- **La transición NO es migrar componentes uno por uno** — si Fase 1 usó daisyUI con disciplina (clases semánticas `btn-primary`, `card`, etc. desde el primer componente, nunca CSS suelto), pasar a marca propia es sobreescribir el theme de Tailwind/daisyUI con los tokens de marca del diseñador. El HTML no cambia, cambian los valores detrás de las clases.
- **Diseña dos veces, antes de escribir una línea de UI**: presenta DOS distribuciones espaciales distintas del mismo componente, en texto plano (ASCII o tabla Markdown), no en HTML ni servidor de preview. Pide al usuario que elija o combine antes de tocar código.
- **Escalada opcional — regresión visual real**: el texto plano no detecta bugs de alineamiento, padding, hover, breakpoints — para un diseñador de producto eso sí importa. Si el usuario lo pide (no por defecto, mismo patrón que Graphify en `/foundation-check`): Playwright dentro de un contenedor Docker (imagen `mcr.microsoft.com/playwright`) evita el problema de Node.js/Windows/WSL2 que rechazamos antes — el servidor Bun corre en el host, el contenedor solo levanta el navegador, toma captura de la ruta crítica, y la compara contra una baseline en `docs/design/`. Requiere Docker instalado (no Node.js en el host). Actívalo cuando el Design System ya esté en Fase 2 y valga la pena proteger contra regresión — no en cada ajuste rápido de prototipo.
- Genera `docs/agents/DESIGN_SYSTEM.md` con el theme nuevo — no reescribe el HTML existente, solo los valores de tokens.
- Genera `tokens.css` con la paleta, tipografía y espaciado.
- Aplica detalles de UI automáticamente: bordes concéntricos, texto balanceado (sin palabras huérfanas), animaciones de iconos con opacidad y escala, números tabulares, animaciones interrumpibles.

## OUTPUT
Sistema de diseño documentado y tokens generados.

## LÍMITES
- Solo usa valores de la escala definida. Prohibido decimales no autorizados.
- No inventes colores o tipografías fuera de la entrevista.

---
description: Reglas del frontend (apps/web) — SPEC.md §C5, convenciones heredadas del usuario
globs: apps/web/**/*.ts,apps/web/**/*.tsx
alwaysApply: false
---

Fuente: `docs/specs/SPEC.md` §C5 y `[[user_frontend_conventions]]` (memoria del usuario) — aplican
sin excepción, no son sugerencias de estilo.

## Convenciones de código
- TypeScript estricto, prohibido `any`.
- Prohibidos los ternarios para renderizado condicional — usar early return o un componente propio.
- Prohibidas las funciones anónimas inline como manejadores/props — nombrarlas.
- Un componente, una responsabilidad. Lógica de más de ~20 líneas se extrae a un hook propio de
  la feature, no al componente.
- Arquitectura por features: cada feature con `index.ts`, componente, `styles.ts`,
  `constants.tsx`, `types.ts`. Componentes atómicos reutilizables van a una carpeta común.
- Cada feature tiene su propio error boundary y estado de carga — no uno genérico compartido a
  ciegas entre features distintas.

## Dos regímenes de datos — no mezclarlos
- Páginas normales del sitio (inicio, configuración, estado del meta, héroes): RTK Query contra
  `apps/engine`.
- Vista de draft en vivo: **única excepción** — WebSocket + Zustand. Nunca RTK Query para el
  estado de draft en vivo.

## Vista de draft — los 6 estados, ninguno opcional
`desconectado`, `esperando_draft`, `activo`, `degradado`, `completo`, `error` deben existir todos
en pantalla. Una sugerencia de confianza `baja` se muestra igual, marcada como tal — nunca se
calla el sistema durante un draft.

## Design system — taxonomía obligatoria
- Color por rol semántico únicamente: `--surface-*`, `--content-*`, `--accent-*`,
  `--signal-positive` / `--signal-negative` / `--signal-warning`. Prohibido un hex suelto en un
  componente.
- Espaciado en escala de 4px: `space-1` … `space-12`.
- Tipografía: `text-caption` / `text-body` / `text-heading` / `text-display`.
- Nombres de componente `<Dominio><Cosa>` — `DraftBoard`, `DraftHeroSlot`, `SuggestionCard`,
  `SignalBreakdown`.
- El pulido visual (hover/pressed/focus/disabled, estética "glass") es requisito duro cuando se
  construyan pantallas — vía `/design-forge` + Artisan, auditado por `ux-senior`. No se considera
  terminada una pantalla sin esos estados.

## Seguridad de frontend
- Prohibido `dangerouslySetInnerHTML` en toda la app. Los nombres de héroe vienen de OpenDota —
  se tratan como texto no confiable, React los escapa por defecto.
- `img_url` de héroe: validar que el host esté en la lista permitida (CDN de Valve) antes de
  renderizar. Nunca una URL arbitraria tomada directo de la respuesta de la API.

## Íconos de héroe
- Todo héroe se muestra siempre con su ícono/foto oficial (`img_url`) — es un requisito duro de
  UI, no un nice-to-have.

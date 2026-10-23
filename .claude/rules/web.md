---
description: Frontend (apps/web)
paths:
  - "apps/web/**"
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

> Historia por fase (1b–9.1, cerradas): `docs/rules-archive/rules-web-fases-cerradas.md`. No se carga sola.

## Fase 5 — Auth & Personal Hero Pool multi-usuario (SPEC.md §12.11)

- **`proxy.ts` deja de hacer Basic Auth.** Se retiran `isValidBasicAuth` y las variables
  `SITE_ACCESS_USER`/`SITE_ACCESS_PASSWORD`. El nuevo `proxy.ts` verifica la sesión de
  `iron-session`; sin sesión válida, cualquier ruta salvo `/login`, `/api/auth/*` y `/healthz`
  redirige a login. Es el único gate de acceso al sitio a partir de esta fase — no conviven dos
  mecanismos de auth en paralelo.
- **La sesión es la cookie `d2k_session`** (`httpOnly`/`lax`/`secure` en prod), con exactamente 3
  campos: `accountId`, `issuedAt`, `firstLoginAt`. Nunca datos de perfil de Steam (nombre/avatar —
  fuera de alcance, ver abajo). TTL 30 días con renovación deslizante desde los 7 días de
  antigüedad, tope absoluto de 90 días.
- **El token para el WebSocket del motor se acuña del lado del servidor, nunca en el navegador.**
  `GET /api/auth/engine-token` (exige sesión) devuelve un token de 60 s de un solo uso. El cliente
  lo pide **inmediatamente antes de cada conexión**, incluida cada reconexión — nunca lo guarda en
  `localStorage` ni lo reutiliza entre intentos.
- **`fetchBaseQuery`/`prepareHeaders` de `lib/engine-api.ts` NO firma el token interno.** El
  navegador no tiene ni puede tener `INTERNAL_AUTH_SECRET`, y no puede leer la cookie `httpOnly` de
  sesión — el token viaja acuñado desde `proxy.ts` (servidor), inyectado como header hacia el
  destino del rewrite. Un diseño que intente firmar el token en el cliente es un error de capa, no
  un detalle de implementación.
- **`HeroPoolConfig.tsx` pierde el input manual de `account_id`.** El Steam32 sale de la sesión
  activa, nunca de un campo de texto que el usuario tipea — ese flujo era el de antes del login
  real.
- **`/settings` (pantalla y endpoints genéricos de clave/valor) se retira.** Reemplazada por "Mi
  cuenta", que expone únicamente `GET`/`POST /api/account`. No hay editor genérico de KV expuesto
  al usuario en esta fase.
- **El MVP no muestra nombre ni avatar de Steam.** La UI identifica a la cuenta por su Steam32,
  igual que hoy — mostrar el perfil público exigiría una Steam Web API key (secreto nuevo fuera de
  alcance) y agrega dato personal de terceros que nadie pidió.
- **Régimen de datos sin cambios de criterio**: login/cuenta son "páginas normales del sitio" (RTK
  Query), nunca WebSocket/Zustand — la única pieza de esta fase que toca el transporte en vivo es
  pedir el token de 60 s justo antes de conectar/reconectar el draft, no el resto del flujo de
  cuenta.


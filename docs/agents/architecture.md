# architecture.md — dota2coach (Draft Coach, fase 1)

Generado por `/pre-flight`. Consolida los 6 bloques de investigación y decisión.
Este documento es la base para `/blueprint` (síntesis de arquitectura formal).

## Bloque 1 — Visión del Producto

- **Problema**: tomar decisiones de pick/ban correctas en Dota 2 es difícil por
  tiempo e ignorancia del meta — dirigido a jugadores de nivel bajo/medio, no a
  pro players.
- **Usuario**: el propio usuario, jugando sus partidas (pubs y/o Captain Mode).
  Visión futura: ofrecerlo como servicio a otros jugadores (con cuentas/login).
- **Resultado esperado (fase 1)**: reconoce automáticamente el tipo de partida
  (pública vs. Captain Mode — tiempos y mecanismo de bans distintos), captura el
  estado del draft en tiempo real, y sugiere picks/bans/contrapicks en tiempo real
  basado en meta del parche actual y winrates generales — SIN personalización de
  hero pool todavía (eso es fase 1b).
- **Fuera de alcance de fase 1 (fases futuras, no compromisos, no cierran puertas
  arquitectónicas)**: personalización de hero pool (1b), itemización, timings,
  plugin/bot de voz en Discord, servicio multiusuario con cuentas.

## Bloque 2 — Dominio e Investigación

**Verificado con fuente primaria propia (WebSearch/WebFetch en esta sesión):**
- [Issue #19408, ValveSoftware/Dota2-Gameplay](https://github.com/ValveSoftware/Dota2-Gameplay/issues/19408)
  (15 jun 2024, sin respuesta oficial de Valve): confirma que GSI no expone picks
  de draft en partidas de matchmaking/ranked de forma pública documentada. El autor
  del issue afirma que Overwolf sí accede a esa info, aparentemente vía lectura de
  memoria autorizada específicamente para ellos como socio — no vía GSI pública.
- STRATZ (verificado vía su propio blog de Medium) no está "muerto" ni es
  "perfecto" — tiene historial real de rupturas y recuperaciones tras parches
  (`STRATZ+ Reborn`, `Major STRATZ+ Fixes`, adaptación a parche 7.25 en 2020).
  Tratarlo como fuente secundaria opcional, no como dependencia crítica.
- **Bans en All Pick (parche 7.35d)**: ya no hay veto activo de 15s en pantalla —
  es una lista de preferencias (máx. 4 héroes) configurada fuera de partida, con
  al menos 1 baneo garantizado por jugador. El algoritmo exacto de cómo se completa
  el total de baneados no está documentado oficialmente con claridad — incertidumbre
  abierta, no bloqueante.
- **Fuentes de datos de meta**: OpenDota recomendado como fuente principal (rápida,
  documentación abierta, límites gratuitos razonables). STRATZ como complemento
  opcional, no crítico.
- **Prior art**: Dota Coach, DotaPlus, STRATZ+ (Overwolf-based, activos en 2026).
  Equivalente en LoL: U.GG, Mobalytics, Porofessor, OP.GG — patrón de producto que
  funciona: una sugerencia principal + 2 alternativas, explicación corta, filtro por
  rol/comfort pool, degradación elegante a input manual si falla la detección.
- **Métodos de captura descartados**: lectura de memoria RAM directa (VAC ban,
  descartado por completo). Spectator/DotaTV (delay de ~2 min, inútil en vivo).
  Parsing de replays (solo post-partida, inútil para draft en vivo).
- **Métodos de captura viables**: Overwolf SDK (usado por competidores reales,
  acceso privilegiado autorizado por Valve) y/o OCR/screen-reading como
  complemento o fallback.
- **Pendiente de validación empírica** (no bloqueante, se valida durante el build):
  el propio usuario probará el archivo `gamestate_integration_*.cfg` con el bloque
  `draft` activado en una partida real propia para confirmar qué expone GSI para
  un jugador (no espectador) en su propia partida.

## Bloque 3 — Arquitectura e Ingeniería

- **Tiempo real**: sí — las sugerencias deben llegar en segundos durante el draft.
  El backend empuja actualizaciones (WebSocket), no request/response tradicional
  para el flujo de draft en vivo.
- **Monolito modular** (no microservicios): un solo desarrollador, un solo usuario
  en el MVP, presupuesto mínimo — microservicios añadirían complejidad operativa
  sin beneficio a esta escala. Se puede partir en servicios más adelante si el
  escalado a multiusuario lo amerita.
- **Ambiente de pruebas = misma arquitectura, capturador intercambiable**: el
  capturador real (Overwolf/OCR) y un simulador de draft comparten el mismo
  contrato de eventos hacia el backend. El simulador permite reproducir escenarios
  de draft en segundos, sin depender de partidas reales de ~45 min para probar los
  ~5 min de draft.

```
┌─────────────────────────┐     ┌──────────────────────────┐
│  Capturador real (PC)    │     │  Simulador de draft       │
│  Overwolf SDK / OCR      │     │  (ambiente de pruebas)     │
└────────────┬─────────────┘     └────────────┬──────────────┘
             │                                │
             └───────────┬────────────────────┘
                         │  mismo contrato de eventos de draft
                         ▼
              ┌─────────────────────────┐        ┌──────────────────────┐
              │  Backend (Next.js API/  │◄──────►│  OpenDota API +       │
              │  pipeline de sugerencias)│        │  cache local de meta  │
              └────────────┬─────────────┘        └──────────────────────┘
                           │ WebSocket push (sugerencias en vivo)
                           ▼
              ┌─────────────────────────┐
              │  Frontend Next.js —      │
              │  vista de draft en vivo  │
              │  (navegador u overlay    │
              │  Overwolf apuntando a    │
              │  la misma página)        │
              └─────────────────────────┘
```

- **Motor de sugerencias**: debe combinar múltiples señales, no una sola consulta
  — contrapick contra los héroes rivales, winrate de esos contrapicks en el parche
  actual, sinergia con los héroes ya elegidos por aliados, exclusión de baneados,
  y extensible a otras señales futuras. Este pipeline (combinar "buckets" de
  información en una sugerencia coherente) es el riesgo central identificado por
  el usuario a partir de un intento previo fallido — el diseño detallado de este
  motor se define en `/blueprint`, no aquí.
- **Persistencia**: SQLite local (vía Drizzle) — cache de meta de OpenDota,
  configuración del usuario, y más adelante historial de partidas (fase 1b). No
  se justifica un servidor de base de datos separado a esta escala.

## Bloque 4 — Seguridad desde el diseño

- **Backend**: local en la PC del usuario para el MVP (más simple, sin exposición
  de red innecesaria). Revisar de nuevo si/cuando se escale a multiusuario.
- **Cruce Backend → OpenDota**: sin datos personales en fase 1 (solo consultas de
  estadísticas públicas y agregadas). La pregunta de privacidad se retoma en fase
  1b, cuando se consulte historial de partidas asociado a una cuenta de Steam.
  Todas las preguntas del motor de sugerencias (contrapick + winrate + sinergia +
  exclusión de baneados) siguen siendo sobre datos agregados públicos, no personales.
- **Secretos**: si se necesita alguna API key, vive únicamente en variable de
  entorno, nunca en el código del repo — confirmado por el usuario.
- **Privilegios por componente**: el capturador solo usa los permisos que Overwolf
  ya le concede (sin acceso admin especial); el backend local solo necesita salida
  a internet para OpenDota y lectura/escritura de su archivo SQLite.
- **Visión a futuro (login)**: la arquitectura de Next.js + backend se estructura
  desde ya para que agregar autenticación (ej. NextAuth) más adelante no implique
  una reescritura, aunque no se implemente en el MVP.

## Bloque 5 — Stack Tecnológico

**Corrección importante de alcance**: dota2coach es un **sitio web** de fondo (con
visión de cuentas/login y de escalar a servicio multiusuario) — Overwolf/OCR es
solo el mecanismo de captura del draft en vivo, una pieza que alimenta al
backend/sitio web, no el contenedor de toda la aplicación.

- **Frontend**: Next.js (App Router), TypeScript estricto, Tailwind + shadcn/ui.
  RTK Query como capa principal de datos para las páginas normales del sitio
  (dashboard, configuración, hero pool, historial). La vista de draft en vivo es
  la única excepción: se alimenta por WebSocket, con Zustand manejando ese estado
  en tiempo real. Un mismo frontend sirve tanto en pestaña normal del navegador
  como embebido en un overlay de Overwolf apuntando a la misma página.
- **Backend**: Bun como runtime (WebSockets y SQLite nativos, arranque rápido).
- **Capturador**: Overwolf SDK y/o OCR/screen-reading.
- **Persistencia**: SQLite + Drizzle.
- **Requisito de UI duro**: cada héroe debe mostrarse siempre con su ícono/foto
  oficial de Dota 2, para reconocimiento rápido.
- **Convenciones de código** (reglas personales del usuario, ver
  `docs/agents/CONTEXT.md`/memoria): TypeScript estricto sin `any`, sin ternarios
  para renderizado condicional, sin funciones anónimas, principios SOLID, hooks
  personalizados si la lógica supera ~20 líneas, componentes atómicos reutilizables,
  error boundaries y loading states consistentes, arquitectura por features.
- **Taxonomía de design system**: se define una nomenclatura temprana (tokens de
  color por rol, escala de espaciado, escala tipográfica, convención de nombres de
  componentes) desde el inicio, para que el proyecto de Design System dedicado
  (más adelante, vía `/design-forge`) sea una extensión coherente y no una
  reescritura. El nivel de pulido visual (estados hover/pressed/focus/disabled,
  estética "glass", calidad de un equipo de UX/UI top) es un requisito duro para
  cuando se construyan pantallas — se ejecuta con `/design-forge` + agente
  `artisan`, auditado por `ux-senior`.
- Ver `docs/guides/frameworks.md` para el árbol de decisión completo.

## Bloque 6 — Plan de Validación

El MVP (fase 1) se considera funcional cuando:
1. **Captura correcta**: el sistema identifica el tipo de partida (pública vs.
   Captain Mode) y refleja en la UI, en tiempo real, cada pick/ban a medida que
   ocurre — validado primero con el simulador, luego con partidas reales.
2. **Sugerencias con sentido**: en un set de partidas de prueba (reales o
   simuladas), el usuario evalúa las sugerencias de contrapick/sinergia/meta como
   coherentes — criterio cualitativo del propio usuario, sin métrica estadística
   formal en esta fase.
3. **Velocidad**: las sugerencias aparecen en menos de 2-3 segundos tras cada
   pick/ban — deben llegar a tiempo de ser útiles durante el draft, no después.
4. **Simulador independiente**: permite probar escenarios de draft sin depender de
   una partida real en curso.

## Cierre de ambigüedades — resuelto en `/blueprint` (2026-07-26)

Este documento consolidó la investigación pero dejó tres puntos sin decidir. Quedaron
cerrados en `docs/specs/SPEC.md` (§0), que a partir de aquí es el contrato vigente:

- **Capturador (Bloque 3/5)**: "Overwolf SDK y/o OCR" → el **simulador y la entrada
  manual son capturadores de primera clase en fase 1**; Overwolf y OCR quedan
  especificados como adaptadores del mismo contrato de eventos, construidos después.
  Motivo: ataca primero el riesgo central (motor de sugerencias) sin depender de la
  incógnita de captura aún no validada empíricamente.
- **Sinergia (Bloque 3)**: OpenDota no expone sinergia entre aliados de forma limpia →
  contrapick y meta usan datos reales de OpenDota; la **sinergia es una heurística
  explícita y auditable** sobre `roles[]`, marcada en la UI como señal más débil. Sin
  STRATZ, sin API key, sin dependencias nuevas en fase 1.
- **Topología (Bloques 3 vs. 5)**: el diagrama decía "Backend Next.js" y el stack decía
  "Bun como runtime" → **dos procesos locales**: `apps/web` (Next.js: sitio, RTK Query,
  puerta abierta a login) y `apps/engine` (Bun: motor, WebSocket, SQLite). El capturador
  le habla directo a `apps/engine`, no al sitio.

El diagrama del Bloque 3 sigue siendo válido como vista conceptual; la caja "Backend
(Next.js API / pipeline)" corresponde a `apps/engine` en Bun.

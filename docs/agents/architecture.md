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

---

# architecture.md — Fase 1b (Personalización de hero pool)

Generado por `/pre-flight`, segunda ejecución del proyecto (la primera cubrió fase 1). Fase 1
(MVP) está completa y validada contra sus 4 criterios de aceptación (2026-07-27). Este addendum
consolida las decisiones de 1b — sigue pendiente de síntesis formal en `/blueprint` antes de
convertirse en tickets.

## Bloque 1 — Visión del Producto (1b)

- **Problema**: las sugerencias de fase 1 son correctas en abstracto pero ciegas a lo que el
  jugador realmente sabe jugar — puede sugerir un contrapick perfecto en un héroe que el usuario
  nunca ha tocado.
- **Usuario**: el mismo de fase 1 (el propio usuario, jugando sus partidas). Explícitamente
  **fuera de alcance en esta fase**: el hero pool de compañeros de equipo — el motor hoy no tiene
  forma de saber "de quién es" cada pick del draft (solo conoce `HeroId` + `side`), y crear esa
  identidad de slot es un problema propio que se revisa en una fase posterior, cuando exista
  login/multiusuario real.
- **Resultado esperado**: las sugerencias reflejan también la comodidad personal del usuario con
  cada héroe candidato, sin dejar de mostrar contrapicks fuera de su pool — nunca se filtra en
  duro, se pondera.
- **Qué NO es esta fase**: personalización de compañeros, predicción de rol del rival (se
  investiga y se especifica más abajo, no se construye), itemización, cuentas/login.

## Bloque 2 — Dominio e Investigación (1b)

**Verificado en esta sesión (WebSearch):**
- `GET /players/{account_id}/heroes` de OpenDota existe, no requiere API key, mismos límites
  gratuitos que el resto del proyecto (50 000 llamadas/mes, 60/min). Es viable como fuente para
  "calcular desde mis partidas". Soporta filtrado por fecha (parámetro `date`, en días) — el
  nombre exacto del parámetro se confirma contra el Swagger en vivo durante el build, no
  bloqueante (mismo patrón que "pendiente de validación empírica" de fase 1).
- **OpenDota no expone estadísticas limpias de posición (pos1–pos5) por parche.** `/heroStats`
  segmenta por bracket de MMR, no por rol/posición. Confirmado por búsqueda — no hay endpoint
  público documentado de OpenDota para esto.
- **STRATZ sí expone winrate/pickrate por posición vía su API GraphQL** (`api.stratz.com/graphql`,
  confirmado por búsqueda). Es la única fuente real para la idea de predicción de rol rival — y es
  exactamente el segundo proveedor externo que la decisión D2 de `SPEC.md` evitó a propósito en
  fase 1 (razón entonces: no pagar el costo de una segunda dependencia + secreto el día uno).
- **Dato personal que se reabre**: vincular un `account_id` (Steam32) al usuario local. Es el
  punto que `SPEC.md` §5 dejó marcado explícitamente como "se retoma en 1b". El dato en sí sigue
  siendo de un endpoint público de OpenDota (cualquiera puede consultar cualquier `account_id` sin
  autenticarse) — la sensibilidad real es que ahora el sistema *guarda* una asociación entre "este
  usuario local" y "esta cuenta de Steam real", cosa que fase 1 no hacía.

## Bloque 3 — Arquitectura e Ingeniería (1b)

**Decisiones cerradas con el usuario en esta sesión:**

| # | Pregunta | Decisión |
|---|---|---|
| E1 | Fuente del hero pool | **Ambas**: entrada manual siempre disponible + botón "calcular desde mis partidas" que trae datos de OpenDota y propone (no auto-aplica) un top 5. |
| E2 | Identidad de compañeros | **Fuera de alcance en 1b.** Solo el pool del usuario local. No se crea ningún concepto de "perfil" ni "lineup". |
| E3 | Integración con el motor | **Señal nueva ponderada**: `hero_pool_fit`, quinto `SignalScorer` con el mismo contrato (S3) que las cuatro existentes. Se redefine la constante de pesos (nuevo nombre versionado, ver abajo). |
| E4 | Predicción de rol rival | **Se investiga y se especifica en este documento, no se construye en 1b.** Ver sub-bloque dedicado más abajo. |
| E5 | Criterio de ranking al calcular | **Winrate, con mínimo de partidas y ventana reciente** — ver detalle abajo. |
| E6 | Forma de la señal | **Continua**: escalada por el winrate/partidas personales del jugador con ese héroe, no un simple dentro/fuera. |
| E7 | Recencia | **Ventana reciente** (~90 días vía el parámetro `date` de OpenDota). |

**Reconciliación E5/E7**: en la conversación surgieron dos framings del mismo concepto — "últimos
90 días" y "últimas 100–150 partidas". Se usa el filtro por días (es lo que la API realmente
soporta de forma limpia); para un jugador activo, 90 días equivale aproximadamente a ese rango de
partidas. El número exacto de días queda como parámetro tuneable en `/blueprint`, no fijo aquí.

**Cálculo del pool al pedir "calcular desde mis partidas":**
1. `OpenDotaClient.getPlayerHeroes(accountId, { days: 90 })` (método nuevo, mismo patrón de la
   clase existente — reintentos 1s/4s/16s ya cubiertos por el cliente actual).
2. Se descartan héroes con menos de un mínimo de partidas **dentro de esa ventana** (propuesta
   inicial: 10 partidas — cifra provisional, se ajusta en `/blueprint`, igual que
   `SCORING_WEIGHTS_V1` ya fue "un punto de partida razonado, no medido").
3. De los que quedan, se ordenan por winrate descendente y se toman los primeros 5 (pueden ser
   menos de 5 si no hay suficientes héroes que pasen el mínimo — "hasta 5" es un techo, no un
   piso).
4. El resultado se **propone** en la UI (pantalla de confirmación), el usuario decide si lo
   guarda tal cual o lo edita a mano antes de confirmar. Nunca se sobreescribe el pool existente
   en silencio.

**`hero_pool_fit` — contrato de la señal (S3), continuo:**
- Si el pool nunca se configuró (ni manual ni calculado): `raw: null` — **no vota**, su peso se
  redistribuye proporcionalmente entre las otras 4, igual que cualquier señal sin dato (regla ya
  vigente en `mix.ts`, no cambia).
- Si el pool existe y el candidato **no está en él**: `raw` tiene un valor real y bajo (no
  `null` — hay dato, el dato es "sin comodidad conocida con este héroe"). Distinción importante:
  `raw: null` significa "no sabemos", no "es cero" — un héroe fuera del pool con pool configurado
  sí tiene una respuesta real.
- Si el candidato **está en el pool**: `raw` escala con el winrate personal registrado para ese
  héroe (mismo principio que `patch_meta`, pero con la cuenta del jugador en vez del agregado
  público).
- `MetaSnapshot` (tipo en `signals/types.ts`) se extiende con un campo opcional
  `heroPool?: HeroPoolEntry[]` — mismo patrón ya usado en ese archivo para `patchStats?` y
  `roles?` ("consumidores previos a este ticket no lo conocen todavía"). No rompe los scorers
  existentes.

**Persistencia (extiende C4):**
- Tabla nueva `hero_pool` en `apps/engine` (Drizzle): `heroId`, `source` (`'manual' | 'calculated'`),
  `personalWinrate`, `personalGames`, `updatedAt`. Vive junto a `heroes`/`hero_patch_stats`, mismo
  patrón de esquema.
- Nuevo valor en `settings`: `steam_account_id` — para no pedir el `account_id` cada vez que se
  quiere recalcular.
- **Sin tabla de historial de partidas completo** — solo se persiste el resultado agregado
  (héroe → winrate/partidas), no las partidas individuales. Coherente con la decisión de fase 1 de
  no modelar historial todavía.

**API nueva (extiende §3 de SPEC.md), todo en `apps/engine`, consumido por `apps/web` vía RTK
Query (régimen de "páginas normales del sitio", C5 — el hero pool se edita en configuración, no
es parte del WebSocket de draft en vivo):**

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `GET` | `/api/hero-pool` | `HeroPoolEntry[]` |
| `PUT` | `/api/hero-pool` | Reemplaza el pool completo (edición manual) |
| `POST` | `/api/hero-pool/calculate` | `{ accountId, days? }` → `{ proposed: HeroPoolEntry[] }` — **no escribe en SQLite todavía**, solo propone; el `PUT` posterior confirma |

## Sub-bloque — Predicción de rol/posición del equipo rival (investigado, no construido en 1b)

Idea que salió en conversación pero nunca se investigó formalmente hasta esta sesión. Es una
**señal nueva de predicción**, no personalización — conceptualmente distinta del resto de este
addendum, se documenta aquí para no perderla y para no tener que reabrir `/pre-flight` cuando se
priorice.

- **Qué resolvería**: hoy `role_gap` y `team_synergy` razonan sobre el **equipo propio** (huecos
  de rol, solapamiento de farm). No hay ninguna señal que razone sobre **qué rol es probable que
  ocupe un héroe ya elegido por el rival** este parche — dato que afectaría cómo se interpreta esa
  amenaza.
- **Fuente de datos**: STRATZ es la única fuente real de datos limpios de posición por parche
  (confirmado en Bloque 2). OpenDota no lo tiene.
- **Recomendación de esta sesión** (el usuario delegó la decisión): **documentar STRATZ como
  dependencia condicional futura**, no decidir el "sí" ahora. Mismo patrón que D1 (Overwolf/OCR):
  el contrato de la señal se puede especificar sin comprometerse a construirla. Cuando se
  priorice, pasa obligatoriamente por `/gear-up`/`@depcheck` (regla inviolable de `CLAUDE.md`) y
  necesita un secreto nuevo (`STRATZ_API_KEY`, únicamente en `process.env`, nunca en el repo).
  Razón de la recomendación: es tangencial al objetivo real de esta fase (personalización), añade
  el segundo proveedor externo que fase 1 evitó a propósito, y el proyecto tiene precedente
  reciente de tratar "STRATZ no es imprescindible" como decisión ya tomada (D2).
- **Contrato de señal propuesto (para cuando se construya)**: `enemy_role_prediction`, mismo
  contrato S3 (`SignalContribution`). Para cada héroe ya elegido por el rival, consulta la
  distribución de posición de STRATZ para el parche actual y ajusta la interpretación de amenaza
  (ej. "Phantom Assassin jugado como pos 1 en 68% de las partidas este parche" cambia qué tan
  urgente es un contrapick de safelane vs. de core genérico). **No reemplaza** `counter` — lo
  refina.
- **Alternativa sin STRATZ, si se decide no añadir el proveedor**: heurística más débil sobre
  `roles[]` estático (ya en la tabla `heroes`) + orden de pick dentro del draft — mismo patrón que
  la heurística de `team_synergy` (D2). Más débil, pero cero dependencias nuevas.
- **No bloquea nada de esta fase.** Vive documentado, listo para retomarse.

## Bloque 4 — Seguridad desde el diseño (1b)

- **Nuevo cruce de frontera de confianza**: `apps/web` (formulario de configuración) →
  `apps/engine` (`POST /api/hero-pool/calculate`) → OpenDota, con un `account_id` provisto por el
  usuario. Se valida en el borde que sea numérico y tenga el formato de un Steam32 id válido antes
  de tocar lógica de negocio — mismo principio que cualquier input externo (`security.md`).
- **Dato personal (por primera vez en el proyecto)**: el `account_id` vincula al usuario local con
  una cuenta de Steam real. Vive en SQLite local, nunca se transmite a nadie más que a la propia
  OpenDota (endpoint público, sin autenticación). No es información de pago ni credenciales — pero
  es el primer campo del proyecto que identifica a una persona real, así que se trata con el mismo
  cuidado que security.md ya reserva para "datos personales": sin logging casual del valor en
  `journal.md` o tickets, sin exponerlo en ninguna URL de terceros salvo OpenDota.
- **Sin secreto nuevo para el pool en sí**: OpenDota no requiere API key. El único secreto nuevo
  que este addendum contempla es condicional y futuro (`STRATZ_API_KEY`, sub-bloque de rol rival),
  no aplica a lo que se construye en 1b.
- **`POST /api/hero-pool/calculate` no toca el camino caliente del draft**: es una llamada de red,
  pero ocurre en el flujo de configuración, no durante un draft activo — mismo principio que ya
  aplica a la sincronización de meta (S6). La regla "cero red en el camino caliente" protege
  específicamente el cálculo de sugerencias por pick, que sigue sin tocar la red.
- **Sin cambios** al binding de `apps/engine` (sigue solo en `127.0.0.1`) ni al token de captura.

## Bloque 5 — Stack Tecnológico (1b)

- **Cero dependencias nuevas** para el alcance real de 1b (hero pool). `OpenDotaClient` se
  extiende con un método más, mismo patrón de clase ya existente y probado.
- STRATZ (sub-bloque de rol rival) sería una dependencia nueva **si y cuando** se construya —
  pasa por `/gear-up`/`@depcheck` en ese momento, no ahora.

## Bloque 6 — Plan de Validación (1b)

1. El usuario puede guardar manualmente hasta 5 héroes como su pool desde la UI de configuración,
   persistido en SQLite, visible al recargar.
2. El usuario puede ingresar su `account_id` de Steam y disparar "calcular desde mis partidas": el
   sistema trae sus partidas de los últimos ~90 días, calcula winrate por héroe con un mínimo de
   partidas, y **propone** un top 5 sin sobreescribir nada hasta que el usuario confirme.
3. Durante un draft, un héroe dentro del pool del usuario recibe un ajuste visible y explicado en
   el desglose de señales (`hero_pool_fit` aparece igual que las otras 4, nunca se calla).
4. Con el pool vacío (nunca configurado), `hero_pool_fit` devuelve `raw: null`, su peso se
   redistribuye, y el comportamiento de fase 1 no cambia — **regresión cero** sobre el MVP ya
   validado.
5. Prueba unitaria: los 5 pesos de la nueva constante de pesos suman exactamente `1.0`.
6. La predicción de rol rival queda **fuera** de estos criterios — no se construye en 1b.

## Cierre — pendiente de `/blueprint`

Este addendum consolida la investigación y las decisiones de 1b, pero — igual que pasó con fase 1
— dos números quedan explícitamente sin fijar hasta la síntesis formal: el mínimo de partidas
dentro de la ventana reciente (propuesta: 10) y la distribución exacta de los 5 pesos de la nueva
constante de scoring (propuesta de partida, a validar en `/blueprint`: `counter: 0.35`,
`patch_meta: 0.20`, `team_synergy: 0.15`, `role_gap: 0.10`, `hero_pool_fit: 0.20` — suma 1.0).
`/blueprint` corre en Opus por política del proyecto (única fase de razonamiento caro), y aquí
además cruza un trust boundary nuevo respecto al `architecture.md` original (primer dato personal
del proyecto) — coherente con los gatillos de Opus ya documentados en `CLAUDE.md`, no es una
excepción nueva.

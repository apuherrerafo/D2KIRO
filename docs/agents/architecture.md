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

## Addendum (2026-07-28) — Capturador real: Overwolf primero, OCR condicional

Generado por `/pre-flight`, re-invocado para la fase siguiente a fase 1 (D1 de `SPEC.md` ya
anticipaba que Overwolf/OCR se construirían después de validar el motor). Re-verifica el
Bloque 2 original, que tenía ~1 año de antigüedad en algunos puntos, con fuentes primarias de
esta sesión (WebSearch/WebFetch, incluida la doc oficial de Overwolf y el propio issue de Valve).

### Re-verificación del Bloque 2

- **GSI (`gamestate_integration_*.cfg`) sigue sin exponer el draft de partidas propias de
  matchmaking.** [Issue #19408](https://github.com/ValveSoftware/Dota2-Gameplay/issues/19408)
  sigue abierto; un comentario de julio 2025 (`GameRuiner`) confirma que investigó OpenDota,
  STRATZ, logs y GSI y "no encontró solución" — un año más reciente que la investigación
  original, el problema persiste.
- **Hallazgo nuevo, no estaba en la investigación original**: el SDK oficial y público de
  Overwolf (GEP, `dev.overwolf.com/ow-native/live-game-data-gep/supported-games/dota-2/`)
  documenta campos `roster`, `bans` y `draft` con `heroId`/`team` en JSON — no es "lectura de
  memoria de socio privilegiado" como se especuló originalmente, es una API pública documentada.
  Ejemplo real de la doc: `[{"heroId": "75", "team": "0"}]`. Solo `steamId`/`name` de jugadores
  se ocultan hasta `DOTA_GAMERULES_STATE_STRATEGY_TIME` (protección anti-scouting confirmada por
  Valve en el issue [#878](https://github.com/ValveSoftware/Dota2-Gameplay/issues/878), cerrado)
  — el `heroId`/`team` de bans/picks no está gateado por esa protección según la doc.
- **Tensión sin resolver, no bloqueante**: los apps de Overwolf para Dota 2 requieren
  `-gamestateintegration` en las opciones de lanzamiento, lo que sugiere que el GEP de Overwolf
  podría depender internamente del mismo mecanismo GSI que el punto anterior dice que está roto
  para partidas propias. La documentación no lo aclara — **no hay forma de resolver esto sin
  probarlo empíricamente en una partida real.**
- **OCR tiene precedente real y en producción**: STRATZ+ lo construyó y lo mantiene, con
  fragilidad documentada — falla con resoluciones custom, grids de héroe personalizados, skins
  arcana, overlays de Dota+ encima del héroe, y partículas de la sala de espera.
- **Pregunta de dominio (turnos en All Pick), evidencia nueva pero no oficial de Valve**: en
  All Pick rankeado hay ~16 bans instantáneos pre-partida (mezcla de listas de preferencia +
  héroes más baneados del bracket, no una fase de veto en vivo) y luego una fase de picks por
  turnos con patrón 2-2-1 alternando entre equipos. Fuente secundaria (guía de terceros), no
  documentación oficial de Valve.

### Decisiones (confirmadas por el usuario, 2026-07-28)

| # | Decisión | Razón |
|---|---|---|
| D4 | **Spike empírico antes de construir cualquier adapter de producción.** Un script desechable fuera del árbol de producción, corrido por el usuario en una partida real de All Pick, valida el GEP de Overwolf antes de invertir en el adapter completo. | Hay evidencia contradictoria (GSI roto para partidas propias vs. GEP de Overwolf documentado pero de dependencia interna incierta) que no se resuelve leyendo más documentación — coincide con la filosofía ya aplicada en D1 de `SPEC.md` ("no asumas, valida"). |
| D5 | **Es aceptable que el capturador dependa de que el usuario tenga Overwolf instalado y corriendo.** | Mismo patrón que competidores reales activos (DotaPlus, STRATZ+) — estándar de la industria para este caso de uso, gratuito, y la vía técnica más sólida encontrada. |
| D6 | **OCR se construye solo si el spike de Overwolf falla** (no en paralelo). | Ataca primero la vía más prometedora y documentada oficialmente; evita duplicar esfuerzo antes de saber si hace falta — mismo principio que D1. |
| D7 | **El orden de turnos 2-2-1 de All Pick NO se modela en el reductor.** Se mantiene la regla ya inviolable de `SPEC.md` §C2 ("especificar un turnero que adivine sería especificar un bug"). | La evidencia nueva es de una guía de terceros, no de Valve — no alcanza el nivel de certeza para tocar una regla inviolable ya cerrada. Se puede revisar si aparece una fuente primaria. |

### Plan — Paso 0: spike empírico de Overwolf

**Qué valida (ampliado tras revisión del usuario, 2026-07-28):**
1. Que `roster`/`bans`/`draft` del GEP realmente entregan `heroId`/`team` en vivo durante una
   partida propia de All Pick (pública, no rankeada, para no arriesgar la cuenta).
2. **Que un `pick_revert` provocado intencionalmente durante la misma partida de prueba se
   pueda distinguir de un pick nuevo en los datos crudos del GEP** — el adapter `overwolf`
   (Paso 1A) va a depender de una heurística de snapshots consecutivos para detectar esto
   (`pick_reverted` es parte del contrato S1 desde fase 1); esa heurística nunca se prueba si el
   criterio de éxito se queda solo en "los datos llegan". Es más barato descubrir en el spike
   que la heurística no es confiable que descubrirlo a medio construir el adapter completo.

**Cómo:** script desechable fuera del árbol de producción (p. ej. `scripts/spikes/`), que
vuelca a consola/archivo lo que llega en `roster`/`bans`/`draft` en cada `match_state_changed`,
durante una partida real jugada por el usuario, incluyendo un pick_revert deliberado.

**Bifurcación:** éxito en ambos puntos → Paso 1A (adapter `overwolf`). Falla cualquiera de los
dos → Paso 1B (adapter `ocr`), documentando en `journal.md` por qué se descartó Overwolf pese a
estar documentado oficialmente.

### Plan — Paso 1A: adapter `overwolf` (si el spike valida ambos puntos)

- Vive en `apps/engine` como un capturador más (mismo patrón que `simulator`/`manual`), hablando
  al motor exclusivamente vía `POST /ingest/draft-event` con `x-capture-token`.
- Mapeo: `match_state_changed` (HERO_SELECTION/STRATEGY_TIME) → `session_started`; diffs en
  `bans[]` → `hero_banned`; diffs en `draft[]`/`roster[].heroId` → `hero_picked`;
  `roster[].steamId` propio → `local_side_identified`; pérdida del proceso Overwolf →
  `capture_health: lost` (la UI habilita entrada manual sin perder estado, regla ya existente).
- Confianza reportada: `1.0` (dato estructurado directo del cliente, no inferencia).
- `pick_reverted` se detecta comparando snapshots consecutivos — heurística validada en el
  Paso 0, no asumida.
- Modelo de seguridad sin cambios: proceso separado en la misma PC, sin privilegios admin, habla
  a `apps/engine` en `127.0.0.1` igual que cualquier otro capturador.

### Plan — Paso 1B: adapter `ocr` (solo si el spike de Overwolf falla)

- Mismo contrato de salida (S1); confianza variable por lectura (`0.0–1.0`, ya contemplado en
  el contrato desde fase 1). Riesgos ya documentados por el precedente de STRATZ+ (resolución
  custom, grid de héroes personalizado, skins arcana, overlays de Dota+, partículas) — a validar
  con pruebas propias, no asumir. Esta rama solo se abre si 1A no es viable.

### Explícitamente fuera de alcance de esta fase

- Turnos de Valve (2-2-1 en All Pick, orden de Captains Mode) — sin modelar en el reductor (D7).
- Captain Mode como adapter separado — el mismo adapter `overwolf`/`ocr` cubre ambos formatos
  porque el contrato de eventos es agnóstico al formato.
- Cualquier cambio al contrato S1, al reductor (C2), o al motor de sugerencias (C3) — cero tocar.

**Siguiente paso:** `/rulebook` (o `/grill-me` para afinar el spike primero) parte esto en
tickets con `preferred_tool`/límites de archivo, empezando por el Paso 0.

# architecture.md — Fase 3 (Posiciones reales en el motor de sugerencias)

Disparado por QA manual del usuario sobre el Random Draft Simulator (2026-08-20): el bot elige
composiciones inválidas (dos carries seguidos), y el usuario lo describió sin filtro — "el
drafter no funciona como un drafter, es como una mentira". Investigación confirmó la causa real
antes de proponer ninguna solución (ver journal.md, evt del 2026-08-20).

## Bloque 1 — Visión del Producto (Fase 3)

- **Problema**: el motor no tiene ningún concepto de posición (pos 1-5). Usa etiquetas temáticas
  de OpenDota (`roles[]`) que no representan roles reales — 57% de los héroes están marcados
  "Carry" (Zeus, Axe, Tidehunter incluidos). La señal que debería frenar esto, `role_gap`, pesa
  0.108 contra 0.288 de `counter` — aunque detecte el problema, casi no influye en el resultado.
- **Usuario**: solo el usuario del proyecto, uso personal, hasta que funcione de verdad. No se
  comparte con nadie más por ahora.
- **Resultado esperado**: que el motor deje de sugerir composiciones estructuralmente inválidas
  (doble carry, sin support temprano), usando datos reales de posición por héroe, y que ese
  criterio realmente pese en el resultado final — no solo aparezca correcto en el desglose sin
  cambiar nada.
- **Qué NO es**: no predice la posición del rival (sigue fuera de alcance, ver sub-bloque de 1b
  más arriba — sin cambios). No usa ML. No toca el bot del Random Draft Simulator (que tiene su
  propio scoring, ver `engine.md`) ni la UX de "qué ya se sacó" — cada uno queda para su propio
  turno, decisión explícita del usuario de ir paso a paso.

## Bloque 2 — Dominio e Investigación (Fase 3)

- **Qué dato hace falta**: posición real por héroe (pos 1-5: carry, mid, offlane, soft support,
  hard support), del parche activo.
- **STRATZ**: investigado a fondo (deep research externo del usuario, no generado por el
  asistente). Técnicamente viable — API GraphQL activa, tier gratuito amplio (~10k
  peticiones/día), términos que permiten cachear localmente. **Descartado igual**: un segundo
  research (comparación de costo real) recomendó curar a mano en cambio — 6-8h armar una vez,
  12-18h/año de mantenimiento, cero dependencia nueva, cero secreto nuevo, mismo patrón que
  `capabilities.json` ya existente en el proyecto (Fase 2). Precedente de la industria confirmado:
  proyectos open source comparables (`dota2-draft-frontend`, `dota-2-ban-pick-tool`) usan JSON
  estático, no APIs en vivo.
- **OpenDota, verificado de nuevo en esta sesión (no solo en 1b)**: la API pública real no tiene
  campo de posición. El SQL Explorer público (mismo proveedor que ya usa el proyecto, sin API key)
  tiene `lane_role` y `net_worth` a nivel de jugador, pero la tabla con ese detalle solo cubre
  partidas parseadas manualmente (~138 en 10 días) — muestra insuficiente para 124 héroes.
  `public_matches` (la tabla grande, la misma que alimenta `heroStats`) no tiene detalle por
  jugador. Confirma que el segundo research tenía razón: no hay atajo automatizado vía OpenDota.
- **Fuente real usada**: Dota2ProTracker (`dota2protracker.com/meta?position=pos+N`), bracket
  7000+ MMR, parche 7.41e. Bloquea el fetch simple (`WebFetch`, 403) pero es accesible con un
  navegador real (Playwright + Edge del sistema) con pausas entre página y página — Cloudflare
  frena solo ante ráfagas rápidas, no ante el acceso en sí. **Dato real obtenido, no simulado**:
  126 de 127 héroes con al menos una posición, filtrando con un mínimo de 200 partidas para
  descartar ruido de baja muestra. Solo Chen quedó sin dato (por debajo del umbral en las 5).
  Validado contra conocimiento real del juego (Anti-Mage solo Carry, Crystal Maiden Hard/Soft
  Support, Tinker solo Mid, etc.) — sin sorpresas raras. El caso que arrancó todo (Spectre +
  Wraith King) se confirma con datos reales: Spectre es carry puro, Wraith King es Offlane/Carry
  — exactamente la superposición que el usuario vio draftear mal.
- **Competidores/precedentes**: Dota Coach, STRATZ+, DotaPlus (herramientas de asistencia
  reales); ninguna expone su modelo de scoring, se investigó su lógica conceptual, no su código.

## Bloque 3 — Arquitectura e Ingeniería (Fase 3)

- **Decisión central**: `role_gap` y `role_safety` (dos señales existentes, ambas ciegas por usar
  `roles[]` de OpenDota) se **fusionan en una señal nueva, `position_fit`**, en vez de arreglarse
  cada una por separado. Razón: las dos razonan sobre la misma pregunta de fondo ("qué posición
  necesito, y es buen momento para revelarla") — separadas, competían entre sí en el número final
  en vez de resolver una sola decisión coherente, mismo tipo de reasoning que usa un jugador real.
- **Algoritmo** (a implementar en `/build`, aquí solo el contrato):
  1. Cubre qué posiciones ya tiene el equipo propio (picks propios + `hero_positions.json`).
  2. Calcula qué posición falta.
  3. Usa el número de pick propio como proxy de "momento del draft" — temprano favorece
     posiciones seguras/flexibles (support), tarde favorece comprometer lo que falta sin
     importar el rol.
  4. Para el candidato: en qué posición(es) suele jugarse (dato real, con volumen de partidas
     como proxy de qué tan "primaria" es esa posición para ese héroe) — ¿llena un hueco real en
     el momento correcto?
  5. **Sigue siendo una señal ponderada, no un filtro duro** — nunca descarta un héroe de la
     lista de candidatos (eso rompería el único invariante real del motor: "nunca 0/1"). El
     único filtro duro que existe hoy (`candidatePool`) es por hechos binarios (baneado/pickeado),
     no por juicio de calidad — `position_fit` no cambia eso.
- **Peso**: necesita una constante nueva, `SCORING_WEIGHTS_V4` — reemplaza las entradas de
  `role_gap` y `role_safety` por una sola de `position_fit`, con peso mayor a la suma de las dos
  viejas (0.108 + su parte de `role_safety`), para que de verdad compita con `counter` (0.288) en
  vez de perder siempre. Número exacto pendiente de `/blueprint`. `SCORING_WEIGHTS_V1/V2/V3`
  **no se tocan** — quedan congeladas, mismo patrón que cada versión anterior.
- **Dato fuente**: `hero_positions.json`, archivo estático versionado en el repo — mismo patrón
  exacto que `capabilities.json` (Fase 2), **no en SQLite**, nunca se consulta contra una fuente
  externa en runtime. Generado con un script de scraping vía navegador real (no HTTP simple),
  corrido a mano por el usuario/desarrollador cuando decida actualizarlo (después de un parche
  grande) — nunca automático, nunca desde `apps/engine`. El archivo real ya se armó y se validó
  en esta sesión (ver `journal.md`); vive en el scratchpad hasta que `/build` lo mueva al repo.
- **Sin tiempo real nuevo**: el cálculo de `position_fit` es tan síncrono como cualquier otro
  `SignalScorer` — no cambia el presupuesto de 500ms del motor.
- **Monolito**: se queda dentro de `apps/engine/src/signals/`, ningún proceso ni servicio nuevo.

## Bloque 4 — Seguridad desde el diseño (Fase 3)

- **Cruce de frontera de confianza**: uno solo, y no es en runtime — el script que genera
  `hero_positions.json` toca una fuente externa (Dota2ProTracker) desde la máquina del
  desarrollador, nunca desde `apps/engine`. Corre a mano, deliberado, nunca programado ni
  automático. El motor en producción nunca hace esa llamada.
- **Datos sensibles**: ninguno. Estadísticas públicas agregadas de héroes, mismo tipo de dato que
  `patchStats` (picks/wins) que ya vive en el motor.
- **Secretos**: ninguno nuevo — la decisión de curar a mano en vez de STRATZ evita exactamente el
  secreto (`STRATZ_API_KEY`) que la Fase 1b había dejado como "condicional futuro".
- **Privilegio**: el script de generación necesita salida a internet (solo cuando corre, nunca
  automático); `apps/engine` no gana ningún privilegio nuevo — sigue leyendo un archivo estático
  del repo, igual que `capabilities.json`.
- **Regla dura que se mantiene intacta**: cero red en el camino caliente del motor. Esta fase no
  la toca ni la debilita.

## Bloque 5 — Stack Tecnológico (Fase 3)

- **Sin stack nuevo.** `position_fit` es un `SignalScorer` más, mismo contrato S3 que los otros
  cinco. El script de generación del archivo es una utilidad de desarrollo más, mismo patrón que
  `scripts/hub.ts`/`scripts/verify-simplicity.sh` — no una dependencia del runtime del motor.
- **Cero dependencias npm nuevas** — decisión explícita, evita `/gear-up` por completo.

## Bloque 6 — Plan de Validación (Fase 3)

Automatizado (pruebas unitarias, mismo patrón que cada `SignalScorer` existente):
1. Con un carry puro ya elegido (Spectre, dato real) y otro carry puro como candidato (Wraith
   King, dato real) → `position_fit` puntúa bajo/negativo por la superposición.
2. Primer pick propio del draft (sin nada elegido todavía) → un héroe support puntúa más alto
   que un carry puro en ese mismo momento.
3. Héroe sin dato de posición (Chen, el único caso real) → `raw: null`, nunca un valor inventado,
   nunca una excepción sin capturar.
4. **Candado de regresión del bug original**: reproducir Spectre + Wraith King contra el
   pipeline completo (`buildSuggestions`, no la señal aislada) y confirmar que Wraith King ya no
   aparece en el top 3 — prueba que `SCORING_WEIGHTS_V4` mueve el resultado final, no solo el
   desglose interno.

Manual, guiado por el usuario, dos escenarios independientes con pasos numerados y resultado
esperado explícito (ver journal.md para el detalle completo acordado con el usuario):
- **Escenario A** ("no repitas rol"): con Spectre ya pickeado, ningún carry puro debería estar
  en el top 3 de sugerencias del Copilot.
- **Escenario B** ("primero lo seguro"): draft vacío → sugerencia #1 debería inclinarse a
  support; una vez cubierto ese rol, debería abrirse a otros roles con normalidad.

Explícitamente fuera de estos criterios: el bot del Random Draft Simulator (no usa el motor
real todavía, ver `engine.md`) — el QA se hace contra el Copilot real (`/draft` o simulador de
guion fijo), nunca contra ese bot.

## Cierre — pendiente de `/blueprint`

Números sin fijar hasta la síntesis formal: el peso exacto de `position_fit` dentro de
`SCORING_WEIGHTS_V4` (propuesta de partida a validar: algo en el orden de 0.20-0.25, para que
compita de verdad con `counter`), el umbral mínimo de partidas para que una posición cuente como
real en `hero_positions.json` (ya aplicado en el dato recolectado: 200), y la fórmula exacta de
cómo se combinan "cobertura de posición" + "timing del pick" dentro de una sola señal continua
(el Bloque 3 da el contrato conceptual, no la fórmula matemática final).

`/blueprint` corre en Opus por política del proyecto (única fase de razonamiento caro del
proyecto). Esta fase no cruza ningún gatillo objetivo de los documentados en `CLAUDE.md` (no hay
trust boundary nuevo, no hay migración irreversible, no cambia autenticación ni motor de DB) — es
una decisión de scoring dentro del motor existente, corresponde el flujo normal.

---

# architecture.md — Fase 4 (Intención de Draft, Sinergia en Cadena y Diversificación Estratégica)

Disparado por feedback directo del usuario (product designer del proyecto, 2026-08-23): el motor
da un top-3 estático al inicio de cada draft porque pondera winrate general/flex de forma aislada,
sin ningún concepto de intención táctica ni de cómo un pick propio debería reencuadrar los
siguientes. Alcance acordado en conversación previa a esta sesión de `/pre-flight`: 4 piezas,
evaluadas ya contra el contrato real de `SignalScorer`/`mix.ts` antes de llegar acá.

## Bloque 1 — Visión del Producto (Fase 4)

- **Problema**: las sugerencias del pick #1 (y en general, cualquier pick) no reflejan ninguna
  intención estratégica — el motor no distingue entre "quiero cerrar rápido con push" y "quiero
  escalar a late game" hasta que ya hay picks propios de los que inferir gaps de capacidad
  (`team_synergy`, `position_fit`). El usuario lo describe como "siempre los mismos 3 héroes de
  soporte al inicio" — el problema no es solo falta de variedad, es falta de intención.
- **Usuario**: mismo usuario único del proyecto (uso personal, ver Fase 1/3).
- **Resultado esperado**: (1) poder declarar una intención de draft al arrancar la sesión y ver
  que las sugerencias la reflejan de verdad, no solo en el desglose; (2) que un pick propio abra
  cadenas de sinergia reales sobre los siguientes, no solo cobertura de gaps genérica; (3) que un
  patrón de picks rivales insinuando una composición dispare contras a nivel de arquetipo, no solo
  matchup héroe-a-héroe (`counter` ya cubre eso); (4) que el top-3 dentro de una banda de empate
  real varíe entre corridas, en vez de ser siempre idéntico.
- **Qué NO es**: no reemplaza ninguna señal existente (`position_fit` sigue siendo la de mayor
  peso, Fase 3 no se reabre). No es un sistema de "recomendación de builds/items" — sigue siendo
  exclusivamente picks/bans. No toca el bot del Random Draft Simulator (mismo criterio que Fase 3:
  scoring separado, documentado en `engine.md`, fuera de alcance a propósito). No introduce ningún
  modelo de ML — sigue siendo scoring determinista con datos curados, mismo espíritu que Fase 3.

## Bloque 2 — Dominio e Investigación (Fase 4)

- **Hallazgo 1 (invalida el plan original de la pieza 2)**: la propuesta previa a esta sesión
  asumía que `GET /heroes/{hero_id}/matchups` de OpenDota expone una partición "with" (sinergia de
  compañeros), reutilizando el mismo endpoint que ya consume `counter.ts` para "against". **Falso,
  verificado contra el código fuente real de `odota/core`** (`svc/api/responses/
  HeroMatchupsResponse.ts`, repo público): el shape de respuesta es exclusivamente `{ hero_id,
  games_played, wins }` — solo resultados contra un rival, nunca junto a un aliado. No existe
  endpoint público de sinergia héroe-héroe como compañeros de equipo en la API de OpenDota.
  Consecuencia: la pieza 2 no puede apoyarse en un sync nuevo de OpenDota (`MetaSnapshot.
  heroSynergy?`, tabla C4 nueva) — ese diseño queda descartado.
- **Decisión del usuario sobre el hallazgo 1**: derivar la sinergia en cadena de `capabilities.json`
  (mismo criterio que la pieza 1, "Opción A"), no de una fuente externa nueva. Sin sync nuevo, sin
  tabla SQLite nueva, sin dependencia nueva — el sub-ticket 4.4 (ver Bloque 3) se simplifica
  respecto al diseño original.
- **Hallazgo 2 (redefine la pieza 1, buena noticia)**: `apps/engine/src/draft-paths/build-paths.ts`
  (Fase 2, "Caminos de draft") **ya tiene exactamente el concepto de arquetipo que la pieza 1
  necesita** — `DraftPathArchetype = "push" | "teamfight" | "pickoff" | "scaling"` (`draft-paths/
  types.ts`), con una función ya escrita, probada y en producción (`archetypeFitBonus()`,
  `build-paths.ts`) que puntúa cuánto encaja un candidato (`HeroCapabilities`) con cada uno de los
  4 arquetipos — literalmente los 4 que pidió el usuario (Push/Fast Tempo, Teamfight Heavy, Late
  Game Scaling, Pickoff/Catch), con distinto nombre pero mismo concepto de dominio. Esto significa
  que "Opción A" (derivar de `capabilities.json` vía función pura) ya tiene una implementación de
  referencia real en el repo — no hace falta escribir `archetype-affinity.json` como archivo
  nuevo: la afinidad es barata de calcular al vuelo desde `HeroCapabilities`, materializarla como
  un segundo JSON sería duplicar un dato que ya vive en `capabilities.json` sin necesidad. Ver
  Bloque 3 y el detalle de sub-ticket 4.1 al final de este documento — **esto reinterpreta lo que
  el usuario aprobó como "Opción A"**: mismo principio (derivar, no curar externo), mecanismo más
  simple (función reutilizada, no archivo nuevo). Señalado explícitamente para que el usuario lo
  confirme o lo corrija antes de que 4.1 pase a `/blueprint`.
- **Precedente de producto**: `apps/web/features/draft-paths/` ya expone el vocabulario
  "Push/Teamfight/Pickoff/Scaling" al usuario real, en el panel "Caminos de draft" (post-hoc: "qué
  le falta al draft"). La intención de draft de esta fase (pre-hoc: "qué quiero que sea mi draft")
  reutiliza el mismo lenguaje ya validado, en vez de inventar una taxonomía nueva que competiría
  por atención con una que el usuario ya conoce.
- **Dato que sigue sin existir en ningún lado** (pieza 3, denial de composición): un "quién le
  gana a quién" a nivel de arquetipo (¿qué contrarresta a un draft de `push`?) no se deriva
  directamente de `capabilities.json` — es una relación entre 4 arquetipos, no una propiedad de un
  héroe. Necesita una matriz pequeña (4×4) curada a mano por el usuario (dominio real del juego,
  no dato estadístico) — mismo criterio que cualquier constante de producto ya versionada en el
  repo (`PATH_PRIORITIES` en `build-paths.ts` es del mismo tipo de dato). Detalle exacto pendiente
  del sub-ticket 4.5 (Bloque 3).

## Bloque 3 — Arquitectura e Ingeniería (Fase 4)

### Pieza 1 — Intención de Draft → señal nueva `archetype_fit`

- Tipo reutilizado sin duplicar: `DraftPathArchetype` (`draft-paths/types.ts`) pasa a ser también
  el tipo de la intención de draft — un solo nombre de dominio para el mismo concepto, consumido
  tanto por "Caminos de draft" (post-hoc) como por `archetype_fit` (pre-hoc, la intención elegida
  por el usuario). Legítimo importarlo directo entre `signals/` y `draft-paths/`: ambos viven en
  el mismo proceso (`apps/engine`) — la regla de "espejo a mano, nunca import directo" es
  exclusiva de la frontera `apps/engine` ↔ `apps/web` (`team_synergy.ts` ya importa hoy de
  `draft-paths/gaps.ts` con el mismo criterio).
- 6ª señal, mismo contrato `SignalScorer` que las otras cinco: `score(state, candidate, meta)`,
  puro, nunca I/O. `applicable: false` cuando no se eligió intención (ausente en
  `BuildSuggestionsOptions.archetypeIntent?`) — nunca `raw: null` en ese caso, mismo criterio
  exacto que `hero_pool_fit` (Fase 1b) para "función no configurada". `raw: null` reservado
  exclusivamente para un candidato sin entrada en `capabilities.json` (hoy: cobertura completa, a
  reconfirmar en `/blueprint`).
- Construcción por llamada (no singleton de módulo), mismo patrón que `position_fit`/
  `team_synergy`: depende de un dato inyectado por invocación (`archetypeIntent`), no solo de
  archivos estáticos cargados una vez.
- Detalle de implementación completo, listo para `/blueprint`, al final de este documento
  (sub-ticket 4.1).

### Pieza 2 — Sinergia en cadena → extensión de `team_synergy.ts` (no señal nueva)

- Tras el hallazgo 1 (Bloque 2), se deriva de `capabilities.json`, **sin agregar campos nuevos**
  al schema de `HeroCapabilities` en esta fase — reutiliza exactamente lo que ya existe
  (`hasInitiation`, `hasCatch`, `hasWaveclear`, `structuralDamage`, `teamfight`, `scaling`,
  `damageType`). `team_synergy.ts` ya puntúa cuánto un candidato llena gaps de capacidad del
  equipo propio (`detectDraftGaps`/`filledGaps`); la extensión de esta pieza generaliza esa misma
  lógica a "cuánto complementa a un aliado específico ya elegido", no solo "cuánto llena un hueco
  del equipo en general" — la diferencia es de granularidad (par a par vs. equipo agregado), no de
  fuente de dato. Fórmula exacta (cómo pesar "complementa al último pick" vs. "complementa al
  equipo") pendiente de su propio sub-ticket (4.4) — no bloquea a 4.1.
- Sin `MetaSnapshot.heroSynergy?` nuevo, sin sync C4 nuevo, sin tabla SQLite nueva — el diseño
  original de esta pieza (que sí los necesitaba) queda descartado por el hallazgo 1.

### Pieza 3 — Denial / counter de composición → extensión de `counter.ts` (no señal nueva)

- `counter.ts` ya itera `knownEnemies` (picks rivales conocidos) para matchup héroe-a-héroe. Esta
  pieza agrega una segunda pasada agregada: qué arquetipo dominante insinúan los picks rivales
  (reusa `archetypeFit` de la pieza 1 contra los héroes rivales conocidos, no solo contra
  candidatos propios) y qué candidatos puntúan bien contra ESE arquetipo, vía la matriz 4×4
  mencionada en el Bloque 2 (curada a mano, sub-ticket 4.5).
- No cambia la firma de `counter.ts` (`SignalId: "counter"` se mantiene) — extiende su cálculo
  interno y su `explanation`, mismo criterio que ya se usó para incorporar `knownEnemies`.

### Pieza 4 — Diversificación → cambio en la selección final de `mix.ts` (no en el scoring)

- No toca las 6 señales ni sus pesos. Aplica exclusivamente a qué 3 candidatos de `scored`
  (ya ordenado por `mixScore`) entran al `TOP_N` final: candidatos dentro de una banda de
  tolerancia del líder (número exacto pendiente de `/blueprint`) entran a un softmax de
  temperatura baja; un líder que domina por un margen amplio se sigue mostrando siempre en el
  puesto 1 — nunca se diversifica fuera una sugerencia claramente superior.
- `BuildSuggestionsOptions.random?: () => number` — mismo patrón exacto que `now?: () => number`
  (determinismo inyectable en pruebas). Nueva costura de prueba **S12** (`testing-seams.md`).
- `buildComparison`/`SuggestionComparison` no cambian de contrato — la diversificación ocurre
  después de tener el ranking completo, `buildComparison` sigue operando sobre los primeros dos
  puestos del resultado final tal cual hoy.

## Bloque 4 — Seguridad desde el diseño (Fase 4)

- **Cruce de frontera de confianza**: ninguno nuevo en runtime. Las 4 piezas consumen
  exclusivamente datos que ya están validados en el borde (`capabilities.json` vía `loadHero
  Capabilities()`, S9) o son puramente internos al proceso (`state`, RNG inyectado). El hallazgo 1
  del Bloque 2 elimina el único cruce que el diseño original iba a introducir (sync nuevo hacia
  OpenDota para sinergia de compañeros).
- **Datos sensibles**: ninguno. Mismo tipo de dato agregado y público que el resto del motor.
- **Secretos**: ninguno nuevo.
- **Privilegio**: sin cambios — `apps/engine` no gana ningún acceso de red nuevo. La matriz 4×4 de
  contras por arquetipo (pieza 3) es dato de producto curado a mano, versionado en el repo, mismo
  criterio que `PATH_PRIORITIES`/`capabilities.json` — no en SQLite, no consultada contra ninguna
  fuente externa en runtime.
- **Regla dura que se mantiene intacta**: cero red en el camino caliente del motor. Ninguna de las
  4 piezas la debilita — es, de hecho, más estricta que el diseño original de la pieza 2 (que sí
  iba a abrir un sync nuevo).

## Bloque 5 — Stack Tecnológico (Fase 4)

- **Sin stack nuevo.** `archetype_fit` es un `SignalScorer` más (mismo contrato S3). La
  diversificación es una función pura más dentro de `mix.ts`. Cero dependencias npm nuevas —
  decisión explícita, evita `/gear-up` por completo, igual que Fase 3.

## Bloque 6 — Plan de Validación (Fase 4)

Automatizado, por sub-ticket (cada `SignalScorer`/extensión con su propio archivo de prueba
aislado, mismo criterio que S3 ya exige):
1. `archetype_fit` sin intención elegida → `applicable: false` en los 4 arquetipos, nunca
   `raw: null`.
2. `archetype_fit` con intención "push" → un candidato con `structuralDamage: "high"` puntúa más
   alto que uno con `"low"`, manteniendo el mismo criterio que `archetypeFitBonus` ya prueba hoy
   en `build-paths.test.ts`.
3. **Candado de regresión V5→V6** (mismo criterio que V1→V2 en Fase 1b, no el de V4→V5): con
   `archetypeIntent` ausente, `mixScore` sobre un set de señales fijo debe reproducir exactamente
   los mismos números que `SCORING_WEIGHTS_V5` — candado numérico en `mix.test.ts`, no una
   afirmación de que "el comportamiento no cambió".
4. Diversificación: con un `random?` fijo (valores deterministas), dos corridas con el mismo
   `DraftState`/`MetaSnapshot` producen el mismo `TOP_N` — determinismo real en la prueba, no
   aleatoriedad real capturada por snapshot.
5. **Candado de regresión de pipeline completo** (mismo criterio que Fase 3 con Spectre+Wraith
   King): con una intención de draft elegida, `buildSuggestions` completo debe reflejarla en el
   top-3 real, no solo en el desglose de `archetype_fit` aislado.

Manual, guiado por el usuario (detalle exacto de escenarios pendiente de `/blueprint`, mismo
criterio que Fase 3): elegir "Push" al arrancar un draft vacío y confirmar que el top-3 se inclina
hacia héroes de daño a estructuras/waveclear tempranos, sin que eso rompa la prioridad de
`position_fit` (Fase 3 no se reabre — `position_fit` sigue siendo la señal de mayor peso).

## Cierre — pendiente de `/blueprint`

Números y decisiones sin fijar hasta la síntesis formal:
- Peso exacto de `archetype_fit` dentro de `SCORING_WEIGHTS_V6` y el `RAW_RANGE.archetype_fit`
  correspondiente (la escala natural de `archetypeFitBonus` hoy es 0-3, sin normalizar — decidir
  si se deja así, documentado como rango propio como ya hace `patch_meta`, o se normaliza a 0-1).
- Ancho exacto de la "banda de tolerancia" para la diversificación (pieza 4) y la temperatura del
  softmax.
- Contenido exacto de la matriz 4×4 de contras por arquetipo (pieza 3, sub-ticket 4.5) — dominio
  real del juego, requiere validación directa del usuario, no se infiere de ningún dato existente.
- Fórmula exacta de "sinergia par a par" de la pieza 2 (sub-ticket 4.4) — el Bloque 3 da el
  contrato conceptual (reutiliza campos existentes de `capabilities.json`, sin agregar ninguno
  nuevo en esta fase), no la fórmula matemática final.
- **Confirmación pendiente del usuario**: el hallazgo 2 del Bloque 2 reinterpreta "Opción A" (sin
  archivo `archetype-affinity.json` nuevo, reusando `archetypeFitBonus` de `build-paths.ts` en su
  lugar). El detalle de sub-ticket 4.1 más abajo ya asume esta reinterpretación — corresponde
  confirmarla explícitamente antes de que `/blueprint` la fije en `SPEC.md` §11.
- Ruta de sub-tickets 4.1-4.8: contenido reordenado respecto a la primera propuesta (ver detalle
  de 4.1 abajo) para reflejar que ya no hace falta un ticket separado de "cargar archivo JSON
  nuevo" — a confirmar junto con el punto anterior.

`/blueprint` corre en Opus por política del proyecto. Esta fase no cruza ningún gatillo objetivo
de `CLAUDE.md` (no hay trust boundary nuevo — el hallazgo 1 elimina el único que el diseño
original iba a abrir; no hay migración irreversible; no cambia autenticación ni motor de DB) — es
una extensión de scoring dentro del motor existente, corresponde el flujo normal en Sonnet hasta
`/blueprint`.

---

## Detalle de implementación — Sub-ticket 4.1 (listo para revisión de `/blueprint`)

**Objetivo**: señal `archetype_fit` funcionando de forma aislada (sin integrarse todavía a
`mix.ts`/`SCORING_WEIGHTS_V6` — eso es 4.2), con su propio archivo de prueba, cumpliendo S3.

**Archivos previstos** (2):
1. `apps/engine/src/draft-paths/build-paths.ts` — cambio de una línea: `archetypeFitBonus` pasa de
   función privada a `export function archetypeFitBonus(...)`. Sin cambios de comportamiento, sin
   cambios de firma — solo visibilidad, para que `signals/` pueda reutilizarla sin duplicar la
   fórmula. (Si `/blueprint` prefiere no tocar `draft-paths/` desde `signals/` por separación de
   capas, alternativa: mover `archetypeFitBonus` a `draft-paths/gaps.ts`, que ya es el módulo de
   primitivas puras reutilizado por ambos — decisión menor, no cambia el resto del diseño.)
2. `apps/engine/src/signals/archetype-fit.ts` — nuevo. Contenido:
   - `createArchetypeFitScorer(intent: DraftPathArchetype | undefined): SignalScorer` — mismo
     patrón de fábrica que `createPositionFitScorer`/`createTeamSynergyScorer`.
   - `score(state, candidate, meta)`:
     - `intent === undefined` → `{ signal: "archetype_fit", raw: null, weighted: 0, applicable:
       false, explanation: "Elegí una intención de draft para activar esta señal", sampleSize: 0 }`
       — nunca `raw: null` sin `applicable: false` en este caso (distinción de Fase 1b intacta).
     - candidato sin entrada en `capabilities.json` → `raw: null` (hueco de dato real, único otro
       caso, `applicable` ausente/`true`).
     - caso normal → `raw: archetypeFitBonus(intent, candidate)` (reutilizada de `build-paths.ts`,
       no reimplementada), `explanation` describe qué aporta el candidato a esa intención (mismo
       vocabulario que `GAP_LABELS`/`PATH_LABELS` ya usan en `apps/web`).
   - `id: "archetype_fit"` agregado a `SignalId` (`signals/types.ts`) — **no incluido en el
     conteo de archivos de este sub-ticket si `types.ts` no se toca todavía**: el `SignalId` puede
     ampliarse recién en 4.2 junto con `SCORING_WEIGHTS_V6`, ya que hasta que no se integre a
     `mix.ts` esta señal no participa de ningún tipo compartido. A confirmar en `/blueprint` si
     conviene adelantarlo acá para que el archivo de prueba compile con el tipo real desde el
     principio (probablemente sí — un archivo de prueba que compila es parte del criterio de
     aceptación de S3).
3. `apps/engine/src/signals/archetype-fit.test.ts` — nuevo. Casos mínimos (S3, aislado de las
   otras 5 señales): sin intención → `applicable: false` en los 4 arquetipos; con intención
   "push" → candidato con alta `structuralDamage` puntúa más que uno bajo; candidato sin entrada
   en `capabilities.json` → `raw: null`; nunca lanza una excepción sin capturar (mismo patrón que
   `safeScore` en `mix.ts` ya exige de cualquier scorer).

**Sin edge-validation nueva**: a diferencia del diseño original (que asumía un archivo
`archetype-affinity.json` nuevo, necesitando su propio `loadArchetypeAffinity()` con validación de
borde), esta versión reutiliza `HeroCapabilities[]` ya validado por `loadHeroCapabilities()` (S9,
`draft-paths/capabilities.ts`) — no hay ningún dato nuevo cruzando ninguna frontera en este
sub-ticket. Esto también significa que **no hace falta una costura S11 nueva** para 4.1 — la señal
cae dentro de S3 (como cualquier `SignalScorer`) y depende de S9 (ya existente), sin costura
propia adicional, a diferencia de lo que la primera propuesta de esta fase asumía.

**Fuera de alcance de 4.1** (queda para 4.2 y siguientes): wiring en `mix.ts`, `BuildSuggestions
Options.archetypeIntent?`, `SCORING_WEIGHTS_V6`, cualquier cambio en `apps/web`.

---

# architecture.md — Fase 5 (MVP de Producción: Auth & Personal Hero Pool multi-usuario)

Disparado por decisión de producto del usuario (2026-08-24): preparar dota2coach para que jugadores
reales (no solo el propio desarrollador) puedan loguearse con su cuenta de Steam y recibir
sugerencias personalizadas con su propio `hero_pool_fit`. Insumo de entrada: auditoría de
arquitectura completa del flujo actual de hero pool hecha en esta misma sesión (ver Bloque 2/3 —no
se repite el detalle de archivo:línea acá, se referencia). Alcance confirmado por el usuario vía
`AskUserQuestion` antes de investigar: **multi-usuario real** (no solo reemplazar el campo manual
del propio desarrollador), y **el login de Steam reemplaza el Basic Auth compartido de `proxy.ts`**
como único gate de acceso al sitio.

## Bloque 1 — Visión del Producto (Fase 5)

- **Problema**: hoy `dota2coach` es de un solo usuario de facto — el `account_id` de Steam se pega
  a mano en una pantalla de configuración, y el acceso al sitio entero está detrás de una sola
  contraseña compartida (`proxy.ts`). Ningún jugador real distinto del desarrollador puede tener su
  propio hero pool ni sus propias sugerencias personalizadas.
- **Usuario**: cualquier jugador de Dota 2 con cuenta de Steam — primera vez que el proyecto
  atiende a alguien más que el propio desarrollador (`architecture.md` Bloque 1 original ya
  anticipaba esta visión: "ofrecerlo como servicio a otros jugadores, con cuentas/login").
- **Resultado esperado**: login real con Steam (sin contraseña propia que gestionar), cada cuenta
  con su propio `hero_pool` y su propio `hero_pool_fit` en las sugerencias, sin que el pool o los
  datos de un usuario se filtren a otro.
- **Qué NO es esta fase**: no toca la captura del draft en vivo ni el motor de señales más allá del
  *scoping* por cuenta (`position_fit`/`counter`/etc. no cambian de comportamiento). No es un
  sistema de roles/permisos — todo usuario logueado tiene el mismo nivel de acceso, no hay
  admin/moderación. No extiende el hero pool de compañeros de equipo (Fase 2) a cuentas de Steam
  reales de terceros — sigue siendo dato manual, decisión ya cerrada en `security.md`, no se
  reabre acá. No incluye el flujo de "invitar a un amigo" ni ningún tipo de perfil social.

## Bloque 2 — Dominio e Investigación (Fase 5)

**Verificado con fuentes primarias en esta sesión (WebSearch):**

- **Steam usa OpenID 2.0, no OAuth2/OIDC.** Flujo real: `apps/web` redirige el navegador a
  `https://steamcommunity.com/openid/login` con un `return_to` propio; tras el login del usuario en
  el dominio de Steam, Steam redirige de vuelta con parámetros `openid.*` — el relevante es
  `openid.claimed_id`, con forma `https://steamcommunity.com/openid/id/{steamid64}`. **La firma debe
  verificarse con una segunda llamada de servidor a servidor** (`openid.mode=check_authentication`,
  POST de vuelta a Steam) — sin ese paso, cualquiera puede fabricar una respuesta de "login exitoso"
  con el SteamID que quiera. [Steamworks — User Authentication and Ownership](https://partner.steamgames.com/doc/features/auth),
  [Setting up Steam Authentication using OpenID](https://dev.to/emma/setting-up-steam-authentication-using-openid-20ma).
- **Hallazgo de seguridad real, no hipotético**: la librería más popular para esto en Node
  (`passport-steam`, de `liamcurry`) tiene una vulnerabilidad documentada que permite autenticarse
  como cualquier cuenta de Steam — múltiples forks parcheados existen precisamente por esto
  (`@dessly/passport-steam`, `passport-steam-openid`, `modern-passport-steam`). El protocolo real
  (un redirect + un POST de verificación) es simple; envolver eso en Passport (que el proyecto no
  usa en ningún otro lado) más una dependencia de terceros con historial real de este tipo de bug es
  el mismo tipo de costo que ya llevó al proyecto a curar `hero-positions.json` a mano en vez de
  integrar STRATZ (Fase 3) — mismo principio, se recomienda **implementación manual del protocolo**
  (fetch + verificación de firma), no una librería. [passport-steam-openid](https://github.com/danocmx/passport-steam-openid),
  [@dessly/passport-steam](https://www.npmjs.com/package/@dessly/passport-steam).
- **Conversión SteamID64 ↔ Steam32**: `steamId32 = steamId64 - 76561197960265728` (offset fijo de
  la codificación de Valve; reversible sumando la misma constante). El proyecto ya valida y persiste
  en formato Steam32 (`isValidSteamAccountId()`, fase 1b) — el login de Steam entrega SteamID64 (la
  parte final de `openid.claimed_id`), así que esta conversión es un paso obligatorio antes de
  reutilizar cualquier validación/persistencia ya existente, no un dato nuevo que inventar.
  [Valve Developer Community — SteamID](https://developer.valvesoftware.com/wiki/SteamID).
- **Estrategia de sesión**: `iron-session` (vvo/iron-session) es la opción activa, mantenida, y la
  que la propia documentación oficial de Next.js referencia para sesiones basadas en cookie —
  cifra y firma los datos de sesión dentro de una cookie `httpOnly`, sin necesitar tabla ni servidor
  de sesiones propio. Encaja directo con la restricción real del proyecto ("SQLite es la única
  persistencia, sin infraestructura nueva"). Alternativa evaluada y descartada: implementar el
  cifrado/firma a mano con `node:crypto` para no sumar ninguna dependencia — se descarta porque
  reimplementaría exactamente lo que `iron-session` ya resuelve (nonce, expiración, cifrado
  autenticado) en código de seguridad propio, mayor superficie de bug que una dependencia madura de
  bajo peso. [vvo/iron-session](https://github.com/vvo/iron-session).
- **Contrato `apps/web` → `apps/engine` para propagar el `accountId` verificado**: `apps/engine` no
  tiene hoy ningún concepto de "request autenticado" — solo el `x-capture-token` estático del
  capturador. Evaluadas tres opciones: (a) reenviar la cookie de `iron-session` tal cual — descartada,
  acopla a `apps/engine` con el formato de sesión de `apps/web`, y `apps/engine` tendría que conocer
  el mismo secreto de cifrado de sesión (usado para muchas otras cosas), mezclando responsabilidades;
  (b) un JWT corto firmado (`jose`) — viable, pero suma una dependencia más y una librería más a
  mantener en un proceso (`apps/engine`) que hoy no tiene ninguna dependencia de auth; (c) **un
  token interno corto, HMAC-SHA256 sobre `accountId + timestamp`, firmado con un secreto compartido
  nuevo (`INTERNAL_AUTH_SECRET`, env)** — mismo principio exacto que el `x-capture-token` ya
  existente (secreto en `process.env`, header custom, verificado en el borde), sin dependencia nueva
  en `apps/engine` (`node:crypto`/`Bun.CryptoHasher` ya están disponibles). Recomendada: (c), por
  consistencia con el patrón ya establecido y cero dependencia nueva en el proceso más sensible
  (`apps/engine`, `127.0.0.1`-only).
- **Migración segura desde el estado global actual**: hoy hay exactamente **una cuenta real en
  producción** — el propio usuario, con su `hero_pool` ya calculado y confirmado (`journal.md`,
  2026-07-29). La migración no parte de cero: crea `accounts`, inserta una fila para esa cuenta
  leyendo el `steam_account_id` ya guardado en `settings`, agrega una columna `account_id` a
  `hero_pool` con *backfill* a esa única cuenta existente, y solo entonces cambia la PK a compuesta.
  SQLite no soporta `ALTER TABLE` para cambiar una PK directamente — `drizzle-kit` genera el patrón
  estándar (tabla nueva + copia + drop + rename), viable sin riesgo real dado el volumen bajísimo de
  filas hoy (un puñado de héroes en el pool de una sola cuenta).

## Bloque 3 — Arquitectura e Ingeniería (Fase 5)

- **Los dos procesos siguen separados, sin cambios en esa frontera**: el callback de OpenID
  necesita una URL pública — solo puede terminar en `apps/web` (público). `apps/engine` sigue
  atado a `127.0.0.1` por regla dura, sin excepción — nunca ve el flujo de login de Steam
  directamente, solo recibe el `accountId` ya verificado vía el token interno del Bloque 2.

```
Navegador                apps/web (Next.js, público)         Steam                apps/engine (127.0.0.1)
    │  GET /login               │                              │                        │
    ├──────────────────────────►│                              │                        │
    │                           │ redirect a                   │                        │
    │                           │ steamcommunity.com/openid/... │                        │
    │◄──────────────────────────┤                              │                        │
    │  (login en dominio de Steam, fuera del control de dota2coach)                      │
    │──────────────────────────────────────────────────────────►│                        │
    │◄─────────────────────────────────────────────────────────┤ redirect de vuelta con  │
    │                           │  openid.claimed_id=...        │ openid.* firmado        │
    ├──────────────────────────►│                              │                        │
    │                           │──────────────────────────────►│ check_authentication    │
    │                           │◄──────────────────────────────┤ (verifica firma real)   │
    │                           │  steamId64 → steamId32        │                        │
    │                           │  crea sesión iron-session      │                        │
    │                           │  (cookie httpOnly)             │                        │
    │◄──────────────────────────┤                              │                        │
    │  cookie de sesión seteada │                              │                        │
    │                           │  cada request a /api/*        │                        │
    │                           │  genera token HMAC(accountId, │                        │
    │                           │  ts) con INTERNAL_AUTH_SECRET  │                        │
    │                           ├───────────────────────────────────────────────────────►│
    │                           │            x-account-token: <hmac>                     │
    │                           │◄───────────────────────────────────────────────────────┤
```

- **`apps/web`**: `iron-session` gestiona la cookie de sesión (contiene `accountId`/Steam32, nunca
  el SteamID64 crudo ni datos de perfil). El middleware que hoy hace Basic Auth (`proxy.ts`) se
  reemplaza por una verificación de sesión — sin cookie válida, cualquier ruta (salvo `/login` y
  `/healthz`) redirige a login. `fetchBaseQuery` de `apps/web/lib/engine-api.ts` gana
  `prepareHeaders` para adjuntar el token HMAC en cada llamada a `apps/engine`, leyendo el
  `accountId` de la sesión activa — nunca del estado de un componente (a diferencia del flujo actual
  en `HeroPoolConfig.tsx`, que hoy pide el `accountId` a mano en un input).
- **`apps/engine`**: cada ruta que hoy lee/escribe `hero_pool`/`settings` sin ningún control de
  acceso pasa a exigir el header `x-account-token`, lo verifica (HMAC + ventana de tiempo corta
  contra repetición) y usa el `accountId` verificado para *scopear* la consulta — nunca confía en un
  `accountId` que venga en el cuerpo/query de la request. `POST /ingest/draft-event` (el capturador)
  no cambia — sigue usando `x-capture-token`, es un contrato completamente distinto.
- **`buildMetaSnapshot(db, accountId)`** gana el parámetro que hoy no tiene — las consultas a
  `hero_pool`/`settings` (líneas ya identificadas en la auditoría de esta sesión) se filtran por esa
  cuenta. **`cachedSnapshot` (singleton de módulo) pasa a `Map<accountId, MetaSnapshot>`** —
  invalidación exactamente igual que hoy (`invalidateMetaSnapshotCache`), pero recibe `accountId` y
  borra solo la entrada de esa cuenta del mapa, nunca el mapa entero (para no penalizar a otras
  sesiones activas en paralelo con un recálculo innecesario).
- **Handshake de WebSocket** (`apps/web/features/draft/socket.ts` → `apps/engine/src/server/
  session.ts`): el mensaje `hello` gana `accountId` + el mismo token HMAC del Bloque 2 (no una
  cookie — WebSocket no reenvía cookies HttpOnly de forma transparente entre orígenes distintos de
  forma confiable). `apps/engine` verifica el token en el momento del `hello`, antes de aceptar la
  conexión — un `hello` con token inválido/vencido se rechaza con el mismo mecanismo de error ya
  usado para otras validaciones de borde del reductor (nunca tira el proceso).
- **Schema (Drizzle)**: tabla nueva `accounts` (PK `id` autogenerada o el propio `steamId32` como
  PK, a fijar en `/blueprint`; columnas mínimas: `steamId32`, `createdAt`). `hero_pool` cambia de PK
  simple (`heroId`) a compuesta (`accountId`, `heroId`), con FK a `accounts`. `settings` dejaría de
  ser el lugar del `steam_account_id`/`personal_baseline_winrate` — esos dos valores pasan a vivir
  como columnas de `accounts` (uno por cuenta, no una fila global) o de un `account_settings` propio
  — decisión de detalle para `/blueprint`, no una ambigüedad de fondo.

## Bloque 4 — Seguridad desde el diseño (Fase 5)

- **Frontera de confianza nueva #1**: navegador → `apps/web`, en el callback de OpenID. Dato
  hostil posible: una respuesta de "login exitoso" fabricada con cualquier `steamid64`. Mitigación:
  la verificación `check_authentication` (Bloque 2) es obligatoria, no opcional — sin ella, este
  cruce queda completamente abierto (es exactamente la vulnerabilidad real ya documentada de
  `passport-steam`). Nunca confiar en `openid.claimed_id` sin la verificación de vuelta a Steam.
- **Frontera de confianza nueva #2**: `apps/web` → `apps/engine`, el token interno HMAC. Dato
  hostil posible: un cliente que hable directo con `apps/engine` (ambos en la misma red local)
  intentando falsificar el `accountId` de otra cuenta. Mitigación: el HMAC usa un secreto que solo
  conocen los dos procesos (`INTERNAL_AUTH_SECRET`, nunca expuesto al navegador), con ventana de
  tiempo corta para evitar reuso de un token capturado (replay).
- **Frontera de confianza nueva #3**: el `hello` de WebSocket. Mismo mecanismo y misma mitigación
  que #2 — es la misma frontera, otro transporte.
- **Dato personal, ahora a escala real**: hasta hoy el único `account_id` del proyecto era el del
  propio desarrollador. Con multi-usuario real, cada cuenta logueada es una persona real distinta.
  Sigue siendo un dato de naturaleza pública (cualquiera puede consultar el perfil de Steam de
  cualquier `accountId`), pero el sistema ahora los administra a escala — se mantiene el mismo
  cuidado que ya rige `account_id` desde fase 1b (nunca en logs/`journal.md`/tickets/errores),
  extendido a *todas* las cuentas, no solo la del desarrollador.
- **Secretos nuevos**: `INTERNAL_AUTH_SECRET` (compartido entre `apps/web`/`apps/engine`, HMAC) y el
  `password`/`SESSION_SECRET` que `iron-session` exige (mínimo 32 caracteres). Ninguno requiere una
  cuenta ni una API key externa — Steam OpenID no exige credencial alguna del sitio para el login
  básico (a diferencia de OAuth2, no hay `client_id`/`client_secret` que registrar). Ambos viven
  únicamente en `process.env`, nunca en el repo — mismo principio ya vigente.
- **Privilegio**: `apps/engine` gana la responsabilidad de rechazar con `401` cualquier request a
  `hero-pool`/`settings` sin token interno válido — hoy esas rutas son de lectura/escritura sin
  ningún control de acceso (hallazgo real de la auditoría de esta sesión: `GET /api/settings`
  devuelve todo sin filtrar a cualquiera que llegue al puerto). El binding a `127.0.0.1` no cambia.
- **`proxy.ts` (Basic Auth)**: se retira por completo, confirmado por el usuario — el login de Steam
  pasa a ser el único gate de acceso al sitio. Evita mantener dos mecanismos de auth en paralelo.

## Bloque 5 — Stack Tecnológico (Fase 5)

**Opción A (recomendada, la más simple y la que sigue el patrón ya usado por el proyecto):**
- `iron-session` — única dependencia de producción nueva en `apps/web` (sesión por cookie).
- Verificación del protocolo Steam OpenID **implementada a mano** (un `fetch` para construir la URL
  de login, un `fetch` de servidor a servidor para `check_authentication`) — cero dependencia nueva
  para esto, evita el historial real de bugs de las librerías de terceros (Bloque 2).
- Token interno HMAC con `node:crypto`/`Bun.CryptoHasher` — ya disponible, cero dependencia nueva en
  `apps/engine`.
- `drizzle-kit` para la migración de schema — ya es `devDependency` existente, bypass total de
  Governance 2.0, sin pasar por `/gear-up`.
- **Total: 1 dependencia de producción nueva** (`iron-session`) — exige pasar por `/gear-up`/
  `@depcheck` y marcarse `// ALLOWED`, como cualquier `dependency` nueva.

**Opción B (descartada, mencionada para que quede el porqué):** `passport` + `passport-steam-openid`
(o algún fork parcheado) — 2-3 dependencias más, introduce una capa de abstracción (Passport) que el
proyecto no usa en ningún otro lado, para un protocolo que en sí mismo es un redirect y un POST de
verificación. Mismo principio que ya aplicó el proyecto en Fase 3 (curar a mano en vez de sumar un
proveedor/dependencia cuando el costo real de hacerlo a mano es bajo y controlable).

## Bloque 6 — Plan de Validación (Fase 5)

1. Un usuario nuevo (cuenta de Steam distinta a la del desarrollador) puede loguearse y ve su propio
   `hero_pool` vacío al principio — nunca el pool del desarrollador ni de ningún otro usuario.
2. Dos cuentas reales distintas configuran/calculan cada una su propio pool en paralelo; las
   sugerencias de una nunca reflejan el pool de la otra — prueba explícita de aislamiento, con y sin
   `MetaSnapshot` cacheado simultáneamente para ambas.
3. La cuenta ya real en producción (el propio desarrollador) migra sin perder su `hero_pool` ya
   calculado — criterio de aceptación verificado contra el dato real, no solo contra un fixture.
4. Sin sesión válida, cualquier ruta del sitio (salvo `/login`/`/healthz`) redirige a login —
   `proxy.ts`/Basic Auth queda completamente retirado, confirmado.
5. La verificación HMAC del contrato interno no suma latencia perceptible al presupuesto de 500ms
   del motor — medido, no asumido (mismo estándar que ya exige `engine.md` para cualquier señal).
6. Un token interno capturado y reenviado fuera de su ventana de validez es rechazado — prueba
   explícita de replay, no solo de "el HMAC no coincide".

## Cierre — pendiente de `/blueprint`

Números y decisiones sin fijar hasta la síntesis formal:
- PK exacta de `accounts` (`id` autogenerado vs. `steamId32` como PK directa) y si
  `personal_baseline_winrate`/`steam_account_id` migran a columnas de `accounts` o a un
  `account_settings` propio.
- Ventana de validez exacta del token HMAC interno (segundos) y el mecanismo exacto anti-replay
  (nonce vs. solo timestamp).
- TTL de la cookie de `iron-session` y si hay renovación silenciosa o el usuario tiene que
  re-loguearse tras vencer.
- Si se guarda algo del perfil público de Steam (nombre, avatar) para mostrarlo en la UI, o el MVP
  se queda solo con el `accountId` — implica o no una llamada extra a la Steam Web API (que sí
  requiere una API key propia, secreto nuevo no contemplado en el Bloque 4 de este documento si se
  decide que sí).
- Nombre exacto del header interno (`x-account-token` usado como placeholder en el Bloque 3) y
  forma exacta del payload firmado.
- Orden exacto de los tickets de migración (¿la tabla `accounts` y el *backfill* van en un ticket
  separado del cambio de PK de `hero_pool`, o es una sola unidad lógica con excepción documentada
  de migración de schema, mismo criterio que ya usa `CLAUDE.md` para migraciones Drizzle?).

**Gatillos de Opus confirmados para `/blueprint`** (`CLAUDE.md`, sección de excepciones
documentadas): esta fase cruza **dos** de los gatillos objetivos listados — cambio de trust boundary
respecto a lo que definía `architecture.md` hasta ahora (login real + multi-cuenta) y modificación
de autenticación/permisos (literal). No es una decisión ambigua ni una excepción a justificar caso
por caso — corresponde razonamiento caro en `/blueprint`, una sola vez, igual que en fase 1, 1b, y
Fase 3.

---

# architecture.md — Fase 6 (Formalizar Pro-Drafter: apertura de equipo consciente de bans)

## Bloque 1 — Visión del Producto (Fase 6)

- **Problema**: el top-5 de apertura de equipo del Copilot (simulador) se siente repetitivo entre
  drafts distintos, aunque los bans cambien ronda a ronda — feedback directo del usuario probando
  el simulador, con evidencia concreta (captura de pantalla + diagnóstico propio de Codex a mitad
  de un fix). Dos causas menores ya se corrigieron en la sesión que originó esta fase: el
  encabezado de fase repetido idéntico en las 5 tarjetas (TSK-124), y el wording genérico del bono
  por ban (fix de Codex, terminado). Queda la causa de fondo: `MAX_COUNTER_RELIEF = 0.12` en
  `drafter/team-opener.ts` es chico frente al peso dominante de `position_fit` (0.38 de
  `SCORING_WEIGHTS_V5`) — casi ningún ban reordena el top-5 real, solo cambia el texto que lo
  justifica.
- **Usuario**: mismo usuario único del proyecto.
- **Resultado esperado**: que el top-5 de apertura reaccione de verdad a qué se baneó — un ban que
  elimina a un héroe de rol comprometido (baja entropía de posición) debe pesar distinto que un ban
  sobre un héroe flexible (alta entropía), no solo un bono plano igual para cualquier counter
  neutralizado.
- **Qué NO es**: no reescribe `SCORING_WEIGHTS_V5` (sigue congelada, sin tocar). No es la
  arquitectura de matrices $C$/$S$/vector de 8 dimensiones propuesta originalmente por el
  usuario vía un system-prompt de rearquitectura — esa propuesta se contrastó contra el código real
  y se descartó en favor de formalizar lo que ya existe (Bloque 2). No introduce Python ni ningún
  runtime nuevo. No construye una matriz de sinergia de aliados nueva (ver hallazgo del precedente
  de Fase 4 en el Bloque 2) ni unifica `capabilities.json`/`lane/hero-line-profiles.json` en un solo
  esquema. No toca el bot del Random Draft Simulator (mismo criterio que fases anteriores).

## Bloque 2 — Dominio e Investigación (Fase 6)

- **Hallazgo 1 (decisivo)**: ya existe un segundo motor de scoring completo, construido y probado,
  apagado detrás de `ENABLE_PRO_DRAFTER` (`apps/engine/src/pipeline/`, `knn/`, `lane/`, `intent/`,
  spec'd en `docs/research/pro-drafter-spec-v1.md`, explícitamente "no vinculante"). Su
  `intent/denial-score.ts` (`DenialScore = Σ_p P(pos)·MatchupWinrate + β·EarlyPressure·H(F)`,
  entropía de Shannon sobre la distribución de posición) es, matemáticamente, la formalización más
  cercana que existe hoy a lo que el usuario pedía como "Threat Release/Un-countered Window" — pero
  **nunca corre en el momento de apertura de equipo**: `pipeline/run-pipeline.ts` tiene
  `TOP_N = 3` hardcodeado (línea confirmada leyendo el código: `.slice(0, TOP_N)`) y, sin picks
  rivales revelados, `flexTargets.length === 0` hace que `denial_score` degrade a neutro/null para
  todos los candidatos. Formalizar Pro-Drafter en el vacío no arreglaría la queja real — hace falta
  construirle un camino de apertura que hoy no existe.
- **Hallazgo 2 (repite un precedente ya cerrado en Fase 4, verificado de nuevo, no solo recordado)**:
  no existe ningún endpoint de OpenDota que exponga sinergia de aliados (confirmado por dos vías
  independientes en esta sesión: búsqueda web actual, y el hallazgo ya documentado en la Fase 4 de
  este mismo archivo contra el código fuente real de `odota/core`, `HeroMatchupsResponse.ts`: el
  shape es exclusivamente `{hero_id, games_played, wins}` contra un rival, nunca junto a un
  aliado). Fase 4 ya decidió, ante el mismo problema, derivar sinergia de `capabilities.json` en
  vez de recolectar un dato estadístico nuevo — Fase 6 sigue el mismo criterio: **se descarta
  construir una tabla `heroSynergy`/script de recolección nuevo** (simplifica el plan original de
  esta fase). El contador ($C$) tampoco necesita nada nuevo — `MetaSnapshot.matchups` ya lo cubre,
  sincronizado y en producción desde antes de esta fase.
- **Hallazgo 3**: los "vectores de atributos tácticos" ya existen, repartidos en dos datasets con
  escalas distintas — `capabilities.json` (7 campos ordinales/booleanos, 124/126 héroes) y
  `lane/hero-line-profiles.json` (5 dimensiones continuas `[0,1]`, solo 15/126 héroes, dark). Se
  mantienen separados a propósito (responden preguntas distintas en momentos distintos del draft:
  clasificación de arquetipo de partida completa vs. modelo de interacción de lane 2v2) — unificar
  en un solo esquema de 8 dimensiones tocaría `archetype-fit.ts`, `build-paths.ts` y
  `openingStrategy` de `mix.ts` a la vez sin beneficio comprobado.
- **Hallazgo 4**: el sistema de "buckets tácticos" (push/teamfight/pickoff/scaling) ya está
  construido, probado y reusado en 3 lugares (`draft-paths/build-paths.ts::archetypeFitBonus`,
  `signals/archetype-fit.ts`, `mix.ts::openingStrategy`) — no se reinventa ni se duplica.
- **Decisión del usuario sobre el mecanismo de relief**: si la Fase 4 de evaluación (ver Bloque 6)
  confirma que el término ban-aware nuevo mejora sobre el mecanismo actual, **reemplaza
  eventualmente** `MAX_COUNTER_RELIEF` en `team-opener.ts` — no quedan V5 y Pro-Drafter con dos
  mecanismos de relief por ban compitiendo indefinidamente.

## Bloque 3 — Arquitectura e Ingeniería (Fase 6)

- `intent/denial-score.ts` **no se edita** — la fórmula ya es la formalización correcta. Solo
  cambia su fuente de `MatchupWinrate`: de `run-pipeline.ts`'s `corpusMatchupWinrate` (proxy sobre
  el corpus chico de ~175 drafts, ignora posición) a un adaptador respaldado por
  `MetaSnapshot.matchups` (real, ya sincronizado), misma firma.
- `pipeline/run-pipeline.ts` gana un modo `teamOpening`: 5 opciones diversificadas en vez del
  `TOP_N = 3` hardcodeado, combinando `knn_similarity` (sin cambios) con un término de relief
  ban-aware de la misma forma que `calculateDenialScore`, aplicado contra la distribución de
  posición inferida de los **héroes baneados** (vía la maquinaria de entropía ya existente en
  `intent/position-prior.ts`) en vez de picks rivales revelados — reemplazo directo del bono plano
  actual. Diversifica por `openingStrategy`/`archetypeFitBonus` (Hallazgo 4), mismo criterio que
  `team-opener.ts` ya usa hoy.
- `pipeline/feature-extractor.ts` se extiende para aceptar `HeroCapabilities[]` opcional (hoy nunca
  las lee) y exponer el bucket de arquetipo de cada candidato — necesario para la diversificación
  de arriba.
- Archivo nuevo `pipeline/phase-decay.ts`: generaliza el precedente de `TIMING_BLEND` de
  `position-fit.ts` (`[.5,.3,.15,0]`) a un blend continuo aplicado a los 3 pesos de
  `PipelineWeights`, indexado por conteo de picks propios/rivales. `decision-context.ts` se lee
  como precedente del gate discreto de 4 fases, no se edita.
- `server/routes/pro-drafter.ts`: extiende para devolver 5 sugerencias en el caso de apertura,
  siempre detrás de `ENABLE_PRO_DRAFTER`, con el mismo fallback a V5 ya existente si el pipeline
  falla o excede el timeout.
- **`SignalId`/`SCORING_WEIGHTS_V1`-`V5` no se tocan.** Toda dimensión nueva vive en el universo ya
  separado de `pipeline/merge.ts` (`PipelineSignalId = "knn_similarity"|"lane_score"|
  "denial_score"`) — el término ban-aware alimenta el insumo crudo de `denial_score`, no agrega una
  cuarta clave.

## Bloque 4 — Seguridad desde el diseño (Fase 6)

- **Cruce de frontera de confianza**: ninguno nuevo. La decisión de descartar `heroSynergy`
  (Hallazgo 2) elimina el único sync/tabla SQLite nueva que el diseño original de esta fase iba a
  introducir. Todo lo que se toca consume datos que ya están validados en el borde
  (`capabilities.json` vía su loader existente, `MetaSnapshot.matchups` ya sincronizado desde
  OpenDota, `hero-positions.json` vía su loader existente).
- **Datos sensibles**: ninguno. Mismo tipo de dato agregado y público que el resto del motor.
- **Secretos**: ninguno nuevo.
- **Privilegio**: sin cambios. `ENABLE_PRO_DRAFTER` sigue siendo el único gate — esta fase no
  expone la ruta a nadie que no la tuviera ya, ni agrega ningún acceso de red nuevo a `apps/engine`.
- **Regla dura que se mantiene intacta, reforzada**: cero red en el camino caliente. Descartar
  `heroSynergy` deja esta fase con menos superficie nueva que el diseño original, no más.

## Bloque 5 — Stack Tecnológico (Fase 6)

- **Sin stack nuevo.** Bun/TypeScript únicamente — decisión explícita del usuario, confirmada
  contra el hecho verificado de que el proyecto no tiene Python en ningún lado hoy y de que
  introducirlo exigiría un toolchain nuevo sin beneficio (ver investigación previa a este
  `/pre-flight`). Cero dependencias npm/bun nuevas: todo el trabajo reusa `OpenDotaClient` y los
  módulos ya existentes de Pro-Drafter. Sin necesidad de `/gear-up`.

## Bloque 6 — Plan de Validación (Fase 6)

Automatizado, por extensión, cada una con su propio archivo de prueba aislado (mismo criterio S3/
S9/S10 de `testing-seams.md`):
1. `phase-decay.ts`: los pesos generalizados siguen sumando exactamente 1.0 para cualquier
   combinación de conteos de picks propios/rivales.
2. `run-pipeline.ts` modo `teamOpening`: con `own=[]`/`enemy=[]`, produce 5 opciones, no 3.
3. **Candado de sensibilidad — el criterio de éxito real de toda la fase**: dos conjuntos de bans
   distintos sobre el mismo estado producen un top-5 medible mente distinto (comparación numérica
   exacta, mismo criterio que ya usa `mix.test.ts` para V4→V5, aplicado al revés: probar
   sensibilidad, no invarianza).
4. Diversificación por estrategia: las 5 opciones no repiten la misma estrategia más allá del
   criterio ya probado en `team-opener.test.ts`.
5. Fallback intacto: con `ENABLE_PRO_DRAFTER` apagado, el camino de apertura sigue siendo
   exactamente el de `team-opener.ts`/V5 — cero regresión, candado numérico, no solo "no rompió
   nada a ojo".

Manual, guiado por el usuario: correr el script de evaluación extendido
(`scripts/evaluate-pro-drafter.ts`, nuevo modo de la Fase 4 del plan) sobre una muestra real de
bans variados y confirmar que la métrica de repetición baja de forma perceptible frente a V5 —
convierte "se siente repetitivo" en un número, antes de considerar cualquier promoción.

## Cierre — pendiente de `/blueprint`

Números y decisiones sin fijar hasta la síntesis formal:
- Peso exacto del término ban-aware dentro de `PipelineWeights`/`phase-decay.ts` (la forma de la
  fórmula ya está fijada por el Bloque 3, el número no).
- Umbral/criterio exacto de "cuánto debe diferir el top-5 entre dos conjuntos de bans" para
  considerar superada la evaluación de la Fase 4 del plan.
- Momento exacto en que `team-opener.ts` pierde `MAX_COUNTER_RELIEF` una vez confirmado el
  reemplazo (¿mismo commit que activa el nuevo mecanismo, o un ticket de limpieza posterior?).
- Confirmar que extender `feature-extractor.ts`/`run-pipeline.ts` no rompe el contrato de 3
  sugerencias del modo normal (no team-opening) — candado de regresión de pipeline completo, mismo
  criterio que otras fases.
- Alcance exacto de los sub-tickets (cuántos, en qué orden) — el plan guardado en
  `/Users/usuario/.claude/plans/system-prompt-act-parsed-reef.md` da la secuencia de fases
  conceptual (0-4), `/blueprint` la convierte en tickets `TSK-XXX` reales.

**Gatillos de Opus** (`CLAUDE.md`, sección de excepciones documentadas): esta fase **no** cruza
ningún gatillo objetivo — la decisión de descartar `heroSynergy` (Hallazgo 2) elimina el único
cruce de frontera de confianza nuevo que el diseño original iba a abrir; no hay migración
irreversible, no cambia autenticación ni motor de base de datos. Corresponde el flujo normal en
Sonnet hasta `/blueprint`, mismo criterio que Fase 4 bajo circunstancias equivalentes.

---

# architecture.md — Fase 8 (Rehabilitar `counter`: base curada de counter-picks + shrinkage; + higiene de superficie)

`/pre-flight` completo (2026-08-28), corrido en Sonnet. Input: consulta a DeepSeek (respuesta
completa en el hilo de la sesión) + grounding directo del código (`counter.ts`,
`relationship-index.ts`, `pro/shrinkage.ts`, `mix.ts`). Decisiones cerradas con el usuario vía
`AskUserQuestion`.

## Bloque 1 — Visión del Producto (Fase 8)

**Problema.** La señal `counter` del motor está prácticamente muerta. Filtra todo matchup
héroe-vs-héroe con menos de `RELATIONSHIP_MIN_GAMES = 200` partidas de muestra, y en la base local
(15.984 pares, promedio 78 partidas/par) **sólo el 7.3% llega a 200**. Consecuencia real
observada en QA del simulador: el Copilot recomienda Huskar de último pick contra un Ancient
Apparition ya revelado — un hard counter de libro — porque el par Huskar↔AA tiene 42 partidas
(42.9% winrate para Huskar) y se descarta por `42 < 200`. Para Huskar, **cero** de sus 126
matchups llegan al umbral: la señal es ciega contra todos los héroes.

**Usuario final.** El mismo del resto del proyecto: un jugador de Dota 2 usando el draft coach en
el Simulador de Draft.

**Resultado tangible esperado.** Que el Copilot deje de recomendar picks obviamente counterados
(capa A: hard counters), y que además pueda **rankear** entre candidatos cuando ninguno es un hard
counter listado (capa B: la "zona gris", ~50% de los drafts) — hoy en la zona gris `counter`
devuelve `raw: null` para todos y no aporta nada.

**Qué NO es.** No es un predictor completo de matchups. No modela counter-por-lane vs
counter-por-teamfight, ni counters que dependen de un ítem específico (`Spirit Vessel`, `Aghanim`)
en v1 — el schema deja lugar para eso pero no se llena ahora. No reabre `SCORING_WEIGHTS_V6` ni
toca el peso de `counter` (0.216): rehabilita la señal, no la re-pondera. No cambia la
sincronización de meta (S6) ni agrega STRATZ. No borra ninguna ruta ni feature: 8B **oculta**,
no resta.

## Bloque 2 — Dominio e Investigación (Fase 8)

**Datos que necesita.**

1. **`hero-counters.json`** (nuevo, curado, versionado en el repo). Mismo patrón exacto que
   `hero-positions.json` (Fase 3) y `capabilities.json` (Fase 2): dato de dominio que la
   estadística ruidosa no da bien, se cura a mano. Schema v1 mínimo:

   ```jsonc
   {
     "<heroId>": [
       { "vs": <heroId>, "level": "hard" | "medium", "why": "<mecánica, texto visible>" }
     ]
   }
   ```

   - `level`: dos niveles en v1 (`hard` / `medium`). `situational` + `phase` + `requires_item`
     (propuestos por DeepSeek) quedan como campos futuros, no se llenan ahora.
   - `why`: obligatorio — es el texto que la UI muestra ("AA bloquea tu curación con Ice Blast").
     Sin esto el coach es una caja negra.
   - **Fuente y método (decisión del usuario: "esto puede ser un simple deep research")**: se
     produce por investigación de conocimiento público estándar de Dota 2 (wikis de héroe,
     consenso de guías de alto nivel) para un borrador inicial de ~30 héroes más comunes, que el
     usuario revisa y corrige antes de que entre. **No se scrapea Dotabuff** (ToS). Validación /
     cuantificación posterior contra datos grandes (OpenDota Explorer, `fetch-expanded-matchups.ts`
     ya existe) es v2, no bloquea.
   - Alcance del borrador: los ~30 héroes más pickeados, ~3-8 counters cada uno.

2. **`MetaSnapshot.matchups`** (ya existe, ya sincronizado desde OpenDota, S6). La capa
   estadística lo consume sin cambios en la frontera.

3. **`pro/shrinkage.ts`** (ya existe, de TSK-165, sin usar): `shrinkEstimate(observed, sampleSize,
   prior, priorStrength, minimumSampleSize)`. Se reutiliza — no se reimplementa.

**Competidores.** Los sitios de counter-picks de Dota (Dotabuff "worst versus", counter-pick
wikis) ya publican esta info; lo que les falta es integrarla a un flujo de *draft en curso* con
explicación. Ese es exactamente el valor que agrega esta fase.

## Bloque 3 — Arquitectura e Ingeniería (Fase 8)

### 8A — `counter` con capa curada (piso) + capa estadística (ajuste acotado)

Diagrama de bloques:

```
  hero-counters.json ──loadHeroCounters()──┐   (S9: validado al cargar, corrupto -> mapa vacío)
                                           ▼
  DraftState ──observedDraftFacts()──▶ createCounterScorer(curated, opts).score(state, cand, meta)
  MetaSnapshot.matchups ──counterRows(cand, rivals, minGamesBajo)──┘
                                           │
                    ┌──────────────────────┴───────────────────────┐
                    ▼                                              ▼
     CAPA CURADA (piso)                              CAPA ESTADÍSTICA (ajuste acotado)
     rivales revelados que están en                 rivales revelados que NO están en
     curated[cand] -> magnitud fija por             la lista -> counterRows con minGames bajo,
     level (M_hard / M_medium) + `why`              delta descontado por tamaño de muestra
     acumulado                                      (shrinkEstimate) y ponderado por la
                    │                               `confidence` de Wilson que el índice YA calcula
                    └──────────────┬───────────────────────────────┘
                                   ▼
        raw = piso + clamp(ajusteEstadístico, -B, +B)     (ambas vacías -> raw: null, igual que hoy)
                                   ▼
        RAW_RANGE.counter (rango revisado si el piso lo excede) -> [0,100] -> peso 0.216 (V6, intacto)
```

**Cambios de código, por archivo:**

- **`apps/engine/src/signals/hero-counters.ts`** (nuevo): `loadHeroCounters()` + validación de
  borde (descarta entradas malformadas, IDs de héroe desconocidos, `level` inválido; archivo
  corrupto -> mapa vacío, nunca tira el motor). Mismo criterio literal que `loadHeroPositions()` /
  `loadHeroCapabilities()`.
- **`apps/engine/src/signals/hero-counters.json`** (nuevo): el dato curado.
- **`apps/engine/src/signals/counter.ts`**: `counterScorer` (singleton de módulo) pasa a
  **fábrica** `createCounterScorer(curated, opts)` — el mismo patrón que `createPositionFitScorer`
  / `createTeamSynergyScorer` ya usan. `score()` gana las dos pasadas (curada + estadística) y la
  combinación piso + ajuste acotado. **La lógica de shrinkage y de ponderación por confianza vive
  acá**, sobre lo que `counterRows` ya devuelve.
- **`apps/engine/src/signals/relationship-index.ts`**: **sin cambios estructurales.**
  `createRelationshipIndex(matchups, minGames)` ya toma `minGames` como parámetro (línea 56);
  `counter.ts` lo llama con el valor bajo nuevo. El descuento por muestra (`delta * games/(games+P)`)
  usa `delta` y `games`, ambos ya presentes en `CounterEvidence` — no hace falta exponer campos
  nuevos. (Si el `/blueprint` decidiera shrink hacia 0.5 en vez de descontar el delta, ahí sí se
  agrega un campo `observedWinrate` a `CounterEvidence` — aditivo, los consumidores actuales lo
  ignoran.)
- **`apps/engine/src/signals/mix.ts`**: `MODULE_HERO_COUNTERS = loadHeroCounters()` a nivel de
  módulo (como `MODULE_HERO_POSITIONS`); `createCounterScorer(...)` se ensambla por llamada en el
  array `scorers` (como `position_fit`/`team_synergy`). `RAW_RANGE.counter` **se revisa** si el
  piso curado excede `[-0.12, 0.12]` — decisión de número del `/blueprint`.
- **`apps/engine/src/signals/counter.test.ts` / `mix.test.ts`**: el candado de regresión (ver
  Bloque 6).

**Tiempo real:** no. Misma restricción de siempre — el motor no llama a la red en el camino
caliente; `hero-counters.json` se carga una vez al iniciar el módulo.

**Monolito:** sin cambios — es una señal más dentro de `apps/engine`, no hay servicio nuevo.

**Persistencia:** `hero-counters.json` es archivo estático versionado en el repo, **no SQLite**
(mismo criterio que `capabilities.json`/`hero-positions.json`). La capa estadística lee la SQLite
de meta ya sincronizada, sin cambios.

### 8B — Higiene de superficie (reversible, cero borrado)

Decisión del usuario: "lo que creas que se deba quedar para aprobar y hacer todo el flujo de
simulador, dejalo".

- **Nav activo:** Simulador de Draft (`/simulator`), Mi pool (`/hero-pool`), Meta (`/meta`),
  Configuración (`/settings`). Cubren login + cuenta + pool + el flujo completo del simulador +
  ver/refrescar el estado del meta.
- **Se saca del nav (ruta, código y tests intactos; alcanzable por URL directa):** Draft en vivo
  (`/live-draft`, ya gateado por `DRAFT_LIVE_ENABLED`, apagado), Equipos (`/team-groups`, el
  simulador no lo usa), Héroes (`/heroes`, informativo, no hace falta para el flujo).
- **Implementación:** editar el array de links en `apps/web/components/nav-bar/NavBar.tsx`. Nada
  más. Redirects legacy (`/draft`, `/random-draft`) quedan.
- **Overwolf / OCR:** ya dormidos (nunca construidos / spike sin correr). Se documentan
  explícitamente como "stand-by hasta que se retome la captura desde Dota 2 real" — no se tocan.

## Bloque 4 — Seguridad desde el diseño (Fase 8)

**Fronteras de confianza — ninguna nueva.**

- `hero-counters.json`: dato curado del repo, mismo perfil de confianza que `capabilities.json` /
  `hero-positions.json`. Es "input externo" en el sentido del proyecto (se valida en el borde al
  cargarlo, nunca se confía en su forma), pero **no cruza ninguna frontera de red ni de proceso**.
  Un archivo corrupto o manipulado en el repo degrada a "sin datos curados" (mapa vacío) — la
  capa estadística sigue funcionando, el motor nunca se cae ni inyecta magnitudes arbitrarias.
- La capa estadística lee `MetaSnapshot.matchups`, ya validado en la sincronización (S6). Sin
  cambios a esa frontera.
- 8B no toca `proxy.ts` ni el gate de sesión de Steam. Sacar links del nav no cambia qué rutas
  existen ni quién puede acceder — el perímetro de auth es el mismo.

**Datos sensibles:** ninguno nuevo. Sin PII, sin credenciales, sin pagos. `hero-counters.json` es
conocimiento público de Dota 2.

**Secretos:** ninguno nuevo. Sin dependencia nueva, sin API key (STRATZ queda fuera de alcance,
como en Fase 3).

**Privilegio mínimo:** `counter.ts` sigue siendo una función pura sin I/O; el loader sólo lee un
archivo estático del bundle. Sin cambio de privilegios respecto de hoy.

**No sustituye el gate de `/castoff`** — este bloque es el diseño inicial de límites; el gate de
seguridad corre igual en cada deploy.

## Bloque 5 — Stack Tecnológico (Fase 8)

**Sin decisión de stack.** Cero dependencia nueva (`dependencies` ni `devDependencies`). Se
reutiliza `pro/shrinkage.ts` (ya en el repo) y el `wilsonInterval` que `relationship-index.ts` ya
calcula. Un archivo JSON estático nuevo + un loader (patrón ya establecido tres veces). **No pasa
por `/gear-up`** — igual que Fase 3/4/6 bajo circunstancias equivalentes.

## Bloque 6 — Plan de Validación (Fase 8)

1. **Candado de regresión cero de `counter`** (obligatorio, `counter.test.ts` / `mix.test.ts`):
   con `hero-counters.json` ausente (mapa vacío) **y** los parámetros estadísticos en sus valores
   legacy (`minGames = 200`, shrinkage desactivado), `counterScorer.score()` reproduce
   **exactamente** el `raw` / `explanation` / `sampleSize` de hoy, para un fixture fijo. Prueba
   que la capa curada es 100% aditiva y que la re-parametrización estadística es una calibración
   deliberada, no un accidente.
2. **Candado de la zona gris** (`counter.test.ts`): con curado ausente y dos candidatos con
   deltas de matchup reales distintos sobre muestras de 30-100 partidas, `counter` los
   **diferencia** (ambos `raw` no nulos, ordenados correctamente) — donde hoy los dos dan
   `raw: null`.
3. **Candado del hard counter** (`counter.test.ts` con fixture inline de `hero-counters.json`,
   nunca el archivo real — S9): con `{ Huskar: [{ vs: AA, level: "hard", why: "..." }] }`
   inyectado y AA en `state.picks` del rival, `counter.score(state, Huskar, meta)` da un `raw`
   fuertemente negativo y `explanation` contiene el `why`.
4. **Candado de degradación**: `hero-counters.json` corrupto -> `loadHeroCounters()` devuelve mapa
   vacío, `counter` cae a la capa estadística sola, cero excepción (mismo criterio que
   `loadHeroPositions()` con archivo malformado).
5. **QA manual en el Simulador de Draft** (la única superficie activa tras 8B): arrancar un draft,
   pickear Huskar con un Ancient Apparition ya revelado del bot -> el Copilot penaliza Huskar
   fuerte y el desglose de `counter` cita la mecánica. Repetir con un caso de zona gris (ningún
   hard counter en el tablero) -> `counter` ordena los candidatos en vez de quedarse mudo.
6. **8B**: el nav queda con 4 links; `/live-draft` / `/team-groups` / `/heroes` siguen
   alcanzables por URL directa y sus tests siguen verdes (nada se rompió, sólo se ocultó).

## Cierre — pendiente de `/blueprint`

Números que el `/blueprint` (Opus) cierra, todos con el análisis de DeepSeek + el grounding de
código como input:

- **`M_hard`, `M_medium`**: magnitud del piso por nivel de counter curado.
- **`minGames_new`**: umbral estadístico nuevo (DeepSeek sugiere 5-10; el 71% de los pares tiene
  ≥30, el 93% ≥10).
- **`priorStrength P`** del descuento por muestra (o del shrinkage hacia 0.5 si se elige esa
  variante) — DeepSeek sugiere α=β=2; `pro/shrinkage.ts` usa 30 por defecto; hay que decidir.
- **`B`**: banda del `clamp` del ajuste estadístico sobre el piso (DeepSeek: ±0.3 en su escala).
- **`RAW_RANGE.counter`**: rango revisado si el piso curado excede `[-0.12, 0.12]`.
- **Modelo de combinación exacto**: piso + ajuste acotado (DeepSeek lo argumenta contra
  `max`/suma) — confirmar la fórmula final y qué pasa cuando el candidato countea a varios
  rivales a la vez (¿el piso acumula sin tope, con tope?).
- **`hero-counters.json` inicial**: el borrador de ~30 héroes por deep research, para revisión del
  usuario.
- **¿Se recongela algo de `weights.ts`?** A priori no — `counter` mantiene su peso 0.216 en V6.
  Confirmar que rehabilitar la señal no exige re-balancear las otras 5 (candado de regresión de
  pipeline completo, mismo criterio que Fase 3/4).

**Gatillos de Opus** (`CLAUDE.md`): esta fase **sí** cruza uno de los gatillos objetivos
documentados — *"discrepancia seria confirmada entre `SPEC.md` y la arquitectura real del código"*:
el SPEC describe `counter` como una señal activa de peso 0.24/0.216, y en la práctica devuelve
`raw: null` en ~93% de los casos. `/blueprint` corre en Opus para esta fase. Después, Sonnet.

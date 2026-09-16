# Contrato para un futuro adaptador en vivo (Overwolf/OCR, R2+)

Documento, no código — S7 no construye captura en vivo (ver `.kiro/specs/r1-*` non-goals). Este
contrato existe para que Overwolf/OCR sean adaptadores intercambiables después, con la misma
disciplina que ya cumplen los dos adaptadores reales de hoy:

- **`apps/web/features/random-draft-simulator/protocol-client.ts`** (simulador) — cada acción del
  usuario/bot se traduce a un `ProtocolCommand` y se envía a `POST /api/session/protocol/:id/command`
  o `/bot-selection` o `/simulator-authority`.
- **`apps/engine/src/draft-protocol/adapters/manual-observation.ts`** (manual/futuro en vivo) —
  traduce un `ManualProtocolObservation` (un hecho observado) al mismo `ProtocolCommand`, vía
  `commandFromManualObservation`. Su propio comentario de cabecera ya es la mitad de este contrato:
  "deliberately does not derive CM turn order or actor identity: those come from `legalActions(state)`,
  and every translated fact is still accepted or rejected by `applyProtocolCommand`."

Paridad entre ambos ya está certificada hoy, sin necesidad de tocar nada para S7: ver
`apps/engine/src/server/adapter-parity.integration.test.ts` (AP: sealed/reveal/colisión, manual vs.
HTTP del simulador, mismo `authoritativeStateHash` al final) y el test `"parity real"` dentro de
`apps/engine/src/draft-protocol/adapters/cm-simulator.test.ts` (CM: observación manual vs.
`cm-simulator.ts`, mismo hash). Un futuro adaptador Overwolf/OCR que produzca las mismas
`ManualProtocolObservation` que este contrato describe hereda esa paridad automáticamente — el
kernel es el único que decide reglas, nunca el adaptador.

## Lo que un adaptador en vivo DEBE entregar

Cada hecho llega como una `ManualProtocolObservation` (tipo ya definido en
`manual-observation.ts`), nunca como un `ProtocolCommand` armado a mano:

- **Evento/acción de protocolo observado** — cuál de los 6 tipos ya definidos:
  `AP_BANS_OBSERVED`, `AP_BAN_RESOLUTION_OBSERVED`, `AP_SEALED_SELECTION_OBSERVED`,
  `AP_COLLISION_RESOLUTION_OBSERVED`, `CM_FIRST_PICK_SIDE_OBSERVED`, `CM_HERO_ACTION_OBSERVED`.
- **Lado/actor/slot, cuando se conozcan** — `side`/`slotIndex` tal como el juego los expone, nunca
  inferidos por el adaptador.
- **`heroId` sólo cuando sea legalmente observable** — un pick/ban propio siempre lo es; un pick
  rival sigue oculto hasta que Dota mismo lo revela. El adaptador nunca "adivina" un héroe oculto
  a partir de otra señal (patrón de pantalla, timing, lo que sea).
- **Bans autoritativos ya resueltos, cuando la fuente externa los suministre** —
  `AP_COLLISION_RESOLUTION_OBSERVED` existe exactamente para este caso: el adaptador reporta el
  resultado que Dota ya decidió, nunca lo decide él mismo (ver más abajo).
- **Timing/deadline, si se observa externamente** — informativo únicamente; el kernel no depende
  de él para decidir legalidad (`applyProtocolCommand` nunca lee el reloj).
- **Procedencia** — de dónde salió el hecho (qué fuente, qué versión de esa fuente), para que un
  problema de captura sea diagnosticable sin mezclar "el kernel decidió mal" con "la fuente leyó
  mal la pantalla".
- **Contexto de ruleset/patch** — mismo dato que ya exige `createProtocolState`/`ProtocolSessionStore`
  hoy (`rulesetId`, `patch`) — un adaptador en vivo no inventa un contexto nuevo, usa el mismo.

## Lo que un adaptador en vivo NUNCA DEBE hacer

Cada punto de esta lista ya está garantizado por el diseño actual del kernel/adaptador — un futuro
Overwolf/OCR sólo necesita no romperlo:

- **Nunca inferir el héroe oculto de un rival.** El motor sólo sabe lo que
  `PerspectiveDraftView` le da: `HIDDEN` sigue siendo `HIDDEN` hasta que la fuente reporta
  `REVEALED`/`KNOWN` de verdad.
- **Nunca elegir la acción legal por su cuenta.** `commandFromManualObservation` deliberadamente
  no deriva el orden de turno de Captain's Mode ni la identidad del actor — los saca de
  `legalActions(state)`, calculado por el kernel. Un adaptador que intentara decidir "a quién le
  toca" estaría duplicando al kernel, exactamente lo que este contrato prohíbe.
- **Nunca puntuar (score) nada.** Cero relación con V6, `recommendation/**`, ni ningún número de
  confianza — eso es responsabilidad exclusiva del motor de sugerencias, nunca del adaptador de
  captura.
- **Nunca resolver colisiones por su cuenta.** `AP_COLLISION_RESOLUTION_OBSERVED` transporta una
  resolución ya ocurrida en el juego real; un adaptador que "decidiera" un ganador de colisión
  estaría inventando una autoridad que no le corresponde (la autoridad hoy es
  `resolveSimulatorCollisionAuthority` en modo simulador, o el propio Dota en modo real).
- **Nunca fabricar un hecho de protocolo que la fuente no pudo observar.** Si OCR no pudo leer un
  ban con confianza, el resultado correcto es "no observado todavía", nunca un valor relleno. Cada
  observación sigue pasando por `applyProtocolCommand`, que la acepta o la rechaza — un adaptador
  nunca muta el estado autoritativo directamente.
- **Nunca observar una elegibilidad de Captain's Mode.** Ya documentado explícitamente en
  `manual-observation.ts`: "there is deliberately NO 'CM_ELIGIBILITY_OBSERVED' here... The one
  supported path is `ProtocolSessionStore.loadTrustedEligibility` (server/operator side)." Un
  adaptador de captura nunca puede promover su propio snapshot de elegibilidad a confiable — ese
  es exactamente el agujero de confianza que la reparación de S3 cerró.

## Qué hace esto posible más adelante

Con este contrato respetado, sumar Overwolf u OCR en R2+ es "escribir un traductor más" —
exactamente como `manual-observation.ts` ya es un traductor delgado hoy — nunca reabrir el kernel,
`recommendation/**`, ni ninguna regla de Dota. La certificación de paridad
(`adapter-parity.integration.test.ts` + el caso de `cm-simulator.test.ts`) es el patrón a repetir:
mismo hash de estado autoritativo al final, comparado contra el camino ya certificado (simulador),
nunca "confiar" en que el nuevo adaptador se porta igual sin probarlo.

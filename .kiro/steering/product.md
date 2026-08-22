# product — dota2coach, Fase 1 (Draft Coach)

Espejo de `docs/specs/SPEC.md` y `docs/agents/architecture.md` (Bloque 1) para lectura nativa en
Kiro. `CLAUDE.md` sigue siendo la fuente canónica si hay discrepancia.

## Problema y usuario
Tomar decisiones de pick/ban correctas en Dota 2 es difícil por tiempo e ignorancia del meta —
dirigido a jugadores de nivel bajo/medio, no a pro players. Usuario en fase 1: el propio
desarrollador, jugando sus partidas (pubs y/o Captain Mode). Visión futura: servicio a otros
jugadores, con cuentas/login (no en fase 1).

## Qué hace fase 1
- Reconoce el tipo de partida (pública vs. Captain Mode) y captura el draft en tiempo real.
- Sugiere picks/bans/contrapicks en tiempo real, basado en meta del parche actual y winrates
  generales de OpenDota — **sin personalización de hero pool** (eso es fase 1b).
- Capturadores de primera clase en fase 1: `simulator` y `manual`. `overwolf`/`ocr` quedan
  especificados como contrato, se construyen después.

## Fuera de alcance de fase 1 (no cierra puertas arquitectónicas)
Personalización de hero pool, itemización, timings, plugin/bot de voz en Discord, servicio
multiusuario con cuentas.

## Criterios de aceptación (SPEC §6)
1. **Captura correcta**: simulador reproduce Captain Mode y All Pick sin perder ningún pick/ban;
   `format: 'unknown'` no rompe la vista; luego se repite contra una partida real.
2. **Sugerencias con sentido**: sobre ≥5 drafts, coherentes cualitativamente — y cada sugerencia
   debe poder explicarse mirando su desglose de señales.
3. **Velocidad**: `computedInMs` bajo 300ms p95, <2s extremo a extremo.
4. **Simulador independiente**: un draft completo se reproduce sin Dota 2 abierto.

**Estado (2026-08-22)**: fase 1 completa (TSK-001 a TSK-016), MVP validado contra sus 4 criterios.
Ver Fase 1b, Fase 3 y la auditoría de arquitectura abajo — fase 2 ("Draft en equipo" + Random
Draft Simulator) y el deploy real en Railway también completos, ver `.kiro/steering/structure.md`.

## Fase 1b — Personalización de hero pool (SPEC.md §9)
Espejo de `docs/specs/SPEC.md` §9 y el addendum "Fase 1b" de `architecture.md`.

- **Qué agrega**: el usuario guarda hasta 5 héroes de comodidad (a mano, o calculados desde sus
  últimas partidas de OpenDota con un mínimo de 10 partidas en 90 días). Las sugerencias del motor
  ganan una quinta señal ponderada (`hero_pool_fit`) que refleja esa comodidad — nunca filtra en
  duro, solo pondera (máximo 16 puntos sobre 100 del score final).
- **Fuera de alcance de 1b**: hero pool de compañeros de equipo (necesita identidad de slot y
  login), predicción de rol/posición del rival (documentada, depende de STRATZ, no se construye).
- **Regresión cero, demostrable**: con el pool sin configurar, el comportamiento de fase 1 no
  cambia — verificado por prueba unitaria, no solo declarado.
- **Primer dato personal del proyecto**: el `account_id` de Steam del usuario (para calcular el
  pool). Tratamiento en `.claude/rules/security.md`.

## Fase 3 — Posiciones reales en el motor de sugerencias (SPEC.md §10) — completa
Espejo de `docs/specs/SPEC.md` §10 y el addendum "Fase 3" de `architecture.md`.

- **Problema de producto real**: QA manual reveló que el motor sugería doble carry (composiciones
  inválidas) porque usaba `roles[]` de OpenDota para razonar sobre posición — 57% de los héroes
  están etiquetados `"Carry"` ahí (Zeus, Axe, Tidehunter incluidos), son etiquetas temáticas, no
  roles de línea real.
- **Qué cambia**: `role_gap` y `role_safety` (dos señales viejas, ninguna existe ya en el motor) se
  fusionan en `position_fit`, una señal nueva que usa posición real curada a mano
  (`hero-positions.json`, umbral de 200 partidas por posición) en vez de `roles[]`. La intención de
  producto de `role_safety` (support primero, revelar el core después) se conserva completa dentro
  de `position_fit` — lo que se descarta es su implementación sobre etiquetas.
- **Terminología visible**: hard support, support, offlane, midlane, carry — nunca "pos 1/2/3/4/5"
  a secas sin el nombre al lado.
- **Estado**: completa y validada con QA manual real contra el Copilot (dos escenarios de
  `SPEC.md` §10.9, PASS). Ver `docs/agents/PROGRESS.md` para el detalle de ejecución.

## Auditoría de arquitectura post-Fase 3 y recalibración de pesos (2026-08-22)
Una auditoría de coherencia matemática encontró que `RAW_RANGE.counter` (rango de normalización
del contrapick) nunca se había medido contra datos reales — un hard counter real casi empataba con
`position_fit` pese a repetir un rol ya cubierto. Se recalibró el rango y se promovió
`SCORING_WEIGHTS_V5` (`position_fit` sube a 0.38, el resto baja proporcionalmente) — el mismo
patrón que ya corrigió `role_gap` una vez: el peso, no la fórmula, es el único lever real bajo la
normalización lineal del motor. Detalle técnico completo en `.kiro/steering/tech.md` y
`apps/engine/src/signals/weights.ts`.

# Checkpoint de Fase 4A (4A.1 + 4A.2 + 4A.3) — commit local

Sin push, merge ni deploy. Motor, V6, pesos, capturador y datasets sin tocar (`git diff --name-only` no lista `apps/engine`, `data/` ni `eval/`).

## Resultado del motor certificado (V6 intacto, sin reescribir rankings ni recomendaciones)
| Caso | Evidencia | Fuente |
|---|---|---|
| Solo | **Leshrac, STRONG real** (bans curados: semilla CURATED1 + Anti-Mage, Nyx Assassin, Riki, Disruptor) | `scenario-solo-strong.json` |
| Party 2 | **Oracle, STRONG real** (semilla CURATED3 + Doom, Ancient Apparition, Shadow Demon, Troll Warlord; jugador Pos5) | `scenario-party2-strong.json` |
| Party 3 | ELIGE AHORA real (draft completo, rondas 2–3 con rivales revelados) | `phase-4a2/engine-real-party3.json` |
| Party 5 | ELIGE AHORA real | `phase-4a2/engine-real-party5.json` |

## `primaryHeroId` puede ser distinto del primer héroe de `top`
Por contrato V6 la **fuerza de la evidencia** decide qué héroe es acción principal / primario; el **orden** del ranking no cambia. Casos reales: Solo → Leshrac es #4 del ranking y es el recomendado; Party 2 → Oracle es #2.
La UI distingue las dos cosas: el título de cada tarjeta dice el puesto en el **ranking general** («#N en el ranking · PosX»); la **prioridad estratégica** se dice aparte con «ELIGE AHORA» (la decisión del motor) o «Plan de equipo» (primario de su columna que no es la decisión). Fijado por pruebas en `SimulatorLightBoard.test.tsx` (`primaryHeroId distinto del top 1…`: #2 con «Plan de equipo», #1 sin la marca).

## Estado sin candidatos
Con 0 candidatos (`RANKED` sin tarjetas) la columna dice: «Sin recomendaciones disponibles con la información actual. Puedes elegir un héroe con «Buscar otro héroe».» Ajuste mínimo de copy autorizado en esta fase; no fabrica candidatos, no es una alerta y no aparece ELIGE AHORA. La búsqueda manual sigue disponible (E2E `solo-cero`).

## Baselines Linux (8) — revisión visual
Cada par (Windows | Linux | diferencia amplificada) se abrió y se miró individualmente (`vrt/*-win-linux-diff.png`). En los 8: mismo layout, mismos estados (hover, focus, pressed, selected, recommended, locked, banned, disabled…), mismo contenido y misma apariencia canónica; la diferencia se concentra solo en el contorno/grosor de los glifos (antialias de fuente entre Windows y Linux). Métricas de apoyo: `vrt/compare.json`, `structure.json`, `shift-tolerant.json`.
Los 8 quedan aceptados e incluidos. Ningún baseline existente se regeneró ni sobrescribió.
**El job `visual-regression.yml` NO está certificado en GitHub Actions**: solo pasó (10/10, y falla en rojo con un baseline alterado) en Docker local con la misma imagen fijada.

## Riesgos abiertos
1. Job de GitHub Actions sin ejecutar en GitHub.
2. `targetBasis: STRATEGIC` real no observado; la captura con razón estratégica completa es FIXTURE rotulado (4A.2).
3. `visual.pw.ts` sin baselines Linux (fuera del job).
4. Contraste del nombre sobre el retrato medido con un héroe por escenario (peor píxel 8,87:1).
5. WAITING solo cubierto con FIXTURE de interfaz (el Simulador no lo expone en ritmo normal).

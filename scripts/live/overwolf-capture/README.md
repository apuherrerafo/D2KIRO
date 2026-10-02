# D2KIRO Live Capture (Overwolf)

Adapter real de captura del draft de Dota 2, **separado** del spike (`scripts/spikes/overwolf-draft-probe/`,
que se conserva como referencia). Usa exclusivamente el **Overwolf Game Events Provider** oficial: sin
lectura de memoria, sin OCR, sin hooking, sin tocar el cliente de Dota.

| Archivo | Qué hace |
|---|---|
| `capture-core.js` | Núcleo **puro** (sin `overwolf.*`, sin red): GEP → payloads `draft-event/v1`. Probado en `capture-core.test.ts` (`bun test scripts`). |
| `background.js` | Único archivo que toca `overwolf.*`: lee la config local, se suscribe al GEP, verifica `-gamestateintegration` y hace `POST` al motor local. |
| `manifest.json` / `background.html` | App de Overwolf mínima, ventana de fondo, Dota 2 (`7314`). |
| `local/dota-live-capture.json` | **Generado** por `bun run dev:live` en cada corrida (gitignored). Contiene `engineUrl`, `sessionId`, `captureToken`. Nunca se commitea ni se loguea. |

Features GEP pedidas: `roster`, `match_state_changed`, `match_info`, `me`.

## Uso (partida real)

1. **Steam → Dota 2 → Propiedades → Opciones de lanzamiento**: agregá `-gamestateintegration` y reiniciá Dota.
   Sin esa opción el adapter **no emite ningún evento de draft** y la web muestra `DOTA_CAPTURE_NOT_ENABLED`.
2. En la raíz del repo: `bun run dev:live`. Imprime sólo:
   ```
   D2KIRO LIVE READY
   URL: http://127.0.0.1:3000/live-draft?session=<id>
   Waiting for Dota 2...
   ```
3. Overwolf → bandeja → **Development options** → **Load unpacked extension…** → elegí **esta carpeta**
   (`scripts/live/overwolf-capture`). Si ya estaba cargada, **Reload** (la config cambia en cada corrida de `dev:live`).
4. Abrí la URL impresa e iniciá sesión con Steam. La vista muestra CONNECTION / CAPTURE / SIDE y el Team Coach Board.
5. Log en vivo del adapter: Development options → D2KIRO Live Capture → **Inspect** (ventana `background`).

## Mapeo

- `match_state` → `DOTA_GAMERULES_STATE_HERO_SELECTION` ⇒ `session_started` (`all_pick`, `7.41e`), una vez por partida.
- `me.team` ⇒ `local_side_identified`.
- `roster.bans` (heroId nuevo ≠ 0) ⇒ `hero_banned`.
- `roster.players`, identidad estable por `team` + `team_slot` (nunca el orden del array):
  héroe confirmado nuevo ⇒ `hero_picked` (con `position` propia desde `role`);
  mismo asiento con otro héroe **durante la selección** ⇒ `pick_reverted` + `hero_picked`.
- `roster.draft` (sin asiento) ⇒ `hero_picked`, nunca un revert.
- Rol → posición (sólo describe el roster real, nunca cambia la legalidad): 1→Pos1, 4→Pos2, 2→Pos3, 8→Pos4, 16→Pos5.

Cada envelope lleva un `eventId` estable: el motor deduplica, así que un reintento o una actualización
repetida de Overwolf nunca produce un doble pick. El motor sólo escucha en `127.0.0.1` y exige `x-capture-token`.

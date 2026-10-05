# D2KIRO Live Capture (Overwolf)

Captura **automática** del draft de Dota 2 para `/live-draft`: bans, picks aliados, picks rivales y héroe propio llegan
solos — el Player no carga nada a mano. Usa exclusivamente el **Overwolf Game Events Provider (GEP)** oficial: sin lectura
de memoria, sin OCR, sin hooking, sin tocar el cliente de Dota.

Fuente oficial de los campos: <https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/dota-2/>
(features `roster` — info `players` / `bans` / `draft` —, `game_state`, `match_state_changed`, `match_info`, `me`).

| Archivo | Qué hace |
|---|---|
| `capture-core.js` | Núcleo **puro** (sin `overwolf.*`, sin red): GEP → hechos de draft. Aplica la lista blanca de privacidad. Probado en `capture-core.test.ts` y `contract.test.ts` (`bun test scripts`). |
| `background.js` | Único archivo que toca `overwolf.*`: se suscribe al GEP, verifica `-gamestateintegration`, empareja con el sitio y entrega los lotes por HTTPS. |
| `pair.html` / `pair.js` | Ventana de emparejamiento: sitio + código de un solo uso. |
| `manifest.json` | App de Overwolf, Dota 2 (`7314`), ventanas `background` y `pair`. |
| `local/dota-live-capture.json` | **Sólo desarrollo local** (`bun run dev:live`, gitignored): motor en `127.0.0.1` + token de captura. Nunca se commitea ni se loguea. |

## Cómo llega el draft (arquitectura)

```
Dota 2 ── GEP ──> Overwolf ──> esta app (PC del Player)
                                   │  lote `overwolf-capture/v1`: hechos con lista blanca (héroe, bando, posición, ciclo de vida)
                                   │  HTTPS, header x-capture-credential
                                   ▼
        sitio D2KIRO  /api/live/overwolf/<captureId>   (relay público, acota tamaño y tiempo)
                                   ▼
        motor (127.0.0.1)  verifica la credencial ──> MISMA sesión en vivo de la cuenta ──> Team Coach
```

- **Una sola sesión, un solo estado de draft.** Overwolf alimenta los mismos hechos que ya usan GSI y la entrada manual
  (`LiveCaptureRegistry`): el kernel reconstruye el estado; nada se duplica.
- **Autoridad.** Con Overwolf sano (conectado y habiendo informado `draft` o `players`), Overwolf es la fuente de los héroes: el
  héroe propio que sigue mandando GSI se deduplica contra el mismo héroe y **nunca** agrega ni mueve un pick. GSI sigue
  aportando heartbeat, bando, ciclo de vida de la partida y telemetría.
- **Si Overwolf desaparece** en medio del draft: la captura queda `degradada` (`OVERWOLF_LOST`), la UI lo dice y abre la
  entrada manual de respaldo. No se inventa ningún estado.

## Emparejamiento (una vez por sesión de juego, ~12 h)

1. `/live-draft` → **Conectar captura automática** → aparece un código de un solo uso (vence a los 10 min).
2. En la app **D2KIRO Live Capture** (Overwolf): sitio (`https://…`) + código → **Conectar**.
3. El sitio cambia el código por una **credencial acotada** (12 h): sólo puede enviar hechos de draft a **tu** sesión en vivo.
   El adaptador la guarda en su `localStorage`; nunca llega al navegador del sitio ni a ningún log.
4. **Desvincular captura** (en `/live-draft`) la revoca al instante. Re-emparejar, o rotar/revocar el enlace de Dota, también la invalida.

## Mapeo

- `match_state` → `DOTA_GAMERULES_STATE_HERO_SELECTION` ⇒ `session_started` (`all_pick`, `7.41e`), una vez por partida.
- `me.team` / `game.player_team` ⇒ `local_side_identified`.
- `roster.bans` (heroId nuevo ≠ 0) ⇒ `hero_banned`.
- `roster.players`, identidad estable por `team` + `team_slot` (nunca el orden del array): héroe confirmado nuevo ⇒
  `hero_picked`; mismo asiento con otro héroe **durante la selección** ⇒ `pick_reverted` + `hero_picked`.
- `roster.draft` (sin asiento) ⇒ `hero_picked`, nunca un revert.
- **Rol → posición** (sólo de tu lado, sólo donde el rol *nombra* la posición): `1 Safelane → Pos1`, `4 Midlane → Pos2`,
  `2 Offlane → Pos3`, `16 HardSupport → Pos5`. **`8 Other` NO se adivina como Pos4**: ese asiento queda sin posición y la
  asignás vos. Los pools del preset Party 5 (slot N → Pos N) son contexto de recomendación, no verdad de captura.

Cada evento lleva un `eventId` estable y el motor deduplica por hecho: un snapshot completo repetido, un reintento o un
reenvío tras reconectar nunca produce un doble pick.

## Privacidad (no negociable)

Un roster de Overwolf trae `steamId`, `name`, `rank`, `medal_*`. **Nada de eso entra al estado del adaptador**: `sanitizeEntry`
deja pasar sólo héroe / equipo / asiento / rol / confirmación al recibir cada update. No se envía, no se guarda, no se
loguea, no se muestra. Lo único que sale: ids de héroe, bando, posición propia, ciclo de vida y cuatro booleanos de
presencia (`roster`, `bans`, `draft`, `players`).

## Instalación para la próxima partida (desarrollo)

1. **Overwolf Desktop debe estar instalado** (<https://www.overwolf.com/>). Sin él no hay GEP.
2. Overwolf → ícono de la bandeja → **Settings → About → Development options → Load unpacked extension…** → elegí esta
   carpeta (`scripts/live/overwolf-capture`). Se abre la ventana de emparejamiento.
3. **`-gamestateintegration` sigue siendo obligatorio** (lo pide la doc oficial de Overwolf para Dota 2 y es el mismo
   switch que ya usa el `.cfg` de GSI): Steam → Dota 2 → Propiedades → Opciones de lanzamiento. Sin él la app no emite
   ningún evento de draft y `/live-draft` muestra «falta la opción de lanzamiento».
4. En D2KIRO, `/live-draft` ya debe tener **Dota conectado** (instalador/cfg de GSI): la captura automática se ata a esa
   misma sesión.
5. `/live-draft` → **Conectar captura automática** → copiá el código → pegalo en la ventana de Overwolf con el sitio → **Conectar**.
6. **Antes de poner la cola:** abrí Dota 2. El panel «CAPTURA AUTOMÁTICA · OVERWOLF» tiene que decir
   **● Captura automática lista**. Si dice otra cosa, el texto de abajo dice qué falta.
7. Poné la cola. En hero selection el CAPTURE dice **Automática · Overwolf · n/10 héroes visibles**.

Log en vivo del adaptador: Development options → D2KIRO Live Capture → **Inspect** (ventana `background`).

## Modo local (desarrollo, motor en `127.0.0.1`)

`bun run dev:live` imprime la URL de la sesión local y escribe `local/dota-live-capture.json`; cargá/recargá la app y, si no
hay credencial emparejada, el adaptador entrega al motor local con `x-capture-token` (sin ventana de emparejamiento).

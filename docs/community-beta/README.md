# Beta comunitaria: solicitudes, avisos y feedback

## Qué hace
- **Solicitud de acceso**: Steam verifica quién eres; después escribes «¿Quién eres y de dónde nos conoces?» y la envías tú.
  La identidad sale solo de una cookie sellada (`d2k_access_request`, 1 h); el formulario no puede cambiarla.
  Estados: formulario → pendiente → aprobada / rechazada (24 h de espera para volver a pedir).
  Anti-spam: una solicitud pendiente por cuenta, límite por IP y por cuenta, campo trampa, mensaje de 10 a 500 caracteres.
- **Campanita (solo administrador)**: cuenta las solicitudes pendientes y consulta cada 30 s mientras D2KIRO está abierto.
  Aviso en pantalla por cada solicitud nueva; sonido solo si se pulsó «Activar sonido». La marca de «ya avisado» vive en
  `localStorage` (sobrevive a recargar y se comparte entre pestañas), y la primera vez en un navegador no suena por lo viejo.
- **Feedback universal**: botón flotante (esquina inferior derecha) para toda cuenta con sesión. Texto + hasta 3 capturas
  (PNG/JPG/WebP, 2,5 MB cada una; las grandes se reducen en el navegador). Se adjunta pantalla (sin query), tamaño de ventana,
  idioma, navegador y versión del servidor. Nunca cookies, tokens ni SteamID.
- **Bandeja** `/admin/feedback`: filtros por tipo y estado, capturas, estados (pendiente / en revisión / resuelto) y exportación
  JSON/CSV sin SteamID ni nombres de Steam (referencia opaca de autor).

## Limitación documentada
Los avisos y el sonido funcionan **solo con D2KIRO abierto en el navegador**. Con el navegador cerrado no llega nada: no hay Web Push
(requeriría autorización explícita, claves VAPID y un service worker).

## Datos y almacenamiento
| Dato | Dónde | Notas |
|---|---|---|
| Solicitudes e invitados | `beta-access.json` (volumen persistente) | Formato compatible hacia atrás; respaldo único `beta-access.json.bak-v1` antes de la primera escritura nueva |
| Mensajes de feedback | `feedback.json` (volumen persistente) | Separado de la SQLite de V6; respaldo `feedback.json.bak-v1` |
| Capturas | Bucket S3-compatible privado (R2) | Solo la referencia vive en `feedback.json`; lectura por `/api/feedback/image/<id>/<n>` (autor o administrador) |

## Configuración del bucket (pendiente del dueño)
Variables `FEEDBACK_S3_ENDPOINT`, `FEEDBACK_S3_BUCKET`, `FEEDBACK_S3_ACCESS_KEY_ID`, `FEEDBACK_S3_SECRET_ACCESS_KEY` (y opcional
`FEEDBACK_S3_REGION`). Sin ellas, las capturas están desactivadas y la interfaz lo dice.

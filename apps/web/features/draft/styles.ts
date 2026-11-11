// Estilos de acción compartidos de la aplicación. Todos son la capa Canonical Light del shell (`.ap-btn`,
// components/app-shell/app-shell.css): contorno y tinta, foco, hover, pulsado y deshabilitado ya están resueltos allí.
// Los nombres se conservan porque son la API que importan las pantallas; ya no definen una apariencia propia.

export const BUTTON_PRIMARY = "ap-btn ap-btn--solid";

export const BUTTON_SECONDARY = "ap-btn";

export const BUTTON_COMPACT = "ap-btn ap-btn--compact";

export const BUTTON_GHOST = "ap-btn ap-btn--quiet self-start";

// Badge, no un simple texto -- el usuario reportó que el "(Tú)" original pasaba desapercibido (TSK-016).
// Fondo de tinta + texto invertido para que se lea como una etiqueta, no como una nota al pie.
export const LOCAL_SIDE_BADGE =
  "ml-2 inline-flex items-center rounded-full bg-accent-primary px-2 py-0.5 text-caption font-semibold text-surface-base";

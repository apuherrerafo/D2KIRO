// Formato ÚNICO de la etiqueta de parche, compartido por el validador (borde de entrada) y el índice (orden de vigencia).
// Antes cada uno tenía su regex: el validador aceptaba hasta 3 letras ("7.41ab") y el índice sólo una, así que un registro
// válido salía con vigencia "unknown" sin ningún aviso. Una sola definición cierra esa divergencia.
//
// Forma real de Dota: mayor.menor con una letra opcional ("7.41", "7.41e"). Lo que no tenga esa forma se RECHAZA en el borde.

export const PATCH_LABEL = /^\d{1,3}\.\d{1,3}[a-z]?$/;

/** "7.41e" -> [7, 41, 5]; "7.41" -> [7, 41, 0]. `null` si la etiqueta no tiene la forma canónica. */
export function parsePatchLabel(label: string): [number, number, number] | null {
  if (!PATCH_LABEL.test(label)) return null;
  const m = /^(\d+)\.(\d+)([a-z]?)$/.exec(label) as RegExpExecArray;
  const letter = m[3] === "" ? 0 : (m[3] as string).charCodeAt(0) - 96;
  return [Number(m[1]), Number(m[2]), letter];
}

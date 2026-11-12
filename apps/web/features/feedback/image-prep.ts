// Prepara una captura antes de subirla: solo png/jpeg/webp y, si pesa más del límite del servidor (o es muy grande), la reduce en el
// navegador a WebP de hasta 1920 px. El servidor vuelve a validar todo (formato por bytes, tamaño y cantidad): esto solo ahorra un viaje.

export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const TARGET_SIDE = 1920;

export type PrepResult = { ok: true; file: File } | { ok: false; reason: "format" | "too_large" | "unreadable" };

export function isAcceptedType(type: string): boolean {
  return ACCEPTED_TYPES.includes(type);
}

async function downscale(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, TARGET_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  } catch {
    return null;
  }
}

export async function prepareImage(file: File, maxBytes: number): Promise<PrepResult> {
  if (!isAcceptedType(file.type)) return { ok: false, reason: "format" };
  if (file.size <= maxBytes * 0.6) return { ok: true, file };
  const reduced = await downscale(file);
  if (reduced === null) return file.size <= maxBytes ? { ok: true, file } : { ok: false, reason: "unreadable" };
  if (reduced.size > maxBytes) return { ok: false, reason: "too_large" };
  const name = file.name.replace(/\.[^.]+$/, "") || "captura";
  return { ok: true, file: new File([reduced], `${name}.webp`, { type: "image/webp" }) };
}

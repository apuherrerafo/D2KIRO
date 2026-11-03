// Descarga local de un JSON: Blob + enlace temporal. Nada sale del navegador -- no hay red en la grabadora.

export type DownloadFile = (filename: string, contents: string) => void;

export function downloadJsonFile(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportFilename(seed: string | null, at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  const safeSeed = seed !== null && /^[A-Z0-9]{1,16}$/.test(seed) ? `-${seed}` : "";
  return `d2kiro-flight${safeSeed}-${stamp}.json`;
}

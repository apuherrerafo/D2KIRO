import type { MetaPatchProvenance, MetaStatus } from "@/lib/engine-api";

// Texto del estado del meta, en funciones puras (se prueban sin renderizar). Nunca se calla un dato dudoso: cada uno dice si
// está al día, desactualizado o sin verificar, con palabras.

export type MetaTone = "ok" | "pending" | "empty";

export function formatSyncedAt(syncedAt: string | null): string {
  if (!syncedAt) return "Nunca se actualizó";
  const parsed = new Date(syncedAt);
  if (Number.isNaN(parsed.getTime())) return "Fecha no disponible";
  return parsed.toLocaleString("es", { dateStyle: "long", timeStyle: "short" });
}

export function describeSync(status: Pick<MetaStatus, "syncedAt" | "isStale">): { tag: string; tone: MetaTone } {
  if (status.syncedAt === null) return { tag: "Sin datos", tone: "empty" };
  if (status.isStale) return { tag: "Desactualizado (más de 24 h)", tone: "pending" };
  return { tag: "Al día", tone: "ok" };
}

export function describePatch(provenance: MetaPatchProvenance | undefined): { value: string; tag: string; tone: MetaTone } {
  if (provenance === undefined || provenance.label === null) {
    return { value: "El dato no declara a qué parche pertenece.", tag: "Sin procedencia", tone: "empty" };
  }
  if (provenance.verified) return { value: `Parche ${provenance.label}`, tag: "Verificado", tone: "ok" };
  return { value: `Parche ${provenance.label}`, tag: "Sin verificar", tone: "pending" };
}

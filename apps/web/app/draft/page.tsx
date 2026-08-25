import { redirect } from "next/navigation";

// Compatibilidad de enlaces existentes: la experiencia no desaparece, cambia a una URL que
// explica que consume eventos reales de Dota. La ruta canónica vive en /live-draft.
export default function LegacyDraftPage() {
  redirect("/live-draft");
}

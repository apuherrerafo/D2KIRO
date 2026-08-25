import { redirect } from "next/navigation";

// Compatibilidad de enlaces existentes: el simulador ahora tiene una URL estable y entendible.
export default function LegacyRandomDraftPage() {
  redirect("/simulator");
}

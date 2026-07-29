import { randomUUID } from "node:crypto";
import { DraftView } from "@/features/draft";

interface DraftPageProps {
  searchParams: Promise<{ session?: string }>;
}

// Sin ?session en la URL, cada carga de página arranca con una sesión propia -- evita heredar
// estado acumulado de una corrida anterior del simulador (TSK-016; antes "local" era el único
// valor posible, así que dos corridas seguidas compartían la misma sesión en memoria del motor).
export default async function DraftPage({ searchParams }: DraftPageProps) {
  const { session } = await searchParams;
  return <DraftView sessionId={session ?? randomUUID()} />;
}

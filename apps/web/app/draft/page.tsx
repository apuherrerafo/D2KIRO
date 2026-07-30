import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { DraftView } from "@/features/draft";
import { isDraftLiveEnabled } from "./live-config";

export const dynamic = "force-dynamic";

interface DraftPageProps {
  searchParams: Promise<{ session?: string }>;
}

// Sin ?session en la URL, cada carga de página arranca con una sesión propia -- evita heredar
// estado acumulado de una corrida anterior del simulador (TSK-016; antes "local" era el único
// valor posible, así que dos corridas seguidas compartían la misma sesión en memoria del motor).
export default async function DraftPage({ searchParams }: DraftPageProps) {
  await connection();
  if (!isDraftLiveEnabled()) return <DraftUnavailablePage />;
  const { session } = await searchParams;
  return <DraftView sessionId={session ?? randomUUID()} />;
}

function DraftUnavailablePage() {
  return (
    <main className="flex min-h-screen flex-col gap-3 bg-surface-base p-6">
      <span className="text-heading text-content-primary">Draft en vivo local</span>
      <p className="max-w-2xl text-body text-content-secondary">
        El draft en vivo necesita el motor corriendo en tu PC, en la misma red que el capturador. No está disponible en esta
        instancia.
      </p>
    </main>
  );
}

import { DraftView } from "@/features/draft";

interface DraftPageProps {
  searchParams: Promise<{ session?: string }>;
}

// La creación real de sesión (simulador TSK-011, entrada manual TSK-013) todavía no existe --
// "local" es un placeholder de sessionId hasta que exista ese flujo real.
export default async function DraftPage({ searchParams }: DraftPageProps) {
  const { session } = await searchParams;
  return <DraftView sessionId={session ?? "local"} />;
}

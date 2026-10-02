import { connection } from "next/server";
import { LiveDotaView, LiveTeamCoachView } from "@/features/team-coach";
import { isDraftLiveEnabled } from "./live-config";

export const dynamic = "force-dynamic";

interface DraftPageProps {
  searchParams: Promise<{ session?: string | string[]; setup?: string | string[] }>;
}

function single(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  return null;
}

// Draft REAL de Dota con el Team Coach Board (mismo componente que /simulator).
//
// TSK-219: el camino normal es Dota GSI -> este sitio (Railway): la cuenta conecta Dota una vez
// ("Conectar Dota" -> archivo de configuración) y la vista sigue la sesión en vivo de esa cuenta.
// `?session=<id>` sólo existe para la captura LOCAL de desarrollo (`dev:live`, motor en la misma PC,
// DRAFT_LIVE_ENABLED distinto de "false"); en el despliegue se ignora.
export default async function DraftPage({ searchParams }: DraftPageProps) {
  await connection();
  const params = await searchParams;
  const localSession = single(params.session);
  if (isDraftLiveEnabled() && localSession !== null) return <LiveTeamCoachView sessionId={localSession} />;
  return <LiveDotaView setupError={single(params.setup)} />;
}

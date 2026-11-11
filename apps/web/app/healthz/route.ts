import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function engineInternalUrl() {
  return process.env.ENGINE_INTERNAL_URL ?? "http://127.0.0.1:4000";
}

export async function GET() {
  try {
    const engineResponse = await fetch(`${engineInternalUrl()}/api/health`, { cache: "no-store" });
    if (!engineResponse.ok) {
      return NextResponse.json({ ok: false, next: "ok", engine: "fail" }, { status: 503 });
    }
  } catch {
    return NextResponse.json({ ok: false, next: "ok", engine: "fail" }, { status: 503 });
  }

  // Qué versión está sirviendo el sitio: Railway inyecta el commit del despliegue. Solo se publica si es un SHA
  // hexadecimal (nunca se refleja un valor arbitrario del entorno); sin la variable, la respuesta no cambia.
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA;
  if (sha !== undefined && /^[0-9a-f]{40}$/.test(sha)) return NextResponse.json({ ok: true, next: "ok", engine: "ok", sha });
  return NextResponse.json({ ok: true, next: "ok", engine: "ok" });
}

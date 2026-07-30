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

  return NextResponse.json({ ok: true, next: "ok", engine: "ok" });
}

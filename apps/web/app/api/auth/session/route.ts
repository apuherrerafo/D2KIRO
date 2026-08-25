import { NextResponse } from "next/server";
import { getSession, getSessionProfile, renewSessionIfNeeded } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!await renewSessionIfNeeded(session)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(getSessionProfile(session), { headers: { "cache-control": "no-store" } });
}

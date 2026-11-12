import { NextResponse } from "next/server";
import { isBetaAdmin, isSessionStillAllowed } from "@/lib/beta-access";
import { getSession, getSessionProfile, renewSessionIfNeeded } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!await renewSessionIfNeeded(session)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSessionStillAllowed(session.accountId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(getSessionProfile(session, isBetaAdmin(session.accountId)), { headers: { "cache-control": "no-store" } });
}

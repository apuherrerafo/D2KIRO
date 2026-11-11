import { NextResponse } from "next/server";
import { getCanonicalOrigin } from "@/lib/canonical-origin";
import { getSession } from "@/lib/session";

export function createLogoutHandler(destroySession: () => Promise<void>, publicOrigin: string | null) {
  return async () => {
    await destroySession();
    if (publicOrigin === null) return new NextResponse("Authentication is unavailable", { status: 503 });
    // 303 (See Other): el navegador sigue con un GET a /login. Con 307 repetiría el POST contra una página que solo se lee.
    return NextResponse.redirect(new URL("/login", publicOrigin), 303);
  };
}

export async function POST() {
  return createLogoutHandler(async () => {
    const session = await getSession();
    session.destroy();
  }, getCanonicalOrigin())();
}

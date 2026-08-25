import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export function createLogoutHandler(destroySession: () => Promise<void>) {
  return async () => {
    await destroySession();
    return NextResponse.redirect(new URL("/login", "https://coach.example"));
  };
}

export async function POST(request: Request) {
  return createLogoutHandler(async () => {
    const session = await getSession();
    session.destroy();
  })().then((response) => NextResponse.redirect(new URL("/login", request.url), { status: response.status }));
}

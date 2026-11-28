import { waitlistHandlers } from "@/lib/waitlist-wiring";

export const dynamic = "force-dynamic";

// Puerta pública: registrar un correo en la waitlist. No abre sesión.
export async function POST(request: Request) {
  return waitlistHandlers().signup(request);
}

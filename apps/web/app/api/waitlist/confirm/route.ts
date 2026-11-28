import { waitlistHandlers } from "@/lib/waitlist-wiring";

export const dynamic = "force-dynamic";

// Puerta pública: consumir el enlace de verificación. Solo POST, para que un escáner de correo que abre el enlace no lo gaste.
export async function POST(request: Request) {
  return waitlistHandlers().confirm(request);
}

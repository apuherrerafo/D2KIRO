import { isIP } from "node:net";
import { createRateLimiter, type RateLimiter } from "./rate-limit";

// Antiabuso del registro: a quién se le cuenta cada intento y cuántos caben. Todo en memoria (un solo proceso web): un reinicio
// lo limpia. Ninguna de estas claves se guarda ni se registra.
//
// La IP sale SOLO de `x-real-ip`: es la cabecera que Railway documenta como IP del cliente en su red pública
// (docs.railway.com/networking/public-networking/specs-and-limits); que su borde pise la que mande el cliente lo afirma su equipo en
// el foro, no la documentación. `x-forwarded-for` no se lee: no está documentada. Fuera de ese borde la cabecera es falsificable.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const CLIENT_PER_HOUR = 3;
export const CLIENT_PER_DAY = 6;
export const NETWORK_PER_DAY = 30;
export const GLOBAL_PER_HOUR = 100;
export const GLOBAL_PER_DAY = 500;
export const TAGGED_PER_MAILBOX_PER_DAY = 2;

export interface ClientKeys {
  /** Una conexión: IPv4 entera, o el /64 en IPv6 (lo que recibe un solo abonado). */
  client: string;
  /** La red alrededor: /24 en IPv4, /48 en IPv6. */
  network: string;
}

const UNKNOWN_CLIENT: ClientKeys = { client: "unknown", network: "unknown" };

/** Los 8 grupos de una IPv6 ya validada. `URL` la deja en su forma canónica (hexadecimal, un solo `::`). */
function ipv6Groups(address: string): string[] {
  const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
  const [head, tail] = canonical.split("::");
  const left = head === "" ? [] : head.split(":");
  if (tail === undefined) return left;
  const right = tail === "" ? [] : tail.split(":");
  return [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
}

function ipv4Keys(address: string): ClientKeys {
  return { client: address, network: `${address.split(".").slice(0, 3).join(".")}.0/24` };
}

function ipv6Keys(address: string): ClientKeys {
  const groups = ipv6Groups(address);
  const mapped = groups.slice(0, 5).every((group) => group === "0") && groups[5] === "ffff";
  if (mapped) {
    const bytes = groups.slice(6).flatMap((group) => [parseInt(group, 16) >> 8, parseInt(group, 16) & 255]);
    return ipv4Keys(bytes.join("."));
  }
  return { client: `${groups.slice(0, 4).join(":")}::/64`, network: `${groups.slice(0, 3).join(":")}::/48` };
}

/** Sin una IP legible, todos comparten cupo: falla hacia lo estricto, nunca hacia «sin límite». */
export function clientKeys(headers: Headers): ClientKeys {
  const address = headers.get("x-real-ip")?.trim().split("%")[0] ?? "";
  const version = isIP(address);
  if (version === 4) return ipv4Keys(address);
  if (version === 6) return ipv6Keys(address);
  return UNKNOWN_CLIENT;
}

/**
 * Solo Gmail, que documenta que `+etiqueta` y los puntos entregan en el mismo buzón. Devuelve el buzón de una dirección CON
 * etiqueta (las variantes que se pueden fabricar sin fin) o null. La dirección sin etiqueta nunca entra en este cupo: nadie puede
 * agotárselo a su dueño. En cualquier otro dominio no se supone nada y no se recorta nada.
 */
export function taggedMailboxKey(email: string): string | null {
  const [local, domain] = email.split("@");
  if (domain !== "gmail.com" && domain !== "googlemail.com") return null;
  if (!local.includes("+")) return null;
  return `${local.split("+")[0].replaceAll(".", "")}@gmail.com`;
}

export interface SignupLimits {
  client: RateLimiter;
  network: RateLimiter;
  /** Variantes con etiqueta de un mismo buzón. */
  tagged: RateLimiter;
  /** Freno de emergencia del proveedor de correo: se consulta el último, solo con lo que pasó los demás. */
  global: RateLimiter;
}

function allOf(...limiters: RateLimiter[]): RateLimiter {
  return {
    allow: (key, now) => limiters.every((limiter) => limiter.allow(key, now)),
    reset: () => limiters.forEach((limiter) => limiter.reset()),
  };
}

export function createSignupLimits(): SignupLimits {
  return {
    client: allOf(createRateLimiter(CLIENT_PER_HOUR, HOUR_MS), createRateLimiter(CLIENT_PER_DAY, DAY_MS)),
    network: createRateLimiter(NETWORK_PER_DAY, DAY_MS),
    tagged: createRateLimiter(TAGGED_PER_MAILBOX_PER_DAY, DAY_MS),
    global: allOf(createRateLimiter(GLOBAL_PER_HOUR, HOUR_MS), createRateLimiter(GLOBAL_PER_DAY, DAY_MS)),
  };
}

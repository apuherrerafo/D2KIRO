// Verificación contra la URL PÚBLICA desplegada (no localhost). Sólo lo que se puede probar sin una cuenta de Steam:
// visitante sin sesión, puertas públicas, ausencia de endpoints de prueba, cookies seguras, SHA servido.
//
//   bun run beta:verify -- https://d2kiro-f4-preview-preview.up.railway.app <sha-esperado-de-40-hex>
//
// No manda ningún secreto ni cookie; no crea cuentas. Sale con código 1 si algún chequeo falla.
const [baseArg, expectedSha] = process.argv.slice(2);
if (!baseArg || !expectedSha || !/^[0-9a-f]{40}$/.test(expectedSha)) {
  console.error("Uso: bun run beta:verify -- <url-publica> <sha-esperado-40-hex>");
  process.exit(2);
}
const base = new URL(baseArg);
if (base.protocol !== "https:") {
  console.error("La URL pública debe ser https.");
  process.exit(2);
}

interface Check { name: string; ok: boolean; detail: string }
const checks: Check[] = [];
function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -- ${detail}`}`);
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(path, base), { redirect: "manual", ...init });
}

function redirectsToLogin(response: Response): boolean {
  const location = response.headers.get("location") ?? "";
  return [301, 302, 303, 307, 308].includes(response.status) && new URL(location, base).pathname === "/login";
}

const health = await call("/healthz");
const healthBody = (await health.json().catch(() => ({}))) as { ok?: boolean; engine?: string; sha?: string };
record("healthz: sitio y motor sanos", health.status === 200 && healthBody.ok === true && healthBody.engine === "ok", `status ${health.status}`);
record("SHA servido = SHA publicado", healthBody.sha === expectedSha, `servido ${healthBody.sha ?? "(no expuesto)"}`);

const publicPaths = ["/", "/login", "/access-denied"];
for (const path of publicPaths) {
  const response = await call(path);
  record(`visitante: ${path} es público (200)`, response.status === 200, `status ${response.status}`);
}

const privatePaths = ["/simulator", "/live-draft", "/hero-pool", "/team-groups", "/settings", "/meta", "/heroes"];
for (const path of privatePaths) {
  const response = await call(path);
  record(`visitante: ${path} redirige a /login`, redirectsToLogin(response), `status ${response.status}`);
}

const apiProbes: Array<{ path: string; init?: RequestInit }> = [
  { path: "/engine/api/session/protocol/live", init: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" } },
  { path: "/engine/api/live/gsi-link" },
  { path: "/engine/api/hero-pool" },
  { path: "/engine/api/account" },
  { path: "/api/live/companion-installer", init: { method: "POST" } },
  { path: "/api/live/gsi-config", init: { method: "POST" } },
  { path: "/api/auth/engine-token" },
];
for (const probe of apiProbes) {
  const response = await call(probe.path, probe.init);
  const denied = redirectsToLogin(response) || [401, 403, 404, 405].includes(response.status);
  record(`visitante: ${probe.path} no entrega datos`, denied, `status ${response.status}`);
}

// Ninguna puerta de pruebas (E2E) alcanzable desde afuera, ni siquiera con forma plausible.
const e2eProbes = ["/engine/api/test/seed", "/engine/api/e2e/inject", "/engine/api/session/protocol/x/test-clock", "/api/e2e", "/engine/api/session/protocol/x/force-bot-selection"];
for (const path of e2eProbes) {
  const response = await call(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  record(`sin endpoints de prueba: ${path}`, redirectsToLogin(response) || [401, 403, 404, 405].includes(response.status), `status ${response.status}`);
}

// El ingreso de Dota (GSI) es público pero exige token del enlace: sin él no se acepta nada.
const gsi = await call("/api/live/gsi/00000000-0000-0000-0000-000000000000", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ auth: { token: "x" } }) });
record("GSI sin enlace válido se rechaza (nunca 2xx/5xx)", [400, 401, 403, 404].includes(gsi.status), `status ${gsi.status}`);

// Login de Steam: debe mandar al OpenID de Steam con return_to/realm HTTPS del mismo dominio y cookie de nonce segura.
const login = await call("/api/auth/steam/login");
const steamLocation = login.headers.get("location") ?? "";
let steamOk = false;
let detail = `status ${login.status}`;
try {
  const url = new URL(steamLocation);
  const returnTo = new URL(url.searchParams.get("openid.return_to") ?? "");
  steamOk = url.origin === "https://steamcommunity.com" && returnTo.origin === base.origin && returnTo.pathname === "/api/auth/steam/callback" && url.searchParams.get("openid.realm") === base.origin;
  detail = `return_to ${returnTo.origin}${returnTo.pathname}`;
} catch { /* detail ya dice el status */ }
record("Steam OpenID: redirige a steamcommunity.com con return_to/realm de este dominio https", steamOk, detail);
const setCookie = login.headers.get("set-cookie") ?? "";
record("Steam OpenID: cookie de nonce HttpOnly + Secure + SameSite", /d2k_login_nonce=/.test(setCookie) && /httponly/i.test(setCookie) && /secure/i.test(setCookie) && /samesite=/i.test(setCookie), "cookie sin flags");

// Un callback fabricado (sin nonce ni firma de Steam) nunca crea sesión.
const forged = await call("/api/auth/steam/callback?openid.mode=id_res&state=falso&openid.claimed_id=https://steamcommunity.com/openid/id/76561198000000001");
record("callback de Steam fabricado no crea sesión", !/d2k_session=[^;]+/.test(forged.headers.get("set-cookie") ?? "") && new URL(forged.headers.get("location") ?? "/", base).pathname === "/login", `status ${forged.status}`);

const failed = checks.filter((check) => !check.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} chequeos pasan.`);
process.exit(failed.length === 0 ? 0 : 1);

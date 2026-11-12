import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sealData } from "iron-session";
import type { BrowserContext } from "@playwright/test";
import { expect, test } from "./support/failure-evidence";

// Onboarding de la beta privada, de punta a punta con navegador real (web de producción + motor reales, beta configurada como en Railway):
// un amigo sin invitación, el propietario que lo aprueba desde la web y la salida de quien se retira. Las sesiones de prueba se sellan con el
// SESSION_SECRET efímero de la corrida (igual que global-setup.ts); NO prueba el login real de Steam ni una segunda cuenta de Steam real.

const OUT = resolve(process.cwd(), "docs/research/beta-onboarding");
mkdirSync(OUT, { recursive: true });
const FRIEND_ACCOUNT = 999000002;
const FRIEND_NAME = "Amigo de prueba";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function accessFile(): string {
  const dir = process.env.E2E_RUNTIME_DIR;
  if (dir === undefined) throw new Error("falta E2E_RUNTIME_DIR");
  return join(dir, "beta-access.json");
}

// «Entrar con Steam» de la cuenta del amigo: lo que haría el callback tras verificar a Steam (aquí, la cookie sellada con el secreto efímero de la corrida).
async function signInFriend(context: BrowserContext): Promise<void> {
  const now = Date.now();
  const sealed = await sealData({ accountId: FRIEND_ACCOUNT, issuedAt: now, firstLoginAt: now }, { password: process.env.E2E_SESSION_SECRET!, ttl: SESSION_TTL_SECONDS });
  await context.addCookies([{ name: "d2k_session", value: sealed, url: process.env.E2E_BASE_URL!, httpOnly: true, sameSite: "Lax" }]);
}

async function friendContext(browser: import("@playwright/test").Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL!, viewport: { width: 1280, height: 800 }, storageState: { cookies: [], origins: [] } });
  await signInFriend(context);
  return context;
}

test.describe("beta privada: invitación desde la web", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("el propietario invita sin consola; el amigo pide acceso, entra al aprobarlo y sale al retirarlo", async ({ page, browser }) => {
    test.setTimeout(180_000);
    rmSync(accessFile(), { force: true });

    // 1 · Mi cuenta: el propietario encuentra «Invitar amigos» y el enlace para compartir (sin SteamID, sin terminal).
    await page.goto("/settings");
    await page.getByTestId("account-invite-friends").click();
    await expect(page.getByTestId("beta-admin-page")).toBeVisible();
    await expect(page.getByTestId("beta-share-url")).toHaveText(process.env.E2E_BASE_URL!);
    await expect(page.getByText("Nadie ha pedido acceso todavía.")).toBeVisible();
    await page.screenshot({ path: resolve(OUT, "1-admin-sin-solicitudes.png"), fullPage: true });

    // 2 · El amigo (cuenta que Steam ya verificó, sin invitación) llega con su pedido registrado: lo ve el propietario con nombre, sin ID.
    writeFileSync(accessFile(), JSON.stringify({ version: 1, invited: [], requests: [{ steam32: FRIEND_ACCOUNT, personaName: FRIEND_NAME, avatarUrl: null, at: Date.now() }] }));
    await page.reload();
    const pending = page.getByTestId("beta-entry").filter({ hasText: FRIEND_NAME });
    await expect(pending).toHaveCount(1);
    await expect(page.getByTestId("beta-admin-page")).not.toContainText(String(FRIEND_ACCOUNT));
    await page.screenshot({ path: resolve(OUT, "2-admin-con-solicitud.png"), fullPage: true });

    // 3 · Sin aprobar, el amigo no entra a nada: cae en «Tu acceso está pendiente» y se le dice qué hacer.
    const friend = await friendContext(browser);
    const friendPage = await friend.newPage();
    await friendPage.goto("/meta");
    await expect(friendPage).toHaveURL(/\/access-denied$/);
    await expect(friendPage.getByRole("heading", { name: "Tu acceso está pendiente" })).toBeVisible();
    await expect(friendPage.getByRole("link", { name: "Entrar con Steam" })).toBeVisible();
    await friendPage.screenshot({ path: resolve(OUT, "3-amigo-acceso-pendiente.png"), fullPage: true });

    // 4 · El propietario aprueba con un botón; el amigo ya entra, y NO ve la administración.
    await pending.getByTestId("beta-approve").click();
    await expect(page.getByTestId("beta-entry").filter({ hasText: FRIEND_NAME }).getByRole("button", { name: "Quitar acceso" })).toBeVisible();
    // «Ya me aprobaron, entrar»: vuelve a entrar con Steam (el rechazo cortó su sesión de prueba) y ahora pasa.
    await signInFriend(friend);
    await friendPage.goto("/meta");
    await expect(friendPage).toHaveURL(/\/meta$/);
    await expect(friendPage.getByTestId("app-nav")).toBeVisible();
    await friendPage.goto("/admin/invitaciones");
    await expect(friendPage.getByTestId("beta-admin-forbidden")).toBeVisible();
    expect((await friendPage.request.get("/api/beta-admin")).status()).toBe(403);
    expect((await friendPage.request.post("/api/beta-admin", { data: { action: "approve", ref: "0".repeat(16) } })).status()).toBe(403);
    await friendPage.screenshot({ path: resolve(OUT, "4-amigo-sin-administracion.png") });

    // 5 · Retirar el acceso corta también su sesión abierta.
    await page.getByTestId("beta-entry").filter({ hasText: FRIEND_NAME }).getByRole("button", { name: "Quitar acceso" }).click();
    await expect(page.getByText("Todavía no has aprobado a nadie desde aquí.")).toBeVisible();
    await friendPage.goto("/meta");
    await expect(friendPage).toHaveURL(/\/access-denied$/);
    await friend.close();
  });

  test("el panel de invitaciones se ve entero en móvil (390 px) sin desborde", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/invitaciones");
    await expect(page.getByTestId("beta-admin-page")).toBeVisible();
    const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: resolve(OUT, "5-admin-movil-390.png"), fullPage: true });
  });

  test("Mi cuenta separa «Steam conectado» de «perfil no disponible», ofrece reintentar y se recupera al leer el perfil real", async ({ page }) => {
    // Steam se simula en el navegador (el servidor del E2E no tiene salida a Steam): primero no responde y al segundo intento entrega el perfil.
    let recovered = false;
    let refreshCalls = 0;
    const unavailable = { accountId: 1, personaName: "Jugador de Steam", avatarUrl: null, profileStatus: "unavailable", isAdmin: true };
    const available = { accountId: 1, personaName: "Kiro de prueba", avatarUrl: null, profileStatus: "ok", isAdmin: true };
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: recovered ? available : unavailable }));
    await page.route("**/api/auth/refresh-profile", (route) => {
      refreshCalls += 1;
      recovered = refreshCalls >= 3;
      return route.fulfill({ json: recovered ? available : unavailable });
    });

    await page.goto("/settings");
    await expect(page.getByTestId("steam-connected")).toHaveText("Steam conectado");
    // Autenticada (Steam confirmó la cuenta) pero perfil no disponible: no es un error de acceso, y se reintentó sola una vez.
    await expect(page.getByTestId("profile-unavailable")).toBeVisible();
    await expect(page.getByTestId("account-name")).toHaveText("Jugador de Steam");
    await expect(page.getByTestId("profile-retry-failed")).toBeVisible();
    await expect(page.getByTestId("account-page")).not.toContainText(/\d{7,10}/);
    await page.screenshot({ path: resolve(OUT, "6-mi-cuenta-perfil-no-disponible.png"), fullPage: true });

    await page.getByTestId("profile-retry").click(); // 2.º intento: Steam sigue sin responder
    await expect(page.getByTestId("profile-retry-failed")).toBeVisible();
    await page.getByTestId("profile-retry").click(); // 3.er intento: Steam entrega el perfil
    await expect(page.getByTestId("account-name")).toHaveText("Kiro de prueba");
    await expect(page.getByTestId("profile-unavailable")).toHaveCount(0);
    await expect(page.getByTestId("steam-connected")).toHaveText("Steam conectado");
    await page.screenshot({ path: resolve(OUT, "7-mi-cuenta-perfil-real.png"), fullPage: true });
  });
});

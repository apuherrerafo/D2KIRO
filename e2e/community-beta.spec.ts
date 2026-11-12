import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { sealData } from "iron-session";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./support/failure-evidence";

// Beta comunitaria de punta a punta con navegador real: solicitud de acceso con mensaje, campanita del administrador (aviso + sonido sin repetir),
// aprobar / rechazar desde la interfaz, y feedback universal con capturas privadas. Las sesiones se sellan con el SESSION_SECRET efímero de la corrida
// (igual que global-setup.ts): NO prueba el login real de Steam ni dos cuentas Steam auténticas. El bucket es un S3 SIMULADO en loopback (:9199) que
// comprueba la firma y el hash del cuerpo: valida el cliente de D2KIRO, NO el servicio real de Cloudflare R2.

const OUT = resolve(process.cwd(), "docs/research/community-beta");
mkdirSync(OUT, { recursive: true });
const ANA = { id: 999000002, name: "Ana de prueba" };
const BEN = { id: 999000003, name: "Ben de prueba" };
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const S3_PORT = 9199;

// PNG válido de 1×1 (rojo).
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function runtimeFile(name: string): string {
  const dir = process.env.E2E_RUNTIME_DIR;
  if (dir === undefined) throw new Error("falta E2E_RUNTIME_DIR");
  return join(dir, name);
}

// ───────── S3 simulado ─────────
interface FakeS3 {
  objects: Map<string, Buffer>;
  rejected: string[];
  down: boolean;
  server: Server;
}

function startFakeS3(): Promise<FakeS3> {
  const state = { objects: new Map<string, Buffer>(), rejected: [] as string[], down: false } as FakeS3;
  state.server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (state.down) {
        response.statusCode = 503;
        response.end();
        return;
      }
      const body = Buffer.concat(chunks);
      const authorization = request.headers.authorization ?? "";
      const declaredHash = request.headers["x-amz-content-sha256"];
      const actualHash = createHash("sha256").update(body).digest("hex");
      // El bucket real rechaza lo que no viene firmado o cuyo cuerpo no coincide con el hash firmado.
      if (!/^AWS4-HMAC-SHA256 Credential=e2e-key-id\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/.test(authorization) || declaredHash !== actualHash) {
        state.rejected.push(`${request.method} ${request.url}`);
        response.statusCode = 403;
        response.end();
        return;
      }
      const key = (request.url ?? "").replace(/^\/d2kiro-feedback-e2e\//, "");
      if (request.method === "PUT") {
        state.objects.set(key, body);
        response.statusCode = 200;
        response.end();
      } else if (request.method === "GET") {
        const found = state.objects.get(key);
        response.statusCode = found === undefined ? 404 : 200;
        response.end(found);
      } else {
        state.objects.delete(key);
        response.statusCode = 204;
        response.end();
      }
    });
  });
  return new Promise((done) => state.server.listen(S3_PORT, "127.0.0.1", () => done(state)));
}

// ───────── sesiones de prueba ─────────
async function sealedCookie(name: string, data: object, ttl: number): Promise<{ name: string; value: string; url: string; httpOnly: boolean; sameSite: "Lax" }> {
  const value = await sealData(data, { password: process.env.E2E_SESSION_SECRET!, ttl });
  return { name, value, url: process.env.E2E_BASE_URL!, httpOnly: true, sameSite: "Lax" };
}

async function newContext(browser: Browser, viewport = { width: 1280, height: 800 }): Promise<BrowserContext> {
  return browser.newContext({ baseURL: process.env.E2E_BASE_URL!, viewport, storageState: { cookies: [], origins: [] } });
}

// Lo que dejaría el callback de Steam tras verificar a una cuenta que todavía no está en la beta.
async function steamVerifiedVisitor(browser: Browser, person: { id: number; name: string }): Promise<BrowserContext> {
  const context = await newContext(browser);
  await context.addCookies([await sealedCookie("d2k_access_request", { accountId: person.id, personaName: person.name, avatarUrl: null, profileAvailable: true }, 3600)]);
  return context;
}

// Lo que dejaría el callback al entrar una cuenta ya admitida.
async function signedIn(browser: Browser, person: { id: number; name: string }, viewport = { width: 1280, height: 800 }): Promise<BrowserContext> {
  const context = await newContext(browser, viewport);
  const now = Date.now();
  await context.addCookies([await sealedCookie("d2k_session", { accountId: person.id, issuedAt: now, firstLoginAt: now, personaName: person.name, avatarUrl: null, profileAvailable: true }, SESSION_TTL_SECONDS)]);
  return context;
}

// Cuenta cuántas veces intentó sonar el navegador (cada aviso son dos notas) sin necesitar un altavoz.
async function countAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Real = window.AudioContext;
    (window as unknown as { __notes: number }).__notes = 0;
    window.AudioContext = class extends Real {
      createOscillator(): OscillatorNode {
        const oscillator = super.createOscillator();
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (when?: number) => {
          (window as unknown as { __notes: number }).__notes += 1;
          start(when);
        };
        return oscillator;
      }
    };
  });
}

function notes(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __notes: number }).__notes ?? 0);
}

async function waitBadge(page: Page, count: string): Promise<void> {
  await expect(page.getByTestId("admin-bell-count")).toHaveText(count, { timeout: 45_000 });
}

test.describe.configure({ mode: "serial" });

let s3: FakeS3;
test.beforeAll(async () => {
  rmSync(runtimeFile("beta-access.json"), { force: true });
  rmSync(runtimeFile("feedback.json"), { force: true });
  s3 = await startFakeS3();
});
test.afterAll(async () => {
  await new Promise<void>((done) => s3.server.close(() => done()));
});

test.describe("solicitud de acceso y campanita del administrador", () => {
  test("mensaje obligatorio → pendiente → aviso, contador y sonido sin repetir → aprobar y rechazar", async ({ page, browser }) => {
    test.setTimeout(300_000);
    await countAudio(page);
    await page.goto("/meta");
    await expect(page.getByTestId("admin-bell")).toBeVisible();
    await expect(page.getByTestId("admin-bell-count")).toHaveCount(0);
    await page.waitForTimeout(1500); // primera lectura: fija la marca, no avisa

    // Ana (Steam ya la verificó, no está en la beta) pide acceso: el mensaje es obligatorio.
    const ana = await steamVerifiedVisitor(browser, ANA);
    const anaPage = await ana.newPage();
    await anaPage.goto("/access-denied");
    await expect(anaPage.getByTestId("access-request-who")).toContainText(ANA.name);
    await expect(anaPage.getByText("¿Quién eres y de dónde nos conoces?")).toBeVisible();
    await expect(anaPage.getByTestId("access-request-submit")).toBeDisabled();
    await anaPage.getByTestId("access-request-message").fill("hola");
    await expect(anaPage.getByTestId("access-request-submit")).toBeDisabled();
    await anaPage.screenshot({ path: resolve(OUT, "1-solicitud-formulario.png"), fullPage: true });
    await anaPage.getByTestId("access-request-message").fill("Soy Ana, juego con Julio en el equipo de los jueves");
    await anaPage.getByTestId("access-request-submit").click();
    await expect(anaPage.getByTestId("access-request-pending")).toBeVisible();
    await expect(anaPage.getByTestId("access-request-sent-message")).toContainText("Soy Ana");
    await anaPage.screenshot({ path: resolve(OUT, "2-solicitud-pendiente.png"), fullPage: true });
    await anaPage.reload(); // el estado pendiente sobrevive a recargar
    await expect(anaPage.getByTestId("access-request-pending")).toBeVisible();

    // Pendiente no es una sesión: la app sigue cerrada para ella (la manda al inicio de sesión).
    await anaPage.goto("/meta");
    await expect(anaPage).toHaveURL(/\/login/);
    await anaPage.goto("/access-denied");
    await expect(anaPage.getByTestId("access-request-pending")).toBeVisible();

    // El administrador ve el aviso y el contador (consulta cada 30 s), SIN sonido porque todavía no lo activó.
    await waitBadge(page, "1");
    await expect(page.getByTestId("admin-bell-toast")).toContainText(ANA.name);
    expect(await notes(page)).toBe(0);
    await page.getByTestId("admin-bell").click();
    await expect(page.getByTestId("admin-bell-message")).toContainText("Soy Ana, juego con Julio");
    await page.screenshot({ path: resolve(OUT, "3-campanita-con-solicitud.png") });

    // «Activar sonido» suena una vez (tono de confirmación); una solicitud nueva suena UNA vez más.
    await page.getByTestId("admin-bell-sound").click();
    await expect(page.getByTestId("admin-bell-sound")).toHaveText("Sonido activado");
    await expect.poll(() => notes(page)).toBeGreaterThanOrEqual(2);
    const afterToggle = await notes(page);
    const ben = await steamVerifiedVisitor(browser, BEN);
    const benPage = await ben.newPage();
    await benPage.goto("/access-denied");
    await benPage.getByTestId("access-request-message").fill("Soy Ben, te vi en un stream de Dota");
    await benPage.getByTestId("access-request-submit").click();
    await expect(benPage.getByTestId("access-request-pending")).toBeVisible();
    await waitBadge(page, "2");
    await expect(page.getByTestId("admin-bell-item").filter({ hasText: BEN.name })).toBeVisible(); // con el panel abierto, la solicitud aparece en la lista (el aviso flotante se oculta)
    await expect.poll(() => notes(page)).toBe(afterToggle + 2);

    // Ni refrescar ni abrir otra pestaña repiten el sonido por solicitudes que ya se avisaron.
    const afterNew = await notes(page);
    await page.waitForTimeout(32_000); // al menos un ciclo de consulta más: nada nuevo → nada suena
    expect(await notes(page)).toBe(afterNew);
    await page.reload();
    await waitBadge(page, "2");
    expect(await notes(page)).toBe(0);
    const second = await page.context().newPage();
    await countAudio(second);
    await second.goto("/meta");
    await waitBadge(second, "2");
    expect(await notes(second)).toBe(0);
    await second.close();

    // Aprobar a Ana y rechazar a Ben desde la campanita.
    await page.getByTestId("admin-bell").click();
    const anaItem = page.getByTestId("admin-bell-item").filter({ hasText: ANA.name });
    await anaItem.getByTestId("admin-bell-approve").click();
    await expect(page.getByTestId("admin-bell-count")).toHaveText("1");
    const benItem = page.getByTestId("admin-bell-item").filter({ hasText: BEN.name });
    await benItem.getByTestId("admin-bell-reject").click();
    await expect(page.getByTestId("admin-bell-count")).toHaveCount(0);
    await expect(page.getByTestId("admin-bell-empty")).toBeVisible();
    await page.screenshot({ path: resolve(OUT, "4-campanita-vacia.png") });

    // Ana vuelve a entrar sin terminal: su pantalla de espera le avisa y entra a la app. Ben ve que no fue aprobado.
    await anaPage.goto("/access-denied");
    await expect(anaPage.getByTestId("access-request-approved")).toBeVisible();
    await anaPage.screenshot({ path: resolve(OUT, "5-solicitud-aprobada.png"), fullPage: true });
    await ana.close();
    const anaIn = await signedIn(browser, ANA);
    const anaApp = await anaIn.newPage();
    await anaApp.goto("/meta");
    await expect(anaApp).toHaveURL(/\/meta$/);
    await expect(anaApp.getByTestId("app-nav")).toBeVisible();
    await expect(anaApp.getByTestId("admin-bell")).toHaveCount(0); // la campanita es solo del administrador
    expect((await anaApp.request.get("/api/beta-admin")).status()).toBe(403);
    await anaIn.close();

    await benPage.reload();
    await expect(benPage.getByTestId("access-request-rejected")).toBeVisible();
    await benPage.screenshot({ path: resolve(OUT, "6-solicitud-rechazada.png"), fullPage: true });
    await ben.close();
  });

  test("la identidad no se falsifica: sin la cookie sellada de Steam no se puede pedir acceso ni suplantar a otra cuenta", async ({ browser }) => {
    const anonymous = await newContext(browser);
    const page = await anonymous.newPage();
    await page.goto("/login");
    const origin = process.env.E2E_BASE_URL!;
    const without = await page.request.post("/api/auth/access-request", { headers: { origin }, data: { message: "Soy alguien sin verificar por Steam" } });
    expect(without.status()).toBe(401);
    await anonymous.close();

    const visitor = await steamVerifiedVisitor(browser, { id: 999000009, name: "Eve de prueba" });
    const eve = await visitor.newPage();
    await eve.goto("/access-denied");
    const forged = await eve.request.post("/api/auth/access-request", { headers: { origin }, data: { message: "Quiero entrar como el administrador", accountId: 999000001, personaName: "Dueño" } });
    expect(forged.status()).toBe(201);
    const admin = await browser.newContext({ baseURL: origin, storageState: process.env.E2E_SESSION_PATH ?? join(process.env.E2E_RUNTIME_DIR!, "session.json") });
    const list = await (await admin.request.get("/api/beta-admin")).json();
    const names = (list.requests as Array<{ personaName: string }>).map((entry) => entry.personaName);
    expect(names).toEqual(["Eve de prueba"]); // la solicitud quedó a nombre de la cuenta que Steam verificó, no de la que dijo el cuerpo
    expect(JSON.stringify(list)).not.toContain("999000009");
    await admin.close();
    await visitor.close();
  });
});

test.describe("feedback universal", () => {
  test("botón flotante en Simulador y Live; texto + captura privada; la otra cuenta no la ve; bandeja con filtros, estados y exportación", async ({ page, browser }) => {
    test.setTimeout(240_000);
    // Ana ya está aprobada (como quedó en la prueba anterior): la prueba no depende del orden de ejecución.
    writeFileSync(runtimeFile("beta-access.json"), JSON.stringify({ version: 1, invited: [{ steam32: ANA.id, personaName: ANA.name, avatarUrl: null, at: Date.now() }], requests: [], rejected: [] }));
    // 1 · Administrador envía desde el Simulador con una captura.
    await page.goto("/simulator");
    await expect(page.getByTestId("feedback-fab")).toBeVisible();
    await page.screenshot({ path: resolve(OUT, "7-simulador-boton-feedback.png") });
    await page.getByTestId("feedback-fab").click();
    await expect(page.getByTestId("feedback-panel")).toBeVisible();
    await page.getByTestId("feedback-type-idea").click();
    await page.getByTestId("feedback-message").fill("Me gustaría ver el porqué del pick en una sola frase.");
    await page.getByTestId("feedback-file").setInputFiles({ name: "captura.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(page.getByTestId("feedback-previews").locator("img")).toHaveCount(1);
    await page.screenshot({ path: resolve(OUT, "8-feedback-con-vista-previa.png") });
    await page.getByTestId("feedback-submit").click();
    await expect(page.getByTestId("feedback-thanks")).toBeVisible();
    await expect(page.getByTestId("feedback-sent").first()).toContainText("Me gustaría ver el porqué");
    await expect(page.getByTestId("feedback-sent").first()).toContainText("/simulator");
    expect(s3.rejected).toEqual([]);
    expect(s3.objects.size).toBe(1);
    await page.screenshot({ path: resolve(OUT, "9-feedback-enviado.png") });

    // 2 · Archivo que dice ser PNG pero no lo es: el servidor lo rechaza y el texto escrito NO se pierde.
    await page.getByTestId("feedback-message").fill("Intento con un archivo falso");
    await page.getByTestId("feedback-file").setInputFiles({ name: "falso.png", mimeType: "image/png", buffer: Buffer.from("<svg onload=alert(1)>") });
    await page.getByTestId("feedback-submit").click();
    await expect(page.getByTestId("feedback-error")).toContainText("PNG, JPG o WebP");
    await expect(page.getByTestId("feedback-message")).toHaveValue("Intento con un archivo falso");
    expect(s3.objects.size).toBe(1);

    // 3 · Bucket caído: el reporte NO se da por enviado y se explica.
    s3.down = true;
    await page.getByTestId("feedback-previews").getByRole("button", { name: "Quitar" }).click();
    await page.getByTestId("feedback-file").setInputFiles({ name: "otra.png", mimeType: "image/png", buffer: PNG_1X1 });
    await page.getByTestId("feedback-submit").click();
    await expect(page.getByTestId("feedback-error")).toContainText("NO se envió");
    await page.screenshot({ path: resolve(OUT, "10-feedback-bucket-caido.png") });
    s3.down = false;
    await page.getByTestId("feedback-submit").click(); // con el bucket de vuelta, el mismo envío funciona
    await expect(page.getByTestId("feedback-sent")).toHaveCount(2);
    expect(s3.objects.size).toBe(2);

    // 4 · Ana (cuenta aprobada, no administradora) reporta desde Live.
    const ana = await signedIn(browser, ANA);
    const anaPage = await ana.newPage();
    await anaPage.goto("/live-draft");
    await anaPage.getByTestId("feedback-fab").click();
    await anaPage.getByTestId("feedback-message").fill("En Live no me aparece el aviso de conexión.");
    await anaPage.getByTestId("feedback-submit").click();
    await expect(anaPage.getByTestId("feedback-sent")).toHaveCount(1);
    await expect(anaPage.getByTestId("feedback-sent")).toContainText("/live-draft");
    // Aislamiento: Ana solo ve lo suyo.
    await expect(anaPage.getByTestId("feedback-thread")).not.toContainText("porqué del pick");

    // 5 · Capturas privadas: el autor y el administrador las leen; otra cuenta y un visitante, no.
    const mine = await (await page.request.get("/api/feedback")).json();
    const imageUrl = mine.items.find((item: { images: unknown[] }) => item.images.length > 0).images[0].url as string;
    expect((await page.request.get(imageUrl)).status()).toBe(200);
    expect((await anaPage.request.get(imageUrl)).status()).toBe(404);
    const stranger = await newContext(browser);
    const strangerPage = await stranger.newPage();
    await strangerPage.goto("/login");
    expect((await strangerPage.request.get(imageUrl, { maxRedirects: 0 })).status()).not.toBe(200);
    await stranger.close();
    // Las rutas de la bandeja del administrador no son para Ana.
    expect((await anaPage.request.get("/api/feedback-admin")).status()).toBe(403);
    expect((await anaPage.request.get("/api/feedback-admin/export?format=csv")).status()).toBe(403);
    await anaPage.goto("/admin/feedback");
    await expect(anaPage.getByTestId("feedback-inbox-forbidden")).toBeVisible();
    await ana.close();

    // 6 · Bandeja del administrador.
    await page.goto("/admin/feedback");
    await expect(page.getByTestId("feedback-inbox-item")).toHaveCount(3);
    await expect(page.getByTestId("feedback-inbox-shot").first()).toBeVisible();
    // La captura se descarga de verdad (con la sesión, desde el bucket privado): no basta con que el <img> exista.
    await expect.poll(() => page.getByTestId("feedback-inbox-shot").first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: resolve(OUT, "11-bandeja.png"), fullPage: true });
    await page.getByTestId("feedback-filter-type").selectOption("idea"); // los dos envíos del administrador (el segundo reintentó la misma idea)
    await expect(page.getByTestId("feedback-inbox-item")).toHaveCount(2);
    await page.getByTestId("feedback-filter-type").selectOption("problema");
    await expect(page.getByTestId("feedback-inbox-item")).toHaveCount(1);
    await page.getByTestId("feedback-filter-type").selectOption("");
    await page.getByTestId("feedback-inbox-item").first().getByTestId("feedback-status-en_revision").click();
    await page.getByTestId("feedback-filter-status").selectOption("en_revision");
    await expect(page.getByTestId("feedback-inbox-item")).toHaveCount(1);
    await page.getByTestId("feedback-inbox-item").first().getByTestId("feedback-status-resuelto").click();
    await page.getByTestId("feedback-filter-status").selectOption("resuelto");
    await expect(page.getByTestId("feedback-inbox-item")).toHaveCount(1);
    await page.getByTestId("feedback-filter-status").selectOption("");

    const json = await page.request.get("/api/feedback-admin/export?format=json");
    expect(json.headers()["content-disposition"]).toContain("attachment");
    const exported = await json.text();
    expect(JSON.parse(exported).items).toHaveLength(3);
    for (const id of [999000001, ANA.id]) expect(exported).not.toContain(String(id));
    expect(exported).not.toContain(ANA.name);
    const csv = await (await page.request.get("/api/feedback-admin/export?format=csv")).text();
    expect(csv.split("\n")[0]).toContain("authorRef");
    const download = page.waitForEvent("download");
    await page.getByTestId("feedback-export-csv").click();
    expect((await download).suggestedFilename()).toMatch(/^d2kiro-feedback-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test("móvil (390 px): botón, panel de feedback y campanita caben sin desborde horizontal", async ({ browser }) => {
    const context = await signedIn(browser, { id: 999000001, name: "Admin móvil" }, { width: 390, height: 844 });
    const page = await context.newPage();
    await page.goto("/simulator");
    await page.getByTestId("feedback-fab").click();
    await expect(page.getByTestId("feedback-panel")).toBeVisible();
    const box = await page.getByTestId("feedback-panel").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: resolve(OUT, "12-movil-feedback.png") });
    await page.getByTestId("feedback-close").click();
    await page.getByTestId("admin-bell").click();
    await expect(page.getByTestId("admin-bell-panel")).toBeVisible();
    const bell = await page.getByTestId("admin-bell-panel").boundingBox();
    expect(bell!.x).toBeGreaterThanOrEqual(0);
    expect(bell!.x + bell!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: resolve(OUT, "13-movil-campanita.png") });
    await page.goto("/admin/feedback");
    const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: resolve(OUT, "14-movil-bandeja.png"), fullPage: true });
    await context.close();
  });
});

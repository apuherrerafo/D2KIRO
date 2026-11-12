import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFeedbackAdminHandlers, csvCell, toCsv } from "./feedback-admin-handler";
import { createFeedbackHandlers, detectImageMime, type FeedbackSession } from "./feedback-handler";
import { readFeedbackStore } from "./feedback-store";
import type { ObjectStorage } from "./object-storage";
import { createRateLimiter } from "./rate-limit";

const SECRET = "ref-" + "credential-for-tests-only-0123456789abcdef";
const ORIGIN = "https://coach.example";
const OWNER = 1001;
const ANA = 2002;
const BEN = 3003;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

let dir = "";
let file = "";
let clock = 1_800_000_000_000;
let ids = 0;

function fakeStorage(options: { failPut?: boolean } = {}): ObjectStorage & { objects: Map<string, { body: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    objects,
    async put(key, body, contentType) {
      if (options.failPut === true) throw new Error("bucket caído");
      objects.set(key, { body, contentType });
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async remove(key) {
      objects.delete(key);
    },
  };
}

function env(): Record<string, string> {
  return { FEEDBACK_FILE: file, BETA_ADMIN_STEAM_IDS: String(OWNER), SESSION_SECRET: SECRET, RAILWAY_GIT_COMMIT_SHA: "a".repeat(40) };
}

function user(accountId: number | null, storage: ObjectStorage | null, name = "Ana") {
  const session: FeedbackSession | null = accountId === null ? null : { accountId, personaName: name };
  return createFeedbackHandlers({
    session: async () => session,
    env: env(),
    publicOrigin: ORIGIN,
    now: () => clock,
    storage,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    limiter: createRateLimiter(100, 60_000),
  });
}

function admin(accountId: number | null) {
  return createFeedbackAdminHandlers({ accountId: async () => accountId, env: env(), publicOrigin: ORIGIN, now: () => clock });
}

function report(fields: Record<string, string>, images: Array<{ bytes: Uint8Array; name: string; type: string }> = [], headers: Record<string, string> = {}): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries({ type: "problema", message: "El botón de elegir no responde", route: "/simulator", viewport: "1280x800", language: "es-PE", userAgent: "Mozilla/5.0 Test", ...fields })) form.set(key, value);
  for (const image of images) form.append("images", new File([image.bytes as BlobPart], image.name, { type: image.type }));
  return new Request(`${ORIGIN}/api/feedback`, { method: "POST", headers: { origin: ORIGIN, ...headers }, body: form });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "d2k-fb-"));
  file = join(dir, "feedback.json");
  clock = 1_800_000_000_000;
  ids = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("enviar feedback", () => {
  test("texto solo: se guarda con tipo, ruta, contexto técnico y versión del servidor", async () => {
    const response = await user(ANA, null).POST(report({}));
    expect(response.status).toBe(201);
    const [saved] = readFeedbackStore(file).items;
    expect(saved).toMatchObject({ type: "problema", status: "pendiente", route: "/simulator", appVersion: "aaaaaaaa", author: ANA, authorName: "Ana" });
    expect(saved.context).toEqual({ viewport: "1280x800", language: "es-PE", userAgent: "Mozilla/5.0 Test" });
  });

  test("sin sesión → 401; otro origen → 403; nada se escribe", async () => {
    expect((await user(null, null).POST(report({}))).status).toBe(401);
    expect((await user(ANA, null).POST(report({}, [], { origin: "https://evil.example" }))).status).toBe(403);
    expect(existsSync(file)).toBe(false);
  });

  test("valida tipo y mensaje; una ruta con query o rara no se guarda tal cual; el contexto no puede traer cookies ni tokens", async () => {
    expect((await user(ANA, null).POST(report({ type: "otro" }))).status).toBe(400);
    expect((await user(ANA, null).POST(report({ message: "   " }))).status).toBe(400);
    expect((await user(ANA, null).POST(report({ message: "x".repeat(2001) }))).status).toBe(400);
    await user(ANA, null).POST(report({ route: "/live-draft?token=SECRETO#x", userAgent: "UA\u0000con\ncontrol" }));
    const [saved] = readFeedbackStore(file).items;
    expect(saved.route).toBe("(desconocida)");
    expect(saved.context.userAgent).toBe("UA con control");
    expect(JSON.stringify(saved)).not.toContain("SECRETO");
  });

  test("el autor sale SOLO de la sesión: un campo `author` del formulario se ignora", async () => {
    await user(ANA, null).POST(report({ author: String(OWNER), authorName: "Dueño" }));
    const [saved] = readFeedbackStore(file).items;
    expect(saved.author).toBe(ANA);
    expect(saved.authorName).toBe("Ana");
  });

  test("capturas: se reconocen por sus bytes, se guardan privadas y el registro solo guarda la referencia", async () => {
    const storage = fakeStorage();
    const response = await user(ANA, storage).POST(report({}, [{ bytes: PNG, name: "a.png", type: "image/png" }, { bytes: WEBP, name: "b.webp", type: "image/webp" }]));
    expect(response.status).toBe(201);
    const [saved] = readFeedbackStore(file).items;
    expect(saved.images.map((image) => image.mime)).toEqual(["image/png", "image/webp"]);
    expect([...storage.objects.keys()]).toEqual([`feedback/${saved.id}/0.png`, `feedback/${saved.id}/1.webp`]);
    expect(readFileSync(file, "utf8")).not.toContain("iVBOR"); // ni base64 ni bytes en el JSON
  });

  test("formato falso: un .png que en realidad es otra cosa se rechaza (el tipo declarado no cuenta)", async () => {
    const storage = fakeStorage();
    const response = await user(ANA, storage).POST(report({}, [{ bytes: new TextEncoder().encode("<svg onload=alert(1)>"), name: "x.png", type: "image/png" }]));
    expect(response.status).toBe(415);
    expect(storage.objects.size).toBe(0);
    expect(existsSync(file)).toBe(false);
  });

  test("límites: más de 3 imágenes → 400; una imagen mayor al tope → 413", async () => {
    const storage = fakeStorage();
    const four = Array.from({ length: 4 }, (_, index) => ({ bytes: PNG, name: `${index}.png`, type: "image/png" }));
    expect((await user(ANA, storage).POST(report({}, four))).status).toBe(400);
    const big = new Uint8Array(2_500_001);
    big.set(PNG);
    expect((await user(ANA, storage).POST(report({}, [{ bytes: big, name: "big.png", type: "image/png" }]))).status).toBe(413);
    expect(storage.objects.size).toBe(0);
  });

  test("cuerpo chunked SIN content-length que supera el límite → 413 y la lectura se corta (no se materializa entero en memoria)", async () => {
    // Hallazgo de las dos revisiones independientes del P0: el tope solo miraba content-length, que una petición chunked no trae.
    let pulled = 0;
    const chunk = new Uint8Array(1_000_000);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= 60) return controller.close();
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    const request = new Request(`${ORIGIN}/api/feedback`, { method: "POST", headers: { origin: ORIGIN, "content-type": "multipart/form-data; boundary=x" }, body: stream, duplex: "half" } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();
    const response = await user(ANA, fakeStorage()).POST(request);
    expect(response.status).toBe(413);
    expect(pulled).toBeLessThan(20); // se leyeron ~8 MB como mucho, no los 60 MB que el cliente quería mandar
    expect(readFeedbackStore(file).items).toHaveLength(0);
  });

  test("sin bucket configurado: el texto funciona, las imágenes dan 503 y nada se guarda a medias", async () => {
    expect((await (await user(ANA, null).GET()).json()).imagesEnabled).toBe(false);
    const response = await user(ANA, null).POST(report({}, [{ bytes: PNG, name: "a.png", type: "image/png" }]));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("images_unavailable");
    expect(existsSync(file)).toBe(false);
  });

  test("si el bucket falla, el reporte NO se guarda y se avisa (no se declara enviado)", async () => {
    const response = await user(ANA, fakeStorage({ failPut: true })).POST(report({}, [{ bytes: PNG, name: "a.png", type: "image/png" }]));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("image_upload_failed");
    expect(existsSync(file)).toBe(false);
  });

  test("límite de frecuencia por cuenta", async () => {
    const limited = createFeedbackHandlers({ session: async () => ({ accountId: ANA, personaName: "Ana" }), env: env(), publicOrigin: ORIGIN, now: () => clock, storage: null, limiter: createRateLimiter(2, 60_000) });
    expect((await limited.POST(report({}))).status).toBe(201);
    expect((await limited.POST(report({}))).status).toBe(201);
    expect((await limited.POST(report({}))).status).toBe(429);
  });

  test("detectImageMime distingue png/jpg/webp y rechaza el resto", () => {
    expect(detectImageMime(PNG)).toBe("image/png");
    expect(detectImageMime(JPG)).toBe("image/jpeg");
    expect(detectImageMime(WEBP)).toBe("image/webp");
    expect(detectImageMime(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(detectImageMime(new Uint8Array())).toBeNull();
  });
});

describe("aislamiento de cuentas y capturas privadas", () => {
  test("cada persona ve solo sus reportes (también el administrador en su vista personal)", async () => {
    await user(ANA, null, "Ana").POST(report({ message: "de Ana" }));
    await user(BEN, null, "Ben").POST(report({ message: "de Ben" }));
    await user(OWNER, null, "Dueño").POST(report({ message: "del dueño" }));
    const mine = async (id: number) => ((await (await user(id, null).GET()).json()).items as Array<{ message: string }>).map((item) => item.message);
    expect(await mine(ANA)).toEqual(["de Ana"]);
    expect(await mine(BEN)).toEqual(["de Ben"]);
    expect(await mine(OWNER)).toEqual(["del dueño"]);
    expect(JSON.stringify(await (await user(ANA, null).GET()).json())).not.toContain(String(ANA));
  });

  test("una captura la lee su autor y el administrador; otra cuenta recibe 404 y sin sesión 401", async () => {
    const storage = fakeStorage();
    await user(ANA, storage).POST(report({}, [{ bytes: PNG, name: "a.png", type: "image/png" }]));
    const id = readFeedbackStore(file).items[0].id;
    const own = await user(ANA, storage).IMAGE(id, "0");
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/png");
    expect(own.headers.get("cache-control")).toContain("no-store");
    expect(own.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await user(OWNER, storage).IMAGE(id, "0")).status).toBe(200);
    expect((await user(BEN, storage).IMAGE(id, "0")).status).toBe(404);
    expect((await user(null, storage).IMAGE(id, "0")).status).toBe(401);
    expect((await user(ANA, storage).IMAGE(id, "1")).status).toBe(404);
    expect((await user(ANA, storage).IMAGE("../../etc/passwd", "0")).status).toBe(404);
  });
});

describe("bandeja del administrador", () => {
  async function seed(): Promise<void> {
    await user(ANA, null, "Ana").POST(report({ type: "problema", message: "=HYPERLINK(\"http://x\")" }));
    clock += 1000;
    await user(BEN, null, "Ben").POST(report({ type: "idea", message: "Una idea con, coma y \"comillas\"" }));
  }

  test("solo el administrador: sin sesión 401, otra cuenta 403", async () => {
    expect((await admin(null).GET(new Request(`${ORIGIN}/api/feedback-admin`))).status).toBe(401);
    expect((await admin(ANA).GET(new Request(`${ORIGIN}/api/feedback-admin`))).status).toBe(403);
    expect((await admin(ANA).EXPORT(new Request(`${ORIGIN}/api/feedback-admin/export`))).status).toBe(403);
  });

  test("lista con filtros por tipo y estado; el estado se cambia y persiste; nunca aparece el Steam32 ni el nombre", async () => {
    await seed();
    const all = await (await admin(OWNER).GET(new Request(`${ORIGIN}/api/feedback-admin`))).json();
    expect(all.items.map((item: { type: string }) => item.type)).toEqual(["idea", "problema"]); // más nuevo primero
    expect(all.pending).toBe(2);
    expect(JSON.stringify(all)).not.toContain(String(ANA));
    expect(JSON.stringify(all)).not.toContain("Ana");
    const ideas = await (await admin(OWNER).GET(new Request(`${ORIGIN}/api/feedback-admin?type=idea`))).json();
    expect(ideas.items).toHaveLength(1);
    const target = all.items[1].id as string;
    const change = await admin(OWNER).POST(new Request(`${ORIGIN}/api/feedback-admin`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ id: target, status: "resuelto" }) }));
    expect(change.status).toBe(200);
    const resolved = await (await admin(OWNER).GET(new Request(`${ORIGIN}/api/feedback-admin?status=resuelto`))).json();
    expect(resolved.items.map((item: { id: string }) => item.id)).toEqual([target]);
    const bad = await admin(OWNER).POST(new Request(`${ORIGIN}/api/feedback-admin`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ id: target, status: "borrado" }) }));
    expect(bad.status).toBe(400);
  });

  test("exporta JSON y CSV sin datos personales de cuenta, y el CSV neutraliza fórmulas", async () => {
    await seed();
    const json = await admin(OWNER).EXPORT(new Request(`${ORIGIN}/api/feedback-admin/export?format=json`));
    expect(json.headers.get("content-disposition")).toContain("attachment");
    const body = await json.text();
    expect(JSON.parse(body).items).toHaveLength(2);
    expect(body).not.toContain(String(ANA));
    expect(body).not.toContain(String(BEN));
    const csv = await (await admin(OWNER).EXPORT(new Request(`${ORIGIN}/api/feedback-admin/export?format=csv`))).text();
    expect(csv.split("\n")[0]).toBe("id,createdAt,type,status,message,route,appVersion,viewport,language,userAgent,authorRef,images");
    expect(csv).toContain("\"'=HYPERLINK(");
    expect(csv).toContain("\"Una idea con, coma y \"\"comillas\"\"\"");
  });

  test("csvCell escapa comillas y neutraliza = + - @", () => {
    expect(csvCell("=1+1")).toBe("\"'=1+1\"");
    expect(csvCell("+cmd")).toBe("\"'+cmd\"");
    expect(csvCell("-1")).toBe("\"'-1\"");
    expect(csvCell("@x")).toBe("\"'@x\"");
    expect(csvCell("a\"b")).toBe("\"a\"\"b\"");
    expect(toCsv([])).toContain("id,createdAt");
  });
});

describe("persistencia", () => {
  test("un archivo ilegible NO se pisa: el reporte se rechaza antes de perder los anteriores", async () => {
    writeFileSync(file, "{ esto no es json");
    const response = await user(ANA, null).POST(report({}));
    expect(response.status).toBe(503);
    expect(readFileSync(file, "utf8")).toBe("{ esto no es json");
  });

  test("lo guardado sobrevive a un «reinicio» (otra instancia del manejador lee el mismo archivo) y deja respaldo del formato anterior", async () => {
    await user(ANA, null).POST(report({ message: "primero" }));
    const restarted = user(ANA, null);
    expect(((await (await restarted.GET()).json()).items as unknown[]).length).toBe(1);
    await restarted.POST(report({ message: "segundo" }));
    expect(readFeedbackStore(file).items).toHaveLength(2);
    expect(existsSync(`${file}.bak-v1`)).toBe(true);
  });
});

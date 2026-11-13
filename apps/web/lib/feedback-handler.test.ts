import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFeedbackAdminHandlers, csvCell, toCsv } from "./feedback-admin-handler";
import { createFeedbackHandlers, createReadGate, detectImageMime, MAX_FORM_PARTS, multipartBoundary, type FeedbackSession, type ReadGate } from "./feedback-handler";
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

function user(accountId: number | null, storage: ObjectStorage | null, name = "Ana", read: { readGate?: ReadGate; readDeadlineMs?: number; readIdleMs?: number; storageTimeoutMs?: number } = {}) {
  const session: FeedbackSession | null = accountId === null ? null : { accountId, personaName: name };
  return createFeedbackHandlers({
    ...read,
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

  describe("ataques al endpoint de subida (revisión independiente: memoria, goteo, ráfagas)", () => {
    const BOUNDARY = "multipart/form-data; boundary=x";
    function streamRequest(stream: ReadableStream<Uint8Array>, headers: Record<string, string> = {}): Request {
      return new Request(`${ORIGIN}/api/feedback`, { method: "POST", headers: { origin: ORIGIN, "content-type": BOUNDARY, ...headers }, body: stream, duplex: "half" } as RequestInit);
    }
    function chunks(count: number, size: number, onPull?: () => void): ReadableStream<Uint8Array> {
      let sent = 0;
      const chunk = new Uint8Array(size);
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          onPull?.();
          if (sent >= count) return controller.close();
          sent += 1;
          controller.enqueue(chunk);
        },
      });
    }

    test("content-length MENTIROSO (dice 100 bytes, manda ~60 MB): 413 y se corta la lectura", async () => {
      let pulls = 0;
      const request = streamRequest(chunks(60, 1_000_000, () => (pulls += 1)), { "content-length": "100" });
      const response = await user(ANA, fakeStorage()).POST(request);
      expect(response.status).toBe(413);
      expect(pulls).toBeLessThan(20);
    });

    test("tipo de contenido que no es multipart: 415 sin leer ni un byte del cuerpo", async () => {
      let pulls = 0;
      const request = streamRequest(chunks(60, 1_000_000, () => (pulls += 1)), { "content-type": "application/json" });
      const response = await user(ANA, fakeStorage()).POST(request);
      expect(response.status).toBe(415);
      expect(pulls).toBeLessThanOrEqual(1); // un ReadableStream pide 1 trozo al crearse (highWaterMark); el handler no lee ninguno más
    });

    test("multipart sin boundary: 415", async () => {
      const request = streamRequest(chunks(1, 10), { "content-type": "multipart/form-data" });
      expect((await user(ANA, fakeStorage()).POST(request)).status).toBe(415);
    });

    test("goteo lento (el cliente nunca termina de mandar): 408 dentro del plazo, la lectura se cancela", async () => {
      let cancelled = false;
      const stalled = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(10));
          return new Promise(() => undefined); // jamás entrega el siguiente trozo
        },
        cancel() {
          cancelled = true;
        },
      });
      const started = Date.now();
      const response = await user(ANA, fakeStorage(), "Ana", { readDeadlineMs: 80 }).POST(streamRequest(stalled));
      expect(response.status).toBe(408);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(cancelled).toBe(true);
    });

    test("ráfaga de envíos simultáneos: pasado el máximo global, 503 con Retry-After; la misma cuenta no abre dos a la vez (429); al liberarse un cupo se acepta de nuevo", async () => {
      const gate = createReadGate(2);
      const open: Array<() => void> = [];
      function held(): Request {
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            return new Promise<void>((resolve) => {
              open.push(() => {
                controller.close();
                resolve();
              });
            });
          },
        });
        return streamRequest(stream);
      }
      const read = { readGate: gate, readDeadlineMs: 5_000 };
      const first = user(ANA, fakeStorage(), "Ana", read).POST(held());
      const second = user(BEN, fakeStorage(), "Ben", read).POST(held());
      await Bun.sleep(30);
      const refused = await user(OWNER, fakeStorage(), "Dueño", read).POST(held());
      expect(refused.status).toBe(503);
      expect(refused.headers.get("retry-after")).toBe("5");
      const sameAccount = await user(ANA, fakeStorage(), "Ana", read).POST(held());
      expect(sameAccount.status).toBe(429); // ANA ya tiene un envío en curso
      expect(((await sameAccount.json()) as { error: string }).error).toBe("upload_in_progress");
      for (const release of open) release();
      expect([(await first).status, (await second).status]).toEqual([400, 400]); // cuerpo vacío: rechazado, pero el cupo se liberó
      expect((await user(ANA, fakeStorage(), "Ana", read).POST(report({}))).status).toBe(201);
    });

    test("el cupo cubre TODO el envío, también la subida al bucket (memoria retenida mientras el almacén es lento)", async () => {
      const gate = createReadGate(1);
      let releaseUpload: () => void = () => undefined;
      const slow: ObjectStorage = {
        async put() {
          await new Promise<void>((resolve) => {
            releaseUpload = resolve;
          });
        },
        async get() {
          return null;
        },
        async remove() {},
      };
      const read = { readGate: gate, readDeadlineMs: 5_000 };
      const uploading = user(ANA, slow, "Ana", read).POST(report({}, [{ bytes: PNG, name: "a.png", type: "image/png" }]));
      await Bun.sleep(50); // la lectura ya terminó; el envío está esperando al bucket
      const other = await user(BEN, fakeStorage(), "Ben", read).POST(report({}));
      expect(other.status).toBe(503);
      releaseUpload();
      expect((await uploading).status).toBe(201);
      expect((await user(BEN, fakeStorage(), "Ben", read).POST(report({}))).status).toBe(201);
    });

    test("un 415/413 por cabeceras NO gasta el cupo por hora de la cuenta", async () => {
      const limited = createRateLimiter(1, 60_000);
      const make = () => createFeedbackHandlers({ session: async () => ({ accountId: ANA, personaName: "Ana" }), env: env(), publicOrigin: ORIGIN, now: () => clock, storage: null, limiter: limited });
      expect((await make().POST(streamRequest(chunks(1, 10), { "content-type": "application/json" }))).status).toBe(415);
      expect((await make().POST(streamRequest(chunks(1, 10), { "content-length": "99999999" }))).status).toBe(413);
      expect((await make().POST(report({}))).status).toBe(201); // el único cupo de la hora seguía intacto
      expect((await make().POST(report({}))).status).toBe(429);
    });

    test("EVASIÓN del tope de partes con `x-boundary=` antes del boundary real: el boundary se lee con tokenizador, no con regex suelta", async () => {
      const part = '--BBB\r\nContent-Disposition: form-data; name="f"\r\n\r\nv\r\n';
      const body = new TextEncoder().encode(part.repeat(20_000) + "--BBB--\r\n");
      const attack = new Request(`${ORIGIN}/api/feedback`, { method: "POST", headers: { origin: ORIGIN, "content-type": "multipart/form-data; x-boundary=AAA; boundary=BBB" }, body });
      const response = await user(ANA, fakeStorage()).POST(attack);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("too_many_parts"); // se contó con BBB, el mismo que usa el parser
    });

    test("boundary ambiguo o fuera de RFC (dos boundary, >70 caracteres, sin cerrar comillas, vacío, sin parámetros): 415", async () => {
      const bad = [
        "multipart/form-data; boundary=a; boundary=b",
        `multipart/form-data; boundary="${"b".repeat(71)}"`,
        'multipart/form-data; boundary="abc',
        "multipart/form-data; boundary=",
        "multipart/form-data; charset",
        "text/plain; boundary=x",
      ];
      for (const contentType of bad) {
        const response = await user(ANA, fakeStorage(), "Ana", { readGate: createReadGate(8) }).POST(streamRequest(chunks(1, 10), { "content-type": contentType }));
        expect(response.status, contentType).toBe(415);
      }
    });

    test("INACTIVIDAD: un cliente que manda un trozo y se queda callado se corta por el plazo de inactividad (no retiene el cupo los 45 s)", async () => {
      let cancelled = false;
      const stalled = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(10));
          return new Promise(() => undefined);
        },
        cancel() {
          cancelled = true;
        },
      });
      const started = Date.now();
      const response = await user(ANA, fakeStorage(), "Ana", { readDeadlineMs: 30_000, readIdleMs: 60 }).POST(streamRequest(stalled));
      expect(response.status).toBe(408);
      expect(Date.now() - started).toBeLessThan(2_000); // por inactividad, mucho antes que el plazo total de 30 s
      expect(cancelled).toBe(true);
    });

    test("INUNDACIÓN de trozos de 1 byte (CPU, no bytes): se corta por cantidad de trozos con 413", async () => {
      let pulls = 0;
      const request = streamRequest(chunks(60_000, 1, () => (pulls += 1)));
      const response = await user(ANA, fakeStorage()).POST(request);
      expect(response.status).toBe(413);
      expect(pulls).toBeLessThan(25_000); // MAX_CHUNKS = 20 000: se dejó de leer
    });

    test("un bucket COLGADO no retiene el cupo: la subida vence por plazo (502) y el cupo queda libre", async () => {
      const gate = createReadGate(1);
      const hung: ObjectStorage = { async put() { await new Promise(() => undefined); }, async get() { return null; }, async remove() {} };
      const read = { readGate: gate, readDeadlineMs: 5_000, storageTimeoutMs: 80 };
      const started = Date.now();
      const response = await user(ANA, hung, "Ana", read).POST(report({}, [{ bytes: PNG, name: "a.png", type: "image/png" }]));
      expect(response.status).toBe(502);
      expect(Date.now() - started).toBeLessThan(3_000);
      expect((await user(BEN, fakeStorage(), "Ben", read).POST(report({}))).status).toBe(201); // el único cupo se liberó
      expect(readFeedbackStore(file).items.filter((item) => item.author === ANA)).toHaveLength(0);
    });

    test("un 429 'envío en curso' o un 503 'ocupado' NO gastan uno de los envíos de la hora de la cuenta", async () => {
      const gate = createReadGate(8);
      const limited = createRateLimiter(2, 60_000);
      const handlersFor = (accountId: number) => createFeedbackHandlers({ session: async () => ({ accountId, personaName: "x" }), env: env(), publicOrigin: ORIGIN, now: () => clock, storage: null, limiter: limited, readGate: gate, readDeadlineMs: 5_000 });
      let release: () => void = () => undefined;
      const held = new ReadableStream<Uint8Array>({ pull(controller) { return new Promise<void>((resolve) => { release = () => { controller.close(); resolve(); }; }); } });
      const first = handlersFor(ANA).POST(streamRequest(held)); // gasta 1 de 2
      await Bun.sleep(30);
      expect((await handlersFor(ANA).POST(report({}))).status).toBe(429); // en curso: rechazado SIN gastar el segundo
      release();
      await first;
      expect((await handlersFor(ANA).POST(report({}))).status).toBe(201); // si el rechazado hubiera gastado el token, aquí sería 429
    });

    test("multipartBoundary tolera el `;` final que emiten clientes no navegador", () => {
      expect(multipartBoundary("multipart/form-data; boundary=abc;")).toBe("abc");
      expect(multipartBoundary("multipart/form-data; boundary=abc; ")).toBe("abc");
    });

    test("multipartBoundary: lee boundary con y sin comillas y en cualquier orden de parámetros", () => {
      expect(multipartBoundary("multipart/form-data; boundary=abc")).toBe("abc");
      expect(multipartBoundary('multipart/form-data; boundary="a b-c"')).toBe("a b-c");
      expect(multipartBoundary("multipart/form-data; charset=utf-8; boundary=zzz")).toBe("zzz");
      expect(multipartBoundary("MULTIPART/FORM-DATA; Boundary=Q")).toBe("Q");
      expect(multipartBoundary("multipart/form-data; x-boundary=AAA")).toBeNull();
    });

    test(`miles de partes diminutas bajo el tope de bytes: 400 too_many_parts (más de ${MAX_FORM_PARTS} boundaries), sin parsear`, async () => {
      const part = '--x\r\nContent-Disposition: form-data; name="f"\r\n\r\nv\r\n';
      const body = new TextEncoder().encode(part.repeat(20_000) + "--x--\r\n");
      expect(body.byteLength).toBeLessThan(2_000_000); // cabe en el tope de bytes: solo el conteo de partes lo frena
      const request = new Request(`${ORIGIN}/api/feedback`, { method: "POST", headers: { origin: ORIGIN, "content-type": BOUNDARY }, body });
      const response = await user(ANA, fakeStorage()).POST(request);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("too_many_parts");
      expect(readFeedbackStore(file).items).toHaveLength(0);
    });

    test("un boundary partido entre dos trozos se cuenta igual (no se evade el tope de partes)", async () => {
      const part = '--x\r\nContent-Disposition: form-data; name="f"\r\n\r\nv\r\n';
      const all = new TextEncoder().encode(part.repeat(MAX_FORM_PARTS + 5) + "--x--\r\n");
      const pieces: Uint8Array[] = [];
      for (let at = 0; at < all.length; at += 7) pieces.push(all.slice(at, at + 7)); // trozos de 7 bytes: cada `--x` cruza fronteras
      let index = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index >= pieces.length) return controller.close();
          controller.enqueue(pieces[index++]!);
        },
      });
      const response = await user(ANA, fakeStorage()).POST(streamRequest(stream));
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("too_many_parts");
    });

    test("un reporte legítimo con 3 capturas sigue pasando con todas las defensas activas", async () => {
      const storage = fakeStorage();
      const three = [PNG, JPG, WEBP].map((bytes, index) => ({ bytes, name: `${index}.bin`, type: "application/octet-stream" }));
      expect((await user(ANA, storage).POST(report({}, three))).status).toBe(201);
      expect(storage.objects.size).toBe(3);
    });

    test("archivo enorme con firma de imagen válida: se rechaza por tamaño y nada llega al bucket", async () => {
      const storage = fakeStorage();
      const huge = new Uint8Array(2_600_000);
      huge.set(PNG);
      const response = await user(ANA, storage).POST(report({}, [{ bytes: huge, name: "huge.png", type: "image/png" }]));
      expect(response.status).toBe(413);
      expect(storage.objects.size).toBe(0);
      expect(readFeedbackStore(file).items).toHaveLength(0);
    });
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

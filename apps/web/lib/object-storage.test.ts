import { describe, expect, test } from "bun:test";
import { createObjectStorage, readObjectStorageConfig, signRequest } from "./object-storage";

const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("firma AWS Signature V4", () => {
  test("reproduce el vector oficial de la documentación de AWS (GET Object con Range)", () => {
    const signed = signRequest({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      canonicalPath: "/test.txt",
      headers: { range: "bytes=0-9" },
      payloadHash: EMPTY_SHA,
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      date: new Date("2013-05-24T00:00:00Z"),
    });
    expect(signed.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });
});

describe("configuración del almacenamiento", () => {
  const complete = { FEEDBACK_S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com", FEEDBACK_S3_BUCKET: "d2kiro-feedback", FEEDBACK_S3_ACCESS_KEY_ID: "id", FEEDBACK_S3_SECRET_ACCESS_KEY: "secret" };

  test("completa → configuración; región por defecto «auto»", () => {
    expect(readObjectStorageConfig(complete)?.region).toBe("auto");
  });

  test("falta cualquier dato, endpoint sin https o bucket inválido → null (imágenes deshabilitadas)", () => {
    expect(readObjectStorageConfig({})).toBeNull();
    for (const missing of Object.keys(complete)) {
      const partial: Record<string, string> = { ...complete };
      delete partial[missing];
      expect(readObjectStorageConfig(partial)).toBeNull();
    }
    expect(readObjectStorageConfig({ ...complete, FEEDBACK_S3_ENDPOINT: "http://example.com" })).toBeNull();
    expect(readObjectStorageConfig({ ...complete, FEEDBACK_S3_BUCKET: "../x" })).toBeNull();
    expect(readObjectStorageConfig({ ...complete, FEEDBACK_S3_ENDPOINT: "no es url" })).toBeNull();
  });
});

describe("cliente de objetos", () => {
  const config = { endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "d2kiro-feedback", accessKeyId: "id", secretAccessKey: "secret", region: "auto" };
  const KEY = "feedback/123e4567-e89b-12d3-a456-426614174000/0.png";

  test("PUT firma la petición, usa ruta con bucket y nunca manda el secreto", async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    const storage = createObjectStorage(config, async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers });
      return new Response(null, { status: 200 });
    }, () => new Date("2026-11-12T10:00:00Z"));
    await storage.put(KEY, new Uint8Array([1, 2, 3]), "image/png");
    expect(calls[0].url).toBe(`https://acct.r2.cloudflarestorage.com/d2kiro-feedback/${KEY}`);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].headers.authorization).toStartWith("AWS4-HMAC-SHA256 Credential=id/20261112/auto/s3/aws4_request");
    expect(JSON.stringify(calls[0].headers)).not.toContain("secret");
  });

  test("GET de un objeto inexistente es null; un error del servicio lanza", async () => {
    expect(await createObjectStorage(config, async () => new Response(null, { status: 404 })).get(KEY)).toBeNull();
    await expect(createObjectStorage(config, async () => new Response(null, { status: 500 })).get(KEY)).rejects.toThrow();
  });

  test("una clave que no es de D2KIRO se rechaza antes de firmar o enviar nada", async () => {
    let called = false;
    const storage = createObjectStorage(config, async () => { called = true; return new Response(null, { status: 200 }); });
    await expect(storage.put("../../etc/passwd", new Uint8Array(), "image/png")).rejects.toThrow("object_key_invalid");
    await expect(storage.get("feedback/x/0.png")).rejects.toThrow("object_key_invalid");
    expect(called).toBe(false);
  });
});

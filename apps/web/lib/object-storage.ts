import { createHash, createHmac } from "node:crypto";

// Almacenamiento de objetos compatible con S3 (Cloudflare R2, AWS S3, MinIO) para las capturas del feedback. Sin dependencia nueva:
// firma AWS Signature V4 con node:crypto y habla con el bucket por fetch. Los objetos son PRIVADOS: nunca hay URL pública; las imágenes
// se leen siempre a través de una ruta de D2KIRO que comprueba quién pide (ver feedback-handler.ts). Las credenciales viven solo en process.env.

export interface ObjectStorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 usa «auto»; S3 real, la región del bucket. */
  region: string;
}

export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  remove(key: string): Promise<void>;
}

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: Uint8Array }) => Promise<Response>;

/** Lee la configuración del entorno. Devuelve null si falta cualquier dato: sin ella no hay subida de imágenes (el texto del feedback sigue funcionando). */
export function readObjectStorageConfig(env: Env): ObjectStorageConfig | null {
  const endpoint = env.FEEDBACK_S3_ENDPOINT?.trim();
  const bucket = env.FEEDBACK_S3_BUCKET?.trim();
  const accessKeyId = env.FEEDBACK_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.FEEDBACK_S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
  } catch {
    return null;
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return null;
  return { endpoint: endpoint.replace(/\/+$/, ""), bucket, accessKeyId, secretAccessKey, region: env.FEEDBACK_S3_REGION?.trim() || "auto" };
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export interface SignInput {
  method: string;
  host: string;
  /** Ruta ya codificada (cada segmento una sola vez, como exige S3). */
  canonicalPath: string;
  query?: string;
  /** Cabeceras extra a firmar (minúsculas). `host`, `x-amz-date` y `x-amz-content-sha256` se agregan solas. */
  headers?: Record<string, string>;
  payloadHash: string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Instante de la firma (inyectado para poder probar contra los vectores oficiales de AWS). */
  date: Date;
}

export interface SignedHeaders {
  authorization: string;
  amzDate: string;
  headers: Record<string, string>;
}

export function signRequest(input: SignInput): SignedHeaders {
  const service = input.service ?? "s3";
  const amzDate = input.date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const signed: Record<string, string> = { ...input.headers, host: input.host, "x-amz-content-sha256": input.payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(signed).map((name) => name.toLowerCase()).sort();
  const canonicalHeaders = names.map((name) => `${name}:${signed[Object.keys(signed).find((key) => key.toLowerCase() === name) as string].trim()}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [input.method, input.canonicalPath, input.query ?? "", canonicalHeaders, signedHeaders, input.payloadHash].join("\n");
  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, amzDate, headers: signed };
}

/** Las claves de objeto que genera D2KIRO son siempre de la forma `feedback/<uuid>/<n>.<ext>`; cualquier otra cosa se rechaza antes de firmar. */
const SAFE_KEY = /^feedback\/[0-9a-f-]{36}\/[0-9]\.(png|jpg|webp)$/;

export function createObjectStorage(config: ObjectStorageConfig, fetchImpl: FetchLike = fetch as unknown as FetchLike, now: () => Date = () => new Date()): ObjectStorage {
  const endpoint = new URL(config.endpoint);

  async function send(method: string, key: string, body?: Uint8Array, contentType?: string): Promise<Response> {
    if (!SAFE_KEY.test(key)) throw new Error("object_key_invalid");
    // Path-style (`endpoint/bucket/key`): funciona igual en R2, S3 y MinIO sin tocar el DNS del bucket.
    const canonicalPath = `${endpoint.pathname.replace(/\/+$/, "")}/${encodeSegment(config.bucket)}/${key.split("/").map(encodeSegment).join("/")}`;
    const payload = body ?? new Uint8Array();
    const extra: Record<string, string> = contentType === undefined ? {} : { "content-type": contentType };
    const signed = signRequest({ method, host: endpoint.host, canonicalPath, headers: extra, payloadHash: sha256Hex(payload), region: config.region, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, date: now() });
    const headers: Record<string, string> = { ...extra, "x-amz-date": signed.amzDate, "x-amz-content-sha256": signed.headers["x-amz-content-sha256"], authorization: signed.authorization };
    return fetchImpl(`${endpoint.origin}${canonicalPath}`, { method, headers, body: method === "PUT" ? payload : undefined });
  }

  return {
    async put(key, body, contentType) {
      const response = await send("PUT", key, body, contentType);
      if (!response.ok) throw new Error(`object_put_failed_${response.status}`);
    },
    async get(key) {
      const response = await send("GET", key);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`object_get_failed_${response.status}`);
      return { body: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
    },
    async remove(key) {
      const response = await send("DELETE", key);
      if (!response.ok && response.status !== 404) throw new Error(`object_delete_failed_${response.status}`);
    },
  };
}

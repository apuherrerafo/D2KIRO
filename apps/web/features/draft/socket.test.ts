import { describe, expect, test } from "bun:test";
import { requestEngineToken } from "./socket";

describe("token del WebSocket", () => {
  test("pide un token nuevo antes de cada intento, sin reutilizarlo", async () => {
    const requests: string[] = [];
    let attempt = 0;
    const fetcher = async (input: RequestInfo | URL) => {
      requests.push(String(input));
      attempt += 1;
      return Response.json({ token: `token-${attempt}`, expiresAt: Date.now() + 60_000 });
    };

    expect(await requestEngineToken(fetcher)).toBe("token-1");
    expect(await requestEngineToken(fetcher)).toBe("token-2");
    expect(requests).toEqual(["/api/auth/engine-token", "/api/auth/engine-token"]);
  });

  test("no abre la conexión con una respuesta no autorizada o vencida", async () => {
    await expect(requestEngineToken(async () => new Response(null, { status: 401 }))).rejects.toThrow("No se pudo autenticar");
    await expect(requestEngineToken(async () => Response.json(JSON.parse('{"to' + 'ken":"old","expiresAt":0}')))).rejects.toThrow("Respuesta de autenticación inválida");
  });
});

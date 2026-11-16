import { describe, expect, test } from "bun:test";
import nextConfig from "../next.config";
import { buildSecurityHeaders } from "./security-headers";

function headerValue(isProduction: boolean, key: string): string | undefined {
  return buildSecurityHeaders(isProduction).find((header) => header.key === key)?.value;
}

describe("SECURITY-001: cabeceras de seguridad", () => {
  test("producción: HSTS de un año, sin includeSubDomains ni preload (dominio compartido)", () => {
    const hsts = headerValue(true, "Strict-Transport-Security");
    expect(hsts).toBe("max-age=31536000");
    expect(hsts).not.toContain("includeSubDomains");
    expect(hsts).not.toContain("preload");
  });

  test("desarrollo: nunca HSTS (se pegaría en el navegador del desarrollador sobre http://localhost)", () => {
    expect(headerValue(false, "Strict-Transport-Security")).toBeUndefined();
  });

  test("siempre: nosniff, Referrer-Policy, Permissions-Policy y X-Frame-Options", () => {
    for (const isProduction of [true, false]) {
      expect(headerValue(isProduction, "X-Content-Type-Options")).toBe("nosniff");
      expect(headerValue(isProduction, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(headerValue(isProduction, "X-Frame-Options")).toBe("DENY");
      const permissions = headerValue(isProduction, "Permissions-Policy") ?? "";
      for (const feature of ["camera=()", "microphone=()", "geolocation=()", "payment=()", "usb=()"]) {
        expect(permissions).toContain(feature);
      }
    }
  });

  test("frame-ancestors va en el CSP que SÍ se aplica; el Report-Only no lo lleva (el navegador lo ignoraría)", () => {
    const enforced = headerValue(true, "Content-Security-Policy") ?? "";
    expect(enforced).toContain("frame-ancestors 'none'");
    expect(enforced).toContain("object-src 'none'");
    // El CSP aplicado no puede bloquear ninguna carga de recursos: ni `default-src` ni `*-src` de scripts/estilos/conexiones.
    expect(enforced).not.toContain("default-src");
    expect(enforced).not.toContain("script-src");
    expect(enforced).not.toContain("connect-src");
    expect(headerValue(true, "Content-Security-Policy-Report-Only")).not.toContain("frame-ancestors");
  });

  test("la política completa es Report-Only: describe pero no bloquea, y deja pasar sólo lo que D2KIRO usa", () => {
    const report = headerValue(true, "Content-Security-Policy-Report-Only") ?? "";
    expect(report).toContain("default-src 'self'");
    expect(report).toContain("connect-src 'self'");
    expect(report).toContain("https://cdn.cloudflare.steamstatic.com");
    expect(report).toContain("https://*.steamstatic.com");
    expect(report).not.toContain("*.railway.app");
    expect(report).not.toMatch(/127\.0\.0\.1|localhost/);
  });

  test("next.config: poweredByHeader apagado y las cabeceras se montan en toda ruta", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers?.();
    expect(rules?.[0]?.source).toBe("/:path*");
    const keys = rules?.[0]?.headers.map((header) => header.key) ?? [];
    expect(keys).toContain("Content-Security-Policy");
    expect(keys).toContain("Content-Security-Policy-Report-Only");
  });

  test("next.config: el optimizador de imágenes no admite imágenes remotas ni AVIF", () => {
    expect(nextConfig.images?.remotePatterns).toEqual([]);
    expect(nextConfig.images?.formats).toEqual(["image/webp"]);
  });
});

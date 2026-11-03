import { afterEach, describe, expect, test } from "bun:test";
import { getCanonicalOrigin } from "./canonical-origin";

const ORIGINAL_BASE_URL = process.env.PUBLIC_BASE_URL;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
// `NODE_ENV` es de sólo lectura en los tipos de Node/Bun; en runtime sí es mutable
// y es la única forma de ejercitar la rama de producción vs. desarrollo en la prueba.
const env = process.env as Record<string, string | undefined>;

afterEach(() => {
  process.env.PUBLIC_BASE_URL = ORIGINAL_BASE_URL;
  env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe("getCanonicalOrigin", () => {
  test("en producción usa exactamente el origen de PUBLIC_BASE_URL", () => {
    env.NODE_ENV = "production";
    process.env.PUBLIC_BASE_URL = "https://coach.example.com";

    expect(getCanonicalOrigin()).toBe("https://coach.example.com");
  });

  test("normaliza un PUBLIC_BASE_URL con path/query a solo el origen", () => {
    env.NODE_ENV = "production";
    process.env.PUBLIC_BASE_URL = "https://coach.example.com/some/path?x=1";

    expect(getCanonicalOrigin()).toBe("https://coach.example.com");
  });

  test("sin PUBLIC_BASE_URL en producción falla cerrado (null), nunca adivina un origen", () => {
    env.NODE_ENV = "production";
    delete process.env.PUBLIC_BASE_URL;

    expect(getCanonicalOrigin()).toBeNull();
  });

  test("un PUBLIC_BASE_URL sintácticamente inválido falla cerrado, incluso fuera de producción", () => {
    env.NODE_ENV = "development";
    process.env.PUBLIC_BASE_URL = "not-a-url";

    expect(getCanonicalOrigin()).toBeNull();
  });

  test("rechaza un esquema no http/https aunque la URL sea sintácticamente válida", () => {
    env.NODE_ENV = "production";
    process.env.PUBLIC_BASE_URL = "javascript:alert(1)";

    expect(getCanonicalOrigin()).toBeNull();
  });

  test("fuera de producción, sin PUBLIC_BASE_URL, usa el fallback local seguro (nunca null)", () => {
    env.NODE_ENV = "test";
    delete process.env.PUBLIC_BASE_URL;

    expect(getCanonicalOrigin()).toBe("http://localhost:3000");
  });
});

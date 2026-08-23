import { describe, expect, test } from "bun:test";
import { buildNavLinks } from "./NavBar";

describe("buildNavLinks", () => {
  test("con draft habilitado conserva el link Draft normal", () => {
    const draftLink = buildNavLinks(true).find((link) => link.href === "/draft");

    expect(draftLink?.label).toBe("Draft");
  });

  test("con draft apagado el NavBar refleja que el draft es local", () => {
    const draftLink = buildNavLinks(false).find((link) => link.href === "/draft");

    expect(draftLink?.label).toBe("Draft local");
  });

  test("incluye un acceso directo a /random-draft -- antes solo era accesible tipeando la URL", () => {
    const randomDraftLink = buildNavLinks(true).find((link) => link.href === "/random-draft");

    expect(randomDraftLink?.label).toBe("Simulador AP");
  });
});

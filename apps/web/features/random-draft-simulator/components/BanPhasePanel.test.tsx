import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { BanPhasePanel } from "./BanPhasePanel";

afterEach(cleanup);

function hero(id: number, localizedName: string): HeroMeta {
  return { id, name: `npc_dota_hero_${id}`, localizedName, imgUrl: "", primaryAttr: "str", attackType: "Melee", roles: [] };
}

const CATALOG = new Map<number, HeroMeta>([
  [1, hero(1, "Axe")],
  [2, hero(2, "Lion")],
]);

test("compacto: una sola fila con el conteo y el nombre de cada ban", () => {
  const view = render(<BanPhasePanel resolvedBans={[1, 2]} heroCatalog={CATALOG} compact />);

  const row = view.getByTestId("resolved-bans");
  expect(row.textContent).toContain("Bans resueltos (2)");
  expect(row.textContent).toContain("Axe");
  expect(row.textContent).toContain("Lion");
  expect(view.getByTitle("Axe")).toBeTruthy();
});

test("sin compact: el panel grande de siempre sigue con el mismo testid y conteo", () => {
  const view = render(<BanPhasePanel resolvedBans={[1]} heroCatalog={CATALOG} />);

  expect(view.getByTestId("resolved-bans").textContent).toContain("Bans resueltos (1)");
});

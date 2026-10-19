import "@/test-support/happy-dom";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { HeroPicker } from "./HeroPicker";

afterEach(cleanup);

const HEROES: HeroMeta[] = [1, 2, 3].map((id) => ({ id, name: `npc_${id}`, localizedName: `Hero ${id}`, imgUrl: "", primaryAttr: "str", attackType: "melee", roles: [] }));

test("sin variante conserva la presentación de siempre y dice «ya en el draft» en lo no disponible", () => {
  const view = render(<HeroPicker heroes={HEROES} onSelect={() => undefined} unavailableHeroIds={new Set([2])} />);
  expect(view.container.innerHTML).not.toContain("tg-");
  expect(view.getByPlaceholderText("Buscar héroe...").className).toContain("bg-surface-overlay");
  expect(view.getByText("ya en el draft")).toBeTruthy();
  expect((view.getByRole("button", { name: /Hero 2/ }) as HTMLButtonElement).disabled).toBe(true);
});

test("la variante canónica y la etiqueta propia cambian el aspecto y el texto, no la selección", () => {
  const picked: number[] = [];
  function handleSelect(id: number) {
    picked.push(id);
  }
  const view = render(<HeroPicker variant="canonical" heroes={HEROES} onSelect={handleSelect} unavailableHeroIds={new Set([2])} unavailableLabel="ya en el pool" />);
  expect(view.getByPlaceholderText("Buscar héroe...").className).toBe("tg-input");
  expect(view.getByText("ya en el pool")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: /Hero 3/ }));
  fireEvent.click(view.getByRole("button", { name: /Hero 2/ }));
  expect(picked).toEqual([3]);
});

test("el ícono de la fila puede venir del llamador: el picker no importa el sistema de diseño", () => {
  function renderIcon(hero: HeroMeta) {
    return <i data-testid={`icon-${hero.id}`} />;
  }
  const view = render(<HeroPicker heroes={HEROES} onSelect={() => undefined} renderIcon={renderIcon} />);
  expect(view.getByTestId("icon-1")).toBeTruthy();
});

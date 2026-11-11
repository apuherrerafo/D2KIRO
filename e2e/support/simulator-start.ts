import { expect } from "./failure-evidence";
import type { Page } from "@playwright/test";

// Fase 4A.1 · arranque compartido de un draft del Simulador contra motor + web reales (mismo recorrido que simulator-canonical-light.spec.ts).
export interface PartyCase {
  name: string;
  size: 1 | 2 | 3 | 5;
  positions: string[];
  personal: string;
  columns: number;
}

export const PARTY_CASES: PartyCase[] = [
  { name: "solo", size: 1, positions: [], personal: "Posición 2 — Midlane", columns: 1 },
  { name: "party2", size: 2, positions: ["Posición 2 — Midlane", "Posición 5 — Hard support"], personal: "Posición 5 — Hard support", columns: 2 },
  { name: "party3", size: 3, positions: ["Posición 1 — Carry", "Posición 3 — Offlane", "Posición 5 — Hard support"], personal: "Posición 3 — Offlane", columns: 3 },
  { name: "party5", size: 5, positions: [], personal: "Posición 2 — Midlane", columns: 5 },
];

export function personalPositionOf(item: PartyCase): number {
  return Number(/Posición (\d)/.exec(item.personal)?.[1] ?? 0);
}

export async function startDraft(page: Page, item: PartyCase) {
  await page.goto("/simulator");
  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Radiant", exact: true }).click();
  const sizeLabel = item.size === 1 ? "Solo (1)" : `Party ${item.size}`;
  await page.getByRole("group", { name: "Tamaño de party" }).getByRole("button", { name: sizeLabel }).click();
  for (const pos of item.positions) {
    await page.getByRole("group", { name: "Posiciones de tu party" }).getByRole("button", { name: pos }).click();
  }
  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: item.personal }).click();
  await page.getByRole("button", { name: "Iniciar Draft" }).click();
  await expect(page.getByTestId("resolved-bans")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("team-coach-board")).toBeVisible();
  await expect(page.getByTestId("team-coach-board").locator("[data-testid^='team-coach-column-']").first()).toBeVisible({ timeout: 60_000 });
}

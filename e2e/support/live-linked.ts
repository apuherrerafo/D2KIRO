import { expect } from "./failure-evidence";
import type { Page } from "@playwright/test";

/**
 * Espera el estado funcional estable de /live-draft con enlace de Dota emitido: `live-team-coach`.
 * `live-dota` es solo el cascaron de "Cargando..." / "sin enlace" y desaparece en cuanto el enlace carga,
 * asi que esperarlo es una carrera contra la carga. Si la auth/carga falla (`live-forbidden`, `live-engine-unreachable`)
 * `live-team-coach` no aparece y esto falla: no se oculta ningun fallo real.
 */
export async function awaitLiveDraftLinked(page: Page): Promise<void> {
  await expect(page.getByTestId("live-team-coach")).toBeVisible({ timeout: 60_000 });
}

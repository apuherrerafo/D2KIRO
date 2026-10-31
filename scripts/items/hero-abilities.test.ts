import { describe, expect, test } from "bun:test";
import { classifyHeroFile } from "./hero-abilities";

// Fixture inline (recortado de los archivos del juego). Ninguna prueba lee archivos reales del juego.
const FIXTURE = `
"DOTAAbilities"
{
	// comentario que se ignora
	"axe_berserkers_call"
	{
		"AbilityBehavior"	"DOTA_ABILITY_BEHAVIOR_NO_TARGET | DOTA_ABILITY_BEHAVIOR_DONT_RESUME_MOVEMENT"
		"SpellImmunityType"	"SPELL_IMMUNITY_ENEMIES_YES"
		"SpellDispellableType"	"SPELL_DISPELLABLE_NO"
		"AbilityValues"
		{
			"radius"	"315"
		}
	}
	"axe_culling_blade"
	{
		"AbilityBehavior"	"DOTA_ABILITY_BEHAVIOR_UNIT_TARGET"
		"SpellImmunityType"	"SPELL_IMMUNITY_ENEMIES_YES"
	}
	"lion_voodoo"
	{
		"AbilityBehavior"	"DOTA_ABILITY_BEHAVIOR_UNIT_TARGET"
		"SpellImmunityType"	"SPELL_IMMUNITY_ENEMIES_NO"
		"SpellDispellableType"	"SPELL_DISPELLABLE_YES"
	}
	"axe_counter_helix"
	{
		"AbilityBehavior"	"DOTA_ABILITY_BEHAVIOR_PASSIVE"
		"SpellImmunityType"	"SPELL_IMMUNITY_ENEMIES_YES"
	}
	"special_bonus_unique_axe"
	{
		"AbilityBehavior"	"DOTA_ABILITY_BEHAVIOR_PASSIVE"
	}
}
`;

describe("classifyHeroFile — qué hechizos frena un BKB activo", () => {
  const abilities = classifyHeroFile(FIXTURE);

  test("Berserker's Call: sin objetivo y atraviesa BKB", () => {
    const call = abilities.get("axe_berserkers_call");
    expect(call?.unitTarget).toBe(false);
    expect(call?.piercesBkb).toBe(true);
    expect(call?.blockedByBkb).toBe(false);
  });

  test("Culling Blade: con objetivo y atraviesa BKB (Linken's sí lo detendría, BKB no)", () => {
    const blade = abilities.get("axe_culling_blade");
    expect(blade?.unitTarget).toBe(true);
    expect(blade?.piercesBkb).toBe(true);
  });

  test("Hex: con objetivo, lo frena un BKB activo y se puede dispelear", () => {
    const hex = abilities.get("lion_voodoo");
    expect(hex?.unitTarget).toBe(true);
    expect(hex?.blockedByBkb).toBe(true);
    expect(hex?.dispellable).toBe("SPELL_DISPELLABLE_YES");
  });

  test("pasivas se marcan como pasivas; los special_bonus se descartan", () => {
    expect(abilities.get("axe_counter_helix")?.passive).toBe(true);
    expect(abilities.has("special_bonus_unique_axe")).toBe(false);
  });

  test("un sub-bloque de valores (AbilityValues) no se confunde con un hechizo", () => {
    expect(abilities.has("AbilityValues")).toBe(false);
    expect(abilities.size).toBe(4);
  });

  test("texto vacío o basura no lanza", () => {
    expect(classifyHeroFile("").size).toBe(0);
    expect(classifyHeroFile("{{{ \"x\"").size).toBe(0);
  });
});

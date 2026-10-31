#!/usr/bin/env bun
// Lector offline de los archivos de héroes del juego (formato KeyValues de Valve,
// `game/dota/pak01_dir/scripts/npc/heroes/npc_dota_hero_*.txt`, espejo público SteamDatabase/GameTracking-Dota2).
// Clasifica cada hechizo: ¿lo frena un BKB activo? ¿tiene objetivo (Linken's/Lotus)? ¿es pasivo? ¿se puede dispelear?
//
// Es la capa MECÁNICA de "qué ítem arregla qué counter". Responde solo "si el ítem está puesto, ¿frena el hechizo?".
// NO responde "¿hay tiempo de activarlo?" (BKB hexeado no se puede activar) ni "¿se compra de verdad?": eso sale de
// partidas pro / guías. Script de desarrollador: nunca se importa desde `apps/`, cero red aquí.
//
// Uso: bun scripts/items/hero-abilities.ts <carpeta_heroes> <salida.json>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type KvNode = { [key: string]: string | KvNode };

export interface AbilityMechanics {
  readonly unitTarget: boolean;
  readonly passive: boolean;
  /** `SPELL_IMMUNITY_ENEMIES_YES` = atraviesa BKB. */
  readonly piercesBkb: boolean;
  /** `SPELL_IMMUNITY_ENEMIES_NO` = lo frena un BKB activo. Vacío/otro valor: no se sabe. */
  readonly blockedByBkb: boolean;
  readonly immunity: string;
  readonly dispellable: string;
}

const TOKEN = /"((?:[^"\\]|\\.)*)"|([{}])|\/\/[^\n]*/g;

type Token = { kind: "s" | "{" | "}"; value: string };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    if (m[1] !== undefined) tokens.push({ kind: "s", value: m[1] });
    else if (m[2] === "{" || m[2] === "}") tokens.push({ kind: m[2], value: m[2] });
  }
  return tokens;
}

function parseBlock(tokens: Token[], start: number): { node: KvNode; next: number } {
  const node: KvNode = {};
  let i = start;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.kind === "}") return { node, next: i + 1 };
    if (token.kind !== "s") {
      i += 1;
      continue;
    }
    const key = token.value;
    i += 1;
    const following = tokens[i];
    if (following === undefined) break;
    if (following.kind === "{") {
      const sub = parseBlock(tokens, i + 1);
      node[node[key] === undefined ? key : `${key}#dup`] = sub.node;
      i = sub.next;
    } else {
      node[key] = following.value;
      i += 1;
    }
  }
  return { node, next: i };
}

export function parseKeyValues(text: string): KvNode {
  return parseBlock(tokenize(text), 0).node;
}

function isNode(value: string | KvNode | undefined): value is KvNode {
  return typeof value === "object" && value !== null;
}

/** Todo bloque con `AbilityBehavior`, a cualquier profundidad, indexado por nombre de hechizo. */
export function findAbilities(node: KvNode): Map<string, KvNode> {
  const found = new Map<string, KvNode>();
  for (const [key, value] of Object.entries(node)) {
    if (!isNode(value)) continue;
    if (value["AbilityBehavior"] !== undefined) {
      if (!found.has(key)) found.set(key, value);
      continue;
    }
    for (const [name, ability] of findAbilities(value)) {
      if (!found.has(name)) found.set(name, ability);
    }
  }
  return found;
}

function textOf(value: string | KvNode | undefined): string {
  return typeof value === "string" ? value : "";
}

export function classifyAbility(ability: KvNode): AbilityMechanics {
  const behavior = textOf(ability["AbilityBehavior"]);
  const immunity = textOf(ability["SpellImmunityType"]);
  return {
    unitTarget: behavior.includes("UNIT_TARGET"),
    passive: behavior.includes("PASSIVE"),
    piercesBkb: immunity === "SPELL_IMMUNITY_ENEMIES_YES",
    blockedByBkb: immunity === "SPELL_IMMUNITY_ENEMIES_NO",
    immunity,
    dispellable: textOf(ability["SpellDispellableType"]),
  };
}

export function classifyHeroFile(text: string): Map<string, AbilityMechanics> {
  const result = new Map<string, AbilityMechanics>();
  for (const [name, ability] of findAbilities(parseKeyValues(text))) {
    if (name.startsWith("special_bonus") || name === "ability_base") continue;
    result.set(name, classifyAbility(ability));
  }
  return result;
}

function main(folder: string, outPath: string): void {
  const all: Record<string, AbilityMechanics> = {};
  for (const file of readdirSync(folder).sort()) {
    for (const [name, mechanics] of classifyHeroFile(readFileSync(join(folder, file), "utf-8"))) {
      all[name] = mechanics;
    }
  }
  writeFileSync(outPath, `${JSON.stringify(all, null, 1)}\n`);
  console.log(`${Object.keys(all).length} habilidades -> ${outPath}`);
}

if (import.meta.main) {
  const [folder, outPath] = process.argv.slice(2);
  if (!folder || !outPath) {
    console.error("uso: bun scripts/items/hero-abilities.ts <carpeta_heroes> <salida.json>");
    process.exit(1);
  }
  main(folder, outPath);
}

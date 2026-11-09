import type { CuratedSynergy } from "../signals/hero-synergies";

// P0-04: el winrate global (`patch_meta`) ya NO es fundamento de una tarjeta. Las pruebas de MECANISMO (orden, pools, paridad, transporte) que antes
// vivían de ese winrate necesitan UN fundamento estratégico neutro para que sus héroes sigan siendo elegibles. Este es SINTÉTICO y explícito: una pareja
// curada, con porqué, con un aliado YA elegido (`NEUTRAL_ALLY`, un id que no existe en Dota). Es uniforme para todos los héroes que se le pasen, así que
// no los distingue entre sí. NO es conocimiento de Dota y ninguna prueba de comportamiento real (counters, bans, composición) debe apoyarse en él.
export const NEUTRAL_ALLY = 901;

export function neutralSynergies(heroes: Iterable<number>, base?: ReadonlyMap<number, readonly CuratedSynergy[]>): ReadonlyMap<number, readonly CuratedSynergy[]> {
  const merged = new Map<number, readonly CuratedSynergy[]>(base ?? []);
  for (const hero of heroes) merged.set(hero, [...(merged.get(hero) ?? []), { with: NEUTRAL_ALLY, why: "fixture: pareja neutral que habilita a todos por igual" }]);
  return merged;
}

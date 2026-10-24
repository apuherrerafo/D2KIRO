# Curation proposals: Ringmaster (131), Kez (145), Largo (155)

**Proposals only. `capabilities.json` is not modified; you approve each value.** Structured copy: `docs/f2/curation/proposals.json`.

## Where the evidence comes from

The three hero definition files were read, read-only, from the local Dota 2 install (`pak01_dir.vpk`, build `ClientVersion 6966`, `VersionDate Oct 22 2026`, `SourceRevision 11159903`) with a ~60-line VPK reader and a KeyValues summariser (`docs/f2/curation/tools/`). The SHA-256 of each source file is in the JSON. Anyone with the game can reproduce every number below. The Valve files themselves are not committed (open licence question already noted in the V7 blueprint); this document quotes ability numbers only.

The repo has **no written rubric** for what `hasInitiation`, `hasCatch`, `hasWaveclear` or the levels mean. So each field is justified two ways: what the game data says (ability targeting and numbers), and how already curated *anchor* heroes were labelled for similar kits. Confidence:

- **HIGH**: read directly from the game data.
- **MEDIUM**: follows from game data under a convention inferred from the anchors.
- **LOW**: the game data does not decide it; your call. Valve's own `Rolelevels` are the only external datum, and they are cited where relevant.

Base rates of the curated set (124 heroes): initiation 37 %, catch 64 %, waveclear 65 %; structural low/medium/high 61/23/15 %; scaling low/medium/high 21/41/38 %.

## Kez (145) — agility melee carry, katana/sai modes. Valve roles Carry 3, Escape 2, Disabler 1

| Field | Proposed | Conf. | Evidence | Anchors |
| --- | --- | --- | --- | --- |
| damageType | physical | HIGH | attack, Echo Slash, Talon Toss, Kazurai Katana are physical; only the ultimate is pure | Phantom Assassin, Spectre |
| hasInitiation | **false** (alt. true) | MEDIUM | Grappling Claw: single-target gap closer, range 650–950, cd 13→7, slow 70–100 % for 0.7–1.0 s; no AoE disable | Slark, Riki, Weaver, Phantom Assassin: false |
| hasCatch | true | MEDIUM | Claw slow up to 100 %; Talon Toss silence 2.0–2.75 s (range 650–950, cd 13→7); Shodo Sai stun 0.5–0.8 s | Slark, Riki, Weaver: true |
| hasWaveclear | **false** (alt. true) | LOW | Echo Slash (cd 21→12) and Raptor Dance (cd 40→30) can hit creeps but are not repeatable wave tools | Phantom Assassin, Anti-Mage, Slark: false |
| structuralDamage | low | HIGH | no ability targets buildings (Echo Slash and Raptor Dance target hero/basic); Katana is an on-attack bleed | agility carries: low |
| teamfight | **low** (alt. medium) | LOW | Raptor Dance is AoE (radius 450, 4 strikes, 100 % lifesteal) but is a single-target-focused carry ult | Phantom Assassin, Slark, Anti-Mage: low; Spectre: high |
| scaling | high | MEDIUM | primary-agility melee carry, crit/bleed scale with attack damage; Carry level 3 | Phantom Assassin, Anti-Mage, Slark: high |

## Ringmaster (131) — ranged intelligence support. Valve roles Support 2, Nuker 2, Escape 2, Disabler 1

| Field | Proposed | Conf. | Evidence | Anchors |
| --- | --- | --- | --- | --- |
| damageType | magical | HIGH | Tame the Beasts, Impalement, The Wheel, Spotlight are all magical | Lion, Skywrath Mage |
| hasInitiation | true | MEDIUM | The Wheel: point-target, range 1400, mesmerize radius 500, stun 2.5–3.0 s, burst 300–600, cd 90→70 | Tidehunter, Treant, Centaur Warrunner: true |
| hasCatch | true | MEDIUM | Impalement: skillshot range 2400, cd 1, slow 100 % for 0.5–0.8 s, bleed 3–6 % max HP; plus the Wheel stun | Lion, Skywrath, Grimstroke: true |
| hasWaveclear | true | MEDIUM | Tame the Beasts: channelled AoE cone (range 700, cd 16→10), 50–180 up to 125–480 with channel | Skywrath, Dark Willow, Shadow Shaman: true |
| structuralDamage | low | HIGH | no ability targets buildings; Impalement bleed is explicitly creep DPS | Lion, Skywrath: low |
| teamfight | **high** (alt. medium) | MEDIUM | Wheel 2.5–3.0 s AoE stun + burst + aura 50–100 per 0.5 s; Tame the Beasts fear/damage | Shadow Shaman, Grimstroke: high; Lion, Skywrath: medium |
| scaling | **low** | LOW | game files do not decide scaling; every comparable int support is low | Lion, Skywrath, Dark Willow, Shadow Shaman, Rubick, Oracle: low |

## Largo (155) — melee strength durable support. Valve roles Durable 2, Disabler 1, Support 3

| Field | Proposed | Conf. | Evidence | Anchors |
| --- | --- | --- | --- | --- |
| damageType | **magical** (alt. mixed) | LOW | Lick, Frogstomp and songs deal magical damage; his 39–45 attack is physical. **High impact: this field feeds the damage-mix critical gap** | Abaddon, Snapfire, Tidehunter: mixed; Oracle, Rubick: magical |
| hasInitiation | false | MEDIUM | no gap closer, no AoE disable (Frogstomp stun is 0.1 s; Lick pulls the target 235–325 units over 0.3 s) | Abaddon, Oracle: false |
| hasCatch | **false** (alt. true) | LOW | Disabler is level 1 (Valve's lowest); only a 0.3 s pull (cd 13→7, range 700) and a 12–30 % slow. Pudge's hook is curated as catch, so a pull can count | Pudge: true; Abaddon, Oracle: false |
| hasWaveclear | **true** (alt. false) | LOW | Frogstomp: AoE radius 350, 4–7 ticks of 36–72 magical (up to 504 per cast), cd 20→14 | Axe, Tidehunter: true; Abaddon, Oracle: false |
| structuralDamage | low | HIGH | no ability targets buildings | support/durable: low |
| teamfight | medium | LOW | 800-radius song buffs (spell amp 8–16 %, armor stacks, heal bursts 30–80), Frogstomp zone, Croak redirects 30–45 % of an ally's damage for 5 s | Oracle, Rubick: medium |
| scaling | medium | LOW | armor stacks per rhythm; game files do not decide scaling | Abaddon, Tidehunter: medium |

## What needs your decision, in order of impact

1. **Largo `damageType`** (feeds a critical gap), and **`hasCatch`**.
2. **Kez `hasInitiation`** (the anchors say false; many players would call Claw an engage).
3. The LOW `scaling`/`teamfight` fields: they matter less today (no critical-gap rule reads them, they weigh in `team_synergy` and `archetype_fit`).

## What approving them costs

`capabilities.json` changes, so its SHA-256 changes and with it the `comparableKey` of every exam and replay. **F1 has to be re-measured on the frozen set with the new curation ("F1c") before any F2 comparison**; the current F1 reference stays valid as the pre-curation baseline. The three heroes would then have a computed `team_synergy` instead of the neutral imputation that promoted Kez in E1 (see `E1_FOLLOWUP.md`). Their cards would also stop saying nothing about gaps: with capabilities, `CRITICAL_GAP` can be raised or ruled out for them.

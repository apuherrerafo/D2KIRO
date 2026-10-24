"""Summarise a Dota hero KV file: hero-level stats and every ability (behavior, targeting, damage, cooldown, range, value names). Read-only."""
import re
import sys


def tokens(text):
    for m in re.finditer(r'"((?:[^"\\]|\\.)*)"|([{}])|//[^\n]*', text):
        if m.group(1) is not None:
            yield ("s", m.group(1))
        elif m.group(2):
            yield (m.group(2), m.group(2))


def parse(text):
    it = iter(tokens(text))

    def block():
        out = {}
        for kind, val in it:
            if kind == "}":
                return out
            key = val
            kind2, val2 = next(it)
            if kind2 == "{":
                out.setdefault(key, []).append(block())
            else:
                out.setdefault(key, []).append(val2)
        return out

    root = {}
    for kind, val in it:
        if kind == "s":
            k2, v2 = next(it)
            if k2 == "{":
                root[val] = block()
    return root


def first(d, k, default=""):
    v = d.get(k)
    return v[0] if v else default


path = sys.argv[1]
doc = parse(open(path, encoding="utf-8", errors="replace").read())
inner = doc["DOTAHeroes"]
(name, hero), = [(k, v[0]) for k, v in inner.items() if k.startswith("npc_dota_hero_")]
print(f"== {name}  HeroID={first(hero,'HeroID')}")
for k in ["Role", "Rolelevels", "AttackCapabilities", "AttackRange", "AttackRate", "AttackDamageMin", "AttackDamageMax", "ArmorPhysical", "AttributePrimary", "AttributeBaseStrength", "AttributeBaseAgility", "AttributeBaseIntelligence", "MovementSpeed", "VisionNighttimeRange"]:
    if k in hero:
        print(f"  {k}: {first(hero,k)}")
for k, v in hero.items():
    if re.fullmatch(r"Ability\d+", k):
        pass
abilities = [(k, first(hero, k)) for k in hero if re.fullmatch(r"Ability\d+", k)]
print("  slots:", ", ".join(f"{k}={v}" for k, v in abilities))


def find_ability_blocks(d, acc):
    for k, vs in d.items():
        for v in vs if isinstance(vs, list) else []:
            if isinstance(v, dict):
                if "AbilityBehavior" in v or "AbilityValues" in v:
                    acc[k] = v
                find_ability_blocks(v, acc)
    return acc


blocks = find_ability_blocks(hero, {})
for aname, a in blocks.items():
    hidden = "HIDDEN" in first(a, "AbilityBehavior")
    print(f"\n-- {aname}{'  [hidden]' if hidden else ''}")
    for k in ["AbilityBehavior", "AbilityUnitTargetTeam", "AbilityUnitTargetType", "AbilityUnitDamageType", "SpellImmunityType", "AbilityCastRange", "AbilityCooldown", "AbilityManaCost", "AbilityCastPoint", "AbilityDuration", "AbilityChannelTime", "AbilityDamage", "IsShardUpgrade", "IsGrantedByShard", "IsGrantedByScepter", "HasScepterUpgrade", "HasShardUpgrade"]:
        if k in a:
            print(f"   {k}: {first(a,k)}")
    vals = a.get("AbilityValues", [{}])[0]
    if vals:
        items = []
        for vk, vv in vals.items():
            v0 = vv[0]
            if isinstance(v0, dict):
                v0 = first(v0, "value", "{..}")
            items.append(f"{vk}={v0}")
        print("   values:", "; ".join(items)[:900])

"""Offline benchmark: reference portraits under synthetic transformations -> top-1/top-3/false positives/latency.

Synthetic ONLY. It proves the matcher survives scale/blur/light/tint/compression/misalignment; it does NOT
prove accuracy on Dota's real hero-selection art (that needs real screenshots: `lab` command).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from .catalog import Catalog
from .matcher import Matcher, Thresholds, confident, is_blank
from .synth import blank_slot, degrade, transition_blend

DEFAULT_THRESHOLDS = Thresholds(min_score=0.70, min_margin=0.15)


@dataclass
class BenchReport:
    samples: int = 0
    top1: float = 0.0
    top3: float = 0.0
    emitted: float = 0.0
    wrong_when_emitted: float = 0.0
    negatives: int = 0
    false_positive_rate: float = 0.0
    transition_samples: int = 0
    transition_emit_rate: float = 0.0
    median_ms: float = 0.0
    p95_ms: float = 0.0
    by_width: dict[str, float] = field(default_factory=dict)


def run_bench(catalog: Catalog, matcher: Matcher, thresholds: Thresholds = DEFAULT_THRESHOLDS, *, per_hero: int = 6, seed: int = 7, severity: float = 1.0) -> BenchReport:
    rng = np.random.default_rng(seed)
    ids = list(catalog.portraits)
    hits1 = hits3 = emitted = wrong = 0
    total = 0
    times: list[float] = []
    width_hits: dict[str, list[int]] = {"<64": [], "64-128": [], ">=128": []}
    for hero_id in ids:
        for _ in range(per_hero):
            crop = degrade(catalog.portraits[hero_id], rng, severity=severity)
            start = time.perf_counter()
            result = matcher.match(crop)
            times.append((time.perf_counter() - start) * 1000)
            total += 1
            ok1 = result.hero_id == hero_id
            hits1 += ok1
            hits3 += hero_id in [h for h, _ in result.top3]
            if confident(result, thresholds) and not is_blank(crop):
                emitted += 1
                wrong += not ok1
            width = crop.shape[1]
            width_hits["<64" if width < 64 else "64-128" if width < 128 else ">=128"].append(int(ok1))
    false_pos = negatives = 0
    for index in range(len(ids)):
        crop = blank_slot(rng, index % 4)
        negatives += 1
        if not is_blank(crop) and confident(matcher.match(crop), thresholds):
            false_pos += 1
    transition_emits = transitions = 0
    for index in range(len(ids)):
        a, b = catalog.portraits[ids[index]], catalog.portraits[ids[(index * 7 + 3) % len(ids)]]
        if ids[index] == ids[(index * 7 + 3) % len(ids)]:
            continue
        blended = degrade(transition_blend(a, b, rng), rng, severity=0.5)
        transitions += 1
        if confident(matcher.match(blended), thresholds):
            transition_emits += 1
    ordered = sorted(times)
    return BenchReport(
        samples=total,
        top1=hits1 / total,
        top3=hits3 / total,
        emitted=emitted / total,
        wrong_when_emitted=wrong / max(emitted, 1),
        negatives=negatives,
        false_positive_rate=false_pos / negatives,
        transition_samples=transitions,
        transition_emit_rate=transition_emits / max(transitions, 1),
        median_ms=float(np.median(ordered)),
        p95_ms=float(ordered[int(len(ordered) * 0.95) - 1]),
        by_width={key: (sum(vals) / len(vals) if vals else float("nan")) for key, vals in width_hits.items()},
    )

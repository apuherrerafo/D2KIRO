// The head -> tail seam guard (guards.py seam_verdict): the STANDARD rule stays the default, DECAY mode accepts ONLY a cut inside one continuous deceleration.
// Synthetic frames (a soft blob on a measured path, poses that follow it) give one clean decaying seam and one negative fixture per defect; each negative breaks
// exactly the rule it targets. Then the guard is MUTATION-TESTED at the source: every rule, the fallback and the thresholds are mutated in a copy of guards.py,
// and each mutant must be caught by at least one fixture (a guard whose rules can be deleted without a test noticing proves nothing).
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const made: string[] = [];
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Builds every fixture and runs it through the guards module found in `sys.argv[1]`; prints {fixture: {mode, broken}}. */
const FIXTURES = `
import sys, math, json
sys.path.insert(0, sys.argv[1])
import numpy as np
import guards as g

W, SIG = 96, 9.0
HEAD = [0.6, 1.2, 1.8, 2.4, 2.8, 3.0, 2.9, 2.4, 1.6]   # px per frame inside a 10-frame head: ease in, peak, decay (the real A->P / C->P shape)
SEAM = 1.35                                            # the cut: 0.84 of the step before it
TAIL = [0.95, 0.6, 0.4, 0.25, 0.15, 0.1, 0.06, 0.04]   # the tail keeps decaying (9 frames)
B = len(HEAD)

def blob(x, y, sig=SIG, gain=1.0):
    yy, xx = np.mgrid[0:W, 0:W]
    a = np.zeros((W, W, 4), np.uint8)
    a[..., 0], a[..., 1], a[..., 2] = np.clip(np.array([200, 140, 60]) * gain, 0, 255).astype(np.uint8)
    a[..., 3] = (np.exp(-(((xx - x) ** 2 + (yy - y) ** 2) / (2 * sig ** 2))) * 255).astype(np.uint8)
    return a

def build(steps, headings=None, frame_fx=None, pose_fx=None, head_frames=B + 1):
    headings = headings or [0.0] * len(steps)
    x, y, pts = 30.0, 48.0, [(30.0, 48.0)]
    for s, h in zip(steps, headings):
        x += s * math.cos(math.radians(h)); y += s * math.sin(math.radians(h))
        pts.append((x, y))
    frames = [blob(px, py) for px, py in pts]
    poses, run = [], 0.0
    for i in range(len(pts)):
        run += steps[i - 1] if i else 0.0
        poses.append(dict(yaw=0.01 * run, pitch=-0.002 * run, eyeOpen=1.0, eyeX=0.004 * run, eyeZ=0.0, shardSpin=0.05 * run, shardRadius=1.0))
    if frame_fx: frame_fx(frames, pts)
    if pose_fx: pose_fx(poses)
    return frames[:head_frames], frames[head_frames:], poses[:head_frames], poses[head_frames:]

def prof(seam=SEAM, after=None):
    s = HEAD + [seam] + TAIL
    if after: s[B + 1:B + 1 + len(after)] = after
    return s

def kick(key, amount):
    def fx(p):
        for q in p[B + 1:]: q[key] += amount
    return fx

def wrap_spin(p):  # the ring crosses +-pi exactly at the cut: the same picture, a 2 pi jump in the raw number
    for q in p: q["shardSpin"] = ((q["shardSpin"] + math.pi - 0.05 * (sum(HEAD) + SEAM / 2)) + math.pi) % (2 * math.pi) - math.pi

def swap(i, **kw):
    return lambda f, pts: f.__setitem__(i, blob(*pts[i], **kw))

def swell(f, pts):
    s = prof()
    for i in range(len(f)): f[i] = blob(48, 48, sig=SIG + 0.12 * sum(s[:i]))

LIMIT = 0.05  # far below every boundary: the STANDARD rule rejects them all, so the verdict is the decay rule's
FIX = {
    # accepted
    "clean": dict(steps=prof()),
    "ringWrapClean": dict(steps=prof(), pose_fx=wrap_spin),
    "standardSmallSeam": dict(steps=prof(seam=2.0, after=[1.25, 0.8]), limit=10.0),
    # rejected: one defect each
    "acceleration": dict(steps=prof(seam=2.0, after=[1.25, 0.8])),
    "afterAccelerates": dict(steps=prof(after=[1.5, 1.0])),
    "lateAcceleration": dict(steps=prof(after=[0.95, 1.3])),
    "abruptStop": dict(steps=prof(seam=0.6, after=[0.4, 0.25])),
    "abruptStopAfterSeam": dict(steps=prof(after=[0.45, 0.3])),
    "directionReversal": dict(steps=prof(), headings=[0] * B + [180] * (len(TAIL) + 1)),
    "directionKink": dict(steps=prof(), headings=[0] * (B - 2) + [-35, -35] + [-10] * (len(TAIL) + 1)),
    "noDirection": dict(steps=prof(), frame_fx=swell),
    "visorFlip": dict(steps=prof(), pose_fx=kick("yaw", -0.027)),
    "visorJump": dict(steps=prof(), pose_fx=kick("pitch", -0.06)),
    "eyeJump": dict(steps=prof(), pose_fx=kick("eyeX", 0.08)),
    "ringJump": dict(steps=prof(), pose_fx=kick("shardSpin", 0.6)),
    "hiddenPopSwell": dict(steps=prof(), frame_fx=swap(B + 1, sig=SIG * 1.03)),
    "hiddenPopFlash": dict(steps=prof(), frame_fx=swap(B + 1, gain=1.06)),
    "seamInStandardBand": dict(steps=prof(seam=2.0, after=[1.25, 0.8]), limit=3.4 / 1.4),
    "headTooShort": dict(steps=prof(), head_frames=3),
}
out = {}
for name, kw in FIX.items():
    kw = dict(kw)
    limit = kw.pop("limit", LIMIT)
    h, t, hp, tp = build(**kw)
    v = g.seam_verdict(h, t, limit, lambda: (hp, tp))
    d = v.get("decay")
    out[name] = dict(mode=v["mode"], note=d if isinstance(d, str) else None, broken=d["broken"] if isinstance(d, dict) else None, steps=d["steps"] if isinstance(d, dict) else None, flowCos=d["flowCos"] if isinstance(d, dict) else None, boundary=v["boundary"], standardLimit=v["standardLimit"])
print(json.dumps(out))
`;

/** Expected verdict of every fixture against the real guard: mode, and for a decay attempt exactly which rules break. */
const EXPECTED: Record<string, { mode: string; broken?: string[] }> = {
  clean: { mode: "DECAY", broken: [] },
  ringWrapClean: { mode: "DECAY", broken: [] },
  standardSmallSeam: { mode: "STANDARD" },
  acceleration: { mode: "FAIL", broken: ["decelerating"] },
  afterAccelerates: { mode: "FAIL", broken: ["keepsDecaying"] },
  lateAcceleration: { mode: "FAIL", broken: ["keepsDecaying"] },
  abruptStop: { mode: "FAIL", broken: ["noAbruptStop"] },
  abruptStopAfterSeam: { mode: "FAIL", broken: ["noAbruptStop"] },
  directionReversal: { mode: "FAIL", broken: ["direction", "noPop"] },
  directionKink: { mode: "FAIL", broken: ["direction"] },
  noDirection: { mode: "FAIL", broken: ["direction", "noPop"] },
  visorFlip: { mode: "FAIL", broken: ["visorSign"] },
  visorJump: { mode: "FAIL", broken: ["visor"] },
  eyeJump: { mode: "FAIL", broken: ["eyes"] },
  ringJump: { mode: "FAIL", broken: ["ring"] },
  hiddenPopSwell: { mode: "FAIL", broken: ["noPop"] },
  hiddenPopFlash: { mode: "FAIL", broken: ["noPop"] },
  seamInStandardBand: { mode: "FAIL", broken: ["decelerating"] },
  headTooShort: { mode: "FAIL" },
};

/** Source mutations of guards.py: [name, exact snippet (must occur once), replacement]. */
const MUTANTS: [string, string, string][] = [
  ["drop rule decelerating", "decelerating=boundary <= before,", "decelerating=True,"],
  ["drop rule keepsDecaying", "keepsDecaying=after <= boundary and after2 <= after,", "keepsDecaying=True,"],
  ["keepsDecaying ignores after2", "keepsDecaying=after <= boundary and after2 <= after,", "keepsDecaying=after <= boundary,"],
  ["drop rule noAbruptStop", "noAbruptStop=boundary / before >= DECAY_MIN_RATIO and after / boundary >= DECAY_MIN_RATIO,", "noAbruptStop=True,"],
  ["noAbruptStop ignores after / boundary", "noAbruptStop=boundary / before >= DECAY_MIN_RATIO and after / boundary >= DECAY_MIN_RATIO,", "noAbruptStop=boundary / before >= DECAY_MIN_RATIO,"],
  ["drop rule direction", "direction=all(c is not None and c >= DECAY_MIN_FLOW_COS for c in cos),", "direction=True,"],
  ["drop rule visorSign", "visorSign=not flips,", "visorSign=True,"],
  ["drop rule visor", 'visor=pose["visor"]["seam"] <= pose["visor"]["internalMax"],', "visor=True,"],
  ["drop rule eyes", 'eyes=pose["eyes"]["seam"] <= pose["eyes"]["internalMax"],', "eyes=True,"],
  ["drop rule ring", 'ring=pose["ring"]["seam"] <= pose["ring"]["internalMax"],', "ring=True,"],
  ["drop rule noPop", 'noPop=pop["seam"] <= pop["neighbours"],', "noPop=True,"],
  ["DECAY accepts on any rule", "    if all(rules.values()):\n        out[\"mode\"] = \"DECAY\"", "    if any(rules.values()):\n        out[\"mode\"] = \"DECAY\""],
  ["pose internal max includes the seam itself", "internalMax=max(x for i, x in enumerate(st) if i != b)", "internalMax=max(st)"],
  ["ring spin not angle-wrapped", 'return max(abs(angle(b[k] - a[k])) if k == "shardSpin" else abs(b[k] - a[k]) for k in keys)', "return max(abs(b[k] - a[k]) for k in keys)"],
  ["ratio threshold 0.5 -> 0.3", "DECAY_MIN_RATIO = 0.5", "DECAY_MIN_RATIO = 0.3"],
  ["flow cosine threshold 0.95 -> 0.9", "DECAY_MIN_FLOW_COS = 0.95", "DECAY_MIN_FLOW_COS = 0.9"],
  ["visor velocity dead band 1e-3 -> 0.1", "VISOR_VEL_EPS = 1e-3", "VISOR_VEL_EPS = 0.1"],
  ["STANDARD factor relaxed 1.25 -> 1.5", "STANDARD_SEAM_FACTOR = 1.25", "STANDARD_SEAM_FACTOR = 1.5"],
];

function runFixtures(guardsDir: string): Record<string, { mode: string; broken: string[] | null; steps: Record<string, number> | null; flowCos: (number | null)[] | null }> {
  const r = spawnSync("python", ["-I", "-c", FIXTURES, guardsDir], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) return { __error: { mode: `${r.stdout}${r.stderr}`.trim().split("\n").slice(-3).join(" | "), broken: null, steps: null, flowCos: null } };
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}

/** A mutant is killed only by a changed VERDICT (a defect accepted, or a good seam rejected), not merely by a different list of broken rules. */
const sameVerdict = (got: { mode: string } | undefined, want: { mode: string }) => got?.mode === want.mode;

describe("decay-aware head -> tail seam guard", () => {
  const real = runFixtures(DIR);

  test("the clean deceleration passes through DECAY (the STANDARD rule alone would reject it), a seam within the old threshold is STANDARD", () => {
    expect(real.__error).toBeUndefined();
    expect(real.clean).toMatchObject({ mode: "DECAY", broken: [] });
    expect(real.clean.steps!.boundary).toBeGreaterThan(0.05 * 1.25);
    expect(real.ringWrapClean.mode).toBe("DECAY");
    expect(real.standardSmallSeam.mode).toBe("STANDARD");
  });

  test("every synthetic defect is rejected, and each one by exactly the rule it targets", () => {
    for (const [name, want] of Object.entries(EXPECTED)) expect({ name, ...real[name] }, name).toMatchObject({ name, mode: want.mode, ...(want.broken ? { broken: expect.arrayContaining(want.broken) } : {}) });
    for (const [name, want] of Object.entries(EXPECTED)) if (want.broken) expect([...(real[name].broken ?? [])].sort(), name).toEqual([...want.broken].sort());
  });

  test("the hidden pops keep the step series a monotone deceleration: only the one-frame detour rule sees them", () => {
    for (const name of ["hiddenPopSwell", "hiddenPopFlash"]) {
      const s = real[name].steps!;
      expect(s.before >= s.boundary && s.boundary >= s.after && s.after >= s.after2, name).toBe(true);
      expect(Math.min(...(real[name].flowCos as number[])), name).toBeGreaterThan(0.95);
    }
  });

  test("the STANDARD threshold is not relaxed: a non-decaying seam just above 1.25 x the ordinary step still fails", () => {
    expect(real.seamInStandardBand.mode).toBe("FAIL");
    expect(real.headTooShort).toMatchObject({ mode: "FAIL", broken: null });
    expect(String((real.headTooShort as { note?: string }).note)).toMatch(/not applicable/);
  });

  test("mutation test: every mutant of the guard flips the verdict of at least one fixture (a crash does not count as a kill)", () => {
    const src = readFileSync(join(DIR, "guards.py"), "utf8");
    const root = mkdtempSync(join(tmpdir(), "cm-decay-mut-"));
    made.push(root);
    const survivors: string[] = [];
    const killedBy: Record<string, string[]> = {};
    MUTANTS.forEach(([name, from, to], i) => {
      const norm = src.replace(/\r\n/g, "\n");
      expect(norm.split(from).length - 1, `mutant "${name}": snippet must occur exactly once in guards.py`).toBe(1);
      const dir = join(root, `m${i}`);
      mkdirSync(dir);
      writeFileSync(join(dir, "guards.py"), norm.replace(from, to));
      copyFileSync(join(DIR, "pack_manifest.py"), join(dir, "pack_manifest.py"));
      const got = runFixtures(dir);
      killedBy[name] = got.__error ? [] : Object.keys(EXPECTED).filter((f) => !sameVerdict(got[f], EXPECTED[f]));
      if (got.__error) console.log(`mutant "${name}" crashed: ${got.__error.mode}`);
      if (!killedBy[name].length) survivors.push(name);
    });
    console.log(JSON.stringify(killedBy, null, 1));
    // CM_MUTATION_REPORT=<file>: keep the evidence (fixture verdicts + which fixtures kill each mutant)
    if (process.env.CM_MUTATION_REPORT) writeFileSync(process.env.CM_MUTATION_REPORT, `${JSON.stringify({ fixtures: real, expected: EXPECTED, mutants: MUTANTS.map(([name]) => ({ name, killedBy: killedBy[name] })), survivors }, null, 1)}\n`);
    expect(survivors).toEqual([]);
  }, 120_000);
});

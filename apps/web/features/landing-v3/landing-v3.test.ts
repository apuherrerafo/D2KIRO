import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isPublicCoachAsset } from "../../lib/public-coach-assets";
import { FORBIDDEN_CLAIMS } from "../landing/copy";
import { LANDING_CONFIG, collectionEnabled, helpActions, type LandingConfig } from "./config";
import * as copy from "./copy";
import { BEATS, FAQ } from "./copy";
import { CANDIDATES, HEROES, candidate, ranking, signed } from "./fixture";
import {
  BEAT_COUNT,
  COACH,
  COACH_POSES,
  EDGES,
  NODE_VISIBILITY,
  ROW_STATE,
  SUB,
  TAGS,
  TALL_EDGES,
  STILL_BEATS,
  beatForProgress,
  coachUrl,
  progressForBeat,
  rowFit,
  rowSlot,
} from "./graph/model";
import { coachCue, poseLabel, walkAmount } from "./hero/timeline";
import { faqJsonLd, jsonLdString, LANDING_V3_METADATA } from "./seo";
import { isValidEmail } from "./components/WaitlistProvider";

/* One draft, one story: every chapter must tell the truth about the same Draft A. */
describe("Draft A fixture", () => {
  test("the generic ranking is Queen of Pain 84, Puck 82, Void Spirit 77", () => {
    expect(ranking("anyone").map((c) => [HEROES[c.hero].name, c.anyone.fit])).toEqual([["Queen of Pain", 84], ["Puck", 82], ["Void Spirit", 77]]);
  });

  test("the personal ranking is Puck 88, Queen of Pain 83, Void Spirit 77", () => {
    expect(ranking("you").map((c) => [HEROES[c.hero].name, c.you.fit])).toEqual([["Puck", 88], ["Queen of Pain", 83], ["Void Spirit", 77]]);
  });

  test("your games: Puck +6 often played, Queen of Pain -1 some history, Void Spirit nothing", () => {
    expect(candidate("puck").games).toEqual({ delta: 6, label: "Often played" });
    expect(candidate("qop").games).toEqual({ delta: -1, label: "Some history" });
    expect(candidate("vs").games).toBeNull();
    expect(signed(6)).toBe("+6");
    expect(signed(-1)).toBe("−1");
  });

  test("the payoff moves: Queen of Pain #1→#2, Puck #2→#1, Void Spirit #3→#3", () => {
    const moves = Object.fromEntries(CANDIDATES.map((c) => [c.id, [c.anyone.slot + 1, c.you.slot + 1]]));
    expect(moves).toEqual({ qop: [1, 2], puck: [2, 1], vs: [3, 3] });
  });

  test("the graph's row model agrees with the fixture at both ends", () => {
    for (const c of CANDIDATES) {
      for (let k = 1; k <= 5; k += 1) {
        expect(rowSlot(c.id, k)).toBe(c.anyone.slot);
        expect(rowFit(c.id, k)).toBe(c.anyone.fit);
      }
      expect(rowSlot(c.id, 6)).toBe(c.you.slot);
      expect(rowFit(c.id, 6)).toBe(c.you.fit);
    }
  });
});

describe("living decision graph model", () => {
  test("six beats, every table is six long", () => {
    expect(BEATS).toHaveLength(BEAT_COUNT);
    expect(BEATS.map((b) => b.n)).toEqual(["01", "02", "03", "04", "05", "06"]);
    for (const id of ["qop", "puck", "vs"] as const) {
      expect(SUB[id]).toHaveLength(BEAT_COUNT);
      expect(ROW_STATE[id]).toHaveLength(BEAT_COUNT);
    }
    for (const states of Object.values(NODE_VISIBILITY)) expect(states).toHaveLength(BEAT_COUNT);
    for (const edge of EDGES) expect(edge.states).toHaveLength(BEAT_COUNT);
    expect(TALL_EDGES).toHaveLength(BEAT_COUNT);
    expect(COACH.wide).toHaveLength(BEAT_COUNT);
    expect(COACH.tall).toHaveLength(BEAT_COUNT);
  });

  test("the narrow stage draws at most three edges per beat, all of which exist", () => {
    const ids = new Set(EDGES.map((e) => e.id));
    for (const beat of TALL_EDGES) {
      expect(beat.length).toBeLessThanOrEqual(3);
      for (const id of beat) expect(ids.has(id)).toBe(true);
    }
    for (const tag of TAGS) expect(ids.has(tag.edge)).toBe(true);
  });

  test("Slark is already in the draft: quiet at beat 1, never hidden, active from beat 2", () => {
    expect(NODE_VISIBILITY.slark[0]).toBe("q");
    expect(NODE_VISIBILITY.slark).not.toContain("x");
    expect(NODE_VISIBILITY.slark[1]).toBe("o");
  });

  test("lime (personal resolution) appears only at beat 6", () => {
    expect(BEATS.map((b) => b.tone === "lime")).toEqual([false, false, false, false, false, true]);
    for (const edge of EDGES) expect(edge.states.indexOf("l")).toBe(edge.id === "l_y" ? 5 : -1);
    for (const id of ["qop", "puck", "vs"] as const) expect(ROW_STATE[id].indexOf("win")).toBe(id === "puck" ? 5 : -1);
    for (const id of ["qop", "puck", "vs"] as const) {
      SUB[id].forEach(([, tone], i) => expect(tone === "lime").toBe(id === "puck" && i === 5));
    }
  });

  test("the unfinished tether to Void Spirit stays unfinished: no history yet from beat 4", () => {
    const tether = EDGES.find((e) => e.id === "g_v");
    expect(tether?.states).toBe("xxxttt");
    expect(SUB.vs.slice(3).every(([text]) => text === "No history yet")).toBe(true);
  });

  test("only Puck and Queen of Pain connect to your games with evidence", () => {
    expect(EDGES.find((e) => e.id === "g_p")?.states).toBe("xxxssd");
    expect(EDGES.find((e) => e.id === "g_q")?.states).toBe("xxxwwd");
  });

  test("scroll progress selects the beat, with a hysteresis band at the boundaries", () => {
    for (let k = 1; k <= BEAT_COUNT; k += 1) expect(beatForProgress(progressForBeat(k), 0) as number).toBe(k);
    expect(beatForProgress(0, 0)).toBe(1);
    expect(beatForProgress(1, 0)).toBe(6);
    // just past the 1→2 boundary the current beat holds; clearly past it moves
    expect(beatForProgress(1 / 6 + 0.01, 1)).toBe(1);
    expect(beatForProgress(1 / 6 + 0.04, 1)).toBe(2);
    // just before the boundary going back holds
    expect(beatForProgress(1 / 6 - 0.01, 2)).toBe(2);
    expect(beatForProgress(1 / 6 - 0.04, 2)).toBe(1);
  });

  test("a fast flick that skips beats lands on the right one", () => {
    expect(beatForProgress(0.92, 1)).toBe(6);
    expect(beatForProgress(0.05, 6)).toBe(1);
  });

  test("the reduced-motion stills are: for anyone, your games enter, for you", () => {
    expect(STILL_BEATS).toEqual([1, 4, 6]);
    expect(copy.GRAPH.stillLabels).toEqual(["For anyone", "Your games enter", "For you"]);
  });

  test("every Coach still the graph uses is a public Coach asset", () => {
    for (const pose of COACH_POSES) expect(isPublicCoachAsset(coachUrl(pose))).toBe(true);
    for (const kind of ["wide", "tall"] as const) for (const [, , pose] of COACH[kind]) expect(COACH_POSES).toContain(pose);
  });
});

describe("hero loop timeline", () => {
  test("the Coach looks at the evidence from 2.2 s to 6 s, then returns", () => {
    expect(coachCue(0)).toBe("watching");
    expect(coachCue(2.1)).toBe("watching");
    expect(coachCue(2.2)).toBe("analyzing");
    expect(coachCue(5.9)).toBe("analyzing");
    expect(coachCue(6)).toBe("watching");
    expect(coachCue(7.9)).toBe("watching");
  });

  test("the state pill changes after the picture has visibly turned", () => {
    expect(poseLabel(2.3)).toBe("Watching");
    expect(poseLabel(2.6)).toBe("Analyzing");
    expect(poseLabel(4)).toBe("Analyzing");
    expect(poseLabel(6.1)).toBe("Analyzing");
    expect(poseLabel(6.5)).toBe("Watching");
  });

  test("the walk starts and ends at home and stays within 0..1", () => {
    expect(walkAmount(0)).toBe(0);
    expect(walkAmount(2.9)).toBe(0);
    expect(walkAmount(4.6)).toBeCloseTo(1, 5);
    expect(walkAmount(7)).toBeCloseTo(0, 5);
    for (let t = 0; t <= 8; t += 0.1) {
      expect(walkAmount(t)).toBeGreaterThanOrEqual(-1e-9);
      expect(walkAmount(t)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe("copy never overclaims", () => {
  const text = JSON.stringify(copy);

  test("no forbidden claim, no invented rate, no brand it must not name", () => {
    for (const claim of FORBIDDEN_CLAIMS) expect(text).not.toMatch(claim);
    expect(text).not.toMatch(/\d+\s?%/);
    expect(text).not.toMatch(/win\s?rate\s?of/i);
    expect(text).not.toMatch(/dota\s*plus/i);
  });

  test("FIT is always a score, never a rate", () => {
    expect(copy.PAYOFF.fitNote).toMatch(/not a win rate/i);
    expect(copy.TRUST.note).toMatch(/not a win rate/i);
    expect(copy.PRACTICAL.rows.find((r) => r.term === "What it won't do")?.body).toMatch(/never a win rate/i);
  });

  test("draft modes: built around All Pick and Captain's Mode, nothing else promised, no 'both supported' claim", () => {
    const modes = [copy.PRACTICAL.rows.find((r) => r.term === "Draft modes")?.body ?? "", FAQ.items.find((i) => /modes/i.test(i.q))?.a ?? ""];
    for (const line of modes) {
      expect(line).toMatch(/All Pick and Captain's Mode/);
      expect(line).toMatch(/not promised yet/i);
      expect(line).not.toMatch(/\b(supports|supported)\b/i);
    }
  });

  test("the waitlist is free and has no payment, pricing or donation wording", () => {
    const wl = JSON.stringify([copy.WAITLIST, copy.CLOSE, copy.HERO]);
    expect(wl).toMatch(/Free to join · No payment required\./);
    expect(wl).not.toMatch(/\$|€|price|pricing|donat|checkout|subscribe now/i);
    expect(copy.WAITLIST.foundingBody).toMatch(/Not open yet/);
  });

  test("the preview words never read as a stored sign-up", () => {
    expect(copy.WAITLIST.previewDone).toMatch(/not sent/i);
    expect(copy.WAITLIST.previewDoneNote).toMatch(/not sent or stored/i);
    expect(copy.WAITLIST.previewNote).toMatch(/not sent or stored/i);
  });
});

describe("SEO", () => {
  test("five FAQ questions, on the approved topics", () => {
    expect(FAQ.items).toHaveLength(5);
    expect(FAQ.items.map((i) => i.q)).toEqual([
      "What does D2KIRO look at?",
      "Why can the hero recommendation change?",
      "Does it replace learning the game?",
      "Which draft modes is it built around?",
      "Is joining the waitlist free?",
    ]);
  });

  test("the FAQPage JSON-LD is generated from the rendered items and is safe inside a script tag", () => {
    const data = faqJsonLd();
    expect(data["@type"]).toBe("FAQPage");
    expect(data.mainEntity.map((q) => q.name)).toEqual(FAQ.items.map((i) => i.q));
    expect(data.mainEntity.map((q) => q.acceptedAnswer.text)).toEqual(FAQ.items.map((i) => i.a));
    const hostile = jsonLdString(faqJsonLd([{ q: "x", a: "</script><b>" }]));
    expect(hostile).not.toContain("</script>");
    expect(JSON.parse(hostile).mainEntity[0].acceptedAnswer.text).toBe("</script><b>");
  });

  test("the approved meta description and title are wired", () => {
    expect(LANDING_V3_METADATA.title).toBe("D2KIRO · Dota 2 draft assistant");
    expect(LANDING_V3_METADATA.description).toBe(copy.SITE.description);
    expect(copy.SITE.description).toMatch(/^D2KIRO is a Dota 2 draft assistant\./);
    expect(copy.SITE.description).toMatch(/Join the waitlist\.$/);
  });
});

describe("waitlist integration boundary", () => {
  test("nothing is approved yet, so nothing is collected and no inert link is shown", () => {
    expect(LANDING_CONFIG.joinWaitlist).toBeNull();
    expect(collectionEnabled(LANDING_CONFIG)).toBe(false);
    expect(helpActions(LANDING_CONFIG)).toEqual([]);
  });

  test("collection needs an endpoint AND both legal pages", () => {
    const join = async () => undefined;
    const page = { href: "/privacy" };
    const base: LandingConfig = { joinWaitlist: join, legal: { privacy: page, terms: page }, help: { feedback: null, follow: null } };
    expect(collectionEnabled(base)).toBe(true);
    expect(collectionEnabled({ ...base, joinWaitlist: null })).toBe(false);
    expect(collectionEnabled({ ...base, legal: { privacy: page, terms: null } })).toBe(false);
    expect(collectionEnabled({ ...base, legal: { privacy: null, terms: page } })).toBe(false);
  });

  test("help actions appear only where a destination exists", () => {
    const dest = { href: "https://example.com", external: true };
    const config: LandingConfig = { ...LANDING_CONFIG, help: { feedback: dest, follow: null } };
    expect(helpActions(config).map((a) => a.id)).toEqual(["feedback"]);
  });

  test("email validation", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("  name@example.com ")).toBe(true);
    for (const bad of ["", "a", "a@b", "a@b.", "@b.com", "a b@c.com"]) expect(isValidEmail(bad)).toBe(false);
  });
});

describe("source hygiene", () => {
  const root = __dirname;
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
    });
  const code = sources(root).map((file) => ({ file, text: readFileSync(file, "utf8") }));

  test("no live 3D, no engine, no raw HTML injection", () => {
    for (const { file, text } of code) {
      expect(text, file).not.toMatch(/from "three"|CoachLive|hero-loop\/coach\/HeroCoach"/);
      expect(text, file).not.toMatch(/dangerouslySetInnerHTML/);
      expect(text, file).not.toMatch(/apps\/engine/);
    }
  });

  test("the page uses the approved Coach only through public Coach assets", () => {
    const urls = code.flatMap(({ text }) => [...text.matchAll(/["'`](\/coach-[a-z0-9\-/.]+\.[a-z]+)["'`]/g)].map((m) => m[1]));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(isPublicCoachAsset(url), url).toBe(true);
  });
});

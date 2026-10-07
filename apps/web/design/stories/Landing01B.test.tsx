import "@/test-support/happy-dom";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { FORBIDDEN_CLAIMS } from "@/features/landing/copy";
import { coachCueFor, type CoachCharacterProps } from "@/features/landing/coach/coach-slot";
import { isValidEmail } from "@/features/landing/components/WaitlistSection";
import { LandingPage } from "@/features/landing";
import { FAKE_PRODUCT_STATE } from "@/features/landing/product-state/fake-scenario";

afterEach(cleanup);

const root = join(import.meta.dir, "..", "..", "features", "landing");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : [path];
  });
}
const css = readFileSync(join(root, "landing.css"), "utf8");

function renderPage(props: Parameters<typeof LandingPage>[0] = {}) {
  const screen = render(<LandingPage motionMode="reduced" {...props} />);
  return { screen, page: screen.getByTestId("landing-01b") };
}

describe("Landing 01B structure", () => {
  it("renders hero, memory, counterfactual, proposition, demo, signals, evidence and waitlist in order, one h1", () => {
    const { page } = renderPage();
    const ids = [...page.querySelectorAll("[data-section]")].map((node) => node.getAttribute("data-section"));
    expect(ids).toEqual(["hero", "memory", "counterfactual", "proposition", "demo", "signals", "evidence", "waitlist"]);
    expect(page.querySelectorAll("h1")).toHaveLength(1);
  });

  it("makes no forbidden claim in the rendered text", () => {
    const { page } = renderPage();
    for (const claim of FORBIDDEN_CLAIMS) expect(claim.test(page.textContent ?? "")).toBe(false);
  });

  it("labels illustrative data and the preview waitlist honestly", () => {
    const { page } = renderPage();
    expect(page.textContent).toContain("Illustrative draft");
    expect(page.textContent).toContain("nothing you type here leaves this page");
  });
});

describe("Landing 01B consumes canonical primitives only", () => {
  it("defines no landing-local button, card or glass component", () => {
    const code = sources(root).filter((file) => file.endsWith(".tsx")).map((file) => readFileSync(file, "utf8")).join("\n");
    expect(/function Landing(Button|Card|Glass)\b/.test(code)).toBe(false);
    expect(code.includes("dangerouslySetInnerHTML")).toBe(false);
    expect(/<button\b/.test(code)).toBe(false);
  });

  it("never imports the engine, and only the fake file invents draft data", () => {
    for (const file of sources(root).filter((name) => /\.tsx?$/.test(name))) {
      expect(/apps\/engine|from "\.\.\/\.\.\/\.\.\/engine/.test(readFileSync(file, "utf8"))).toBe(false);
    }
    const others = sources(root).filter((file) => /\.tsx?$/.test(file) && !file.includes("fake-scenario"));
    for (const file of others) expect(/Shadow Shaman|Storm Spirit/.test(readFileSync(file, "utf8"))).toBe(false);
  });

  it("keeps the CSS to tokens: no colour literal, no declared property, no loop, no raw duration", () => {
    expect(/#[0-9a-fA-F]{3,8}\b/.test(css)).toBe(false);
    expect(/(^|[{;]\s*)--(?!ld-)[a-z][a-z-]*\s*:/m.test(css)).toBe(false);
    expect(css.includes("infinite")).toBe(false);
    expect(/transition:[^;]*\s\d+(\.\d+)?m?s\b/.test(css)).toBe(false);
  });
});

describe("Landing 01B product-state seam", () => {
  it("renders whatever frames it is given", () => {
    const frames = FAKE_PRODUCT_STATE.frames.map((frame) => ({ ...frame, top3: frame.top3.map((c) => (c.hero === "Lion" ? { ...c, hero: "Dazzle" } : c)) }));
    const { page } = renderPage({ productState: { frames, illustrative: true } });
    expect(page.textContent).toContain("Dazzle");
  });

  it("thin evidence is a default view: no strategic notch, said in words", () => {
    const thin = FAKE_PRODUCT_STATE.frames.find((frame) => frame.basis === "DETERMINISTIC_DEFAULT");
    expect(thin?.confidence).toBe("low");
    const { page } = renderPage();
    fireEvent.click([...page.querySelectorAll("button")].find((b) => b.textContent?.includes("Thin evidence")) as HTMLElement);
    expect(page.textContent).toContain("No clear strategic priority");
    expect(page.querySelector('[data-section="demo"] [data-state="recommended"]')).toBeNull();
  });
});

describe("Landing 01B demo", () => {
  it("steps the draft by data: choosing a moment changes the narrative and the ranking", () => {
    const { page } = renderPage();
    const demo = page.querySelector('[data-section="demo"]') as HTMLElement;
    const first = demo.querySelector(".ld-cand[data-rank='1']")?.getAttribute("data-flip-key");
    fireEvent.click([...demo.querySelectorAll("button")].find((b) => b.textContent?.includes("Enemy reveals")) as HTMLElement);
    const second = demo.querySelector(".ld-cand[data-rank='1']")?.getAttribute("data-flip-key");
    expect(first).toBe("Lion");
    expect(second).toBe("Shadow Shaman");
    expect(demo.querySelector(".ld-narrative")?.textContent).toContain("Crystal Maiden");
  });

  it("evidence markers are 1:1 with the real match count, and thin evidence cannot gather", () => {
    const { page } = renderPage();
    const evidence = page.querySelector('[data-section="evidence"]') as HTMLElement;
    const enough = FAKE_PRODUCT_STATE.frames.filter((f) => f.basis === "STRATEGIC").reduce((a, f) => Math.max(a, f.evidenceSamples), 0);
    expect(evidence.querySelectorAll(".ld-sample")).toHaveLength(enough);
    fireEvent.click([...evidence.querySelectorAll("button")].find((b) => b.textContent === "Too few matches") as HTMLElement);
    expect(evidence.querySelectorAll(".ld-sample")).toHaveLength(3);
    expect((evidence.querySelector("button[aria-pressed][disabled]") as HTMLButtonElement | null)?.disabled).toBe(true);
  });
});

describe("Landing 01B Coach integration point", () => {
  it("reserves an empty slot, then hands product-derived cue and anchor to an injected character", () => {
    const { page } = renderPage();
    expect(page.querySelector('[data-coach-slot="hero"]')?.getAttribute("data-filled")).toBe("false");
    cleanup();
    const seen: CoachCharacterProps[] = [];
    function Probe(props: CoachCharacterProps) {
      seen.push(props);
      return <i data-probe={props.placement} />;
    }
    const screen = render(<LandingPage coach={Probe} motionMode="reduced" />);
    expect([...screen.container.querySelectorAll("[data-probe]")].map((node) => node.getAttribute("data-probe"))).toEqual(["hero", "memory", "counterfactual", "demo"]);
    expect(seen.every((props) => props.reducedMotion)).toBe(true);
  });

  it("derives the cue from state: thin evidence is uncertain and never points; a lock confirms", () => {
    const [opening, reveal, thin, lock] = FAKE_PRODUCT_STATE.frames;
    expect(coachCueFor(reveal, opening)).toEqual({ anchor: "rival", state: "pointing" });
    expect(coachCueFor(thin, reveal)).toEqual({ anchor: null, state: "uncertain" });
    expect(coachCueFor(lock, thin).state).toBe("confirming");
    expect(coachCueFor(opening, null).state).toBe("watching");
  });
});

describe("Landing 01B waitlist", () => {
  it("validates the email at the edge", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });
});

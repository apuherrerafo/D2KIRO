import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

/* Landing V3 release checks. Lean on purpose: one page, the claims that matter. Run the production build (see playwright.landing-v3.config.ts). */

const BEAT_TITLES = [
  "For anyone in this seat, Queen of Pain leads.",
  "Slark changes the read.",
  "Your supports pull toward Puck.",
  "Now your games enter.",
  "The generic lead loses support. The evidence gathers on Puck.",
  "The graph settles. Puck is your call.",
];

const isReduced = (info: TestInfo) => info.project.name.startsWith("reduced");
const isPhone = (info: TestInfo) => info.project.name.startsWith("mobile");

// the project's `reducedMotion` option alone is not honoured by this Playwright / Chromium pairing: ask for it explicitly
test.beforeEach(async ({ page }, info) => {
  if (isReduced(info)) await page.emulateMedia({ reducedMotion: "reduce" });
});

async function open(page: Page): Promise<{ errors: string[]; requests: string[] }> {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("request", (request) => requests.push(request.url()));
  await page.addInitScript(() => {
    (window as unknown as { __d2kiroQA: boolean }).__d2kiroQA = true;
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/", { waitUntil: "load" });
  await expect(page.getByTestId("hero-loop")).toBeAttached();
  return { errors, requests };
}

async function rows(page: Page) {
  return page.$$eval(".gsvg .gr", (nodes) =>
    nodes
      .map((n) => ({ id: (n as SVGElement).dataset.id ?? "", rank: n.querySelector(".rk")?.textContent ?? "", fit: n.querySelector(".sc")?.textContent ?? "", y: n.getBoundingClientRect().top }))
      .sort((a, b) => a.y - b.y),
  );
}

async function scrollToBeat(page: Page, k: number): Promise<void> {
  await page.evaluate((beat) => {
    const story = document.getElementById("story") as HTMLElement;
    const stick = story.querySelector(".stick") as HTMLElement;
    const range = story.offsetHeight - stick.offsetHeight;
    const top = story.getBoundingClientRect().top + window.scrollY - parseFloat(getComputedStyle(stick).top);
    window.scrollTo(0, top + ((beat - 0.5) / 6) * range);
  }, k);
}

test.describe("structure", () => {
  test("every chapter is there, in order, with no console errors and no horizontal overflow", async ({ page }, info) => {
    const { errors } = await open(page);
    await expect(page.locator("#hero-title")).toHaveText("A draft that adapts to you.");
    await expect(page.locator("main > section").first()).toHaveClass(/hero/);
    await expect(page.getByTestId("handoff")).toBeAttached();
    for (const id of ["graph", "payoff", "trust", "practical", "faq", "waitlist"]) await expect(page.locator(`#${id}`)).toBeAttached();
    const ids = await page.$$eval("main > section[id]", (nodes) => nodes.map((n) => n.id));
    expect(ids).toEqual(["graph", "payoff", "trust", "practical", "faq", "waitlist"]);
    await expect(page.getByText("The meta knows the game.")).toBeVisible();
    await expect(page.getByText("D2KIRO knows your game.")).toBeVisible();
    await expect(page.getByText("Same draft.", { exact: true })).toBeVisible();
    // page-level overflow, at rest and after the deepest scroll
    for (const y of [0, 99999]) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `scroll ${y}`).toBeLessThanOrEqual(0);
    }
    expect(errors, info.project.name).toEqual([]);
  });

  test("metadata, canonical and FAQPage JSON-LD match what is on the page", async ({ page }) => {
    await open(page);
    await expect(page).toHaveTitle("D2KIRO · Dota 2 draft assistant");
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description).toMatch(/^D2KIRO is a Dota 2 draft assistant\./);
    expect(description).toMatch(/Join the waitlist\.$/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^http:\/\/localhost:\d+\/?$/);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
    expect(ld["@type"]).toBe("FAQPage");
    const questions: string[] = ld.mainEntity.map((q: { name: string }) => q.name);
    expect(questions).toHaveLength(5);
    const summaries = await page.locator(".faq-list summary").allTextContents();
    expect(summaries).toEqual(questions);
    expect(await page.locator("h1").count()).toBe(1);
  });

  test("layout stays steady while the page loads (CLS)", async ({ page }) => {
    await open(page);
    await page.waitForTimeout(2500);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.1);
  });

  test("nothing third-party but the allow-listed hero portraits, no live 3D model", async ({ page }) => {
    const { requests } = await open(page);
    await page.waitForTimeout(1500);
    const origin = new URL(page.url()).origin;
    const foreign = requests.filter((url) => !url.startsWith(origin) && !url.startsWith("data:") && !url.startsWith("blob:") && !/^https:\/\/cdn\.cloudflare\.steamstatic\.com\/apps\/dota2\/images\/dota_react\/heroes\//.test(url));
    expect(foreign).toEqual([]);
    expect(requests.filter((url) => /coach-gold-master|\/three|\.glb|\.gltf/i.test(url))).toEqual([]);
  });
});

test.describe("hero", () => {
  test("headline, a real waitlist form and the Hero Loop are all on the first screen", async ({ page }, info) => {
    await open(page);
    const vp = page.viewportSize();
    for (const locator of [page.locator("#hero-title"), page.getByTestId("waitlist-hero").locator("input"), page.getByTestId("waitlist-hero").locator(".cx-action")]) {
      const box = await locator.boundingBox();
      expect(box, "visible").not.toBeNull();
      expect(box!.y + box!.height, "above the fold").toBeLessThanOrEqual(vp!.height);
    }
    // the real Hero Loop starts on the first screen on every width (credibility before the story)
    const stage = await page.getByTestId("hero-stage").boundingBox();
    expect(stage!.y).toBeLessThan(vp!.height - (isPhone(info) ? 120 : 200));
    await expect(page.locator(".hl-card").first()).toBeVisible();
  });

  test("the Hero Loop shows real Dota portraits, never monograms", async ({ page }) => {
    await open(page);
    await expect(page.locator(".hl-seat .chm-icon").first()).toBeVisible();
    await expect.poll(() => page.locator(".hl .chm-icon[data-art='image']").count(), { timeout: 20_000 }).toBeGreaterThan(4);
    expect(await page.locator(".lv3 .tile").count()).toBe(0);
  });

  test("Coach: Motion V2 only on supported desktop; phones and reduced motion never request the pack", async ({ page }, info) => {
    const { requests } = await open(page);
    const coach = page.getByTestId("hero-coach");
    await expect(coach).toBeVisible();
    const box = await coach.boundingBox();
    expect(box!.width).toBeGreaterThan(80);
    if (isPhone(info) || isReduced(info)) {
      await page.waitForTimeout(4000);
      expect(requests.filter((url) => url.includes("/coach-motion-v2/"))).toEqual([]);
      return;
    }
    if (info.project.name === "desktop-1024") return; // below the supported-desktop width: the still sprite
    await expect(page.getByTestId("motion-player-384")).toHaveAttribute("data-motion-status", "motion", { timeout: 30_000 });
    expect(requests.some((url) => url.includes("/coach-motion-v2/prod/384/manifest.json"))).toBe(true);
    // it paints: the atlas canvas is visible and non-empty
    const painted = await page.getByTestId("coach-prod-canvas").evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext("2d");
      if (!ctx) return 0;
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 10) n += 1;
      return n;
    });
    expect(painted).toBeGreaterThan(2000);
  });

  test("the loop plays: the phase advances by itself and the draft stays Draft A first", async ({ page }, info) => {
    test.skip(isReduced(info), "reduced motion plays the same beats as crossfades (checked below)");
    await open(page);
    const loop = page.getByTestId("hero-loop");
    const first = await loop.getAttribute("data-phase");
    await expect.poll(() => loop.getAttribute("data-phase"), { timeout: 20_000 }).not.toBe(first);
    await expect(loop).toHaveAttribute("data-scenario", /A|B|C/);
  });

  test("reduced motion: the loop runs as crossfades, nothing travels", async ({ page }, info) => {
    test.skip(!isReduced(info), "reduced-motion project only");
    await open(page);
    await expect(page.getByTestId("hero-loop")).toHaveAttribute("data-motion", "reduced");
    await expect(page.locator(".hl-fly")).toHaveCount(0);
  });

  test("the motion toggle pauses and resumes", async ({ page }, info) => {
    test.skip(isReduced(info), "no motion to pause");
    await open(page);
    const toggle = page.getByTestId("hero-motion-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const loop = page.getByTestId("hero-loop");
    const held = await loop.getAttribute("data-beat");
    await page.waitForTimeout(3500);
    expect(await loop.getAttribute("data-beat"), "paused: the beat holds").toBe(held);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => loop.getAttribute("data-beat"), { timeout: 20_000 }).not.toBe(held);
  });
});

test.describe("living decision graph", () => {
  test("six beats by scroll, one persistent Draft A, resolution at the end", async ({ page }, info) => {
    test.skip(isReduced(info), "reduced motion shows stills");
    await open(page);
    const story = page.getByTestId("graph-story");
    const caption = page.getByTestId("graph-caption");
    for (let k = 1; k <= 6; k += 1) {
      await scrollToBeat(page, k);
      await expect(story).toHaveAttribute("data-k", String(k));
      await expect(caption).toHaveText(BEAT_TITLES[k - 1]);
    }
    // beat 6: the ranking physically reordered, for you
    await expect.poll(async () => (await rows(page)).map((r) => `${r.id}:${r.rank}:${r.fit}`), { timeout: 8000 }).toEqual(["puck:#1:88", "qop:#2:83", "vs:#3:77"]);
    await expect(page.locator(".rk-head")).toHaveAttribute("data-k", "you");
    // and back: scrolling up restores the generic read
    await scrollToBeat(page, 1);
    await expect(story).toHaveAttribute("data-k", "1");
    await expect.poll(async () => (await rows(page)).map((r) => `${r.id}:${r.rank}:${r.fit}`), { timeout: 8000 }).toEqual(["qop:#1:84", "puck:#2:82", "vs:#3:77"]);
    await expect(page.locator(".rk-head")).toHaveAttribute("data-k", "any");
  });

  test("the rail buttons go to their beat", async ({ page }, info) => {
    test.skip(isReduced(info), "reduced motion shows stills");
    await open(page);
    await scrollToBeat(page, 1);
    await expect(page.locator(".gsvg")).toBeAttached(); // the stage is built when the story comes near; a visitor never reaches it sooner
    await page.locator('.rail-b[data-beat="4"]').click();
    await expect(page.getByTestId("graph-story")).toHaveAttribute("data-k", "4");
    await expect(page.getByTestId("graph-caption")).toHaveText(BEAT_TITLES[3]);
  });

  test("a fast flick down and back up lands in a consistent state", async ({ page }, info) => {
    test.skip(isReduced(info), "reduced motion shows stills");
    await open(page);
    await scrollToBeat(page, 1);
    // flick: straight to the end of the story, then to beat 2, then to beat 6, with no waiting in between
    await scrollToBeat(page, 6);
    await scrollToBeat(page, 2);
    await scrollToBeat(page, 6);
    await expect(page.getByTestId("graph-story")).toHaveAttribute("data-k", "6");
    await expect(page.getByTestId("graph-caption")).toHaveText(BEAT_TITLES[5]);
    await expect.poll(async () => (await rows(page)).map((r) => `${r.id}:${r.rank}:${r.fit}`), { timeout: 8000 }).toEqual(["puck:#1:88", "qop:#2:83", "vs:#3:77"]);
    await scrollToBeat(page, 1);
    await scrollToBeat(page, 5);
    await scrollToBeat(page, 1);
    await expect(page.getByTestId("graph-story")).toHaveAttribute("data-k", "1");
    await expect.poll(async () => (await rows(page)).map((r) => `${r.id}:${r.rank}:${r.fit}`), { timeout: 8000 }).toEqual(["qop:#1:84", "puck:#2:82", "vs:#3:77"]);
    // exactly one Coach pose is showing
    const visible = await page.$$eval(".gsvg .coach image", (nodes) => nodes.filter((n) => parseFloat((n as SVGElement).style.opacity || "0") > 0.5).length);
    expect(visible).toBe(1);
  });

  test("Slark is never presented as newly picked: it is in the graph from the first beat", async ({ page }, info) => {
    test.skip(isReduced(info), "reduced motion shows stills");
    await open(page);
    await scrollToBeat(page, 1);
    await expect(page.locator('.gsvg .gn[data-id="slark"]')).toHaveAttribute("data-v", "q");
    await scrollToBeat(page, 2);
    await expect(page.locator('.gsvg .gn[data-id="slark"]')).toHaveAttribute("data-v", "o");
    await expect(page.locator('.gsvg .gn[data-id="slark"]')).toHaveAttribute("data-on", "");
  });

  test("phones draw at most three links per beat", async ({ page }, info) => {
    test.skip(!isPhone(info), "narrow stage only");
    await open(page);
    for (let k = 1; k <= 6; k += 1) {
      await scrollToBeat(page, k);
      await expect(page.getByTestId("graph-story")).toHaveAttribute("data-k", String(k));
      await page.waitForTimeout(700);
      const drawn = await page.$$eval(".gsvg .e", (nodes) => nodes.filter((n) => (n as SVGElement).getAttribute("data-s") !== "x" && !(n as SVGElement).classList.contains("halo")).length);
      expect(drawn, `beat ${k}`).toBeLessThanOrEqual(3);
    }
  });

  test("reduced motion: three understandable still states", async ({ page }, info) => {
    test.skip(!isReduced(info), "reduced-motion project only");
    await open(page);
    await expect(page.getByTestId("graph-story")).toBeHidden();
    const stills = page.getByTestId("graph-stills").locator("figure");
    await expect(stills).toHaveCount(3);
    await expect(stills.nth(0)).toContainText("For anyone");
    await expect(stills.nth(1)).toContainText("Your games enter");
    await expect(stills.nth(2)).toContainText("For you");
    await stills.nth(0).scrollIntoViewIfNeeded();
    await expect(stills.nth(0).locator(".gsvg")).toBeAttached();
    const fits = async (i: number) => stills.nth(i).locator(".gr .sc").allTextContents();
    expect(await fits(0)).toEqual(["84", "82", "77"]);
    expect(await fits(2)).toEqual(["83", "88", "77"]);
    await expect(stills.nth(2).locator(".rk-head")).toHaveAttribute("data-k", "you");
    // no sticky choreography: the page is not taller than its content needs
    const stickyChildren = await page.locator(".story").count();
    expect(stickyChildren).toBe(1);
  });
});

test.describe("differentiation, payoff and trust", () => {
  test("the generic read comes first and the figure shows Draft A's ranking for anyone", async ({ page }) => {
    await open(page);
    await page.locator(".diff").scrollIntoViewIfNeeded();
    await page.getByTestId("diff-figure").scrollIntoViewIfNeeded();
    await expect(page.locator(".diff-svg")).toBeAttached();
    await expect(page.locator(".diff-svg")).toContainText("FOR ANYONE");
    await expect(page.locator(".diff-svg")).toContainText("Queen of Pain");
    await expect(page.getByTestId("diff-figure")).toHaveClass(/is-in/);
    // no brand named, no versus table
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("dota plus");
    expect(await page.locator("table").count()).toBe(0);
  });

  test("payoff: Queen of Pain #1→#2 84→83, Puck #2→#1 82→88, Void Spirit #3→#3 77", async ({ page }) => {
    await open(page);
    const rowsText = await page.getByTestId("payoff-card").locator(".pay-row").allInnerTexts();
    const flat = rowsText.map((t) => t.replace(/\s+/g, " "));
    // the real portraits carry the hero; the canonical RankMove draws the arrow (its words are screen-reader text), "#a → #b" says it in print
    expect(flat[0]).toMatch(/#1 Puck .*#2 → #1 FIT 88 was 82/);
    expect(flat[1]).toMatch(/#2 Queen of Pain .*#1 → #2 FIT 83 was 84 · −1/);
    expect(flat[2]).toMatch(/#3 Void Spirit = .*#3 → #3 FIT 77 no history yet/);
    await expect(page.getByTestId("payoff-card").locator(".chm-icon")).toHaveCount(3);
    // English accessible rank movement: Spanish RankMove text is hidden, one English label per row
    const card = page.getByTestId("payoff-card");
    await expect(card.locator('.pay-row .mv2 [aria-hidden="true"] .cx-sr')).toHaveCount(2);
    const spoken = await card.locator(".pay-row .mv2 > .cx-sr").allTextContents();
    expect(spoken).toEqual(["moves up 1 place", "moves down 1 place", "stays at rank 3"]);
    expect(await card.getByText(/puesto/).count()).toBe(0 + (await card.locator('[aria-hidden="true"] .cx-sr').count()));
    await expect(page.getByTestId("payoff-card")).toContainText("It is not a win rate.");
    // the payoff does not replay the graph
    expect(await page.locator("#payoff .gsvg").count()).toBe(0);
  });

  test("trust: one final call, four reasons on screen, no lock button, no strength bars", async ({ page }) => {
    await open(page);
    const call = page.getByTestId("trust-call");
    await expect(call.locator("h3")).toHaveText("Puck");
    await expect(call.locator(".call-top .fit b")).toHaveText("88");
    const keys = await call.locator(".proof .k").allTextContents();
    expect(keys).toEqual(["COUNTER", "SYNERGY", "YOUR GAMES", "ROLE"]);
    await expect(call).toContainText("Holds up vs the enemy picks");
    await expect(call).toContainText("Pairs with your supports");
    await expect(call).toContainText("Often played by you");
    await expect(call).toContainText("Position 2 / Mid");
    await expect(page.locator(".trust .state-pill")).toContainText("Confirming");
    expect(await page.getByRole("button", { name: /lock/i }).count()).toBe(0);
    expect(await call.locator("progress, meter, [role=progressbar], [class*=bar]").count()).toBe(0);
  });

  test("lime is personal resolution only: never on the free-to-join cue or the SYNERGY evidence (the locked Hero Loop keeps its own approved hues)", async ({ page }) => {
    await open(page);
    const colours = await page.evaluate(() => {
      const lime = getComputedStyle(document.querySelector(".lv3") as Element).getPropertyValue("--lime").trim();
      const rgb = (el: Element, prop: "color" | "backgroundColor") => getComputedStyle(el)[prop];
      const probe = document.createElement("i");
      probe.style.color = lime;
      document.body.appendChild(probe);
      const limeRgb = getComputedStyle(probe).color;
      probe.remove();
      const micro = document.querySelector(".wl-micro") as Element;
      const microDot = getComputedStyle(micro, "::before").backgroundColor;
      const synergy = document.querySelector(".proof li:nth-child(2) .k") as Element;
      return { limeRgb, microDot, synergy: rgb(synergy, "color") };
    });
    expect(colours.microDot).not.toBe(colours.limeRgb);
    expect(colours.synergy).not.toBe(colours.limeRgb);
  });
});

test.describe("practical, FAQ and footer", () => {
  test("built for your next draft: the rows cover the product truthfully", async ({ page }) => {
    await open(page);
    const section = page.locator("#practical");
    await expect(section.locator("h2")).toHaveText("Built for your next draft.");
    const text = (await section.innerText()).toLowerCase();
    for (const phrase of ["dota 2 draft assistant", "counter picks", "synergy", "personalized draft recommendations", "why a recommendation changes", "top 3", "your seat", "your games", "all pick and captain's mode", "additional modes are not promised yet"]) {
      expect(text, phrase).toContain(phrase);
    }
    expect(text).not.toMatch(/both modes are (already )?(publicly )?supported/);
  });

  test("FAQ: five questions as details, they open and close", async ({ page }) => {
    await open(page);
    const items = page.locator(".faq-list details");
    await expect(items).toHaveCount(5);
    const first = items.first();
    await first.locator("summary").scrollIntoViewIfNeeded();
    await expect(first.locator("p")).toBeHidden();
    await first.locator("summary").click();
    await expect(first.locator("p")).toBeVisible();
    await first.locator("summary").click();
    await expect(first.locator("p")).toBeHidden();
  });

  test("footer is minimal; Privacy and Terms are not linked while no approved pages exist", async ({ page }) => {
    await open(page);
    const footer = page.locator("footer.foot");
    await expect(footer).toContainText("D2KIRO");
    await expect(footer).toContainText("not affiliated with or endorsed by Valve Corporation");
    expect(await footer.locator('a[href="/privacy"], a[href="/terms"]').count()).toBe(0);
    expect(await footer.locator("a[href='#']").count()).toBe(0);
  });
});

test.describe("waitlist (preview: no approved backend or legal pages yet)", () => {
  test("both forms validate, say they are a preview and never claim to have stored anything", async ({ page }) => {
    await open(page);
    const hero = page.getByTestId("waitlist-hero");
    await expect(hero.getByTestId("waitlist-preview")).toContainText("Preview only");
    await expect(hero).toContainText("Free to join · No payment required.");
    await hero.locator("input").fill("not-an-email");
    await hero.locator(".cx-action").click();
    await expect(hero.locator(".wl-msg")).toHaveText("Enter an email address like name@example.com.");
    await expect(hero.locator("input")).toHaveAttribute("aria-invalid", "true");
    await hero.locator("input").fill("player@example.com");
    await hero.locator(".cx-action").click();
    // the success state is the preview one, on BOTH forms
    const closing = page.getByTestId("waitlist-close");
    await expect(hero.locator(".wl-ok")).toContainText("Preview only, not sent.");
    await expect(closing.locator(".wl-ok")).toContainText("Preview only, not sent.");
    await expect(closing).not.toContainText("You're on the list.");
    await expect(closing.locator(".wl-ok")).toContainText("Want to help shape D2KIRO?");
    // no inert buttons: no help action without a real destination
    expect(await closing.locator(".help-row, .help button, .ghost").count()).toBe(0);
    // Founding Supporter is a quiet post-signup note, never a payment
    await closing.locator(".later summary").scrollIntoViewIfNeeded();
    await closing.locator(".later summary").click();
    await expect(closing.locator(".later")).toContainText("Not open yet");
    expect(await page.locator("form input[type=tel], form input[name*=card], form input[name*=amount]").count()).toBe(0);
  });

  test("the final waitlist: strong, simple, Coach at rest", async ({ page }) => {
    await open(page);
    const close = page.locator("#waitlist");
    await expect(close.locator("h2")).toHaveText("Join the waitlist.");
    await expect(close).toContainText("Help shape what D2KIRO becomes next.");
    await expect(close.locator(".close-coach .state-pill")).toContainText("Resting");
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const word of ["pricing", "donate", "per month", "/mo", "checkout"]) expect(body).not.toContain(word);
  });
});

test.describe("public Coach assets", () => {
  test("every Coach asset the page uses is reachable without a session; the live model is not", async ({ page, request }) => {
    const { requests } = await open(page);
    await page.waitForTimeout(1500);
    const coach = [...new Set(requests.filter((url) => /\/coach-(web-pack|motion-v2)\//.test(url)).map((url) => new URL(url).pathname))];
    expect(coach.length).toBeGreaterThan(3);
    for (const path of coach) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
    }
    const model = readdirSync(resolve("apps/web/public/coach-gold-master/modular")).find((name) => /\.(glb|gltf|json|bin)$/.test(name));
    if (model) {
      const blocked = await request.get(`/coach-gold-master/modular/${model}`, { maxRedirects: 0 });
      expect(blocked.status()).not.toBe(200);
    }
  });
});

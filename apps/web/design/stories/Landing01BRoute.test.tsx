import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LandingPage } from "@/features/landing";
import { ENTRY_PATH } from "@/features/landing/components/EntrySection";
import { FORBIDDEN_CLAIMS, NAV_LINKS } from "@/features/landing/copy";
import { LANDING_METADATA } from "@/features/landing/metadata";
import { isHiddenForVisitor } from "@/components/nav-bar/NavBar";

// TSK-244: what the public route `/` must keep promising, independent of Storybook.
afterEach(cleanup);

const webRoot = join(import.meta.dir, "..", "..");
const pageSource = readFileSync(join(webRoot, "app", "page.tsx"), "utf8");

describe("Landing route `/`", () => {
  it("serves the same LandingPage Storybook renders, with no sign-up form", () => {
    expect(pageSource).toContain('import { LandingPage } from "@/features/landing"');
    expect(pageSource).toContain("<LandingPage />");
    expect(pageSource).toContain("LANDING_METADATA");
    expect(pageSource).not.toContain("onJoinWaitlist");
  });

  it("renders without a Coach, and every in-page link targets an existing section", () => {
    const screen = render(<LandingPage motionMode="reduced" />);
    const page = screen.getByTestId("landing-01b");
    for (const link of NAV_LINKS) expect(page.querySelector(link.href)).not.toBeNull();
    expect(page.querySelector("#proposition")).not.toBeNull();
    expect(page.querySelector("#entry")).not.toBeNull();
    expect(page.querySelectorAll("h1")).toHaveLength(1);
  });

  it("keeps the sticky-nav offset on every anchor target", () => {
    const landing = readFileSync(join(webRoot, "features", "landing", "landing.css"), "utf8");
    const counterfactual = readFileSync(join(webRoot, "features", "landing", "counterfactual", "counterfactual.css"), "utf8");
    expect(landing).toMatch(/\.ld-section\s*\{[^}]*scroll-margin-top: 56px/);
    expect(landing).toMatch(/\.ld-memory\s*\{[^}]*scroll-margin-top: 56px/);
    expect(counterfactual).toMatch(/\.ld-cf\s*\{[^}]*scroll-margin-top: 56px/);
  });

  it("leaves the app shell nav out of the public landing", () => {
    expect(isHiddenForVisitor(false, "/")).toBe(true);
    expect(isHiddenForVisitor(true, "/")).toBe(false);
    expect(isHiddenForVisitor(false, "/login")).toBe(false);
  });
});

describe("Landing metadata", () => {
  it("is specific to the product and makes no forbidden claim", () => {
    const description = String(LANDING_METADATA.description);
    expect(String(LANDING_METADATA.title)).toContain("D2KIRO");
    expect(description).toContain("draft");
    expect(LANDING_METADATA.openGraph?.title).toBe(LANDING_METADATA.title as string);
    expect(LANDING_METADATA.openGraph?.description).toBe(description);
    expect(LANDING_METADATA.alternates?.canonical).toBe("/");
    for (const claim of FORBIDDEN_CLAIMS) expect(claim.test(`${String(LANDING_METADATA.title)} ${description}`)).toBe(false);
  });
});

describe("Landing entry", () => {
  it("every call to action goes to the real Steam sign-in; no dead waitlist remains", () => {
    expect(ENTRY_PATH).toBe("/login");
    for (const file of ["components/LandingHero.tsx", "components/LandingNav.tsx", "components/EntrySection.tsx"]) {
      expect(readFileSync(join(webRoot, "features", "landing", file), "utf8")).toContain("ENTRY_PATH");
    }
    const screen = render(<LandingPage motionMode="reduced" />);
    const text = screen.getByTestId("landing-01b").textContent ?? "";
    expect(/waitlist|lista de espera|nothing you type here/i.test(text)).toBe(false);
    expect(text).toContain("Sign in with Steam");
  });
});

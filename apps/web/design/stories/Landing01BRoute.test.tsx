import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LandingPage } from "@/features/landing";
import { waitlistWords } from "@/features/landing/components/WaitlistSection";
import { FORBIDDEN_CLAIMS, NAV_LINKS } from "@/features/landing/copy";
import { LANDING_METADATA } from "@/features/landing/metadata";
import { isHiddenForVisitor } from "@/components/nav-bar/NavBar";

// TSK-244: what the public route `/` must keep promising, independent of Storybook.
afterEach(cleanup);

const webRoot = join(import.meta.dir, "..", "..");
const pageSource = readFileSync(join(webRoot, "app", "page.tsx"), "utf8");

describe("Landing route `/`", () => {
  it("serves the same LandingPage Storybook renders, with no waitlist endpoint wired", () => {
    expect(pageSource).toContain('import { LandingPage } from "@/features/landing"');
    expect(pageSource).toContain("<LandingPage />");
    expect(pageSource).toContain("LANDING_METADATA");
    expect(pageSource).not.toContain("onJoinWaitlist=");
  });

  it("renders without a Coach, and every in-page link targets an existing section", () => {
    const screen = render(<LandingPage motionMode="reduced" />);
    const page = screen.getByTestId("landing-01b");
    for (const link of NAV_LINKS) expect(page.querySelector(link.href)).not.toBeNull();
    expect(page.querySelector("#proposition")).not.toBeNull();
    expect(page.querySelector("#waitlist")).not.toBeNull();
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

describe("Landing waitlist without an endpoint", () => {
  it("never says the visitor is on the list while it is a preview", () => {
    const words = waitlistWords(true);
    expect(/on the list|we will write/i.test(`${words.busy} ${words.success} ${words.successNote}`)).toBe(false);
    expect(words.successNote).toContain("not sent or stored");
  });

  it("reports a real success only once an endpoint is wired", () => {
    expect(waitlistWords(false).success).toBe("You are on the list");
  });

  it("derives the words from the absence of an endpoint, and keeps the preview note", () => {
    const source = readFileSync(join(webRoot, "features", "landing", "components", "WaitlistSection.tsx"), "utf8");
    expect(source).toContain("const preview = onJoin === undefined;");
    expect(source).toContain("waitlistWords(preview)");
    const screen = render(<LandingPage motionMode="reduced" />);
    expect(screen.getByTestId("landing-01b").textContent).toContain("nothing you type here leaves this page");
  });
});

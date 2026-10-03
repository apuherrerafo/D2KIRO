import "@/test-support/happy-dom";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { Button } from "./Button";
import { StatusNotice } from "./StatusNotice";

afterEach(cleanup);

describe("Button Primitive", () => {
  it("renders children with correct accessible name", () => {
    const { getByRole } = render(<Button>Lock Hero</Button>);
    const button = getByRole("button", { name: "Lock Hero" });
    expect(button).toBeDefined();
    expect(button.getAttribute("type")).toBe("button");
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("respects aria-label override", () => {
    const { getByRole } = render(<Button aria-label="Confirm draft pick">✓</Button>);
    const button = getByRole("button", { name: "Confirm draft pick" });
    expect(button).toBeDefined();
  });

  it("handles click events when active", () => {
    let clicked = false;
    const { getByRole } = render(<Button onClick={() => { clicked = true; }}>Click me</Button>);
    const button = getByRole("button", { name: "Click me" });
    fireEvent.click(button);
    expect(clicked).toBe(true);
  });

  it("disables interaction and prevents clicks when disabled", () => {
    let clicked = false;
    const { getByRole } = render(
      <Button disabled onClick={() => { clicked = true; }}>
        Disabled Action
      </Button>
    );
    const button = getByRole("button", { name: "Disabled Action" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(clicked).toBe(false);
  });

  it("exposes busy state without dropping accessible name and disables interaction", () => {
    let clicked = false;
    const { getByRole } = render(
      <Button busy onClick={() => { clicked = true; }}>
        Computing Suggestion
      </Button>
    );
    const button = getByRole("button", { name: "Computing Suggestion" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(clicked).toBe(false);
  });

  it("applies primary and secondary variant styles using semantic tokens", () => {
    const { getByRole: getPrimary } = render(<Button variant="primary">Primary</Button>);
    const primaryButton = getPrimary("button", { name: "Primary" });
    expect(primaryButton.className).toContain("bg-accent-primary");
    expect(primaryButton.className).toContain("text-surface-base");

    const { getByRole: getSecondary } = render(<Button variant="secondary">Secondary</Button>);
    const secondaryButton = getSecondary("button", { name: "Secondary" });
    expect(secondaryButton.className).toContain("border-surface-border");
    expect(secondaryButton.className).toContain("text-content-secondary");
  });
});

describe("StatusNotice Primitive", () => {
  it("renders neutral status with role='status' and polite live region", () => {
    const { getByRole, getByText } = render(
      <StatusNotice title="Draft Synchronized">Hero pool is updated with latest meta.</StatusNotice>
    );
    const notice = getByRole("status");
    expect(notice.getAttribute("aria-live")).toBe("polite");
    expect(getByText("Draft Synchronized")).toBeDefined();
    expect(getByText("Hero pool is updated with latest meta.")).toBeDefined();
    expect(notice.className).toContain("border-surface-border");
  });

  it("renders warning status with warning token styling and polite live region", () => {
    const { getByRole, getByText } = render(
      <StatusNotice title="Meta Stale" tone="warning">
        Last sync was 14 days ago. Recommendations may be degraded.
      </StatusNotice>
    );
    const notice = getByRole("status");
    expect(notice.getAttribute("aria-live")).toBe("polite");
    expect(notice.className).toContain("border-signal-warning");
    expect(getByText("Meta Stale").className).toContain("text-signal-warning");
  });

  it("renders error status with role='alert' and assertive live region", () => {
    const { getByRole, getByText } = render(
      <StatusNotice title="Engine Disconnected" tone="error">
        Connection to recommendation engine lost.
      </StatusNotice>
    );
    const notice = getByRole("alert");
    expect(notice.getAttribute("aria-live")).toBe("assertive");
    expect(notice.className).toContain("border-signal-negative");
    expect(getByText("Engine Disconnected").className).toContain("text-signal-negative");
  });
});

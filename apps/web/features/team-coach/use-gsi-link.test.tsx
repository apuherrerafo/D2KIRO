import "@/test-support/happy-dom";

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import { useGsiLink } from "./use-gsi-link";

afterEach(cleanup);

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("useGsiLink -- sliding expiration refresh", () => {
  test("a linked tab re-reads the link and picks up the renewed expiresAt", async () => {
    let expiresAt = "2026-11-01T00:00:00.000Z";
    const fetchImpl = (async () => json({ schema: "live-gsi-link/v1", link: { sessionId: "s1", createdAt: "2026-10-02T00:00:00.000Z", expiresAt } })) as unknown as typeof fetch;
    const { result } = renderHook(() => useGsiLink({ fetchImpl, refreshMs: 20 }));
    await waitFor(() => expect(result.current.state.link?.expiresAt).toBe("2026-11-01T00:00:00.000Z"));
    expiresAt = "2026-12-01T00:00:00.000Z"; // the engine renewed it after a Companion heartbeat
    await waitFor(() => expect(result.current.state.link?.expiresAt).toBe("2026-12-01T00:00:00.000Z"));
  });

  test("with no link there is nothing to refresh (one initial read only)", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return json({ schema: "live-gsi-link/v1", link: null });
    }) as unknown as typeof fetch;
    const { result } = renderHook(() => useGsiLink({ fetchImpl, refreshMs: 10 }));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(calls).toBe(1);
  });
});

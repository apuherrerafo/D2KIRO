// Fixtures + a fake engine for tests that render the team editor / simulator setup against RTK Query.
// Inline data only: nothing here reads a real team, hero catalog or pool.

import type { Seat, TeamGroupEntry } from "@/features/team-groups/types";

export const MEMBER_NAMES = ["Ana", "Bruno", "Carla", "Dani", "Eli"] as const;

/** A Party 5 team. `positions[i]` is the usual position of the i-th member (null = never confirmed, an old team). */
export function party5Team(positions: readonly (Seat | null)[], overrides: Partial<TeamGroupEntry> = {}): TeamGroupEntry {
  return {
    id: 7,
    name: "Mi equipo",
    partySize: 5,
    updatedAt: "2026-10-04",
    members: positions.map((position, index) => ({
      id: 11 + index,
      teamGroupId: 7,
      slot: index + 1,
      position,
      name: MEMBER_NAMES[index]!,
      heroPool: [100 + index],
      updatedAt: "2026-10-04",
    })),
    ...overrides,
  };
}

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
}

/** Installs a fetch that serves the given teams and records every request. Returns the log and a restore function. */
export function installFakeEngine(teams: TeamGroupEntry[]): { requests: RecordedRequest[]; restore: () => void } {
  // RTK Query builds `new Request("/engine/api/...")`: relative URLs need a base, which happy-dom lacks by default.
  (globalThis as unknown as { happyDOM?: { setURL(url: string): void } }).happyDOM?.setURL("http://localhost/");
  const original = globalThis.fetch;
  const requests: RecordedRequest[] = [];
  const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url, "http://localhost").pathname;
    const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
    const body: unknown = text.length > 0 ? JSON.parse(text) : null;
    requests.push({ method: request.method, path, body });
    if (path.endsWith("/api/team-groups") && request.method === "GET") return Response.json(teams);
    if (path.endsWith("/api/heroes")) return Response.json([]);
    if (path.includes("/api/team-groups")) return Response.json({ ...teams[0], ...(body as object) }, { status: request.method === "POST" ? 201 : 200 });
    return Response.json({}, { status: 404 });
  };
  globalThis.fetch = stub as typeof fetch;
  return {
    requests,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

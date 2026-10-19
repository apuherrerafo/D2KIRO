import { expect, test } from "bun:test";
import { createSimulatorProtocolSession } from "../protocol-client";

// The session-creation request carries the saved team and THIS match's assignment -- never pools built in the browser.

function recordingFetch(): { fetchImpl: typeof fetch; bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ sessionId: "s-1" }, { status: 201 });
  }) as typeof fetch;
  return { fetchImpl, bodies };
}

test("manda teamGroupId + teamAssignment, y ningún playerPoolsByPosition", async () => {
  const { fetchImpl, bodies } = recordingFetch();
  await createSimulatorProtocolSession("7.41e", "radiant", fetchImpl, {
    partySize: 5,
    humanPosition: 1,
    teamGroupId: 7,
    teamAssignment: { "11": 1, "12": 5, "15": 2 },
  });
  expect(bodies[0]).toMatchObject({ teamGroupId: 7, teamAssignment: { "11": 1, "12": 5, "15": 2 }, humanPosition: 1 });
  expect(bodies[0]).not.toHaveProperty("playerPoolsByPosition");
});

test("sin equipo (Solo / Party sin preset) no manda asignación", async () => {
  const { fetchImpl, bodies } = recordingFetch();
  await createSimulatorProtocolSession("7.41e", "dire", fetchImpl, { partySize: 1, humanPosition: 4 });
  expect(bodies[0]!.teamAssignment).toBeUndefined();
  expect(bodies[0]!.teamGroupId).toBeUndefined();
});

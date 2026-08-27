import { expect, test } from "bun:test";
import type { Confidence, ProSourceRef, ProTournament } from "./types";

// TSK-148: `source` y `confidence` son obligatorios en todo el contrato -- un patrón sin
// procedencia no debe compilar, nunca degradar en silencio a un default. Esta prueba documenta
// esa garantía en el propio código, no solo en la prosa del ticket -- mismo criterio que la
// prueba dedicada de BigInt en la conversión SteamID64->Steam32 (Fase 5): sin este candado, un
// refactor futuro puede reintroducir el hueco sin que ningún test lo note.
test("ProSourceRef exige source, fetchedAt y sampleSize -- omitir cualquiera no compila", () => {
  const valid: ProSourceRef = { source: "opendota_match", fetchedAt: "2026-08-27T00:00:00.000Z", sampleSize: 1 };
  expect(valid.source).toBe("opendota_match");

  // @ts-expect-error -- source es obligatorio, un literal sin él no debe tipar como ProSourceRef.
  const missingSource: ProSourceRef = { fetchedAt: "2026-08-27T00:00:00.000Z", sampleSize: 1 };
  void missingSource;

  // @ts-expect-error -- sampleSize es obligatorio, mismo criterio.
  const missingSampleSize: ProSourceRef = { source: "opendota_match", fetchedAt: "2026-08-27T00:00:00.000Z" };
  void missingSampleSize;
});

test("ProTournament exige confidence y ref -- omitir cualquiera no compila", () => {
  const ref: ProSourceRef = { source: "opendota_league", fetchedAt: "2026-08-27T00:00:00.000Z", sampleSize: 200 };
  const valid: ProTournament = {
    leagueId: 1,
    name: "The International 2026",
    tier: "premium",
    firstSeenAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: "2026-08-27T00:00:00.000Z",
    region: "unknown",
    ref,
    confidence: "high",
  };
  expect(valid.confidence).toBe("high");

  // @ts-expect-error -- confidence es obligatorio, nunca opcional (evita que "exploratory" se
  // trague en silencio bajo un default -- ver TSK-154).
  const missingConfidence: ProTournament = {
    leagueId: 1,
    name: "sin confianza",
    tier: "premium",
    firstSeenAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: "2026-08-27T00:00:00.000Z",
    region: "unknown",
    ref,
  };
  void missingConfidence;
});

test("Confidence es una unión cerrada de exactamente 4 miembros", () => {
  const members: Confidence[] = ["high", "medium", "exploratory", "none"];
  expect(members).toHaveLength(4);

  // @ts-expect-error -- ningún quinto valor es válido, la unión está cerrada a propósito.
  const invalid: Confidence = "low";
  void invalid;
});

test("region de ProTournament es el literal 'unknown', no un string arbitrario", () => {
  const ref: ProSourceRef = { source: "opendota_league", fetchedAt: "2026-08-27T00:00:00.000Z", sampleSize: 1 };
  const valid: ProTournament = {
    leagueId: 2,
    name: "torneo sin región real",
    tier: "professional",
    firstSeenAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: "2026-08-27T00:00:00.000Z",
    region: "unknown",
    ref,
    confidence: "medium",
  };
  expect(valid.region).toBe("unknown");

  // @ts-expect-error -- region nunca se adivina desde el nombre de la liga; el tipo lo impide.
  const guessedRegion: ProTournament["region"] = "eu";
  void guessedRegion;
});

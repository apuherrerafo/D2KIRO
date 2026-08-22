import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { draftFeedback } from "./schema";

// TSK-050: prueba dedicada de la migración -- insert + select parametrizado vía Drizzle,
// incluidas las dos columnas JSON con objetos anidados reales (no strings planos), para
// confirmar que el esquema round-tripea antes de que TSK-051 construya endpoints sobre él.
function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE draft_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      comment TEXT NOT NULL,
      draft_state TEXT NOT NULL,
      suggestions TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return drizzle(sqlite, { schema: { draftFeedback } });
}

test("insert + select de draft_feedback round-tripea las columnas JSON como objetos reales", () => {
  const db = createTestDb();
  const draftStateSnapshot = { sessionId: "s1", localSide: "radiant", picks: { radiant: [67], dire: [] } };
  const suggestionsSnapshot = { suggestions: [{ hero: 5, rank: 1 }], comparison: null };

  db.insert(draftFeedback)
    .values({
      sessionId: "s1",
      comment: "la sugerencia 1 no tiene sentido",
      draftState: draftStateSnapshot,
      suggestions: suggestionsSnapshot,
      createdAt: "2026-08-21T15:00:00Z",
    })
    .run();

  const rows = db.select().from(draftFeedback).all();

  expect(rows).toHaveLength(1);
  expect(rows[0]!.sessionId).toBe("s1");
  expect(rows[0]!.comment).toBe("la sugerencia 1 no tiene sentido");
  expect(rows[0]!.draftState).toEqual(draftStateSnapshot);
  expect(rows[0]!.suggestions).toEqual(suggestionsSnapshot);
});

test("suggestions acepta null cuando el reporte se manda antes de que llegara ninguna sugerencia", () => {
  const db = createTestDb();

  db.insert(draftFeedback)
    .values({
      sessionId: "s1",
      comment: "todavía no cargó nada",
      draftState: { picks: { radiant: [], dire: [] } },
      suggestions: null,
      createdAt: "2026-08-21T15:00:00Z",
    })
    .run();

  const rows = db.select().from(draftFeedback).all();

  expect(rows[0]!.suggestions).toBeNull();
});

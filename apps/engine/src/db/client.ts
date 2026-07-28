import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

export const DB_PATH = process.env.ENGINE_DB_PATH ?? "./data/dota2coach.sqlite";

// bun:sqlite crea el archivo con { create: true } pero no el directorio contenedor -- en un
// checkout limpio `data/` no existe (está en .gitignore desde TSK-002), así que el servidor
// nunca arrancaba. Necesario para que TSK-010 (servidor real) funcione fuera de esta máquina.
mkdirSync(dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL;");

export const db = drizzle(sqlite, { schema });

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

const DB_PATH = process.env.ENGINE_DB_PATH ?? "./data/dota2coach.sqlite";

const sqlite = new Database(DB_PATH, { create: true });
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: "./src/db/migrations" });

console.log(`Migraciones aplicadas sobre ${DB_PATH}`);

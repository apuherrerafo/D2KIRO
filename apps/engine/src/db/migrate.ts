import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db, DB_PATH } from "./client";

// Reutiliza la misma conexión que index.ts (db/client.ts) -- antes este archivo construía su
// propia Database() por separado, sin el mkdirSync del directorio contenedor (fix de TSK-010),
// así que `bun run db:migrate` en un checkout limpio fallaba con SQLITE_CANTOPEN (encontrado
// durante el smoke test de TSK-014, mismo bug, archivo distinto).
migrate(db, { migrationsFolder: "./src/db/migrations" });

console.log(`Migraciones aplicadas sobre ${DB_PATH}`);

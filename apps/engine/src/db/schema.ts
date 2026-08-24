import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

export const heroes = sqliteTable("heroes", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  localizedName: text("localized_name").notNull(),
  imgUrl: text("img_url").notNull(),
  primaryAttr: text("primary_attr").notNull(),
  attackType: text("attack_type").notNull(),
  roles: text("roles", { mode: "json" }).$type<string[]>().notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const heroPatchStats = sqliteTable(
  "hero_patch_stats",
  {
    heroId: integer("hero_id")
      .notNull()
      .references(() => heroes.id),
    patch: text("patch").notNull(),
    bracket: text("bracket").notNull(),
    picks: integer("picks").notNull(),
    wins: integer("wins").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.heroId, table.patch, table.bracket] })],
);

export const heroMatchups = sqliteTable(
  "hero_matchups",
  {
    heroId: integer("hero_id")
      .notNull()
      .references(() => heroes.id),
    vsHeroId: integer("vs_hero_id")
      .notNull()
      .references(() => heroes.id),
    games: integer("games").notNull(),
    wins: integer("wins").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.heroId, table.vsHeroId] })],
);

export const metaSync = sqliteTable("meta_sync", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull().$type<"running" | "ok" | "failed">(),
  rowsWritten: integer("rows_written").notNull().default(0),
  error: text("error"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Fase 5 (TSK-094, SPEC.md §12.7): primera cuenta real del proyecto. Steam32 como PK, sin id
// sustituto. `personal_baseline_winrate` migra acá desde `settings` (migración 0005) -- nace
// `null` porque esa clave nunca se escribió realmente (hallazgo real de /blueprint, §12.15-E).
export const accounts = sqliteTable("accounts", {
  steamAccountId: integer("steam_account_id").primaryKey(),
  personalBaselineWinrate: real("personal_baseline_winrate"),
  createdAt: text("created_at").notNull(),
});

// Fase 1b (TSK-017, SPEC.md §9.4): hasta 5 héroes de comodidad del usuario local. `steam_account_id`
// y `personal_baseline_winrate` vivían como filas de `settings` -- migradas a `accounts` en Fase 5
// (migración 0005). `hero_pool` en sí sigue con PK simple hasta TSK-095 (migración 0006).
export const heroPool = sqliteTable("hero_pool", {
  heroId: integer("hero_id")
    .primaryKey()
    .references(() => heroes.id),
  source: text("source").notNull().$type<"manual" | "calculated">(),
  personalWinrate: real("personal_winrate"),
  personalGames: integer("personal_games").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const teamGroups = sqliteTable("team_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  partySize: integer("party_size").notNull().$type<1 | 2 | 3 | 5>(),
  updatedAt: text("updated_at").notNull(),
});

export const teamMembers = sqliteTable("team_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamGroupId: integer("team_group_id")
    .notNull()
    .references(() => teamGroups.id),
  slot: integer("slot").notNull(),
  name: text("name").notNull(),
  heroPool: text("hero_pool", { mode: "json" }).$type<number[]>().notNull(),
  updatedAt: text("updated_at").notNull(),
});

// TSK-050: inbox append-only de reportes de QA manual -- `draftState`/`suggestions` quedan sin
// `$type<...>()` a propósito, ese contrato vive en apps/web y cambia con cada fase; tipar acá
// acoplaría el motor a mantenerlo sincronizado sin necesidad real.
export const draftFeedback = sqliteTable("draft_feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  comment: text("comment").notNull(),
  draftState: text("draft_state", { mode: "json" }).notNull(),
  suggestions: text("suggestions", { mode: "json" }),
  createdAt: text("created_at").notNull(),
});

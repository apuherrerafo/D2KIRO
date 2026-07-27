import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

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

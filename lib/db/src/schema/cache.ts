import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Shared radar cache — one entry per date + leagues combination.
 * All users hitting the same leagues on the same day get the same result
 * without an extra Gemini call.
 */
export const radarCacheTable = pgTable("radar_cache", {
  id: serial("id").primaryKey(),
  /** YYYY-MM-DD in UTC */
  date: text("date").notNull(),
  /**
   * Canonical key built from the sorted, lowercased league list joined with "|".
   * Empty string means "default leagues".
   */
  leaguesKey: text("leagues_key").notNull(),
  /** Full JSON result as stored string */
  result: text("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RadarCache = typeof radarCacheTable.$inferSelect;

/**
 * Shared analysis cache — one entry per match (homeTeam + awayTeam + league) per date.
 * All users requesting the same match analysis on the same day share the result.
 */
export const analysisCacheTable = pgTable("analysis_cache", {
  id: serial("id").primaryKey(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  league: text("league").notNull(),
  /** YYYY-MM-DD in UTC — the day the analysis was generated */
  date: text("date").notNull(),
  /** Full JSON result as stored string */
  result: text("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AnalysisCache = typeof analysisCacheTable.$inferSelect;

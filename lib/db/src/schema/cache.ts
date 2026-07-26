import { pgTable, serial, text, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Shared radar cache — one entry for all leagues per day (key = "af_all").
 * Stores the full fixture list; subsequent users read from DB for free.
 */
export const radarCacheTable = pgTable(
  "radar_cache",
  {
    id: serial("id").primaryKey(),
    /** YYYY-MM-DD in UTC */
    date: text("date").notNull(),
    /**
     * Cache key — "af_all" for the full-day fixture dump.
     * One row per key per day.
     */
    league: text("league").notNull(),
    /** JSON array of ApiFootballMatch[] */
    result: text("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("radar_cache_date_league_idx").on(t.date, t.league)],
);

export type RadarCache = typeof radarCacheTable.$inferSelect;

/**
 * Shared analysis cache — one entry per match per date.
 * All users requesting the same match analysis on the same day share the result.
 */
export const analysisCacheTable = pgTable(
  "analysis_cache",
  {
    id: serial("id").primaryKey(),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    league: text("league").notNull(),
    /** YYYY-MM-DD in UTC */
    date: text("date").notNull(),
    /** Full JSON result */
    result: text("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("analysis_cache_match_date_idx").on(
      t.date,
      t.homeTeam,
      t.awayTeam,
      t.league,
    ),
  ],
);

export type AnalysisCache = typeof analysisCacheTable.$inferSelect;

/**
 * Daily odds cache — one entry per sport key per day.
 * Shared across all users to preserve the 500 req/month quota.
 */
export const oddsCacheTable = pgTable(
  "odds_cache",
  {
    id: serial("id").primaryKey(),
    /** YYYY-MM-DD in UTC */
    date: text("date").notNull(),
    /** The Odds API sport key (e.g. "soccer_epl") */
    sportKey: text("sport_key").notNull(),
    /** Full JSON array of OddsEvent objects */
    result: text("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("odds_cache_date_sport_key_idx").on(t.date, t.sportKey)],
);

export type OddsCache = typeof oddsCacheTable.$inferSelect;

/**
 * Team statistics cache — one entry per team+league per day.
 * Covers form, goals, clean sheets, cards from /teams/statistics.
 * Expensive (1 API call per team), so cached hard for the full day.
 */
export const teamStatsCacheTable = pgTable(
  "team_stats_cache",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id").notNull(),
    leagueId: integer("league_id").notNull(),
    /** YYYY-MM-DD in UTC */
    date: text("date").notNull(),
    /** JSON TeamStats object */
    result: text("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("team_stats_cache_team_league_date_idx").on(
      t.teamId,
      t.leagueId,
      t.date,
    ),
  ],
);

export type TeamStatsCache = typeof teamStatsCacheTable.$inferSelect;

/**
 * Injuries cache — one entry per fixture per day.
 * Covers confirmed absences and suspensions from /injuries.
 */
export const injuriesCacheTable = pgTable(
  "injuries_cache",
  {
    id: serial("id").primaryKey(),
    fixtureId: integer("fixture_id").notNull(),
    /** YYYY-MM-DD in UTC */
    date: text("date").notNull(),
    /** JSON InjuryRecord[] */
    result: text("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("injuries_cache_fixture_date_idx").on(t.fixtureId, t.date),
  ],
);

export type InjuriesCache = typeof injuriesCacheTable.$inferSelect;

/**
 * Head-to-head cache — one entry per team pair per day.
 * Stores the last 5 direct encounters from /fixtures/headtohead.
 */
export const h2hCacheTable = pgTable(
  "h2h_cache",
  {
    id: serial("id").primaryKey(),
    homeTeamId: integer("home_team_id").notNull(),
    awayTeamId: integer("away_team_id").notNull(),
    /** YYYY-MM-DD in UTC */
    date: text("date").notNull(),
    /** JSON H2HRecord[] */
    result: text("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("h2h_cache_teams_date_idx").on(
      t.homeTeamId,
      t.awayTeamId,
      t.date,
    ),
  ],
);

export type H2HCache = typeof h2hCacheTable.$inferSelect;

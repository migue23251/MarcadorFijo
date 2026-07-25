import { logger } from "./logger";
import { db, radarCacheTable, analysisCacheTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const API_FOOTBALL_BASE = "https://api-football-v1.p.rapidapi.com/v3";

// ---------------------------------------------------------------------------
// League configuration
// ---------------------------------------------------------------------------

interface LeagueConfig {
  id: number;
  /** "european" = season starts in July/Aug (e.g. 2025 means 2025/26).
   *  "calendar" = season matches the calendar year (e.g. MLS 2026). */
  season: "european" | "calendar";
}

const LEAGUE_CONFIG: Record<string, LeagueConfig> = {
  "Premier League":    { id: 39,  season: "european" },
  "La Liga":           { id: 140, season: "european" },
  "Serie A":           { id: 135, season: "european" },
  "Bundesliga":        { id: 78,  season: "european" },
  "Ligue 1":           { id: 61,  season: "european" },
  "Champions League":  { id: 2,   season: "european" },
  "Europa League":     { id: 3,   season: "european" },
  "Conference League": { id: 848, season: "european" },
  "Eredivisie":        { id: 88,  season: "european" },
  "Primeira Liga":     { id: 94,  season: "european" },
  "Süper Lig":         { id: 203, season: "european" },
  "MLS":               { id: 253, season: "calendar" },
  "Liga MX":           { id: 262, season: "calendar" },
  "Liga BetPlay":      { id: 239, season: "calendar" },
  "Liga Profesional":  { id: 128, season: "calendar" },
  "Brasileirão":       { id: 71,  season: "calendar" },
  "LigaPro Ecuador":   { id: 334, season: "calendar" },
};

export const DEFAULT_LEAGUES = Object.keys(LEAGUE_CONFIG);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiFootballMatch {
  id: string;
  apiFootballId: number;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  stadium: string | null;
  /** "scheduled" | "live" | "halftime" | "finished" | "postponed" */
  status: string;
  score: { home: number | null; away: number | null } | null;
  hasAnalysis: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSeasonYear(seasonType: "european" | "calendar"): number {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1–12

  if (seasonType === "calendar") return year;
  // European seasons start Jul/Aug — before July the ongoing season started last year
  return month >= 7 ? year : year - 1;
}

function mapStatus(short: string): string {
  switch (short) {
    case "NS":   return "scheduled";
    case "1H":
    case "2H":
    case "ET":
    case "BT":
    case "P":
    case "LIVE": return "live";
    case "HT":   return "halftime";
    case "FT":
    case "AET":
    case "PEN":  return "finished";
    default:     return "postponed";
  }
}

function parseFixture(
  fixture: any,
  leagueName: string,
): Omit<ApiFootballMatch, "hasAnalysis"> {
  const f = fixture.fixture;
  const teams = fixture.teams;
  const goals = fixture.goals;
  const statusShort: string = f?.status?.short ?? "NS";
  const status = mapStatus(statusShort);

  const hasScore = goals?.home !== null || goals?.away !== null;

  return {
    id: `af-${f.id}`,
    apiFootballId: f.id as number,
    league: leagueName,
    homeTeam: teams.home.name as string,
    awayTeam: teams.away.name as string,
    kickoffTime: f.date as string,
    stadium: (f.venue?.name as string) ?? null,
    status,
    score: hasScore
      ? { home: goals.home as number | null, away: goals.away as number | null }
      : null,
  };
}

async function fetchFixtures(
  leagueId: number,
  season: number,
  date: string,
): Promise<any[]> {
  const apiKey = process.env["RAPIDAPI_KEY"];
  if (!apiKey) throw new Error("RAPIDAPI_KEY is not configured");

  const url = new URL(`${API_FOOTBALL_BASE}/fixtures`);
  url.searchParams.set("date", date);
  url.searchParams.set("league", String(leagueId));
  url.searchParams.set("season", String(season));

  const response = await fetch(url.toString(), {
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`API-Football ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as any;
  return (data?.response as any[]) ?? [];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fetch today's fixtures from API-Football, one league at a time.
 * Results are cached in radar_cache (key: "af_<leagueId>") per day.
 * Leagues with live matches are NOT cached so they refresh on the next call.
 */
export async function getMatchesFromApiFootball(
  leagues?: string[],
): Promise<{ league: string; matches: ApiFootballMatch[] }[]> {
  const date = new Date().toISOString().split("T")[0];
  const requestedLeagues =
    leagues && leagues.length > 0 ? leagues : DEFAULT_LEAGUES;

  const results = new Map<string, ApiFootballMatch[]>();

  for (const leagueName of requestedLeagues) {
    const config = LEAGUE_CONFIG[leagueName];
    if (!config) continue;

    const cacheKey = `af_${config.id}`;

    // 1. Try cache
    const cached = await db
      .select()
      .from(radarCacheTable)
      .where(
        and(
          eq(radarCacheTable.date, date),
          eq(radarCacheTable.league, cacheKey),
        ),
      )
      .limit(1);

    if (cached.length > 0) {
      logger.info({ leagueName }, "Radar cache hit (API-Football)");
      results.set(leagueName, JSON.parse(cached[0].result) as ApiFootballMatch[]);
      continue;
    }

    // 2. Fetch from API-Football
    try {
      const season = getSeasonYear(config.season);
      const fixtures = await fetchFixtures(config.id, season, date);
      const matches: ApiFootballMatch[] = fixtures.map((f) => ({
        ...parseFixture(f, leagueName),
        hasAnalysis: false,
      }));

      results.set(leagueName, matches);

      // 3. Only cache if no match is currently live (live data changes every minute)
      const hasLive = matches.some(
        (m) => m.status === "live" || m.status === "halftime",
      );
      if (!hasLive) {
        await db
          .insert(radarCacheTable)
          .values({ date, league: cacheKey, result: JSON.stringify(matches) })
          .catch((err) =>
            logger.warn({ err, leagueName }, "Failed to cache API-Football result"),
          );
      }

      logger.info(
        { leagueName, count: matches.length, season, hasLive },
        "API-Football fixtures fetched",
      );
    } catch (err) {
      logger.error({ err, leagueName }, "API-Football fetch failed");
      results.set(leagueName, []);
    }
  }

  // 4. Enrich with hasAnalysis from analysis_cache
  const allMatches = Array.from(results.values()).flat();
  if (allMatches.length > 0) {
    try {
      const analysedToday = await db
        .select({
          homeTeam: analysisCacheTable.homeTeam,
          awayTeam: analysisCacheTable.awayTeam,
          league: analysisCacheTable.league,
        })
        .from(analysisCacheTable)
        .where(eq(analysisCacheTable.date, date));

      const analysedSet = new Set(
        analysedToday.map(
          (r) =>
            `${r.homeTeam.toLowerCase()}|${r.awayTeam.toLowerCase()}|${r.league.toLowerCase()}`,
        ),
      );

      for (const matches of results.values()) {
        for (const m of matches) {
          const key = `${m.homeTeam.toLowerCase()}|${m.awayTeam.toLowerCase()}|${m.league.toLowerCase()}`;
          m.hasAnalysis = analysedSet.has(key);
        }
      }
    } catch (err) {
      logger.warn({ err }, "Failed to enrich matches with hasAnalysis flag");
    }
  }

  // 5. Return only leagues with matches, preserving request order
  return requestedLeagues
    .filter((l) => (results.get(l) ?? []).length > 0)
    .map((league) => ({ league, matches: results.get(league)! }));
}

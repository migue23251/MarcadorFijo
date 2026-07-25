import { logger } from "./logger";
import { db, radarCacheTable, analysisCacheTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const API_FOOTBALL_BASE = "https://api-football-v1.p.rapidapi.com/v3";

/** Cache key used for the full-day fixture dump (single API call). */
const ALL_FIXTURES_CACHE_KEY = "af_all";

// ---------------------------------------------------------------------------
// League configuration — maps our display names to API-Football league IDs
// ---------------------------------------------------------------------------

const LEAGUE_ID_BY_NAME: Record<string, number> = {
  "Premier League":    39,
  "La Liga":           140,
  "Serie A":           135,
  "Bundesliga":        78,
  "Ligue 1":           61,
  "Champions League":  2,
  "Europa League":     3,
  "Conference League": 848,
  "Eredivisie":        88,
  "Primeira Liga":     94,
  "Süper Lig":         203,
  "MLS":               253,
  "Liga MX":           262,
  "Liga BetPlay":      239,
  "Liga Profesional":  128,
  "Brasileirão":       71,
  "LigaPro Ecuador":   334,
};

/** Reverse map: API-Football league ID → our display name */
const LEAGUE_NAME_BY_ID: Record<number, string> = Object.fromEntries(
  Object.entries(LEAGUE_ID_BY_NAME).map(([name, id]) => [id, name]),
);

export const DEFAULT_LEAGUES = Object.keys(LEAGUE_ID_BY_NAME);

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

/**
 * Fetch ALL fixtures for a given date in one API call.
 * Free tier allows 10 req/min and 100 req/day — one call covers every league.
 */
async function fetchAllFixturesForDate(date: string): Promise<any[]> {
  const apiKey = process.env["RAPIDAPI_KEY"];
  if (!apiKey) throw new Error("RAPIDAPI_KEY is not configured");

  const url = new URL(`${API_FOOTBALL_BASE}/fixtures`);
  url.searchParams.set("date", date);

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
 * Fetch today's fixtures from API-Football using ONE API call for all leagues.
 * The full day's fixture list is cached in radar_cache under ALL_FIXTURES_CACHE_KEY.
 * Live matches bypass the cache so scores stay fresh.
 */
export async function getMatchesFromApiFootball(
  leagues?: string[],
): Promise<{ league: string; matches: ApiFootballMatch[] }[]> {
  const date = new Date().toISOString().split("T")[0];
  const wantedLeagueIds = new Set(
    (leagues && leagues.length > 0
      ? leagues
      : Object.keys(LEAGUE_ID_BY_NAME)
    ).map((name) => LEAGUE_ID_BY_NAME[name]).filter(Boolean),
  );

  // 1. Try cache (single row covers all leagues for today)
  const cached = await db
    .select()
    .from(radarCacheTable)
    .where(
      and(
        eq(radarCacheTable.date, date),
        eq(radarCacheTable.league, ALL_FIXTURES_CACHE_KEY),
      ),
    )
    .limit(1);

  let allFixtures: ApiFootballMatch[];

  if (cached.length > 0) {
    logger.info({ date }, "Radar cache hit (API-Football all-fixtures)");
    allFixtures = JSON.parse(cached[0].result) as ApiFootballMatch[];
  } else {
    // 2. One API call — all leagues for today
    try {
      const raw = await fetchAllFixturesForDate(date);
      allFixtures = raw
        .filter((f) => {
          const leagueId: number = f?.league?.id;
          return leagueId && LEAGUE_NAME_BY_ID[leagueId] !== undefined;
        })
        .map((f) => {
          const leagueName = LEAGUE_NAME_BY_ID[f.league.id as number];
          return { ...parseFixture(f, leagueName), hasAnalysis: false };
        });

      logger.info({ date, total: allFixtures.length }, "API-Football all-fixtures fetched");

      // 3. Cache only if no live matches (live scores change every minute)
      const hasLive = allFixtures.some(
        (m) => m.status === "live" || m.status === "halftime",
      );
      if (!hasLive) {
        await db
          .insert(radarCacheTable)
          .values({
            date,
            league: ALL_FIXTURES_CACHE_KEY,
            result: JSON.stringify(allFixtures),
          })
          .catch((err) =>
            logger.warn({ err }, "Failed to cache all-fixtures result"),
          );
      }
    } catch (err) {
      logger.error({ err }, "API-Football all-fixtures fetch failed");
      throw err; // propagate so the route returns a 502
    }
  }

  // 4. Filter to the leagues the caller requested
  const filtered = allFixtures.filter((m) => {
    const id = LEAGUE_ID_BY_NAME[m.league];
    return id !== undefined && wantedLeagueIds.has(id);
  });

  // 5. Enrich with hasAnalysis from analysis_cache
  if (filtered.length > 0) {
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

      for (const m of filtered) {
        const key = `${m.homeTeam.toLowerCase()}|${m.awayTeam.toLowerCase()}|${m.league.toLowerCase()}`;
        m.hasAnalysis = analysedSet.has(key);
      }
    } catch (err) {
      logger.warn({ err }, "Failed to enrich matches with hasAnalysis flag");
    }
  }

  // 6. Group by league, preserving the order of LEAGUE_ID_BY_NAME
  const byLeague = new Map<string, ApiFootballMatch[]>();
  for (const m of filtered) {
    const arr = byLeague.get(m.league) ?? [];
    arr.push(m);
    byLeague.set(m.league, arr);
  }

  return Object.keys(LEAGUE_ID_BY_NAME)
    .filter((name) => byLeague.has(name) && wantedLeagueIds.has(LEAGUE_ID_BY_NAME[name]))
    .map((league) => ({ league, matches: byLeague.get(league)! }));
}

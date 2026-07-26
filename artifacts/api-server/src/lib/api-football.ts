import { logger } from "./logger";
import { db, radarCacheTable, analysisCacheTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

/** How long (ms) to keep a cached result that contained live matches before refreshing. */
const LIVE_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

// Direct API-Sports endpoint — supports both x-apisports-key and x-rapidapi-* headers.
// No trailing slash; append paths directly (e.g. `${API_FOOTBALL_BASE}/fixtures`).
const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const API_FOOTBALL_HOST = "v3.football.api-sports.io";

/** Cache key used for the full-day fixture dump (single API call). */
const ALL_FIXTURES_CACHE_KEY = "af_all";

// ---------------------------------------------------------------------------
// League configuration — maps our display names to API-Football league IDs
// ---------------------------------------------------------------------------

const LEAGUE_ID_BY_NAME: Record<string, number> = {
  "Premier League": 39,
  "La Liga": 140,
  "Serie A": 135,
  Bundesliga: 78,
  "Ligue 1": 61,
  "Champions League": 2,
  "Europa League": 3,
  "Conference League": 848,
  Eredivisie: 88,
  "Primeira Liga": 94,
  "Süper Lig": 203,
  MLS: 253,
  "Liga MX": 262,
  "Liga BetPlay": 239,
  "Liga Profesional": 128,
  Brasileirão: 71,
  "LigaPro Ecuador": 334,
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
    // Not started
    case "NS":
    case "TBD": // Time To Be Defined — date set but kickoff time not yet confirmed
      return "scheduled";
    // In play
    case "1H":
    case "2H":
    case "ET":  // Extra Time
    case "BT":  // Break Time (between ET halves)
    case "P":   // Penalty shootout
    case "LIVE":
      return "live";
    // Halftime
    case "HT":
      return "halftime";
    // Finished
    case "FT":
    case "AET": // After Extra Time
    case "PEN": // After Penalties
    case "AWD": // Technical Loss (result awarded)
    case "WO":  // WalkOver
      return "finished";
    // Cancelled / abandoned — show separately from postponed
    case "CANC":
    case "ABD": // Abandoned mid-match
      return "cancelled";
    // Postponed / interrupted
    case "PST":  // Postponed
    case "SUSP": // Suspended (will resume)
    case "INT":  // Interrupted (temporarily stopped)
      return "postponed";
    default:
      return "postponed";
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
 * Fetch ALL fixtures for a given date in a single API call.
 * The /fixtures?date= endpoint returns the full day's results without pagination
 * (unlike /players or /odds which paginate). Do NOT send a `page` param here.
 * Passes timezone=UTC so date filtering is unambiguous.
 */
async function fetchAllFixturesForDate(date: string): Promise<any[]> {
  const apiKey = process.env["RAPIDAPI_KEY"];
  if (!apiKey) throw new Error("RAPIDAPI_KEY is not configured");

  const url = new URL(`${API_FOOTBALL_BASE}/fixtures`);
  url.searchParams.set("date", date);
  url.searchParams.set("timezone", "UTC");

  const response = await fetch(url.toString(), {
    headers: {
      // x-rapidapi-key is the auth token; x-rapidapi-host must match the actual
      // API-Sports endpoint (v3.football.api-sports.io), NOT the RapidAPI proxy host.
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": API_FOOTBALL_HOST,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`API-Football HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = (await response.json()) as any;

  // API returns HTTP 200 with errors in the body — always check
  const bodyErrors = data?.errors;
  if (bodyErrors && (Array.isArray(bodyErrors) ? bodyErrors.length > 0 : Object.keys(bodyErrors).length > 0)) {
    const msg = Array.isArray(bodyErrors) ? bodyErrors.join("; ") : JSON.stringify(bodyErrors);
    throw new Error(`API-Football error: ${msg}`);
  }

  return (data?.response as any[]) ?? [];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fetch today's fixtures from API-Football using ONE API call for all leagues.
 *
 * Cache strategy (radar_cache, key = ALL_FIXTURES_CACHE_KEY):
 *  - If a valid cache entry exists → return from DB, no API call.
 *  - A cache entry is valid when:
 *      · it contained NO live matches → valid for the rest of the calendar day (UTC).
 *      · it contained live matches   → valid for LIVE_CACHE_TTL_MS (2 min), then refresh.
 *  - After every API fetch the cache is upserted (delete + insert) so createdAt is fresh.
 *  - This ensures the first user to open the radar each day pays the one API request;
 *    every subsequent user reads from the DB for free.
 */
export async function getMatchesFromApiFootball(
  leagues?: string[],
): Promise<{ league: string; matches: ApiFootballMatch[] }[]> {
  const date = new Date().toISOString().split("T")[0];
  const wantedLeagueIds = new Set(
    (leagues && leagues.length > 0 ? leagues : Object.keys(LEAGUE_ID_BY_NAME))
      .map((name) => LEAGUE_ID_BY_NAME[name])
      .filter(Boolean),
  );

  // 1. Check for a cache entry for today
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

  let allFixtures: ApiFootballMatch[] | null = null;

  if (cached.length > 0) {
    const cachedFixtures = JSON.parse(cached[0].result) as ApiFootballMatch[];
    const hadLive = cachedFixtures.some(
      (m) => m.status === "live" || m.status === "halftime",
    );
    const ageMs = Date.now() - new Date(cached[0].createdAt).getTime();
    const isValid = !hadLive || ageMs < LIVE_CACHE_TTL_MS;

    if (isValid) {
      logger.info({ date, hadLive, ageMs }, "Radar cache hit — serving from DB");
      allFixtures = cachedFixtures;
    } else {
      logger.info({ date, ageMs }, "Radar cache stale (live TTL expired) — refreshing");
    }
  }

  if (allFixtures === null) {
    // 2. Fetch from API (one request covers all leagues for the day)
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

      const hasLive = allFixtures.some(
        (m) => m.status === "live" || m.status === "halftime",
      );
      logger.info(
        { date, total: allFixtures.length, hasLive },
        "API-Football fixtures fetched — caching in DB",
      );

      // 3. Upsert cache: delete any stale row, then insert fresh one
      //    Always cache — even with live matches — so subsequent users hit the DB.
      //    The TTL logic above handles freshness for live data.
      await db
        .delete(radarCacheTable)
        .where(
          and(
            eq(radarCacheTable.date, date),
            eq(radarCacheTable.league, ALL_FIXTURES_CACHE_KEY),
          ),
        )
        .catch((err) => logger.warn({ err }, "Failed to clear stale cache row"));

      await db
        .insert(radarCacheTable)
        .values({
          date,
          league: ALL_FIXTURES_CACHE_KEY,
          result: JSON.stringify(allFixtures),
        })
        .catch((err) => logger.warn({ err }, "Failed to write cache row"));
    } catch (err) {
      logger.error({ err }, "API-Football fetch failed");
      throw err;
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
    .filter(
      (name) =>
        byLeague.has(name) && wantedLeagueIds.has(LEAGUE_ID_BY_NAME[name]),
    )
    .map((league) => ({ league, matches: byLeague.get(league)! }));
}

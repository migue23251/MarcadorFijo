import { logger } from "./logger";
import { fetchConRotacion } from "./fetchConRotacion";
import { getTodayColombia, COLOMBIA_TZ } from "./timezone";
import {
  db,
  radarCacheTable,
  analysisCacheTable,
  teamStatsCacheTable,
  injuriesCacheTable,
  h2hCacheTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

/** How long (ms) to keep a cached result that contained live matches before refreshing. */
const LIVE_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const API_FOOTBALL_HOST = "v3.football.api-sports.io";

/** Cache key used for the full-day fixture dump (single API call). */
const ALL_FIXTURES_CACHE_KEY = "af_all";

// ---------------------------------------------------------------------------
// League configuration
// ---------------------------------------------------------------------------

const LEAGUE_ID_BY_NAME: Record<string, number> = {
  "Premier League": 39,
  "La Liga": 140,
  "Serie A": 135,
  Bundesliga: 78,
  "Ligue 1": 61,
  Eredivisie: 88,
  "Primeira Liga": 94,
  "Süper Lig": 203,
  MLS: 253,
  "Liga MX": 262,
  "Liga BetPlay": 239,
  "Liga Profesional": 128,
  Brasileirão: 71,
  "LigaPro Ecuador": 334,
  "FA Cup": 45,
  "Copa del Rey": 143,
  "Coppa Italia": 137,
  "DFB-Pokal": 529,
  "Coupe de France": 66,
  "KNVB Beker": 210,
  "Copa do Brasil": 73,
  "Copa Argentina": 130,
  "Copa BetPlay": 240,
  "Champions League": 2,
  "Europa League": 3,
  "Conference League": 848,
  "Copa Libertadores": 13,
  "Copa Sudamericana": 11,
  "Copa Mundial FIFA": 1,
};

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
  homeTeamId: number;
  awayTeamId: number;
  leagueId: number;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  stadium: string | null;
  status: string;
  score: { home: number | null; away: number | null } | null;
  hasAnalysis: boolean;
}

export interface TeamStats {
  teamName: string;
  season: number;
  form: string;
  played: { home: number; away: number; total: number };
  wins: { home: number; away: number; total: number };
  draws: { home: number; away: number; total: number };
  losses: { home: number; away: number; total: number };
  /** Average goals per game */
  goalsFor: { home: string; away: string; total: string };
  goalsAgainst: { home: string; away: string; total: string };
  cleanSheets: { home: number; away: number; total: number };
  failedToScore: { home: number; away: number; total: number };
  yellowCards: number;
  redCards: number;
}

export interface InjuryRecord {
  player: string;
  team: string;
  type: string;
  reason: string;
}

export interface H2HRecord {
  date: string;
  homeTeam: string;
  awayTeam: string;
  scoreHome: number | null;
  scoreAway: number | null;
  winner: "home" | "away" | "draw";
}

export interface MatchEnrichment {
  homeStats: TeamStats | null;
  awayStats: TeamStats | null;
  injuries: InjuryRecord[] | null;
  h2h: H2HRecord[] | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapStatus(short: string): string {
  switch (short) {
    case "NS":
    case "TBD":
      return "scheduled";
    case "1H":
    case "2H":
    case "ET":
    case "BT":
    case "P":
    case "LIVE":
      return "live";
    case "HT":
      return "halftime";
    case "FT":
    case "AET":
    case "PEN":
    case "AWD":
    case "WO":
      return "finished";
    case "CANC":
    case "ABD":
      return "cancelled";
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
    homeTeamId: teams.home.id as number,
    awayTeamId: teams.away.id as number,
    leagueId: fixture.league.id as number,
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
 * Returns the most recent completed football season year.
 * European leagues start July/August; before August use year-1.
 */
function getRecentSeason(): number {
  const d = new Date();
  return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
}

/**
 * Resuelve las keys de API-Football en orden de prioridad:
 * 1. API_FOOTBALL_KEY_1 (nueva primaria)
 * 2. API_FOOTBALL_KEY_2 (nueva secundaria / failover)
 * 3. FOOTBALL_API_KEY   (nombre anterior — compatibilidad hacia atrás)
 */
function getApiFootballKeys(): string[] {
  return [
    process.env["API_FOOTBALL_KEY_1"],
    process.env["API_FOOTBALL_KEY_2"],
    process.env["FOOTBALL_API_KEY"],
  ].filter((k): k is string => Boolean(k));
}

async function apiFetch(path: string, params: Record<string, string | number>): Promise<any> {
  const url = new URL(`${API_FOOTBALL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const keys = getApiFootballKeys();
  if (keys.length === 0) {
    throw new Error("No API-Football keys configuradas (API_FOOTBALL_KEY_1 / FOOTBALL_API_KEY)");
  }

  // fetchConRotacion maneja 429 y rate-limit en body; devuelve el JSON completo
  const data = await fetchConRotacion(url, keys, {
    type: "header",
    name: "x-rapidapi-key",
    extraHeaders: { "x-rapidapi-host": API_FOOTBALL_HOST },
  });

  // Errores de API-Football que NO son rate-limit (fetchConRotacion ya rotuló los de rate-limit)
  const bodyErrors = data?.errors;
  if (bodyErrors && (Array.isArray(bodyErrors) ? bodyErrors.length > 0 : Object.keys(bodyErrors).length > 0)) {
    const msg = Array.isArray(bodyErrors) ? bodyErrors.join("; ") : JSON.stringify(bodyErrors);
    throw new Error(`API-Football error: ${msg}`);
  }

  return data?.response;
}

// ---------------------------------------------------------------------------
// Team statistics — /teams/statistics
// ---------------------------------------------------------------------------

async function fetchTeamStats(
  teamId: number,
  leagueId: number,
  date: string,
): Promise<TeamStats | null> {
  // Cache check
  const cached = await db
    .select()
    .from(teamStatsCacheTable)
    .where(
      and(
        eq(teamStatsCacheTable.teamId, teamId),
        eq(teamStatsCacheTable.leagueId, leagueId),
        eq(teamStatsCacheTable.date, date),
      ),
    )
    .limit(1);

  if (cached.length > 0) {
    logger.info({ teamId, leagueId, date }, "Team stats served from cache");
    return JSON.parse(cached[0].result) as TeamStats;
  }

  const season = getRecentSeason();
  logger.info({ teamId, leagueId, season }, "Fetching team stats from API-Football");

  let raw: any;
  try {
    raw = await apiFetch("/teams/statistics", { team: teamId, league: leagueId, season });
  } catch (err) {
    logger.warn({ err, teamId, leagueId }, "Failed to fetch team stats");
    return null;
  }

  if (!raw) return null;

  // Count total yellow/red cards across all minute buckets
  const yellowCards = Object.values(raw.cards?.yellow ?? {}).reduce(
    (acc: number, v: any) => acc + (v?.total ?? 0),
    0,
  ) as number;
  const redCards = Object.values(raw.cards?.red ?? {}).reduce(
    (acc: number, v: any) => acc + (v?.total ?? 0),
    0,
  ) as number;

  const stats: TeamStats = {
    teamName: raw.team?.name ?? "",
    season,
    form: (raw.form ?? "").slice(-10), // last 10 matches
    played: raw.fixtures?.played ?? { home: 0, away: 0, total: 0 },
    wins: raw.fixtures?.wins ?? { home: 0, away: 0, total: 0 },
    draws: raw.fixtures?.draws ?? { home: 0, away: 0, total: 0 },
    losses: raw.fixtures?.loses ?? { home: 0, away: 0, total: 0 },
    goalsFor: raw.goals?.for?.average ?? { home: "0", away: "0", total: "0" },
    goalsAgainst: raw.goals?.against?.average ?? { home: "0", away: "0", total: "0" },
    cleanSheets: raw.clean_sheet ?? { home: 0, away: 0, total: 0 },
    failedToScore: raw.failed_to_score ?? { home: 0, away: 0, total: 0 },
    yellowCards,
    redCards,
  };

  try {
    await db
      .insert(teamStatsCacheTable)
      .values({ teamId, leagueId, date, result: JSON.stringify(stats) })
      .onConflictDoNothing();
    logger.info({ teamId, leagueId, date }, "Team stats cached in DB");
  } catch (err) {
    logger.warn({ err }, "Failed to cache team stats");
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Injuries — /injuries
// ---------------------------------------------------------------------------

async function fetchInjuries(
  fixtureId: number,
  date: string,
): Promise<InjuryRecord[] | null> {
  const cached = await db
    .select()
    .from(injuriesCacheTable)
    .where(
      and(
        eq(injuriesCacheTable.fixtureId, fixtureId),
        eq(injuriesCacheTable.date, date),
      ),
    )
    .limit(1);

  if (cached.length > 0) {
    logger.info({ fixtureId, date }, "Injuries served from cache");
    return JSON.parse(cached[0].result) as InjuryRecord[];
  }

  logger.info({ fixtureId }, "Fetching injuries from API-Football");

  let raw: any[];
  try {
    raw = await apiFetch("/injuries", { fixture: fixtureId });
  } catch (err) {
    logger.warn({ err, fixtureId }, "Failed to fetch injuries");
    return null;
  }

  if (!Array.isArray(raw)) return null;

  const injuries: InjuryRecord[] = raw.map((item: any) => ({
    player: item.player?.name ?? "Desconocido",
    team: item.team?.name ?? "",
    type: item.player?.type ?? "Lesión",
    reason: item.player?.reason ?? "",
  }));

  try {
    await db
      .insert(injuriesCacheTable)
      .values({ fixtureId, date, result: JSON.stringify(injuries) })
      .onConflictDoNothing();
    logger.info({ fixtureId, count: injuries.length }, "Injuries cached in DB");
  } catch (err) {
    logger.warn({ err }, "Failed to cache injuries");
  }

  return injuries;
}

// ---------------------------------------------------------------------------
// Head-to-head — /fixtures/headtohead
// ---------------------------------------------------------------------------

async function fetchH2H(
  homeTeamId: number,
  awayTeamId: number,
  date: string,
): Promise<H2HRecord[] | null> {
  // Normalize key order so A-vs-B and B-vs-A share the same cache row
  const keyA = Math.min(homeTeamId, awayTeamId);
  const keyB = Math.max(homeTeamId, awayTeamId);

  const cached = await db
    .select()
    .from(h2hCacheTable)
    .where(
      and(
        eq(h2hCacheTable.homeTeamId, keyA),
        eq(h2hCacheTable.awayTeamId, keyB),
        eq(h2hCacheTable.date, date),
      ),
    )
    .limit(1);

  if (cached.length > 0) {
    logger.info({ homeTeamId, awayTeamId, date }, "H2H served from cache");
    return JSON.parse(cached[0].result) as H2HRecord[];
  }

  logger.info({ homeTeamId, awayTeamId }, "Fetching H2H from API-Football");

  let raw: any[];
  try {
    raw = await apiFetch("/fixtures/headtohead", {
      h2h: `${homeTeamId}-${awayTeamId}`,
      last: 5,
    });
  } catch (err) {
    logger.warn({ err, homeTeamId, awayTeamId }, "Failed to fetch H2H");
    return null;
  }

  if (!Array.isArray(raw)) return null;

  const h2h: H2HRecord[] = raw.slice(0, 5).map((f: any) => {
    const scoreHome = f.goals?.home ?? null;
    const scoreAway = f.goals?.away ?? null;
    let winner: "home" | "away" | "draw" = "draw";
    if (scoreHome !== null && scoreAway !== null) {
      if (scoreHome > scoreAway) winner = "home";
      else if (scoreAway > scoreHome) winner = "away";
    }
    return {
      date: (f.fixture?.date ?? "").split("T")[0],
      homeTeam: f.teams?.home?.name ?? "",
      awayTeam: f.teams?.away?.name ?? "",
      scoreHome,
      scoreAway,
      winner,
    };
  });

  try {
    await db
      .insert(h2hCacheTable)
      .values({ homeTeamId: keyA, awayTeamId: keyB, date, result: JSON.stringify(h2h) })
      .onConflictDoNothing();
    logger.info({ keyA, keyB, count: h2h.length }, "H2H cached in DB");
  } catch (err) {
    logger.warn({ err }, "Failed to cache H2H");
  }

  return h2h;
}

// ---------------------------------------------------------------------------
// Enrichment bundle — all extra data for a match, fetched in parallel
// ---------------------------------------------------------------------------

export async function enrichMatchForAnalysis(
  homeTeamId: number,
  awayTeamId: number,
  leagueId: number,
  fixtureId: number,
): Promise<MatchEnrichment> {
  const date = getTodayColombia();

  const [homeStats, awayStats, injuries, h2h] = await Promise.all([
    fetchTeamStats(homeTeamId, leagueId, date).catch(() => null),
    fetchTeamStats(awayTeamId, leagueId, date).catch(() => null),
    fetchInjuries(fixtureId, date).catch(() => null),
    fetchH2H(homeTeamId, awayTeamId, date).catch(() => null),
  ]);

  return { homeStats, awayStats, injuries, h2h };
}

// ---------------------------------------------------------------------------
// Fixtures fetch (radar)
// ---------------------------------------------------------------------------

async function fetchAllFixturesForDate(date: string): Promise<any[]> {
  const raw = await apiFetch("/fixtures", { date, timezone: COLOMBIA_TZ });
  return Array.isArray(raw) ? raw : [];
}

export async function getMatchesFromApiFootball(
  leagues?: string[],
): Promise<{ league: string; matches: ApiFootballMatch[] }[]> {
  const date = getTodayColombia();
  const wantedLeagueIds = new Set(
    (leagues && leagues.length > 0 ? leagues : Object.keys(LEAGUE_ID_BY_NAME))
      .map((name) => LEAGUE_ID_BY_NAME[name])
      .filter(Boolean),
  );

  // 1. Check cache
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

      // Upsert: delete stale row then insert fresh
      await db
        .delete(radarCacheTable)
        .where(
          and(
            eq(radarCacheTable.date, date),
            eq(radarCacheTable.league, ALL_FIXTURES_CACHE_KEY),
          ),
        )
        .catch((err: unknown) => logger.warn({ err }, "Failed to clear stale radar cache"));

      await db
        .insert(radarCacheTable)
        .values({
          date,
          league: ALL_FIXTURES_CACHE_KEY,
          result: JSON.stringify(allFixtures),
        })
        .onConflictDoNothing()
        .catch((err: unknown) => logger.warn({ err }, "Failed to write radar cache"));
    } catch (err) {
      logger.error({ err }, "API-Football fetch failed");
      throw err;
    }
  }

  // Filter to requested leagues
  const filtered = allFixtures.filter((m) => {
    const id = LEAGUE_ID_BY_NAME[m.league];
    return id !== undefined && wantedLeagueIds.has(id);
  });

  // Enrich with hasAnalysis flag
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
          (r: { homeTeam: string; awayTeam: string; league: string }) =>
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

  // Group by league in original order
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

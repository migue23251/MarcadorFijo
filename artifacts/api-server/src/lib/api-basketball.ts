import { logger } from "./logger";
import { fetchConRotacion } from "./fetchConRotacion";
import {
  db,
  radarCacheTable,
  teamStatsCacheTable,
  injuriesCacheTable,
  h2hCacheTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

const API_BASKETBALL_BASE = "https://v1.basketball.api-sports.io";
const API_BASKETBALL_HOST = "v1.basketball.api-sports.io";

/** Supported basketball leagues */
export type BasketballLeague = "nba" | "euroleague";

const LEAGUE_CONFIG: Record<BasketballLeague, { id: number; cacheKey: string }> = {
  nba:        { id: 12,  cacheKey: "bball_nba" },
  euroleague: { id: 120, cacheKey: "bball_euroleague" },
};

/** Cache TTL for results containing live games (2 min) */
const LIVE_CACHE_TTL_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types — Radar (match list)
// ---------------------------------------------------------------------------

export interface BasketballMatch {
  id: string;
  apiId: number;
  homeTeamId: number;
  awayTeamId: number;
  leagueId: number;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  status: string;
  score: { home: number | null; away: number | null } | null;
}

// ---------------------------------------------------------------------------
// Types — Enrichment
// ---------------------------------------------------------------------------

/** Season-level team stats from /teams/statistics */
export interface BasketballTeamStats {
  teamName: string;
  /** e.g. "2024-2025" */
  season: string;
  /** e.g. "43-39" */
  record: string;
  played: { home: number; away: number; total: number };
  wins:   { home: number; away: number; total: number };
  losses: { home: number; away: number; total: number };

  // ── Scoring averages ──────────────────────────────────────────────────────
  /** Points scored per game */
  ppg:  { home: string; away: string; total: string };
  /** Points allowed per game */
  oppg: { home: string; away: string; total: string };

  // ── Shooting percentages (null if not returned by the API plan) ───────────
  fgPct:    number | null;   // Field-goal %
  threePct: number | null;   // 3-point %
  ftPct:    number | null;   // Free-throw %

  // ── Per-game averages (null if not returned by the API plan) ─────────────
  reboundsOff:   number | null;
  reboundsDef:   number | null;
  reboundsTotal: number | null;
  assists:       number | null;
  turnovers:     number | null;
  steals:        number | null;
  blocks:        number | null;

  // ── Quarter / half scoring averages ───────────────────────────────────────
  ptsQ1:        number | null;   // Avg pts 1st quarter
  ptsQ2:        number | null;   // Avg pts 2nd quarter
  ptsFirstHalf: number | null;   // Avg pts 1st half (Q1 + Q2)

  // ── Context flags ─────────────────────────────────────────────────────────
  /** True when the team played yesterday / earlier today */
  backToBack: boolean;
  /** Last-5 form string, e.g. "WWLWL" */
  last5: string | null;
}

/** One H2H game result */
export interface BasketballH2HRecord {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  winner: "home" | "away" | "draw";
  /** Absolute point difference (home - away), null if score unknown */
  margin: number | null;
}

/** One injury / availability record */
export interface BasketballInjuryRecord {
  player: string;
  team: string;
  /** "Out" | "Doubtful" | "Questionable" | "Day-To-Day" */
  status: string;
  reason: string;
  /**
   * Usage rate % — injected from a separate source if available;
   * left null by the base extractor and enriched at the route level.
   */
  usgPct: number | null;
}

/** Bundle returned by enrichBasketballMatch() */
export interface BasketballMatchEnrichment {
  homeStats:  BasketballTeamStats | null;
  awayStats:  BasketballTeamStats | null;
  h2h:        BasketballH2HRecord[] | null;
  injuries:   BasketballInjuryRecord[] | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getBasketballSeason(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = d.getMonth();
  const base = month >= 9 ? year : year - 1;
  return `${base}-${base + 1}`;
}

function mapStatus(short: string): string {
  switch (short) {
    case "NS":                                      return "scheduled";
    case "Q1": case "Q2": case "Q3": case "Q4":
    case "OT": case "BT": case "LIVE":              return "live";
    case "HT":                                      return "halftime";
    case "FT": case "AOT":                          return "finished";
    case "CANC":                                    return "cancelled";
    default:                                        return "postponed";
  }
}

/**
 * Reuses the same API-Football keys — api-sports.io Basketball uses the same
 * authentication system.
 */
function getApiKeys(): string[] {
  return [
    process.env["API_FOOTBALL_KEY_1"],
    process.env["API_FOOTBALL_KEY_2"],
    process.env["FOOTBALL_API_KEY"],
  ].filter((k): k is string => Boolean(k));
}

async function apiFetch(
  path: string,
  params: Record<string, string | number>,
): Promise<any> {
  const url = new URL(`${API_BASKETBALL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const keys = getApiKeys();
  if (keys.length === 0) {
    throw new Error(
      "No hay llaves de API configuradas (API_FOOTBALL_KEY_1 / API_FOOTBALL_KEY_2 / FOOTBALL_API_KEY)",
    );
  }

  const data = await fetchConRotacion(url, keys, {
    type: "header",
    name: "x-rapidapi-key",
    extraHeaders: { "x-rapidapi-host": API_BASKETBALL_HOST },
  });

  const bodyErrors = data?.errors;
  if (
    bodyErrors &&
    (Array.isArray(bodyErrors) ? bodyErrors.length > 0 : Object.keys(bodyErrors).length > 0)
  ) {
    const msg = Array.isArray(bodyErrors) ? bodyErrors.join("; ") : JSON.stringify(bodyErrors);
    throw new Error(`API Basketball error: ${msg}`);
  }

  return data?.response;
}

/** Parse a numeric field that may come as string or number from the API */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// Radar — today's games
// ---------------------------------------------------------------------------

export async function getBasketballMatchesForToday(
  league: BasketballLeague = "nba",
): Promise<BasketballMatch[]> {
  const config = LEAGUE_CONFIG[league];
  const date = new Date().toISOString().split("T")[0];
  const season = getBasketballSeason();

  // 1. Cache check
  const cached = await db
    .select()
    .from(radarCacheTable)
    .where(and(eq(radarCacheTable.date, date), eq(radarCacheTable.league, config.cacheKey)))
    .limit(1);

  if (cached.length > 0) {
    const cachedMatches = JSON.parse(cached[0].result) as BasketballMatch[];
    const hadLive = cachedMatches.some((m) => m.status === "live" || m.status === "halftime");
    const ageMs = Date.now() - new Date(cached[0].createdAt).getTime();
    if (!hadLive || ageMs < LIVE_CACHE_TTL_MS) {
      logger.info({ date, league, hadLive, ageMs }, "Basketball radar cache hit");
      return cachedMatches;
    }
    logger.info({ date, league, ageMs }, "Basketball radar cache stale — refreshing");
  }

  // 2. Fetch
  logger.info({ date, season, league }, "Fetching basketball games from api-sports.io");

  let raw: any[];
  try {
    raw = await apiFetch("/games", { league: config.id, season, date });
  } catch (err) {
    logger.error({ err, league }, "API Basketball fetch failed");
    throw err;
  }

  if (!Array.isArray(raw)) {
    logger.warn({ date, season, league }, "API Basketball returned no games array");
    raw = [];
  }

  const matches: BasketballMatch[] = raw.map((g: any) => {
    const statusShort: string = g?.status?.short ?? "NS";
    const status = mapStatus(statusShort);
    const scoreHome = g?.scores?.home?.total ?? null;
    const scoreAway = g?.scores?.away?.total ?? null;
    return {
      id:          `bball-${g.id}`,
      apiId:       g.id as number,
      homeTeamId:  g.teams?.home?.id as number ?? 0,
      awayTeamId:  g.teams?.away?.id as number ?? 0,
      leagueId:    config.id,
      homeTeam:    g.teams?.home?.name ?? "Local",
      awayTeam:    g.teams?.away?.name ?? "Visitante",
      kickoffTime: g.date ?? "",
      status,
      score: (scoreHome !== null || scoreAway !== null) ? { home: scoreHome, away: scoreAway } : null,
    };
  });

  // 3. Persist
  await db
    .delete(radarCacheTable)
    .where(and(eq(radarCacheTable.date, date), eq(radarCacheTable.league, config.cacheKey)))
    .catch((err) => logger.warn({ err }, "Failed to clear stale basketball radar cache"));

  await db
    .insert(radarCacheTable)
    .values({ date, league: config.cacheKey, result: JSON.stringify(matches) })
    .onConflictDoNothing()
    .catch((err) => logger.warn({ err }, "Failed to write basketball radar cache"));

  logger.info({ date, league, count: matches.length }, "Basketball games cached");
  return matches;
}

/** @deprecated use getBasketballMatchesForToday("nba") */
export const getNbaMatchesForToday = () => getBasketballMatchesForToday("nba");

// ---------------------------------------------------------------------------
// Team statistics — /teams/statistics
// ---------------------------------------------------------------------------

async function fetchBasketballTeamStats(
  teamId: number,
  leagueId: number,
  season: string,
  date: string,
): Promise<BasketballTeamStats | null> {
  // Cache — reuses the shared teamStatsCacheTable (sport-agnostic JSON blob)
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
    logger.info({ teamId, leagueId, date }, "Basketball team stats cache hit");
    return JSON.parse(cached[0].result) as BasketballTeamStats;
  }

  logger.info({ teamId, leagueId, season }, "Fetching basketball team stats from API");

  let raw: any;
  try {
    raw = await apiFetch("/teams/statistics", { league: leagueId, season, team: teamId });
  } catch (err) {
    logger.warn({ err, teamId, leagueId }, "Failed to fetch basketball team stats");
    return null;
  }

  if (!raw) return null;

  // ── Core win/loss record ──────────────────────────────────────────────────
  const wins   = raw.games?.wins   ?? {};
  const losses = raw.games?.loses  ?? {};
  const played = raw.games?.played ?? {};
  const wTotal = wins.all?.total   ?? 0;
  const lTotal = losses.all?.total ?? 0;

  // ── Scoring ───────────────────────────────────────────────────────────────
  const ptsFor     = raw.points?.for?.average     ?? {};
  const ptsAgainst = raw.points?.against?.average ?? {};

  // ── Shooting / advanced (present in some API plans; null otherwise) ───────
  // api-sports.io basketball may nest these under different keys depending on version
  const shooting = raw.statistics ?? raw.averages ?? raw.per_game ?? {};

  // ── Quarter scoring ───────────────────────────────────────────────────────
  // Some API responses include quarter totals under "points_quarter" or "quarters"
  const q = raw.points_quarter ?? raw.quarters ?? {};
  const q1Total = numOrNull(q["1"]?.for ?? q.q1?.for ?? null);
  const q2Total = numOrNull(q["2"]?.for ?? q.q2?.for ?? null);
  const gamesPlayed = played.all ?? 1; // avoid div/0
  const ptsQ1        = q1Total !== null ? parseFloat((q1Total / gamesPlayed).toFixed(1)) : null;
  const ptsQ2        = q2Total !== null ? parseFloat((q2Total / gamesPlayed).toFixed(1)) : null;
  const ptsFirstHalf = (ptsQ1 !== null && ptsQ2 !== null)
    ? parseFloat((ptsQ1 + ptsQ2).toFixed(1))
    : null;

  const stats: BasketballTeamStats = {
    teamName: raw.team?.name ?? "",
    season,
    record:  `${wTotal}-${lTotal}`,
    played:  { home: played.home ?? 0, away: played.away ?? 0, total: played.all ?? 0 },
    wins:    { home: wins.home?.total ?? 0, away: wins.away?.total ?? 0, total: wTotal },
    losses:  { home: losses.home?.total ?? 0, away: losses.away?.total ?? 0, total: lTotal },
    ppg:     { home: ptsFor.home ?? "0", away: ptsFor.away ?? "0", total: ptsFor.all ?? "0" },
    oppg:    { home: ptsAgainst.home ?? "0", away: ptsAgainst.away ?? "0", total: ptsAgainst.all ?? "0" },

    // Shooting percentages
    fgPct:    numOrNull(shooting.fgp   ?? raw.field_goals?.percentage   ?? null),
    threePct: numOrNull(shooting.tpp   ?? raw.three_points?.percentage  ?? null),
    ftPct:    numOrNull(shooting.ftp   ?? raw.free_throws?.percentage   ?? null),

    // Per-game averages
    reboundsOff:   numOrNull(shooting.offReb ?? raw.rebounds?.offensive?.average  ?? null),
    reboundsDef:   numOrNull(shooting.defReb ?? raw.rebounds?.defensive?.average  ?? null),
    reboundsTotal: numOrNull(shooting.totReb ?? raw.rebounds?.total?.average      ?? null),
    assists:       numOrNull(shooting.assists  ?? raw.assists?.average   ?? null),
    turnovers:     numOrNull(shooting.turnovers ?? raw.turnovers?.average ?? null),
    steals:        numOrNull(shooting.steals   ?? raw.steals?.average    ?? null),
    blocks:        numOrNull(shooting.blocks   ?? raw.blocks?.average    ?? null),

    ptsQ1,
    ptsQ2,
    ptsFirstHalf,

    // Back-to-back and form — injected by the enrichment caller, not the API
    backToBack: false,
    last5:      null,
  };

  try {
    await db
      .insert(teamStatsCacheTable)
      .values({ teamId, leagueId, date, result: JSON.stringify(stats) })
      .onConflictDoNothing();
    logger.info({ teamId, leagueId, date }, "Basketball team stats cached");
  } catch (err) {
    logger.warn({ err }, "Failed to cache basketball team stats");
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Head-to-head — /games/h2h
// ---------------------------------------------------------------------------

async function fetchBasketballH2H(
  homeTeamId: number,
  awayTeamId: number,
  date: string,
): Promise<BasketballH2HRecord[] | null> {
  // Normalize key so A-vs-B and B-vs-A share the same cache row
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
    logger.info({ homeTeamId, awayTeamId, date }, "Basketball H2H cache hit");
    return JSON.parse(cached[0].result) as BasketballH2HRecord[];
  }

  logger.info({ homeTeamId, awayTeamId }, "Fetching basketball H2H from API");

  let raw: any[];
  try {
    // api-sports.io basketball H2H endpoint
    raw = await apiFetch("/games/h2h", {
      h2h:  `${homeTeamId}-${awayTeamId}`,
      last: 5,
    });
  } catch (err) {
    logger.warn({ err, homeTeamId, awayTeamId }, "Failed to fetch basketball H2H");
    return null;
  }

  if (!Array.isArray(raw)) return null;

  const h2h: BasketballH2HRecord[] = raw.slice(0, 5).map((g: any) => {
    const scoreHome = g?.scores?.home?.total ?? null;
    const scoreAway = g?.scores?.away?.total ?? null;
    let winner: "home" | "away" | "draw" = "draw";
    let margin: number | null = null;
    if (scoreHome !== null && scoreAway !== null) {
      margin = scoreHome - scoreAway;
      winner = margin > 0 ? "home" : margin < 0 ? "away" : "draw";
      margin = Math.abs(margin);
    }
    return {
      date:      (g.date ?? "").split("T")[0],
      homeTeam:  g.teams?.home?.name ?? "",
      awayTeam:  g.teams?.away?.name ?? "",
      homeScore: scoreHome,
      awayScore: scoreAway,
      winner,
      margin,
    };
  });

  try {
    await db
      .insert(h2hCacheTable)
      .values({ homeTeamId: keyA, awayTeamId: keyB, date, result: JSON.stringify(h2h) })
      .onConflictDoNothing();
    logger.info({ keyA, keyB, count: h2h.length }, "Basketball H2H cached");
  } catch (err) {
    logger.warn({ err }, "Failed to cache basketball H2H");
  }

  return h2h;
}

// ---------------------------------------------------------------------------
// Injuries — /injuries
// ---------------------------------------------------------------------------

async function fetchBasketballInjuries(
  gameId: number,
  leagueId: number,
  season: string,
  date: string,
): Promise<BasketballInjuryRecord[] | null> {
  const cached = await db
    .select()
    .from(injuriesCacheTable)
    .where(
      and(
        eq(injuriesCacheTable.fixtureId, gameId),
        eq(injuriesCacheTable.date, date),
      ),
    )
    .limit(1);

  if (cached.length > 0) {
    logger.info({ gameId, date }, "Basketball injuries cache hit");
    return JSON.parse(cached[0].result) as BasketballInjuryRecord[];
  }

  logger.info({ gameId, leagueId, season }, "Fetching basketball injuries from API");

  let raw: any[];
  try {
    raw = await apiFetch("/injuries", {
      game:   gameId,
      league: leagueId,
      season,
    });
  } catch (err) {
    logger.warn({ err, gameId }, "Failed to fetch basketball injuries");
    return null;
  }

  if (!Array.isArray(raw)) return null;

  const injuries: BasketballInjuryRecord[] = raw.map((item: any) => ({
    player: item.player?.name ?? "Desconocido",
    team:   item.team?.name   ?? "",
    status: item.player?.type ?? item.player?.status ?? "Out",
    reason: item.player?.reason ?? item.player?.description ?? "",
    usgPct: null, // filled externally if a USG% source is wired in
  }));

  try {
    await db
      .insert(injuriesCacheTable)
      .values({ fixtureId: gameId, date, result: JSON.stringify(injuries) })
      .onConflictDoNothing();
    logger.info({ gameId, count: injuries.length }, "Basketball injuries cached");
  } catch (err) {
    logger.warn({ err }, "Failed to cache basketball injuries");
  }

  return injuries;
}

// ---------------------------------------------------------------------------
// Enrichment bundle — all extra data for a game, fetched in parallel
// ---------------------------------------------------------------------------

export async function enrichBasketballMatch(
  homeTeamId: number,
  awayTeamId: number,
  leagueId: number,
  gameId: number,
): Promise<BasketballMatchEnrichment> {
  const date   = new Date().toISOString().split("T")[0];
  const season = getBasketballSeason();

  const [homeStats, awayStats, h2h, injuries] = await Promise.all([
    fetchBasketballTeamStats(homeTeamId, leagueId, season, date).catch(() => null),
    fetchBasketballTeamStats(awayTeamId, leagueId, season, date).catch(() => null),
    fetchBasketballH2H(homeTeamId, awayTeamId, date).catch(() => null),
    fetchBasketballInjuries(gameId, leagueId, season, date).catch(() => null),
  ]);

  return { homeStats, awayStats, h2h, injuries };
}

import { logger } from "./logger";
import { fetchConRotacion } from "./fetchConRotacion";
import { db, radarCacheTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const API_BASKETBALL_BASE = "https://v1.basketball.api-sports.io";
const API_BASKETBALL_HOST = "v1.basketball.api-sports.io";

/** NBA league ID on api-sports.io */
const NBA_LEAGUE_ID = 12;

/** Cache TTL for results containing live games (2 min) */
const LIVE_CACHE_TTL_MS = 2 * 60 * 1000;

/** Cache key for the NBA daily dump */
const NBA_CACHE_KEY = "bball_nba";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BasketballMatch {
  id: string;
  apiId: number;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  status: string;
  score: { home: number | null; away: number | null } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNbaSeason(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed
  // NBA season starts in October (month 9); before October use previous year as base
  const base = month >= 9 ? year : year - 1;
  return `${base}-${base + 1}`;
}

function mapStatus(short: string): string {
  switch (short) {
    case "NS":
      return "scheduled";
    case "Q1":
    case "Q2":
    case "Q3":
    case "Q4":
    case "OT":
    case "BT":
    case "LIVE":
      return "live";
    case "HT":
      return "halftime";
    case "FT":
    case "AOT":
      return "finished";
    case "CANC":
      return "cancelled";
    default:
      return "postponed";
  }
}

/**
 * Reutiliza las mismas llaves de API-Football en orden de prioridad:
 * 1. API_FOOTBALL_KEY_1 (primaria)
 * 2. API_FOOTBALL_KEY_2 (failover)
 * 3. FOOTBALL_API_KEY   (nombre anterior — compatibilidad)
 * api-sports.io Basketball usa el mismo sistema de autenticación que api-football.
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
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

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
    (Array.isArray(bodyErrors)
      ? bodyErrors.length > 0
      : Object.keys(bodyErrors).length > 0)
  ) {
    const msg = Array.isArray(bodyErrors)
      ? bodyErrors.join("; ")
      : JSON.stringify(bodyErrors);
    throw new Error(`API Basketball error: ${msg}`);
  }

  return data?.response;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function getNbaMatchesForToday(): Promise<BasketballMatch[]> {
  const date = new Date().toISOString().split("T")[0];
  const season = getNbaSeason();

  // 1. Check cache
  const cached = await db
    .select()
    .from(radarCacheTable)
    .where(
      and(
        eq(radarCacheTable.date, date),
        eq(radarCacheTable.league, NBA_CACHE_KEY),
      ),
    )
    .limit(1);

  if (cached.length > 0) {
    const cachedMatches = JSON.parse(cached[0].result) as BasketballMatch[];
    const hadLive = cachedMatches.some(
      (m) => m.status === "live" || m.status === "halftime",
    );
    const ageMs = Date.now() - new Date(cached[0].createdAt).getTime();
    const isValid = !hadLive || ageMs < LIVE_CACHE_TTL_MS;

    if (isValid) {
      logger.info({ date, hadLive, ageMs }, "NBA radar cache hit — serving from DB");
      return cachedMatches;
    }
    logger.info({ date, ageMs }, "NBA radar cache stale — refreshing");
  }

  // 2. Fetch from API
  logger.info({ date, season }, "Fetching NBA games from api-sports.io");

  let raw: any[];
  try {
    raw = await apiFetch("/games", {
      league: NBA_LEAGUE_ID,
      season,
      date,
    });
  } catch (err) {
    logger.error({ err }, "API Basketball fetch failed");
    throw err;
  }

  if (!Array.isArray(raw)) {
    logger.warn({ date, season }, "API Basketball returned no games array");
    raw = [];
  }

  const matches: BasketballMatch[] = raw.map((g: any) => {
    const statusShort: string = g?.status?.short ?? "NS";
    const status = mapStatus(statusShort);
    const scoreHome = g?.scores?.home?.total ?? null;
    const scoreAway = g?.scores?.away?.total ?? null;
    const hasScore = scoreHome !== null || scoreAway !== null;

    return {
      id: `bball-${g.id}`,
      apiId: g.id as number,
      homeTeam: g.teams?.home?.name ?? "Local",
      awayTeam: g.teams?.away?.name ?? "Visitante",
      kickoffTime: g.date ?? "",
      status,
      score: hasScore ? { home: scoreHome, away: scoreAway } : null,
    };
  });

  // 3. Persist to cache (delete stale first, then insert)
  await db
    .delete(radarCacheTable)
    .where(
      and(
        eq(radarCacheTable.date, date),
        eq(radarCacheTable.league, NBA_CACHE_KEY),
      ),
    )
    .catch((err) => logger.warn({ err }, "Failed to clear stale NBA radar cache"));

  await db
    .insert(radarCacheTable)
    .values({ date, league: NBA_CACHE_KEY, result: JSON.stringify(matches) })
    .onConflictDoNothing()
    .catch((err) => logger.warn({ err }, "Failed to write NBA radar cache"));

  logger.info({ date, count: matches.length }, "NBA games cached");
  return matches;
}

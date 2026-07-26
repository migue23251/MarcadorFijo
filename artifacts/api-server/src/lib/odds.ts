import { logger } from "./logger";
import { fetchConRotacion } from "./fetchConRotacion";
import { db, oddsCacheTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

const LEAGUE_TO_SPORT_KEY: Record<string, string> = {
  "Premier League":       "soccer_epl",
  "La Liga":              "soccer_spain_la_liga",
  "Serie A":              "soccer_italy_serie_a",
  "Bundesliga":           "soccer_germany_bundesliga",
  "Ligue 1":              "soccer_france_ligue_one",
  "Eredivisie":           "soccer_netherlands_eredivisie",
  "Primeira Liga":        "soccer_portugal_primeira_liga",
  "Süper Lig":            "soccer_turkey_super_league",
  "MLS":                  "soccer_usa_mls",
  "Liga MX":              "soccer_mexico_ligamx",
  "Brasileirão":          "soccer_brazil_campeonato",
  "Champions League":     "soccer_uefa_champs_league",
  "Europa League":        "soccer_uefa_europa_league",
  "Conference League":    "soccer_uefa_europa_conference_league",
  "Copa Libertadores":    "soccer_conmebol_libertadores",
};

interface OddsOutcome {
  name: string;
  price: number;
}

interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}

interface OddsEvent {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: Array<{
    key: string;
    title: string;
    markets: OddsMarket[];
  }>;
}

function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|sc|ac|rc|as|ss|ssc|bsc|tsv|vfb|rb|sv|afc|bfc|united|city)\b/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function teamsMatch(a: string, b: string): boolean {
  const na = normalizeTeam(a);
  const nb = normalizeTeam(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Resuelve las keys de The Odds API en orden de prioridad:
 * 1. ODDS_API_KEY_1  (nueva primaria)
 * 2. ODDS_API_KEY_2  (nueva secundaria / failover)
 * 3. THE_ODDS_API_KEY (nombre anterior — compatibilidad hacia atrás)
 */
function getOddsApiKeys(): string[] {
  return [
    process.env["ODDS_API_KEY_1"],
    process.env["ODDS_API_KEY_2"],
    process.env["THE_ODDS_API_KEY"],
  ].filter((k): k is string => Boolean(k));
}

async function fetchSportOdds(sportKey: string, date: string): Promise<OddsEvent[] | null> {
  const keys = getOddsApiKeys();
  if (keys.length === 0) {
    logger.warn("No Odds API keys configuradas — omitiendo enriquecimiento de cuotas");
    return null;
  }

  // Cache check
  const cached = await db
    .select()
    .from(oddsCacheTable)
    .where(and(eq(oddsCacheTable.date, date), eq(oddsCacheTable.sportKey, sportKey)))
    .limit(1);

  if (cached.length > 0) {
    logger.info({ sportKey, date }, "Odds served from DB cache");
    return JSON.parse(cached[0].result) as OddsEvent[];
  }

  const url = new URL(`${ODDS_API_BASE}/sports/${sportKey}/odds`);
  url.searchParams.set("regions", "eu");
  url.searchParams.set("markets", "h2h,totals,btts");
  url.searchParams.set("oddsFormat", "decimal");

  logger.info({ sportKey }, "Fetching odds from The Odds API");

  let events: OddsEvent[];
  try {
    const body = await fetchConRotacion(url, keys, { type: "param", name: "apiKey" });
    if (!Array.isArray(body)) {
      logger.warn({ sportKey, body }, "Odds API devolvió un body inesperado");
      return null;
    }
    events = body as OddsEvent[];
  } catch (err) {
    logger.warn({ err, sportKey }, "Error al obtener cuotas de The Odds API");
    return null;
  }

  // Cache — onConflictDoNothing evita colisiones en peticiones concurrentes
  try {
    await db
      .insert(oddsCacheTable)
      .values({ date, sportKey, result: JSON.stringify(events) })
      .onConflictDoNothing();
    logger.info({ sportKey, date, eventCount: events.length }, "Odds cached in DB");
  } catch (err) {
    logger.warn({ err }, "Failed to save odds to DB cache");
  }

  return events;
}

export async function getMatchOdds(
  homeTeam: string,
  awayTeam: string,
  league: string,
): Promise<Record<string, unknown> | null> {
  const sportKey = LEAGUE_TO_SPORT_KEY[league];
  if (!sportKey) {
    logger.info({ league }, "No Odds API sport key mapping for this league — skipping odds");
    return null;
  }

  const date = new Date().toISOString().split("T")[0];
  const events = await fetchSportOdds(sportKey, date);
  if (!events || events.length === 0) return null;

  const event = events.find(
    (e) => teamsMatch(e.home_team, homeTeam) && teamsMatch(e.away_team, awayTeam),
  );

  if (!event) {
    logger.info({ homeTeam, awayTeam, sportKey }, "Match not found in odds data");
    return null;
  }

  // Aggregate best (highest) odds per outcome across all bookmakers
  const bestOdds: Record<string, Record<string, number>> = {};

  for (const bookmaker of event.bookmakers) {
    for (const market of bookmaker.markets) {
      if (!bestOdds[market.key]) bestOdds[market.key] = {};
      for (const outcome of market.outcomes) {
        const current = bestOdds[market.key][outcome.name] ?? 0;
        if (outcome.price > current) {
          bestOdds[market.key][outcome.name] = outcome.price;
        }
      }
    }
  }

  return {
    partido: `${event.home_team} vs ${event.away_team}`,
    inicio: event.commence_time,
    mercados: bestOdds,
  };
}

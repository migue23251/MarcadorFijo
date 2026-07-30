/**
 * Servicio de verificación de resultados de apuestas.
 *
 * Hace UNA petición a API-Football por cada fecha con apuestas pendientes,
 * y peticiones adicionales a /fixtures/statistics solo para los partidos
 * que tengan apuestas de córners o tarjetas (bajo demanda, con caché).
 *
 * Mercados soportados:
 *   • 1X2 / Resultado Final
 *   • Más/Menos Goles (Over/Under)
 *   • BTTS / Ambos Anotan
 *   • Hándicap Asiático
 *   • Hándicap Europeo
 *   • Córners (Over/Under total, Hándicap por equipo)
 *   • Tarjetas (Over/Under total, amarillas por equipo, tarjeta roja sí/no)
 */

import { logger } from "../lib/logger";
import { fetchConRotacion } from "../lib/fetchConRotacion";
import { db, betsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface FixtureStats {
  homeCorners: number;
  awayCorners: number;
  totalCorners: number;
  homeYellowCards: number;
  awayYellowCards: number;
  homeRedCards: number;
  awayRedCards: number;
  /** Todas las amarillas + rojas de ambos equipos */
  totalCards: number;
  homeShotsOnGoal: number;
  awayShotsOnGoal: number;
  totalShotsOnGoal: number;
  homeTotalShots: number;
  awayTotalShots: number;
  totalShots: number;
  homeFouls: number;
  awayFouls: number;
  totalFouls: number;
}

interface FixtureResult {
  /** ID de API-Football — necesario para pedir estadísticas */
  fixtureId?: number;
  homeScore: number;
  awayScore: number;
  /** FT | AET | PEN | AWD | WO | CANC | ABD | PST */
  statusShort: string;
  /** Se carga bajo demanda para mercados de córners/tarjetas */
  stats?: FixtureStats;
}

// Clave por nombre: "<homeTeam_lower>|<awayTeam_lower>"
type FixtureMap = Map<string, FixtureResult>;
// Clave por ID de API-Football
type FixtureIdMap = Map<number, FixtureResult>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(name: string): string {
  return name.toLowerCase().trim();
}

/** Extrae la fecha UTC (YYYY-MM-DD) del kickoffTime de una apuesta. */
function kickoffDateUTC(kickoffTime: string): string {
  try {
    return new Date(kickoffTime).toISOString().split("T")[0];
  } catch {
    return kickoffTime.slice(0, 10);
  }
}

/** Comprueba si el kickoff ya ha ocurrido. */
function hasKickoffPassed(kickoffTime: string): boolean {
  try {
    return new Date(kickoffTime) <= new Date();
  } catch {
    return false;
  }
}

/** Indica si el mercado de una apuesta necesita estadísticas adicionales. */
function requiresStats(market: string): boolean {
  const m = market.toLowerCase();
  return (
    m.includes("córner") ||
    m.includes("corner") ||
    m.includes("esquina") ||
    m.includes("tarjeta") ||
    m.includes("card") ||
    m.includes("amarilla") ||
    m.includes("roja") ||
    m.includes("falta") ||
    m.includes("foul") ||
    m.includes("disparo") ||
    m.includes("tiro") ||
    m.includes("shot")
  );
}

// ---------------------------------------------------------------------------
// Claves API-Football
// ---------------------------------------------------------------------------

function getApiFootballKeys(): string[] {
  return [
    process.env["API_FOOTBALL_KEY_1"],
    process.env["API_FOOTBALL_KEY_2"],
    process.env["FOOTBALL_API_KEY"],
  ].filter((k): k is string => Boolean(k));
}

// ---------------------------------------------------------------------------
// Petición principal: partidos finalizados por fecha
// ---------------------------------------------------------------------------

interface FinishedFixtures {
  byName: FixtureMap;
  byId: FixtureIdMap;
}

async function fetchFinishedFixtures(date: string): Promise<FinishedFixtures> {
  const keys = getApiFootballKeys();
  if (keys.length === 0) {
    throw new Error("No API-Football keys configuradas (API_FOOTBALL_KEY_1 / FOOTBALL_API_KEY)");
  }

  const url = new URL("https://v3.football.api-sports.io/fixtures");
  url.searchParams.set("date", date);
  url.searchParams.set("status", "FT-AET-PEN-AWD-WO");

  logger.info({ date }, "Fetching finished fixtures from API-Football");

  const data = await fetchConRotacion(url, keys, {
    type: "header",
    name: "x-rapidapi-key",
    extraHeaders: { "x-rapidapi-host": "v3.football.api-sports.io" },
  });

  const fixtures: any[] = Array.isArray(data?.response) ? data.response : [];
  logger.info({ date, count: fixtures.length }, "Finished fixtures received");

  const byName: FixtureMap = new Map();
  const byId: FixtureIdMap = new Map();

  for (const f of fixtures) {
    const homeName = normalize(f.teams?.home?.name ?? "");
    const awayName = normalize(f.teams?.away?.name ?? "");
    if (!homeName || !awayName) continue;

    const fixtureId: number | undefined = f.fixture?.id;

    const result: FixtureResult = {
      fixtureId,
      homeScore: f.goals?.home ?? 0,
      awayScore: f.goals?.away ?? 0,
      statusShort: f.fixture?.status?.short ?? "FT",
    };

    byName.set(`${homeName}|${awayName}`, result);
    if (fixtureId) byId.set(fixtureId, result);
  }

  return { byName, byId };
}

// ---------------------------------------------------------------------------
// Petición secundaria: estadísticas por partido (córners, tarjetas)
// Bajo demanda; el resultado se cachea en el objeto FixtureResult.
// ---------------------------------------------------------------------------

/** Caché en memoria para la duración de una ejecución de verificación. */
const statsCache = new Map<number, FixtureStats | null>();

function getStat(teamStats: any[], type: string): number {
  const stat = teamStats.find((s: any) => s.type === type);
  const val = stat?.value;
  // API-Football a veces devuelve null o string "0"
  if (val === null || val === undefined) return 0;
  return typeof val === "number" ? val : parseInt(String(val), 10) || 0;
}

async function loadFixtureStats(
  fixture: FixtureResult,
  keys: string[],
): Promise<FixtureStats | null> {
  if (!fixture.fixtureId) return null;
  if (fixture.stats) return fixture.stats;

  const cached = statsCache.get(fixture.fixtureId);
  if (cached !== undefined) return cached;

  const url = new URL("https://v3.football.api-sports.io/fixtures/statistics");
  url.searchParams.set("fixture", String(fixture.fixtureId));

  logger.info({ fixtureId: fixture.fixtureId }, "Fetching fixture statistics");

  try {
    const data = await fetchConRotacion(url, keys, {
      type: "header",
      name: "x-rapidapi-key",
      extraHeaders: { "x-rapidapi-host": "v3.football.api-sports.io" },
    });

    const response: any[] = Array.isArray(data?.response) ? data.response : [];
    if (response.length < 2) {
      logger.warn({ fixtureId: fixture.fixtureId }, "Estadísticas incompletas o no disponibles");
      statsCache.set(fixture.fixtureId, null);
      return null;
    }

    const homeStats: any[] = response[0]?.statistics ?? [];
    const awayStats: any[] = response[1]?.statistics ?? [];

    const homeYellow = getStat(homeStats, "Yellow Cards");
    const awayYellow = getStat(awayStats, "Yellow Cards");
    const homeRed = getStat(homeStats, "Red Cards");
    const awayRed = getStat(awayStats, "Red Cards");
    const homeCorners = getStat(homeStats, "Corner Kicks");
    const awayCorners = getStat(awayStats, "Corner Kicks");
    const homeShotsOnGoal = getStat(homeStats, "Shots on Goal");
    const awayShotsOnGoal = getStat(awayStats, "Shots on Goal");
    const homeTotalShots = getStat(homeStats, "Total Shots");
    const awayTotalShots = getStat(awayStats, "Total Shots");
    const homeFouls = getStat(homeStats, "Fouls");
    const awayFouls = getStat(awayStats, "Fouls");

    const stats: FixtureStats = {
      homeCorners,
      awayCorners,
      totalCorners: homeCorners + awayCorners,
      homeYellowCards: homeYellow,
      awayYellowCards: awayYellow,
      homeRedCards: homeRed,
      awayRedCards: awayRed,
      totalCards: homeYellow + awayYellow + homeRed + awayRed,
      homeShotsOnGoal,
      awayShotsOnGoal,
      totalShotsOnGoal: homeShotsOnGoal + awayShotsOnGoal,
      homeTotalShots,
      awayTotalShots,
      totalShots: homeTotalShots + awayTotalShots,
      homeFouls,
      awayFouls,
      totalFouls: homeFouls + awayFouls,
    };

    fixture.stats = stats;
    statsCache.set(fixture.fixtureId, stats);
    logger.info({ fixtureId: fixture.fixtureId, stats }, "Estadísticas cargadas");
    return stats;
  } catch (err) {
    logger.error({ err, fixtureId: fixture.fixtureId }, "Error al obtener estadísticas del partido");
    statsCache.set(fixture.fixtureId, null);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Búsqueda fuzzy por nombre de equipo
// ---------------------------------------------------------------------------

function findFixture(
  map: FixtureMap,
  homeBet: string,
  awayBet: string,
): FixtureResult | undefined {
  const homeKey = normalize(homeBet);
  const awayKey = normalize(awayBet);
  const exactKey = `${homeKey}|${awayKey}`;

  if (map.has(exactKey)) return map.get(exactKey);

  for (const [key, result] of map.entries()) {
    const [fHome, fAway] = key.split("|");

    const homeMatch =
      homeKey.length > 3 &&
      fHome.length > 3 &&
      (fHome.includes(homeKey) || homeKey.includes(fHome)) &&
      Math.min(homeKey.length, fHome.length) / Math.max(homeKey.length, fHome.length) >= 0.5;

    const awayMatch =
      awayKey.length > 3 &&
      fAway.length > 3 &&
      (fAway.includes(awayKey) || awayKey.includes(fAway)) &&
      Math.min(awayKey.length, fAway.length) / Math.max(awayKey.length, fAway.length) >= 0.5;

    if (homeMatch && awayMatch) return result;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Evaluación de apuestas
// ---------------------------------------------------------------------------

type BetOutcome = "won" | "lost" | "void";

function evaluateBet(
  market: string,
  selection: string,
  homeScore: number,
  awayScore: number,
  stats?: FixtureStats,
): BetOutcome {
  const m = market.toLowerCase();
  const s = selection.toLowerCase().trim();
  const totalGoals = homeScore + awayScore;

  // -------------------------------------------------------------------------
  // 1X2 / Resultado Final
  // -------------------------------------------------------------------------
  if (m.includes("1x2") || m.includes("resultado") || m.includes("match result")) {
    if (homeScore > awayScore) {
      return s === "1" || s === "local" || s === "home" || s === "victoria local" ? "won" : "lost";
    } else if (homeScore === awayScore) {
      return s === "x" || s === "empate" || s === "draw" ? "won" : "lost";
    } else {
      return s === "2" || s === "visitante" || s === "away" || s === "victoria visitante" ? "won" : "lost";
    }
  }

  // -------------------------------------------------------------------------
  // Córners
  // -------------------------------------------------------------------------
  if (m.includes("córner") || m.includes("corner") || m.includes("esquina")) {
    if (!stats) {
      logger.warn({ market, selection }, "Apuesta de córners sin estadísticas disponibles → void");
      return "void";
    }

    const isHome = s.includes("local") || s.includes("home");
    const isAway = s.includes("visitante") || s.includes("away");

    // Hándicap por equipo: "Local +5.5 córners" / "Visitante -4.5 córners"
    if (isHome || isAway) {
      const handicapMatch = s.match(/([+-]?\d+(?:\.\d+)?)/);
      if (!handicapMatch) return "void";
      const handicap = parseFloat(handicapMatch[1]);
      const teamCorners = isHome ? stats.homeCorners : stats.awayCorners;
      const oppCorners = isHome ? stats.awayCorners : stats.homeCorners;
      const adjusted = teamCorners + handicap;
      if (adjusted > oppCorners) return "won";
      if (adjusted < oppCorners) return "lost";
      return "void"; // empate exacto = push
    }

    // Over/Under total córners: "Más de 9.5 córners" / "Menos de 8.5"
    const lineMatch = s.match(/(\d+(?:\.\d+)?)/);
    if (!lineMatch) return "void";
    const line = parseFloat(lineMatch[1]);
    const isOver = s.includes("más") || s.includes("over") || s.startsWith("+");
    return isOver
      ? stats.totalCorners > line ? "won" : "lost"
      : stats.totalCorners < line ? "won" : "lost";
  }

  // -------------------------------------------------------------------------
  // Tarjetas
  // -------------------------------------------------------------------------
  if (
    m.includes("tarjeta") ||
    m.includes("card") ||
    m.includes("amarilla") ||
    m.includes("booking")
  ) {
    if (!stats) {
      logger.warn({ market, selection }, "Apuesta de tarjetas sin estadísticas disponibles → void");
      return "void";
    }

    // Tarjeta roja sí/no
    if (s.includes("roja") || s.includes("red card")) {
      const totalRed = stats.homeRedCards + stats.awayRedCards;
      if (s.includes("sí") || s.includes("si") || s.includes("yes")) {
        return totalRed > 0 ? "won" : "lost";
      }
      if (s.includes("no")) {
        return totalRed === 0 ? "won" : "lost";
      }
      return "void";
    }

    const lineMatch = s.match(/(\d+(?:\.\d+)?)/);
    if (!lineMatch) return "void";
    const line = parseFloat(lineMatch[1]);
    const isOver = s.includes("más") || s.includes("over") || s.startsWith("+");

    const isHome = s.includes("local") || s.includes("home");
    const isAway = s.includes("visitante") || s.includes("away");

    // Tarjetas amarillas de un equipo específico
    if ((s.includes("amarilla") || s.includes("yellow")) && (isHome || isAway)) {
      const yellows = isHome ? stats.homeYellowCards : stats.awayYellowCards;
      return isOver ? yellows > line ? "won" : "lost" : yellows < line ? "won" : "lost";
    }

    // Tarjetas amarillas totales
    if (s.includes("amarilla") || s.includes("yellow")) {
      const totalYellow = stats.homeYellowCards + stats.awayYellowCards;
      return isOver ? totalYellow > line ? "won" : "lost" : totalYellow < line ? "won" : "lost";
    }

    // Total de tarjetas (amarillas + rojas) — mercado genérico
    return isOver
      ? stats.totalCards > line ? "won" : "lost"
      : stats.totalCards < line ? "won" : "lost";
  }

  // -------------------------------------------------------------------------
  // Disparos a puerta / Tiros a puerta / Shots on goal
  // -------------------------------------------------------------------------
  if (
    m.includes("disparo") ||
    m.includes("tiro") ||
    m.includes("shot")
  ) {
    if (!stats) {
      logger.warn({ market, selection }, "Apuesta de disparos sin estadísticas disponibles → void");
      return "void";
    }

    const isHome = s.includes("local") || s.includes("home");
    const isAway = s.includes("visitante") || s.includes("away");
    const isOnGoal = m.includes("puerta") || m.includes("portería") || m.includes("on goal");

    const lineMatch = s.match(/(\d+(?:\.\d+)?)/);
    if (!lineMatch) return "void";
    const line = parseFloat(lineMatch[1]);
    const isOver = s.includes("más") || s.includes("over") || s.startsWith("+");

    if (isHome) {
      const val = isOnGoal ? stats.homeShotsOnGoal : stats.homeTotalShots;
      return isOver ? val > line ? "won" : "lost" : val < line ? "won" : "lost";
    }
    if (isAway) {
      const val = isOnGoal ? stats.awayShotsOnGoal : stats.awayTotalShots;
      return isOver ? val > line ? "won" : "lost" : val < line ? "won" : "lost";
    }
    // Total ambos equipos
    const val = isOnGoal ? stats.totalShotsOnGoal : stats.totalShots;
    return isOver ? val > line ? "won" : "lost" : val < line ? "won" : "lost";
  }

  // -------------------------------------------------------------------------
  // Faltas / Fouls
  // -------------------------------------------------------------------------
  if (m.includes("falta") || m.includes("foul")) {
    if (!stats) {
      logger.warn({ market, selection }, "Apuesta de faltas sin estadísticas disponibles → void");
      return "void";
    }

    const isHome = s.includes("local") || s.includes("home");
    const isAway = s.includes("visitante") || s.includes("away");

    const lineMatch = s.match(/(\d+(?:\.\d+)?)/);
    if (!lineMatch) return "void";
    const line = parseFloat(lineMatch[1]);
    const isOver = s.includes("más") || s.includes("over") || s.startsWith("+");

    if (isHome) {
      return isOver
        ? stats.homeFouls > line ? "won" : "lost"
        : stats.homeFouls < line ? "won" : "lost";
    }
    if (isAway) {
      return isOver
        ? stats.awayFouls > line ? "won" : "lost"
        : stats.awayFouls < line ? "won" : "lost";
    }
    // Total ambos equipos
    return isOver
      ? stats.totalFouls > line ? "won" : "lost"
      : stats.totalFouls < line ? "won" : "lost";
  }

  // -------------------------------------------------------------------------
  // Over / Under goles totales
  // -------------------------------------------------------------------------
  if (
    m.includes("over") ||
    m.includes("under") ||
    m.includes("más") ||
    m.includes("menos") ||
    m.includes("total gol") ||
    m.includes("goles")
  ) {
    const lineMatch = s.match(/(\d+(?:\.\d+)?)/);
    if (!lineMatch) return "void";
    const line = parseFloat(lineMatch[1]);

    if (s.startsWith("over") || s.startsWith("más") || s.startsWith("+")) {
      return totalGoals > line ? "won" : "lost";
    } else {
      return totalGoals < line ? "won" : "lost";
    }
  }

  // -------------------------------------------------------------------------
  // BTTS / Ambos Anotan
  // -------------------------------------------------------------------------
  if (
    m.includes("btts") ||
    m.includes("ambos") ||
    m.includes("both teams") ||
    m.includes("anotan") ||
    m.includes("gg/ng")
  ) {
    const bothScored = homeScore > 0 && awayScore > 0;
    const selYes =
      s === "sí" || s === "si" || s === "yes" || s === "gg" || s === "sí/yes";
    const selNo = s === "no" || s === "ng";
    if (selYes) return bothScored ? "won" : "lost";
    if (selNo) return !bothScored ? "won" : "lost";
    return "void";
  }

  // -------------------------------------------------------------------------
  // Hándicap Asiático
  // -------------------------------------------------------------------------
  if (m.includes("asiático") || m.includes("asiatico") || m.includes("asian")) {
    const lineMatch = s.match(/([+-]?\d+(?:\.\d+)?)\s*$/);
    if (!lineMatch) return "void";
    const handicap = parseFloat(lineMatch[1]);
    const isHome =
      s.includes("local") || s.includes("home") || s.startsWith("1");
    const effectiveHome = isHome ? homeScore + handicap : homeScore;
    const effectiveAway = isHome ? awayScore : awayScore + handicap;

    if (effectiveHome > effectiveAway) return isHome ? "won" : "lost";
    if (effectiveHome < effectiveAway) return isHome ? "lost" : "won";
    return "void";
  }

  // -------------------------------------------------------------------------
  // Hándicap Europeo
  // -------------------------------------------------------------------------
  if (
    m.includes("europeo") ||
    m.includes("european") ||
    m.includes("hándicap") ||
    m.includes("handicap")
  ) {
    const lineMatch = s.match(/([+-]?\d+(?:\.\d+)?)\s*$/);
    if (!lineMatch) return "void";
    const handicap = parseFloat(lineMatch[1]);
    const isHome =
      s.includes("local") || s.includes("home") || s.startsWith("1");

    const adjustedHomeGoals = isHome ? homeScore + handicap : homeScore;
    const adjustedAwayGoals = isHome ? awayScore : awayScore + handicap;

    if (adjustedHomeGoals > adjustedAwayGoals) return isHome ? "won" : "lost";
    if (adjustedHomeGoals === adjustedAwayGoals) return "void";
    return isHome ? "lost" : "won";
  }

  // -------------------------------------------------------------------------
  // Mercado desconocido
  // -------------------------------------------------------------------------
  logger.warn({ market, selection }, "Mercado no reconocido — apuesta marcada como void");
  return "void";
}

// ---------------------------------------------------------------------------
// Función principal exportada
// ---------------------------------------------------------------------------

export interface VerificationSummary {
  date: string;
  totalPending: number;
  fixturesFound: number;
  statsFetched: number;
  resolved: number;
  won: number;
  lost: number;
  voided: number;
  notMatched: number;
}

export async function verificarResultadosDelDia(): Promise<VerificationSummary> {
  const now = new Date();
  const todayUTC = now.toISOString().split("T")[0];
  const keys = getApiFootballKeys();

  // Limpiar caché de estadísticas al inicio de cada ejecución
  statsCache.clear();

  logger.info({ date: todayUTC }, "Iniciando verificación de resultados");

  // 1. Todas las apuestas pendientes cuyo kickoff ya ha pasado (lookback automático)
  const allPending = await db
    .select()
    .from(betsTable)
    .where(eq(betsTable.status, "pending"));

  const overduePending = allPending.filter((b: { kickoffTime: string }) => hasKickoffPassed(b.kickoffTime));

  logger.info(
    { total: allPending.length, overdue: overduePending.length },
    "Apuestas pendientes con kickoff pasado",
  );

  const summary: VerificationSummary = {
    date: todayUTC,
    totalPending: overduePending.length,
    fixturesFound: 0,
    statsFetched: 0,
    resolved: 0,
    won: 0,
    lost: 0,
    voided: 0,
    notMatched: 0,
  };

  if (overduePending.length === 0) {
    logger.info("No hay apuestas pendientes con kickoff pasado");
    return summary;
  }

  // 2. Agrupar por fecha UTC de kickoff (una llamada a la API por fecha)
  const betsByDate = new Map<string, typeof overduePending>();
  for (const bet of overduePending) {
    const betDate = kickoffDateUTC(bet.kickoffTime);
    if (!betsByDate.has(betDate)) betsByDate.set(betDate, []);
    betsByDate.get(betDate)!.push(bet);
  }

  logger.info({ dates: [...betsByDate.keys()] }, "Fechas únicas de kickoff a verificar");

  // 3. Procesar cada fecha
  for (const [date, bets] of betsByDate.entries()) {
    let fixtures: FinishedFixtures;
    try {
      fixtures = await fetchFinishedFixtures(date);
    } catch (err) {
      logger.error({ err, date }, "Error al obtener resultados de API-Football para la fecha");
      summary.notMatched += bets.length;
      continue;
    }

    summary.fixturesFound += fixtures.byName.size;

    for (const bet of bets) {
      // Buscar el partido correspondiente (por ID exacto primero, luego por nombre)
      let fixture: FixtureResult | undefined;

      if (bet.fixtureId) {
        fixture = fixtures.byId.get(bet.fixtureId);
        if (!fixture) {
          logger.info(
            { betId: bet.id, fixtureId: bet.fixtureId, date },
            "Partido con fixtureId aún no finalizado — apuesta sin resolver",
          );
          summary.notMatched++;
          continue;
        }
      } else {
        fixture = findFixture(fixtures.byName, bet.homeTeam, bet.awayTeam);
      }

      if (!fixture) {
        logger.warn(
          { betId: bet.id, homeTeam: bet.homeTeam, awayTeam: bet.awayTeam, date },
          "Partido no encontrado en resultados — apuesta sin resolver",
        );
        summary.notMatched++;
        continue;
      }

      // Partido cancelado / suspendido / aplazado → anular
      if (
        fixture.statusShort === "CANC" ||
        fixture.statusShort === "ABD" ||
        fixture.statusShort === "PST"
      ) {
        await db
          .update(betsTable)
          .set({ status: "void", finalScore: "—" })
          .where(eq(betsTable.id, bet.id));
        summary.voided++;
        summary.resolved++;
        continue;
      }

      // Cargar estadísticas si el mercado las necesita (córners / tarjetas)
      let stats: FixtureStats | undefined;
      if (requiresStats(bet.market)) {
        const loaded = await loadFixtureStats(fixture, keys);
        if (loaded) {
          stats = loaded;
          // Contar solo llamadas únicas reales (no caché)
          if (!statsCache.has(fixture.fixtureId ?? -1)) summary.statsFetched++;
        }
      }

      // ── Parlay bet: evaluate all legs then decide ──────────────────────────
      if (bet.market === "Parlay del Día" && bet.notes) {
        let parsedParlay: { isParlay?: boolean; legs?: Array<{ homeTeam: string; awayTeam: string; market: string; selection: string; kickoffTime?: string | null }> } = {};
        try { parsedParlay = JSON.parse(bet.notes); } catch { /* ignore */ }

        if (parsedParlay.isParlay && Array.isArray(parsedParlay.legs)) {
          const legs = parsedParlay.legs;
          const legOutcomes: BetOutcome[] = [];
          let anyLegUnresolved = false;

          for (const leg of legs) {
            let legFixture: FixtureResult | undefined;
            // Try to find in the current date's fixture map
            legFixture = findFixture(fixtures.byName, leg.homeTeam, leg.awayTeam);

            if (!legFixture) {
              // Leg's match not yet finished — cannot resolve parlay yet
              anyLegUnresolved = true;
              break;
            }

            let legStats: FixtureStats | undefined;
            if (requiresStats(leg.market)) {
              const loaded = await loadFixtureStats(legFixture, keys);
              if (loaded) legStats = loaded;
            }

            const legOutcome = evaluateBet(leg.market, leg.selection, legFixture.homeScore, legFixture.awayScore, legStats);
            legOutcomes.push(legOutcome);

            if (legOutcome === "lost") break; // Short-circuit: parlay is already lost
          }

          if (anyLegUnresolved) {
            logger.info({ betId: bet.id }, "Parlay tiene partidos aún no finalizados — pospuesto");
            summary.notMatched++;
            continue;
          }

          // Determine parlay outcome
          const parlayOutcome: BetOutcome =
            legOutcomes.some(o => o === "lost") ? "lost" :
            legOutcomes.every(o => o === "won") ? "won" : "void";

          const returnAmount = parlayOutcome === "won"
            ? parseFloat((bet.stake * bet.odds).toFixed(2))
            : 0;

          await db
            .update(betsTable)
            .set({
              status: parlayOutcome,
              finalScore: `${legOutcomes.filter(o => o === "won").length}/${legs.length} picks`,
              returnAmount: parlayOutcome === "won" ? returnAmount : null,
            })
            .where(eq(betsTable.id, bet.id));

          if (parlayOutcome === "won") summary.won++;
          else if (parlayOutcome === "lost") summary.lost++;
          else summary.voided++;
          summary.resolved++;

          logger.info({ betId: bet.id, legOutcomes, parlayOutcome }, "Parlay resuelto");
          continue;
        }
      }
      // ── End parlay handling ────────────────────────────────────────────────

      const outcome = evaluateBet(
        bet.market,
        bet.selection,
        fixture.homeScore,
        fixture.awayScore,
        stats,
      );

      const finalScore = `${fixture.homeScore}-${fixture.awayScore}`;
      const returnAmount =
        outcome === "won" ? parseFloat((bet.stake * bet.odds).toFixed(2)) : 0;

      // Persist stats so the frontend can display them
      const finalStats = stats ? JSON.stringify({
        homeCorners: stats.homeCorners,
        awayCorners: stats.awayCorners,
        totalCorners: stats.totalCorners,
        homeYellowCards: stats.homeYellowCards,
        awayYellowCards: stats.awayYellowCards,
        homeRedCards: stats.homeRedCards,
        awayRedCards: stats.awayRedCards,
        totalCards: stats.totalCards,
        homeShotsOnGoal: stats.homeShotsOnGoal,
        awayShotsOnGoal: stats.awayShotsOnGoal,
        totalShotsOnGoal: stats.totalShotsOnGoal,
        homeTotalShots: stats.homeTotalShots,
        awayTotalShots: stats.awayTotalShots,
        totalShots: stats.totalShots,
        homeFouls: stats.homeFouls,
        awayFouls: stats.awayFouls,
        totalFouls: stats.totalFouls,
      }) : null;

      await db
        .update(betsTable)
        .set({
          status: outcome === "void" ? "void" : outcome,
          finalScore,
          ...(finalStats !== null && { finalStats }),
          returnAmount: outcome === "won" ? returnAmount : null,
        })
        .where(eq(betsTable.id, bet.id));

      if (outcome === "won") summary.won++;
      else if (outcome === "lost") summary.lost++;
      else summary.voided++;
      summary.resolved++;

      logger.info(
        {
          betId: bet.id,
          market: bet.market,
          selection: bet.selection,
          finalScore,
          outcome,
          ...(stats && { stats }),
        },
        "Apuesta resuelta",
      );
    }
  }

  logger.info(summary, "Verificación de resultados completada");
  return summary;
}

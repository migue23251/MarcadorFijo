/**
 * Servicio de verificación de resultados de apuestas.
 *
 * Hace UNA petición a API-Football por cada fecha con apuestas pendientes,
 * luego evalúa y liquida las apuestas sin consumir tokens de IA.
 *
 * Soporta lookback de hasta 7 días para recuperar apuestas no resueltas
 * por fallos previos del cron o partidos con kickoff en días anteriores.
 */

import { logger } from "../lib/logger";
import { fetchConRotacion } from "../lib/fetchConRotacion";
import { db, betsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface FixtureResult {
  homeScore: number;
  awayScore: number;
  /** FT | AET | PEN | AWD | WO | CANC | ABD | PST */
  statusShort: string;
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

/**
 * Extrae la fecha UTC (YYYY-MM-DD) del kickoffTime de una apuesta.
 * Acepta ISO strings con y sin offset de timezone.
 */
function kickoffDateUTC(kickoffTime: string): string {
  try {
    return new Date(kickoffTime).toISOString().split("T")[0];
  } catch {
    // Fallback: tomar los primeros 10 caracteres si el parse falla
    return kickoffTime.slice(0, 10);
  }
}

/**
 * Comprueba si el kickoff ya ha ocurrido (la hora de inicio ya pasó).
 */
function hasKickoffPassed(kickoffTime: string): boolean {
  try {
    return new Date(kickoffTime) <= new Date();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Petición a API-Football (una llamada por fecha)
// ---------------------------------------------------------------------------

function getApiFootballKeys(): string[] {
  return [
    process.env["API_FOOTBALL_KEY_1"],
    process.env["API_FOOTBALL_KEY_2"],
    process.env["FOOTBALL_API_KEY"],
  ].filter((k): k is string => Boolean(k));
}

interface FinishedFixtures {
  byName: FixtureMap;
  byId: FixtureIdMap;
}

async function fetchFinishedFixtures(date: string): Promise<FinishedFixtures> {
  const keys = getApiFootballKeys();
  if (keys.length === 0) {
    throw new Error("No API-Football keys configuradas (API_FOOTBALL_KEY_1 / FOOTBALL_API_KEY)");
  }

  // Pedir todos los partidos terminados (o en juego) del día para no perder
  // partidos aún en curso que podrían terminar pronto.
  const url = new URL("https://v3.football.api-sports.io/fixtures");
  url.searchParams.set("date", date);
  url.searchParams.set("status", "FT-AET-PEN-AWD-WO");

  logger.info({ date, url: url.pathname }, "Fetching finished fixtures from API-Football");

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

    const result: FixtureResult = {
      homeScore: f.goals?.home ?? 0,
      awayScore: f.goals?.away ?? 0,
      statusShort: f.fixture?.status?.short ?? "FT",
    };

    byName.set(`${homeName}|${awayName}`, result);

    const fixtureId: number | undefined = f.fixture?.id;
    if (fixtureId) byId.set(fixtureId, result);
  }

  return { byName, byId };
}

/**
 * Busca el resultado de un partido en el mapa. Intenta primero coincidencia
 * exacta; si falla, intenta coincidencia parcial.
 */
function findFixture(
  map: FixtureMap,
  homeBet: string,
  awayBet: string,
): FixtureResult | undefined {
  const homeKey = normalize(homeBet);
  const awayKey = normalize(awayBet);
  const exactKey = `${homeKey}|${awayKey}`;

  // 1. Exact match
  if (map.has(exactKey)) return map.get(exactKey);

  // 2. Partial match — iterate entries.
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
// Lógica de evaluación de apuestas (pura JS, sin IA)
// ---------------------------------------------------------------------------

type BetOutcome = "won" | "lost" | "void";

function evaluateBet(
  market: string,
  selection: string,
  homeScore: number,
  awayScore: number,
): BetOutcome {
  const m = market.toLowerCase();
  const s = selection.toLowerCase().trim();
  const totalGoals = homeScore + awayScore;

  // ------------------------------------------------------------------
  // 1X2 / Resultado Final
  // ------------------------------------------------------------------
  if (m.includes("1x2") || m.includes("resultado") || m.includes("match result")) {
    if (homeScore > awayScore) {
      return s === "1" || s === "local" || s === "home" ? "won" : "lost";
    } else if (homeScore === awayScore) {
      return s === "x" || s === "empate" || s === "draw" ? "won" : "lost";
    } else {
      return s === "2" || s === "visitante" || s === "away" ? "won" : "lost";
    }
  }

  // ------------------------------------------------------------------
  // Over / Under goles totales
  // ------------------------------------------------------------------
  if (
    m.includes("over") ||
    m.includes("under") ||
    m.includes("más") ||
    m.includes("menos") ||
    m.includes("total gol")
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

  // ------------------------------------------------------------------
  // BTTS / Ambos Anotan
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  // Hándicap Asiático
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  // Hándicap Europeo
  // ------------------------------------------------------------------
  if (m.includes("europeo") || m.includes("european") || m.includes("hándicap") || m.includes("handicap")) {
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

  // ------------------------------------------------------------------
  // Mercado desconocido → marcar como void
  // ------------------------------------------------------------------
  logger.warn({ market, selection }, "Mercado desconocido, apuesta marcada como void");
  return "void";
}

// ---------------------------------------------------------------------------
// Función principal exportada
// ---------------------------------------------------------------------------

export interface VerificationSummary {
  date: string;
  totalPending: number;
  fixturesFound: number;
  resolved: number;
  won: number;
  lost: number;
  voided: number;
  notMatched: number;
}

/**
 * Verifica y liquida todas las apuestas pendientes cuyos partidos ya
 * han comenzado, incluyendo apuestas de días anteriores (lookback 7 días).
 *
 * Agrupa las apuestas por fecha UTC de kickoff y hace una sola petición
 * a API-Football por cada fecha única.
 */
export async function verificarResultadosDelDia(): Promise<VerificationSummary> {
  const now = new Date();
  const todayUTC = now.toISOString().split("T")[0];

  logger.info({ date: todayUTC }, "Iniciando verificación de resultados");

  // 1. Obtener TODAS las apuestas pendientes cuyo kickoff ya ha pasado,
  //    sin restricción de fecha (lookback implícito).
  const allPending = await db
    .select()
    .from(betsTable)
    .where(eq(betsTable.status, "pending"));

  const overduePending = allPending.filter((b) => hasKickoffPassed(b.kickoffTime));

  logger.info(
    { total: allPending.length, overdue: overduePending.length },
    "Apuestas pendientes con kickoff pasado",
  );

  const summary: VerificationSummary = {
    date: todayUTC,
    totalPending: overduePending.length,
    fixturesFound: 0,
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

  // 2. Agrupar apuestas por fecha UTC de kickoff para minimizar
  //    llamadas a la API (una por fecha única).
  const betsByDate = new Map<string, typeof overduePending>();
  for (const bet of overduePending) {
    const betDate = kickoffDateUTC(bet.kickoffTime);
    if (!betsByDate.has(betDate)) betsByDate.set(betDate, []);
    betsByDate.get(betDate)!.push(bet);
  }

  logger.info(
    { dates: [...betsByDate.keys()] },
    "Fechas únicas de kickoff a verificar",
  );

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
      let fixture: FixtureResult | undefined;

      // Priorizar búsqueda por ID exacto de API-Football
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

      // Partido cancelado / suspendido / aplazado → anular apuesta
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

      const outcome = evaluateBet(
        bet.market,
        bet.selection,
        fixture.homeScore,
        fixture.awayScore,
      );
      const finalScore = `${fixture.homeScore}-${fixture.awayScore}`;
      const returnAmount =
        outcome === "won" ? parseFloat((bet.stake * bet.odds).toFixed(2)) : 0;

      await db
        .update(betsTable)
        .set({
          status: outcome === "void" ? "void" : outcome,
          finalScore,
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
          returnAmount: outcome === "won" ? returnAmount : 0,
        },
        "Apuesta resuelta",
      );
    }
  }

  logger.info(summary, "Verificación de resultados completada");
  return summary;
}

/**
 * Servicio de verificación nocturna de resultados.
 *
 * Hace UNA sola petición a API-Football para obtener todos los partidos
 * terminados del día, luego evalúa y liquida las apuestas pendientes de
 * cada usuario sin consumir tokens de IA.
 */

import { logger } from "../lib/logger";
import { db, betsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface FixtureResult {
  homeScore: number;
  awayScore: number;
  /** FT | AET | PEN | AWD | WO | CANC | ABD */
  statusShort: string;
}

// Clave: "<homeTeam_lower>|<awayTeam_lower>"
type FixtureMap = Map<string, FixtureResult>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(name: string): string {
  return name.toLowerCase().trim();
}

function todayUTC(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Comprueba si la fecha de kickoff de la apuesta corresponde a hoy (UTC).
 * `kickoffTime` puede ser ISO string ("2026-07-26T20:00:00Z") o date string.
 */
function isTodayKickoff(kickoffTime: string, date: string): boolean {
  return kickoffTime.startsWith(date);
}

// ---------------------------------------------------------------------------
// Petición a API-Football (una sola llamada)
// ---------------------------------------------------------------------------

async function fetchFinishedFixtures(date: string): Promise<FixtureMap> {
  const apiKey = process.env["FOOTBALL_API_KEY"];
  if (!apiKey) {
    throw new Error("FOOTBALL_API_KEY no está configurada");
  }

  // Una única petición con todos los estados finalizados
  const url = new URL("https://v3.football.api-sports.io/fixtures");
  url.searchParams.set("date", date);
  url.searchParams.set("status", "FT-AET-PEN-AWD-WO");

  logger.info({ date, url: url.toString() }, "Fetching finished fixtures from API-Football");

  const res = await fetch(url.toString(), {
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": "v3.football.api-sports.io",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API-Football HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  const fixtures: any[] = Array.isArray(data?.response) ? data.response : [];

  logger.info({ date, count: fixtures.length }, "Finished fixtures received");

  const map: FixtureMap = new Map();

  for (const f of fixtures) {
    const homeName = normalize(f.teams?.home?.name ?? "");
    const awayName = normalize(f.teams?.away?.name ?? "");
    if (!homeName || !awayName) continue;

    map.set(`${homeName}|${awayName}`, {
      homeScore: f.goals?.home ?? 0,
      awayScore: f.goals?.away ?? 0,
      statusShort: f.fixture?.status?.short ?? "FT",
    });
  }

  return map;
}

/**
 * Busca el resultado de un partido en el mapa. Intenta primero coincidencia
 * exacta; si falla, intenta coincidencia parcial (el nombre de la apuesta
 * contiene el nombre del fixture o viceversa).
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

  // 2. Partial match — iterate entries
  for (const [key, result] of map.entries()) {
    const [fHome, fAway] = key.split("|");
    const homeMatch =
      fHome.includes(homeKey) ||
      homeKey.includes(fHome);
    const awayMatch =
      fAway.includes(awayKey) ||
      awayKey.includes(fAway);
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
      // Home win → "1"
      return s === "1" || s === "local" || s === "home" ? "won" : "lost";
    } else if (homeScore === awayScore) {
      // Draw → "X"
      return s === "x" || s === "empate" || s === "draw" ? "won" : "lost";
    } else {
      // Away win → "2"
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
    // Extraer el número de la selección: "Over 2.5" → 2.5
    const lineMatch = s.match(/(\d+(?:\.\d+)?)/);
    if (!lineMatch) return "void";
    const line = parseFloat(lineMatch[1]);

    if (s.startsWith("over") || s.startsWith("más") || s.startsWith("+")) {
      return totalGoals > line ? "won" : "lost";
    } else {
      // Under
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
    // Selección: "Local -1.5" / "Visitante +1.5" / "Home -1" / "Away +2"
    const lineMatch = s.match(/([+-]?\d+(?:\.\d+)?)\s*$/);
    if (!lineMatch) return "void";
    const handicap = parseFloat(lineMatch[1]);
    const isHome =
      s.includes("local") || s.includes("home") || s.startsWith("1");
    const effectiveHome = isHome ? homeScore + handicap : homeScore;
    const effectiveAway = isHome ? awayScore : awayScore + handicap;

    if (effectiveHome > effectiveAway) return isHome ? "won" : "lost";
    if (effectiveHome < effectiveAway) return isHome ? "lost" : "won";
    return "void"; // push on whole-number lines
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

    if (adjustedHomeGoals > adjustedAwayGoals)
      return isHome ? "won" : "lost";
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

export async function verificarResultadosDelDia(): Promise<VerificationSummary> {
  const date = todayUTC();
  logger.info({ date }, "Iniciando verificación de resultados del día");

  // 1. Obtener resultados finales de API-Football (1 sola llamada)
  const fixtureMap = await fetchFinishedFixtures(date);

  // 2. Consultar apuestas pendientes cuyo kickoff sea hoy
  const pendingBets = await db
    .select()
    .from(betsTable)
    .where(eq(betsTable.status, "pending"));

  const todayPending = pendingBets.filter((b) =>
    isTodayKickoff(b.kickoffTime, date),
  );

  logger.info(
    { total: pendingBets.length, todayPending: todayPending.length },
    "Apuestas pendientes de hoy",
  );

  const summary: VerificationSummary = {
    date,
    totalPending: todayPending.length,
    fixturesFound: fixtureMap.size,
    resolved: 0,
    won: 0,
    lost: 0,
    voided: 0,
    notMatched: 0,
  };

  // 3. Evaluar cada apuesta
  for (const bet of todayPending) {
    const fixture = findFixture(fixtureMap, bet.homeTeam, bet.awayTeam);

    if (!fixture) {
      logger.warn(
        { betId: bet.id, homeTeam: bet.homeTeam, awayTeam: bet.awayTeam },
        "Partido no encontrado en resultados de hoy — apuesta sin resolver",
      );
      summary.notMatched++;
      continue;
    }

    // Partido cancelado / suspendido → anular apuesta
    if (fixture.statusShort === "CANC" || fixture.statusShort === "ABD" || fixture.statusShort === "PST") {
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

  logger.info(summary, "Verificación de resultados completada");
  return summary;
}

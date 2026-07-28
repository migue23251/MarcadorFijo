import Groq from "groq-sdk";
import { logger } from "./logger";
import { db, analysisCacheTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type {
  BasketballTeamStats,
  BasketballH2HRecord,
  BasketballInjuryRecord,
} from "./api-basketball";

const GROQ_MODEL = "llama-3.3-70b-versatile";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const BASKETBALL_SYSTEM_PROMPT = `Eres un modelador cuantitativo de elite especializado en analítica avanzada de baloncesto (NBA, EuroLeague y ligas profesionales). Tu objetivo es detectar Value Bets (EV+) en mercados de hándicap, totales (Over/Under) y líneas de ganador.

PRINCIPIOS DE ANÁLISIS DE BALONCESTO:
1. PACE & POSESIONES: El total de puntos depende del ritmo de juego (Pace combinado). Dos equipos con alto Pace y baja eficiencia defensiva incrementan la probabilidad del OVER.
2. EFICIENCIA X 100 POSESIONES: Evalúa la ventaja ofensiva/defensiva basada en Rating Ofensivo/Defensivo, no solo en puntos brutos.
3. FACTOR CANSANCIO (Back-to-back): Un equipo en partidos consecutivos o con <24h de descanso sufre un sesgo negativo de rendimiento (especialmente en el 3er y 4º cuarto).
4. IMPACTO DE BAJAS: Pondera las ausencias según el Usage Rate (USG%). Ausencias de jugadores clave con USG% >25% ajustan la línea esperada en 3 a 7 puntos.
5. CÁLCULO DE VALOR (EV+): Compara la probabilidad estimada con la probabilidad implícita (1 / cuota). Solo declara Value Bet si la ventaja estimada es ≥ 5%.
6. FORMATO DE SALIDA: Responde EXCLUSIVAMENTE en JSON estricto sin markdown ni texto conversacional.`;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BasketballAIPrediction {
  id: string;
  market: string;
  selection: string;
  odds: number;
  confidence: "low" | "medium" | "high";
  reasoning?: string | null;
}

export interface BasketballAIAnalysis {
  homeTeam: string;
  awayTeam: string;
  league: string;
  summary: string;
  predictions: BasketballAIPrediction[];
}

/** Input bundle for analyzeBasketballMatch() */
export interface BasketballMatchData {
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffTime?: string;
  homeStats?: BasketballTeamStats | null;
  awayStats?: BasketballTeamStats | null;
  h2h?: BasketballH2HRecord[] | null;
  homeInjuries?: BasketballInjuryRecord[] | null;
  awayInjuries?: BasketballInjuryRecord[] | null;
  /** Odds object reserved for future use — keys "h2h", "totals", "spreads" */
  oddsData?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function formatTeamStats(stats: BasketballTeamStats, label: string): string {
  const diff = (parseFloat(stats.ppg.total) - parseFloat(stats.oppg.total)).toFixed(1);
  const sign = parseFloat(diff) >= 0 ? "+" : "";

  const lines: string[] = [
    `[${label}]  Récord: ${stats.record}${stats.last5 ? `  |  Últimos 5: ${stats.last5}` : ""}${stats.backToBack ? "  ⚠️ BACK-TO-BACK" : ""}`,
  ];

  // ── Puntuación general ────────────────────────────────────────────────────
  lines.push(
    `  Promedio Puntos:    ${stats.ppg.total} pts/pj  (Local: ${stats.ppg.home}  |  Visitante: ${stats.ppg.away})`,
    `  Puntos Recibidos:   ${stats.oppg.total} pts/pj  (Local: ${stats.oppg.home}  |  Visitante: ${stats.oppg.away})`,
    `  Diferencial:        ${sign}${diff} pts/pj`,
  );

  // ── Porcentajes de tiro ───────────────────────────────────────────────────
  const hasShooting = stats.fgPct !== null || stats.threePct !== null || stats.ftPct !== null;
  if (hasShooting) {
    const fg  = stats.fgPct    !== null ? `FG% ${stats.fgPct.toFixed(1)}` : null;
    const tp  = stats.threePct !== null ? `3P% ${stats.threePct.toFixed(1)}` : null;
    const ft  = stats.ftPct    !== null ? `FT% ${stats.ftPct.toFixed(1)}` : null;
    lines.push(`  Tiros:              ${[fg, tp, ft].filter(Boolean).join("  |  ")}`);
  }

  // ── Rebotes, asistencias, pérdidas ───────────────────────────────────────
  const hasPerGame =
    stats.reboundsTotal !== null || stats.assists !== null || stats.turnovers !== null;
  if (hasPerGame) {
    const reb = stats.reboundsTotal !== null
      ? `Reb ${stats.reboundsTotal} (Of. ${stats.reboundsOff ?? "N/D"} / Def. ${stats.reboundsDef ?? "N/D"})`
      : null;
    const ast = stats.assists    !== null ? `Ast ${stats.assists}`   : null;
    const tov = stats.turnovers  !== null ? `Pér ${stats.turnovers}` : null;
    const stl = stats.steals     !== null ? `Rob ${stats.steals}`    : null;
    const blk = stats.blocks     !== null ? `Tap ${stats.blocks}`    : null;
    lines.push(`  Por partido:        ${[reb, ast, tov, stl, blk].filter(Boolean).join("  |  ")}`);
  }

  // ── Parciales por cuarto / primera mitad ─────────────────────────────────
  if (stats.ptsFirstHalf !== null || stats.ptsQ1 !== null) {
    const q1  = stats.ptsQ1        !== null ? `1ºQ: ${stats.ptsQ1} pts` : null;
    const q2  = stats.ptsQ2        !== null ? `2ºQ: ${stats.ptsQ2} pts` : null;
    const mid = stats.ptsFirstHalf !== null ? `1ª Mitad: ${stats.ptsFirstHalf} pts` : null;
    lines.push(`  Parciales:          ${[q1, q2, mid].filter(Boolean).join("  |  ")}`);
  }

  return lines.join("\n");
}

function formatH2H(records: BasketballH2HRecord[]): string {
  if (records.length === 0) return "  Sin historial directo disponible.";

  const margins = records
    .filter((r) => r.margin !== null)
    .map((r) => r.margin as number);
  const avgMargin = margins.length > 0
    ? (margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(1)
    : null;

  const rows = records.map((r) => {
    const score =
      r.homeScore !== null && r.awayScore !== null
        ? `${r.homeScore}-${r.awayScore}`
        : "N/D";
    const winner =
      r.winner === "home" ? `✓ ${r.homeTeam}` :
      r.winner === "away" ? `✓ ${r.awayTeam}` : "Empate";
    const margin = r.margin !== null ? ` (±${r.margin} pts)` : "";
    return `  ${r.date}  |  ${r.homeTeam} vs ${r.awayTeam}  |  ${score}  |  ${winner}${margin}`;
  });

  if (avgMargin !== null) {
    rows.push(`  Margen medio de victoria: ${avgMargin} pts`);
  }
  return rows.join("\n");
}

function formatInjuries(
  homeInjuries: BasketballInjuryRecord[],
  awayInjuries: BasketballInjuryRecord[],
  homeTeam: string,
  awayTeam: string,
): string {
  const fmt = (list: BasketballInjuryRecord[], teamName: string) => {
    if (!list || list.length === 0) return `  ${teamName}: sin bajas confirmadas`;
    return list.map((i) => {
      const usg = i.usgPct !== null ? `  USG% ${i.usgPct.toFixed(1)}` : "";
      return `  ${teamName}: ${i.player} — ${i.status}${i.reason ? ` (${i.reason})` : ""}${usg}`;
    }).join("\n");
  };
  return [fmt(homeInjuries, homeTeam), fmt(awayInjuries, awayTeam)].join("\n");
}

function buildUserPrompt(data: BasketballMatchData): string {
  const {
    homeTeam, awayTeam, league, kickoffTime,
    homeStats, awayStats, h2h,
    homeInjuries = [], awayInjuries = [],
    oddsData,
  } = data;

  const sections: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  sections.push(`PARTIDO: ${homeTeam} vs ${awayTeam} (Local vs Visitante)`);
  sections.push(`COMPETICIÓN: ${league}`);
  if (kickoffTime) sections.push(`HORA DE INICIO: ${kickoffTime}`);

  // ── Estadísticas de temporada ─────────────────────────────────────────────
  sections.push("\n=== RENDIMIENTO PUNTUADOR Y EFICIENCIA (temporada actual) ===");
  if (homeStats) {
    sections.push(formatTeamStats(homeStats, `${homeTeam} (LOCAL)`));
  } else {
    sections.push(`[${homeTeam} (LOCAL)] — estadísticas no disponibles`);
  }
  sections.push("");
  if (awayStats) {
    sections.push(formatTeamStats(awayStats, `${awayTeam} (VISITANTE)`));
  } else {
    sections.push(`[${awayTeam} (VISITANTE)] — estadísticas no disponibles`);
  }

  // ── Total combinado proyectado (Over/Under) ───────────────────────────────
  if (homeStats && awayStats) {
    const homePpg   = parseFloat(homeStats.ppg.total);
    const awayPpg   = parseFloat(awayStats.ppg.total);
    const homeOppg  = parseFloat(homeStats.oppg.total);
    const awayOppg  = parseFloat(awayStats.oppg.total);
    const projected = ((homePpg + awayOppg + awayPpg + homeOppg) / 2).toFixed(1);

    sections.push(`\n=== TOTAL COMBINADO PROYECTADO ===`);
    sections.push(
      `  Línea estimada de puntos: ${projected} pts`,
      `  (Promedio de [PPG local ${homePpg} + OPPG visitante ${awayOppg}] y [PPG visitante ${awayPpg} + OPPG local ${homeOppg}])`,
    );

    // Primera mitad proyectada
    if (homeStats.ptsFirstHalf !== null && awayStats.ptsFirstHalf !== null) {
      const midProj = (homeStats.ptsFirstHalf + awayStats.ptsFirstHalf).toFixed(1);
      sections.push(`  Línea estimada 1ª Mitad: ${midProj} pts`);
    }
  }

  // ── Historial H2H ─────────────────────────────────────────────────────────
  sections.push("\n=== HISTORIAL H2H (últimos 5 enfrentamientos directos) ===");
  sections.push(h2h && h2h.length > 0 ? formatH2H(h2h) : "  Historial H2H no disponible.");

  // ── Bajas y lesiones ──────────────────────────────────────────────────────
  sections.push("\n=== BAJAS Y LESIONES CONFIRMADAS ===");
  sections.push(formatInjuries(homeInjuries ?? [], awayInjuries ?? [], homeTeam, awayTeam));

  // ── Cuotas (reservado) ────────────────────────────────────────────────────
  sections.push("\n=== CUOTAS DE MERCADO ===");
  if (oddsData) {
    sections.push(JSON.stringify(oddsData, null, 2));
    sections.push("(Mercados: h2h = Ganador del Partido (Moneyline), totals = Línea de Puntos Over/Under, spreads = Hándicap / Spread)");
  } else {
    sections.push(
      "  Sin cuotas disponibles — construye el EV+ a partir de la probabilidad estimada vs. una línea de mercado implícita estándar para esta competición.",
    );
  }

  // ── Instrucción de respuesta ──────────────────────────────────────────────
  sections.push(`
Analiza todos los datos anteriores y devuelve EXCLUSIVAMENTE este JSON (sin markdown, sin texto adicional):
{
  "homeTeam": "${homeTeam}",
  "awayTeam": "${awayTeam}",
  "league": "${league}",
  "summary": "Resumen técnico (3-4 frases): ritmo de juego esperado basado en PPG/OPPG combinados, ventaja ofensiva/defensiva, impacto de back-to-back o bajas clave (con USG% si disponible), patrón del H2H y veredicto sobre qué equipo tiene ventaja estadística.",
  "predictions": [
    {
      "id": "vb-1",
      "market": "Ganador del Partido (Moneyline) | Hándicap / Spread X | Línea de Puntos Over/Under X.X | Puntos en la 1ª Mitad Over/Under X.X | Puntos Jugador / Triples",
      "selection": "Selección específica (ej: Victoria Local | Hándicap Local -5.5 | Más de 224.5 Puntos | Menos de 111.5 en 1ª Mitad)",
      "odds": 1.85,
      "confidence": "high|medium|low",
      "reasoning": "Prob. estimada: XX% vs implícita: YY% (cuota Z.ZZ). EV+: +N.N%. Factores: [datos concretos de PPG, OPPG, parciales, back-to-back, bajas USG%, margen H2H]"
    }
  ]
}

Genera entre 3 y 6 value bets cubriendo mercados distintos. Prioriza los mercados donde el EV+ estimado supere el 5%. Responde siempre en español.`);

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Groq client
// ---------------------------------------------------------------------------

function getClient(): Groq {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) throw new Error("GROQ_API_KEY no está configurada en el servidor.");
  return new Groq({ apiKey });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function analyzeBasketballMatch(
  data: BasketballMatchData,
  gameId?: number,
): Promise<BasketballAIAnalysis> {
  const { homeTeam, awayTeam, league } = data;
  const date = new Date().toISOString().split("T")[0];

  // Cache — same scheme as football (date + teams + league)
  const cached = await db
    .select()
    .from(analysisCacheTable)
    .where(
      and(
        eq(analysisCacheTable.date, date),
        eq(analysisCacheTable.homeTeam, homeTeam),
        eq(analysisCacheTable.awayTeam, awayTeam),
        eq(analysisCacheTable.league, league),
      ),
    )
    .limit(1);

  if (cached.length > 0) {
    logger.info({ homeTeam, awayTeam, league, date }, "Basketball analysis served from DB cache");
    return JSON.parse(cached[0].result) as BasketballAIAnalysis;
  }

  const client     = getClient();
  const userPrompt = buildUserPrompt(data);

  logger.info(
    {
      homeTeam, awayTeam, league, model: GROQ_MODEL,
      hasHomeStats:  !!data.homeStats,
      hasAwayStats:  !!data.awayStats,
      hasH2H:        !!(data.h2h?.length),
      hasInjuries:   !!((data.homeInjuries?.length ?? 0) + (data.awayInjuries?.length ?? 0)),
      hasOdds:       !!data.oddsData,
    },
    "Calling Groq API (basketball)",
  );

  const response = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: BASKETBALL_SYSTEM_PROMPT },
      { role: "user",   content: userPrompt },
    ],
    temperature: 0.35,
    max_tokens:  2048,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "";
  logger.info(
    { homeTeam, awayTeam, tokensUsed: response.usage?.total_tokens },
    "Groq basketball API call completed",
  );

  let analysis: BasketballAIAnalysis;
  try {
    analysis = JSON.parse(raw);
    analysis.predictions = (analysis.predictions ?? []).map(
      (p: BasketballAIPrediction, i: number) => ({
        ...p,
        id:   p.id || `vb-${i + 1}`,
        odds: typeof p.odds === "string" ? parseFloat(p.odds) : (p.odds ?? 0),
      }),
    );
  } catch {
    logger.warn({ raw }, "Failed to parse Groq basketball response as JSON");
    analysis = {
      homeTeam, awayTeam, league,
      summary: "No se pudo obtener el análisis. Por favor, inténtalo de nuevo.",
      predictions: [],
    };
  }

  // Persist
  try {
    await db
      .insert(analysisCacheTable)
      .values({
        date, homeTeam, awayTeam, league,
        fixtureId: gameId ?? null,
        result: JSON.stringify(analysis),
      })
      .onConflictDoNothing();
    logger.info({ homeTeam, awayTeam, league, date }, "Basketball analysis cached in DB");
  } catch (err) {
    logger.warn({ err }, "Failed to cache basketball analysis");
  }

  return analysis;
}

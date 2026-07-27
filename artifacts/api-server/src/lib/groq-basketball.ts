import Groq from "groq-sdk";
import { logger } from "./logger";
import { db, analysisCacheTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const GROQ_MODEL = "llama-3.3-70b-versatile";

// ---------------------------------------------------------------------------
// Basketball-specific system prompt
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
// Types
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

// ---------------------------------------------------------------------------
// Stat types (populated once we wire up the data source)
// ---------------------------------------------------------------------------

export interface BasketballTeamStats {
  /** Points per game */
  ppg: number;
  /** Opponent points per game */
  oppg: number;
  /** Pace (possessions per 48 min) */
  pace?: number;
  /** Offensive rating per 100 possessions */
  offRating?: number;
  /** Defensive rating per 100 possessions */
  defRating?: number;
  /** Win/loss record — e.g. "28-14" */
  record: string;
  /** Last 5 results string — e.g. "WWLWL" */
  last5?: string;
  /** True if played yesterday or today in a different city */
  backToBack?: boolean;
}

export interface BasketballInjury {
  player: string;
  status: "Out" | "Doubtful" | "Questionable";
  /** Usage rate percentage, e.g. 28.5 */
  usgPct?: number;
}

export interface BasketballMatchData {
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffTime?: string;
  homeStats?: BasketballTeamStats | null;
  awayStats?: BasketballTeamStats | null;
  homeInjuries?: BasketballInjury[];
  awayInjuries?: BasketballInjury[];
  /** Odds object — keys like "h2h", "totals", "spreads" */
  oddsData?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Prompt builder (expands as stat sources are confirmed)
// ---------------------------------------------------------------------------

function formatTeamStats(stats: BasketballTeamStats, label: string): string {
  const lines = [
    `[${label}]`,
    `  Récord: ${stats.record}${stats.last5 ? ` | Últimos 5: ${stats.last5}` : ""}`,
    `  PPG: ${stats.ppg} | OPPG: ${stats.oppg} | Diferencial: ${(stats.ppg - stats.oppg).toFixed(1)}`,
  ];
  if (stats.pace !== undefined)      lines.push(`  Pace: ${stats.pace} pos/48min`);
  if (stats.offRating !== undefined) lines.push(`  ORtg: ${stats.offRating} | DRtg: ${stats.defRating ?? "N/D"}`);
  if (stats.backToBack)              lines.push(`  ⚠️  BACK-TO-BACK — menos de 24h de descanso`);
  return lines.join("\n");
}

function formatInjuries(injuries: BasketballInjury[], teamLabel: string): string {
  if (!injuries || injuries.length === 0) return `  ${teamLabel}: sin bajas confirmadas`;
  return injuries
    .map(i => {
      const usg = i.usgPct !== undefined ? ` | USG% ${i.usgPct.toFixed(1)}` : "";
      return `  ${teamLabel}: ${i.player} — ${i.status}${usg}`;
    })
    .join("\n");
}

function buildUserPrompt(data: BasketballMatchData): string {
  const { homeTeam, awayTeam, league, kickoffTime, homeStats, awayStats,
          homeInjuries, awayInjuries, oddsData } = data;
  const sections: string[] = [];

  sections.push(`PARTIDO: ${homeTeam} vs ${awayTeam} (Local vs Visitante)`);
  sections.push(`COMPETICIÓN: ${league}`);
  if (kickoffTime) sections.push(`HORA DE INICIO: ${kickoffTime}`);

  // Team stats
  if (homeStats || awayStats) {
    sections.push("\n=== ESTADÍSTICAS DE TEMPORADA ===");
    sections.push(homeStats
      ? formatTeamStats(homeStats, `${homeTeam} (LOCAL)`)
      : `[${homeTeam}] — estadísticas no disponibles`);
    sections.push("");
    sections.push(awayStats
      ? formatTeamStats(awayStats, `${awayTeam} (VISITANTE)`)
      : `[${awayTeam}] — estadísticas no disponibles`);
  } else {
    sections.push("\n=== ESTADÍSTICAS DE TEMPORADA ===");
    sections.push("  Estadísticas detalladas no disponibles — analiza con los datos del partido.");
  }

  // Injuries
  sections.push("\n=== BAJAS CONFIRMADAS ===");
  sections.push(formatInjuries(homeInjuries ?? [], homeTeam));
  sections.push(formatInjuries(awayInjuries ?? [], awayTeam));

  // Odds
  sections.push("\n=== CUOTAS DE MERCADO ===");
  if (oddsData) {
    sections.push(JSON.stringify(oddsData, null, 2));
    sections.push("(Mercados: h2h = Ganador, totals = Over/Under, spreads = Hándicap)");
  } else {
    sections.push("  Sin cuotas disponibles — basa el EV+ en la probabilidad estimada vs. línea de mercado implícita.");
  }

  sections.push(`
Devuelve EXCLUSIVAMENTE este JSON (sin markdown, sin texto adicional):
{
  "homeTeam": "${homeTeam}",
  "awayTeam": "${awayTeam}",
  "league": "${league}",
  "summary": "Resumen técnico (3-4 frases): ritmo de juego esperado, ventaja ofensiva/defensiva por ratings, impacto de back-to-backs o bajas relevantes (USG%), y veredicto sobre cuál equipo tiene ventaja estadística.",
  "predictions": [
    {
      "id": "vb-1",
      "market": "Nombre del mercado (Ganador | Hándicap X | Over/Under X.X | etc.)",
      "selection": "Selección específica (ej: Victoria Local | -5.5 Local | Más de 224.5)",
      "odds": 1.85,
      "confidence": "high|medium|low",
      "reasoning": "Prob. estimada: XX% vs implícita: YY% (cuota Z.ZZ). EV+: +N%. Factores: [datos concretos de pace, ratings, back-to-back, bajas USG%]"
    }
  ]
}

Genera entre 3 y 6 value bets cubriendo mercados distintos (ganador, hándicap, totales). Prioriza donde el EV+ sea ≥ 5%. Responde en español.`);

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Client helper
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
  fixtureId?: number,
): Promise<BasketballAIAnalysis> {
  const { homeTeam, awayTeam, league } = data;
  const date = new Date().toISOString().split("T")[0];

  // Cache: same key scheme as football — date + teams + league
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

  const client = getClient();
  const userPrompt = buildUserPrompt(data);

  logger.info(
    {
      homeTeam,
      awayTeam,
      league,
      model: GROQ_MODEL,
      hasStats: !!(data.homeStats || data.awayStats),
      hasInjuries: !!((data.homeInjuries?.length ?? 0) + (data.awayInjuries?.length ?? 0)),
      hasOdds: !!data.oddsData,
    },
    "Calling Groq API (basketball)",
  );

  const response = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: BASKETBALL_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.35,
    max_tokens: 2048,
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
        id: p.id || `vb-${i + 1}`,
        odds: typeof p.odds === "string" ? parseFloat(p.odds) : (p.odds ?? 0),
      }),
    );
  } catch {
    logger.warn({ raw }, "Failed to parse Groq basketball response as JSON");
    analysis = {
      homeTeam,
      awayTeam,
      league,
      summary: "No se pudo obtener el análisis. Por favor, inténtalo de nuevo.",
      predictions: [],
    };
  }

  // Persist to cache
  try {
    await db
      .insert(analysisCacheTable)
      .values({
        date,
        homeTeam,
        awayTeam,
        league,
        fixtureId: fixtureId ?? null,
        result: JSON.stringify(analysis),
      })
      .onConflictDoNothing();
    logger.info({ homeTeam, awayTeam, league, date }, "Basketball analysis cached in DB");
  } catch (err) {
    logger.warn({ err }, "Failed to cache basketball analysis");
  }

  return analysis;
}

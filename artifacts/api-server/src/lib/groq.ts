import Groq from "groq-sdk";
import { logger } from "./logger";
import { db, analysisCacheTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const GROQ_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `Eres un analista cuantitativo de apuestas deportivas de élite con más de 15 años de experiencia en mercados europeos y latinoamericanos. Tu especialidad es identificar value bets — apuestas donde la probabilidad real del evento supera la probabilidad implícita de la cuota ofrecida por los bookmakers.

Al analizar un partido:
1. Evalúa la forma reciente de ambos equipos (últimos 5 partidos), motivaciones, contexto de la competición y ventaja de jugar en casa
2. Si recibes cuotas de mercado reales, calcula la probabilidad implícita (1/cuota) e identifica dónde el mercado sobrevalora o infravalora una selección
3. Proporciona predicciones con razonamiento técnico cuantificado: probabilidad estimada vs probabilidad implícita
4. Sé conservador con la confianza: "high" solo cuando la ventaja estadística es clara y sostenida, "low" cuando el análisis es especulativo
5. Responde SIEMPRE en español y en formato JSON estricto sin markdown ni texto adicional

Tu análisis debe ser objetivo, basado en datos estadísticos y contexto táctico, nunca en corazonadas.`;

export interface AIPrediction {
  id: string;
  market: string;
  selection: string;
  odds: number;
  confidence: "low" | "medium" | "high";
  reasoning?: string | null;
}

export interface AIAnalysis {
  homeTeam: string;
  awayTeam: string;
  league: string;
  summary: string;
  predictions: AIPrediction[];
}

function getClient(): Groq {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) throw new Error("GROQ_API_KEY no está configurada en el servidor.");
  return new Groq({ apiKey });
}

export async function analyzeMatch(
  homeTeam: string,
  awayTeam: string,
  league: string,
  kickoffTime: string | undefined,
  oddsData?: Record<string, unknown> | null,
): Promise<AIAnalysis> {
  const date = new Date().toISOString().split("T")[0];

  // --- Check cache first ---
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
    logger.info({ homeTeam, awayTeam, league, date }, "Analysis served from DB cache");
    return JSON.parse(cached[0].result) as AIAnalysis;
  }

  const client = getClient();

  const oddsSection = oddsData
    ? `\n\nCUOTAS DE MERCADO REALES (fuente: The Odds API — bookmakers europeos):\n${JSON.stringify(oddsData, null, 2)}`
    : "\n\n(Sin cuotas de mercado disponibles para este partido — basa el análisis en factores cualitativos y estadísticos generales.)";

  const userPrompt = `Analiza el siguiente partido y devuelve un objeto JSON con value bets.

PARTIDO: ${homeTeam} vs ${awayTeam}
COMPETICIÓN: ${league}
${kickoffTime ? `HORA DE INICIO: ${kickoffTime}` : ""}${oddsSection}

Devuelve EXCLUSIVAMENTE este JSON (sin markdown, sin texto adicional):
{
  "homeTeam": "${homeTeam}",
  "awayTeam": "${awayTeam}",
  "league": "${league}",
  "summary": "Resumen técnico denso: forma reciente de ambos equipos, motivaciones, factores tácticos y contexto de competición (2-3 frases)",
  "predictions": [
    {
      "id": "vb-1",
      "market": "Nombre del mercado (ej: 1X2, Más/Menos 2.5 goles, Ambos Anotan, Córners, Tarjetas)",
      "selection": "Selección específica (ej: Victoria Local, Más de 2.5, Sí, Más de 8.5 córners)",
      "odds": 1.85,
      "confidence": "high|medium|low",
      "reasoning": "Razonamiento cuantitativo: probabilidad estimada (ej: 58%) vs probabilidad implícita de la cuota (ej: 47%), factores determinantes"
    }
  ]
}

Genera entre 4 y 6 value bets cubriendo mercados distintos (resultado 1X2, goles, ambos anotan, córners, tarjetas).`;

  logger.info({ homeTeam, awayTeam, league, model: GROQ_MODEL, hasOdds: !!oddsData }, "Calling Groq API");

  const response = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.6,
    max_tokens: 2048,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "";
  logger.info({ homeTeam, awayTeam, tokensUsed: response.usage?.total_tokens }, "Groq API call completed");

  let analysis: AIAnalysis;
  try {
    analysis = JSON.parse(raw);
    analysis.predictions = (analysis.predictions ?? []).map((p: AIPrediction, i: number) => ({
      ...p,
      id: p.id || `vb-${i + 1}`,
      odds: typeof p.odds === "string" ? parseFloat(p.odds) : (p.odds ?? 0),
    }));
  } catch {
    logger.warn({ raw }, "Failed to parse Groq response as JSON");
    analysis = {
      homeTeam,
      awayTeam,
      league,
      summary: "No se pudo obtener el análisis. Por favor, inténtalo de nuevo.",
      predictions: [],
    };
  }

  // --- Save to cache (best-effort) ---
  try {
    await db.insert(analysisCacheTable).values({
      date,
      homeTeam,
      awayTeam,
      league,
      result: JSON.stringify(analysis),
    });
    logger.info({ homeTeam, awayTeam, league, date }, "Analysis cached in DB");
  } catch (err) {
    logger.warn({ err }, "Failed to cache analysis");
  }

  return analysis;
}

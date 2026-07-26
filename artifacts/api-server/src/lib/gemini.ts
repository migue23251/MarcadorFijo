import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { logger } from "./logger";
import { db, analysisCacheTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

interface GeminiPrediction {
  id: string;
  market: string;
  selection: string;
  odds: number;
  confidence: "low" | "medium" | "high";
  reasoning?: string | null;
}

interface GeminiAnalysis {
  homeTeam: string;
  awayTeam: string;
  league: string;
  summary: string;
  predictions: GeminiPrediction[];
}

export class GeminiApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Seconds the caller should wait before retrying (from Gemini's Retry-After) */
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "GeminiApiError";
  }
}

function makeClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

async function callGemini(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<string> {
  const ai = makeClient(apiKey);

  let response: GenerateContentResponse;
  try {
    response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    });
  } catch (err: any) {
    // The SDK throws an error object; map known HTTP status codes to user messages.
    const message: string = err?.message ?? String(err);
    const statusMatch = message.match(/\b(4\d\d|5\d\d)\b/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 500;

    logger.error({ status, message, model }, "Gemini API error");

    let userMessage: string;
    let retryAfter: number | undefined;

    if (status === 429) {
      // Parse retry delay — Gemini can respond in seconds ("retry in 30s") or
      // milliseconds ("Please retry in 990.398478ms")
      const retrySecMatch = message.match(/retry in ([\d.]+)s/i);
      const retryMsMatch  = message.match(/retry in ([\d.]+)ms/i);
      if (retrySecMatch) {
        retryAfter = Math.ceil(parseFloat(retrySecMatch[1])) + 2;
      } else if (retryMsMatch) {
        retryAfter = Math.ceil(parseFloat(retryMsMatch[1]) / 1000) + 1;
      } else {
        retryAfter = 60;
      }

      // Detect limit: 0 — means the project has no free-tier quota at all
      // (Google Cloud project without billing, or wrong key type)
      if (/limit:\s*0/i.test(message)) {
        userMessage =
          `Tu API Key no tiene cuota disponible en el tier gratuito (límite = 0). ` +
          `Usa una API Key de Google AI Studio (aistudio.google.com) o habilita la facturación en tu proyecto de Google Cloud.`;
        retryAfter = undefined; // No point retrying — it won't resolve on its own
      } else {
        userMessage = `Cuota de Gemini agotada para el modelo "${model}". Intenta de nuevo en ${retryAfter} segundos.`;
      }
    } else if (status === 404) {
      userMessage = `El modelo "${model}" no existe o no está disponible con tu API Key. Selecciona otro modelo en Configuración.`;
    } else if (status === 400) {
      userMessage = `Error 400: ${message.slice(0, 200) || "API Key de Gemini inválida. Verifica la clave en Configuración."}`;
    } else if (status === 403) {
      userMessage =
        "API Key de Gemini sin permisos. Verifica que la clave tenga acceso a la API.";
    } else {
      userMessage = `Error de Gemini (${status}): ${message.slice(0, 200)}`;
    }

    throw new GeminiApiError(status, userMessage, retryAfter);
  }

  return response.text ?? "";
}

// ---------------------------------------------------------------------------
// Model listing
// ---------------------------------------------------------------------------

export interface GeminiModelInfo {
  id: string;
  displayName: string;
  description: string | null;
}

export async function listAvailableModels(apiKey: string): Promise<GeminiModelInfo[]> {
  const ai = makeClient(apiKey);

  try {
    const models: GeminiModelInfo[] = [];
    const pager = await ai.models.list();
    for await (const model of pager) {
      // Only keep models that support generateContent
      const actions: string[] = (model as any).supportedActions ?? [];
      if (!actions.includes("generateContent")) continue;

      // Skip models that can't generate text predictions
      const nameLower = name.toLowerCase();
      if (
        nameLower.includes("embedding") ||
        nameLower.includes("tts") ||
        nameLower.includes("imagen") ||
        nameLower.includes("robotics") ||
        nameLower.includes("antigravity")
      ) continue;

      const name: string = model.name ?? "";
      // Strip the "models/" prefix to get a clean id like "gemini-2.0-flash"
      const id = name.startsWith("models/") ? name.slice("models/".length) : name;
      if (!id) continue;

      models.push({
        id,
        displayName: model.displayName ?? id,
        description: model.description ?? null,
      });
    }

    // Sort: newer/more capable models first
    return models.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch (err: any) {
    const message: string = err?.message ?? String(err);
    logger.error({ message }, "Failed to list Gemini models");
    throw new GeminiApiError(502, `No se pudieron obtener los modelos: ${message.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayUTC(): string {
  return new Date().toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export async function analyzeMatch(
  apiKey: string,
  model: string,
  homeTeam: string,
  awayTeam: string,
  league: string,
  kickoffTime: string,
): Promise<GeminiAnalysis> {
  const date = todayUTC();

  // --- Cache lookup (shared across all users) ---
  const cached = await db
    .select()
    .from(analysisCacheTable)
    .where(
      and(
        eq(analysisCacheTable.date, date),
        eq(analysisCacheTable.league, league),
        eq(analysisCacheTable.homeTeam, homeTeam),
        eq(analysisCacheTable.awayTeam, awayTeam),
      ),
    )
    .limit(1);

  if (cached.length > 0) {
    logger.info({ homeTeam, awayTeam, league, date }, "Analysis cache hit — skipping Gemini call");
    return JSON.parse(cached[0].result);
  }

  // --- Cache miss: call Gemini ---
  const prompt = `Actúa como un analista cuantitativo de apuestas deportivas profesional y tipster cuantitativo. Tu objetivo es realizar un análisis probabilístico y estadístico exhaustivo para el siguiente partido de fútbol y determinar si existen apuestas de valor (Value Bets).

### DATOS DEL PARTIDO A ANALIZAR:
- Torneo / Liga: ${league}
- Partido: ${homeTeam} vs. ${awayTeam}
- Fecha y Hora: ${kickoffTime}

---

### METODOLOGÍA DE ANÁLISIS:

Por favor, busca, recopila y procesa la siguiente información actualizada de ambos equipos:

1. ESTADO ACTUAL Y TABLA:
   - Posición actual en la tabla, puntos y diferencia de gol de ambos equipos.
   - Tendencia en las últimas 5 a 8 jornadas (Racha: victorias, empates, derrotas).
   - Rendimiento relativo: Localía para el ${homeTeam} vs. Rendimiento como visitante para el ${awayTeam}.

2. ESTADÍSTICAS DE GOLES Y JUEGO:
   - Promedio de goles anotados y concedidos por partido (general, local y visitante).
   - Métricas avanzadas si están disponibles (xG / Goles Esperados a favor y en contra).
   - Porcentaje de partidos con Más/Menos de 2.5 goles y "Ambos Equipos Anotan".

3. DISCIPLINA (TARJETAS):
   - Promedio de tarjetas amarillas y rojas por partido para cada equipo.
   - Perfil del árbitro asignado (si se conoce) o promedio de tarjetas mostradas por el equipo en partidos de alta intensidad.
   - Jugadores clave apercibidos o sancionados por acumulación de tarjetas.

4. PLANTILLA, BAJAS Y JUGADORES CLAVE:
   - Lesionados, suspendidos o dudas confirmadas de última hora.
   - Top goleadores y asistentes de cada equipo, evaluando su disponibilidad para el partido.

5. HISTORIAL DIRECTO (HEAD TO HEAD - H2H):
   - Últimos 5 enfrentamientos directos entre ambos equipos.
   - Patrones recurrentes en esos duelos (goles, tarjetas, dominancia).

6. MONITOREO DE CUOTAS Y MERCADO:
   - Revisa las cuotas ofrecidas por al menos 3 casas de apuestas principales (ej. Bet365, Betfair, Pinnacle, Codere, 1xBet).
   - Analiza la evolución de la cuota: ¿Ha habido caídas o subidas drásticas en la cuota del local, visitante o empates?

---

### FORMATO DE SALIDA:

Devuelve un objeto JSON válido con esta estructura exacta. El campo "summary" debe contener el resumen ejecutivo del partido (contexto, forma y factores determinantes, máximo 150 palabras). Las "predictions" deben ser las apuestas de valor identificadas, ordenadas de mayor a menor confianza.

{
  "homeTeam": "${homeTeam}",
  "awayTeam": "${awayTeam}",
  "league": "${league}",
  "summary": "Resumen ejecutivo: contexto del partido, momento de forma y factores determinantes (bajas clave, cansancio, etc.)",
  "predictions": [
    {
      "id": "value-bet-1",
      "market": "Nombre del mercado (ej: 1X2, Más/Menos 2.5 goles, Ambos Anotan, Tarjetas)",
      "selection": "Selección específica (ej: Victoria Local, Más de 2.5, Sí, Más de 3.5 tarjetas)",
      "odds": 1.85,
      "confidence": "high|medium|low",
      "reasoning": "Argumentación técnica: por qué la cuota representa valor real respecto a la probabilidad estadística estimada"
    }
  ]
}

Proporciona entre 4 y 6 value bets cubriendo distintos mercados (resultado, goles, tarjetas, córners). Devuelve ÚNICAMENTE el objeto JSON, sin markdown ni texto adicional.`;

  const raw = await callGemini(apiKey, model, prompt);

  let analysis: GeminiAnalysis;
  try {
    analysis = JSON.parse(raw);
    analysis.predictions = analysis.predictions.map((p, i) => ({
      ...p,
      id: p.id || `pred-${i}`,
      odds: typeof p.odds === "string" ? parseFloat(p.odds) : p.odds,
    }));
  } catch {
    logger.warn({ raw }, "Failed to parse Gemini analysis response as JSON");
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
    logger.info({ homeTeam, awayTeam, league, date }, "Analysis result cached in DB");
  } catch (err) {
    logger.warn({ err }, "Failed to save analysis result to cache");
  }

  return analysis;
}

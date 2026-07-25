import { logger } from "./logger";

const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiMatch {
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  stadium?: string | null;
}

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
  ) {
    super(message);
    this.name = "GeminiApiError";
  }
}

async function callGemini(apiKey: string, model: string, prompt: string): Promise<string> {
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const geminiMessage: string = body?.error?.message ?? "";

    logger.error({ status: response.status, geminiMessage, model }, "Gemini API error");

    let userMessage: string;
    if (response.status === 429) {
      const retryMatch = geminiMessage.match(/retry in ([\d.]+)s/i);
      const retrySecs = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : null;
      userMessage = retrySecs
        ? `Cuota de Gemini agotada para el modelo "${model}". Intenta de nuevo en ${retrySecs} segundos.`
        : `Cuota de Gemini agotada para el modelo "${model}". Revisa tu plan en https://ai.dev/rate-limit`;
    } else if (response.status === 404) {
      userMessage = `El modelo "${model}" no existe o no está disponible con tu API Key. Selecciona otro modelo en Configuración.`;
    } else if (response.status === 400) {
      userMessage = `Error 400: ${geminiMessage || "API Key de Gemini inválida. Verifica la clave en Configuración."}`;
    } else if (response.status === 403) {
      userMessage = "API Key de Gemini sin permisos. Verifica que la clave tenga acceso a la API.";
    } else {
      userMessage = `Error de Gemini (${response.status})${geminiMessage ? `: ${geminiMessage.slice(0, 200)}` : ""}`;
    }
    throw new GeminiApiError(response.status, userMessage);
  }

  const data = await response.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text;
}

export async function getRadarMatches(
  apiKey: string,
  model: string,
  leagues?: string[],
): Promise<{ league: string; matches: GeminiMatch[] }[]> {
  const leagueList =
    leagues && leagues.length > 0
      ? leagues.join(", ")
      : "Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League, Europa League, MLS";

  const today = new Date().toISOString().split("T")[0];

  const prompt = `You are a football data assistant. Return today's (${today}) scheduled football matches from these leagues: ${leagueList}.

Return a valid JSON array with this exact structure:
[
  {
    "league": "League Name",
    "homeTeam": "Home Team Name",
    "awayTeam": "Away Team Name",
    "kickoffTime": "HH:MM",
    "stadium": "Stadium Name or null"
  }
]

Rules:
- Only include real scheduled matches for today
- If no matches today for a league, skip it
- kickoffTime must be in 24h HH:MM format (UTC)
- Sort results by league name alphabetically, then by kickoffTime chronologically
- Return ONLY the JSON array, no markdown, no explanations`;

  const raw = await callGemini(apiKey, model, prompt);

  let matches: GeminiMatch[] = [];
  try {
    const parsed = JSON.parse(raw);
    matches = Array.isArray(parsed) ? parsed : [];
  } catch {
    logger.warn({ raw }, "Failed to parse Gemini radar response as JSON");
    matches = [];
  }

  // Group by league
  const grouped = new Map<string, GeminiMatch[]>();
  for (const match of matches) {
    if (!match.league || !match.homeTeam || !match.awayTeam) continue;
    const existing = grouped.get(match.league) ?? [];
    existing.push(match);
    grouped.set(match.league, existing);
  }

  // Sort leagues alphabetically
  const sorted = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([league, leagueMatches]) => {
      // Sort by kickoff time
      const sortedMatches = leagueMatches.sort((a, b) =>
        (a.kickoffTime ?? "").localeCompare(b.kickoffTime ?? ""),
      );
      return {
        league,
        matches: sortedMatches.map((m, i) => ({
          ...m,
          id: `${league}-${m.homeTeam}-${m.awayTeam}-${i}`.replace(/\s+/g, "-").toLowerCase(),
        })),
      };
    });

  return sorted;
}

export async function analyzeMatch(
  apiKey: string,
  model: string,
  homeTeam: string,
  awayTeam: string,
  league: string,
  kickoffTime: string,
): Promise<GeminiAnalysis> {
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
    // Ensure IDs are unique
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

  return analysis;
}

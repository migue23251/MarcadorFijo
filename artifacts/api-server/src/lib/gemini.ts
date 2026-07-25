import { logger } from "./logger";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// Leave empty — the admin fills in the custom analysis prompt
const SYSTEM_ANALYSIS_PROMPT = "";

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

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
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
    const err = await response.text().catch(() => "");
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text;
}

export async function getRadarMatches(
  apiKey: string,
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

  const raw = await callGemini(apiKey, prompt);

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
  homeTeam: string,
  awayTeam: string,
  league: string,
  kickoffTime: string,
): Promise<GeminiAnalysis> {
  const basePrompt = `You are an expert football analyst and betting advisor. Analyze the following match and provide detailed betting predictions.

Match: ${homeTeam} vs ${awayTeam}
League: ${league}
Kickoff: ${kickoffTime}

Return a valid JSON object with this exact structure:
{
  "homeTeam": "${homeTeam}",
  "awayTeam": "${awayTeam}",
  "league": "${league}",
  "summary": "A 2-3 sentence match overview covering recent form, head-to-head, key players, and likely outcome",
  "predictions": [
    {
      "id": "unique-id",
      "market": "Market name (e.g. 1X2, Both Teams to Score, Over/Under 2.5, etc.)",
      "selection": "The specific selection (e.g. Home Win, Yes, Over 2.5, etc.)",
      "odds": 1.85,
      "confidence": "high|medium|low",
      "reasoning": "Brief reasoning for this prediction"
    }
  ]
}

Provide 4-6 diverse predictions covering different markets. Return ONLY the JSON object.`;

  const prompt = SYSTEM_ANALYSIS_PROMPT
    ? `${SYSTEM_ANALYSIS_PROMPT}\n\n${basePrompt}`
    : basePrompt;

  const raw = await callGemini(apiKey, prompt);

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

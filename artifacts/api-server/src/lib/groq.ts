import Groq from "groq-sdk";
import { logger } from "./logger";
import { db, analysisCacheTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { MatchEnrichment, TeamStats, InjuryRecord, H2HRecord } from "./api-football";

const GROQ_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `Eres un analista cuantitativo de apuestas deportivas de élite con más de 15 años de experiencia en mercados europeos y latinoamericanos. Tu especialidad es identificar value bets — apuestas donde la probabilidad real supera la probabilidad implícita de la cuota.

PRINCIPIOS DE ANÁLISIS:
1. Basa SIEMPRE tus conclusiones en los datos estadísticos proporcionados (forma, goles, rendimiento local/visitante, bajas, H2H). No inventes datos.
2. Pondera el rendimiento local vs visitante: un equipo puede tener buen registro general pero flojear fuera de casa.
3. Las bajas de jugadores clave (lesiones/suspensiones) pueden cambiar el valor de un mercado en 5-15%.
4. El H2H es relevante si hay patrón claro (ej: el visitante gana 4 de 5); ignóralo si los resultados son dispares.
5. Si tienes cuotas reales, calcula la probabilidad implícita (1/cuota) y compárala con tu estimación. Solo es value bet si tu prob. estimada supera la implícita por ≥5%.
6. Confianza: "high" → ventaja estadística clara y sostenida (≥60% vs implícita ≤52%); "medium" → ventaja moderada; "low" → análisis especulativo o datos insuficientes.
7. Cubre mercados distintos: resultado 1X2, total goles (Over/Under 2.5, 3.5), Ambos Anotan, córners si aplica, tarjetas si hay patrón claro.
8. Cuando dispongas de datos de disparos a puerta y faltas en el H2H, úsalos: equipos con alto ratio disparos/goles en confrontaciones directas indican solidez ofensiva; alta media de faltas sugiere mercados de tarjetas; diferencia de posesión ≥10% es señal de dominancia territorial.
8. Responde SIEMPRE en español y en formato JSON estricto sin markdown ni texto adicional.`;

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

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function formatTeamStats(stats: TeamStats, label: string): string {
  const recentForm = stats.form.slice(-5) || "N/D";
  const penaltyLine =
    stats.penalties.total > 0
      ? `  Penaltis: ${stats.penalties.scored}/${stats.penalties.total} convertidos${stats.penalties.missed > 0 ? ` (${stats.penalties.missed} fallados)` : ""}`
      : null;
  const streakLine =
    stats.biggestWinStreak > 0
      ? `  Racha máx. victorias consecutivas: ${stats.biggestWinStreak} pj | Mayor victoria local: ${stats.biggestWinHome} · visita: ${stats.biggestWinAway}`
      : null;
  const lines = [
    `[${label}] — Temporada ${stats.season} | Forma últimos 5: ${recentForm}`,
    `  Registro general: ${stats.played.total} JJ | ${stats.wins.total}V ${stats.draws.total}E ${stats.losses.total}D`,
    `  Como local:    ${stats.played.home} JJ | ${stats.wins.home}V ${stats.draws.home}E ${stats.losses.home}D`,
    `  Como visitante: ${stats.played.away} JJ | ${stats.wins.away}V ${stats.draws.away}E ${stats.losses.away}D`,
    `  Goles anotados: ${stats.goalsFor.total}/pj (local ${stats.goalsFor.home}/pj · visita ${stats.goalsFor.away}/pj)`,
    `  Goles concedidos: ${stats.goalsAgainst.total}/pj (local ${stats.goalsAgainst.home}/pj · visita ${stats.goalsAgainst.away}/pj)`,
    `  Valla invicta: ${stats.cleanSheets.total} (${stats.cleanSheets.home} local · ${stats.cleanSheets.away} visita) | Sin marcar: ${stats.failedToScore.total}`,
    `  Disciplina: ${stats.yellowCards} amarillas · ${stats.redCards} rojas en la temporada`,
    ...(penaltyLine ? [penaltyLine] : []),
    ...(streakLine ? [streakLine] : []),
  ];
  return lines.join("\n");
}

function formatInjuries(
  injuries: InjuryRecord[],
  homeTeam: string,
  awayTeam: string,
): string {
  if (injuries.length === 0) return "  Sin bajas confirmadas para este partido.";

  const home = injuries.filter((i) =>
    i.team.toLowerCase().includes(homeTeam.toLowerCase().split(" ")[0]),
  );
  const away = injuries.filter((i) =>
    i.team.toLowerCase().includes(awayTeam.toLowerCase().split(" ")[0]),
  );

  const fmt = (list: InjuryRecord[]) =>
    list.length === 0
      ? "ninguna baja confirmada"
      : list.map((i) => `${i.player} (${i.type}${i.reason ? ` - ${i.reason}` : ""})`).join(", ");

  return `  ${homeTeam}: ${fmt(home)}\n  ${awayTeam}: ${fmt(away)}`;
}

function formatH2H(h2h: H2HRecord[]): string {
  if (h2h.length === 0) return "  Sin historial directo disponible.";
  return h2h
    .map((m) => {
      const score =
        m.scoreHome !== null && m.scoreAway !== null
          ? `${m.scoreHome}-${m.scoreAway}`
          : "N/D";
      const winnerLabel =
        m.winner === "home"
          ? `✓ ${m.homeTeam}`
          : m.winner === "away"
            ? `✓ ${m.awayTeam}`
            : "Empate";
      const statsLine = m.stats
        ? ` | Disparos portería: ${m.stats.home.shotsOnGoal}-${m.stats.away.shotsOnGoal} (total: ${m.stats.home.totalShots}-${m.stats.away.totalShots}) | Faltas: ${m.stats.home.fouls}-${m.stats.away.fouls} | Córners: ${m.stats.home.corners}-${m.stats.away.corners} | Posesión: ${m.stats.home.possession}%-${m.stats.away.possession}%`
        : "";
      return `  ${m.date} | ${m.homeTeam} vs ${m.awayTeam} | ${score} | ${winnerLabel}${statsLine}`;
    })
    .join("\n");
}

function buildUserPrompt(
  homeTeam: string,
  awayTeam: string,
  league: string,
  kickoffTime: string | undefined,
  oddsData: Record<string, unknown> | null | undefined,
  enrichment: MatchEnrichment | null | undefined,
): string {
  const sections: string[] = [];

  sections.push(`PARTIDO: ${homeTeam} vs ${awayTeam} (Local vs Visitante)`);
  sections.push(`COMPETICIÓN: ${league}`);
  if (kickoffTime) sections.push(`HORA DE INICIO: ${kickoffTime}`);

  // --- Team stats ---
  if (enrichment?.homeStats || enrichment?.awayStats) {
    sections.push("\n=== ESTADÍSTICAS DE TEMPORADA ===");
    if (enrichment.homeStats) {
      sections.push(formatTeamStats(enrichment.homeStats, `${homeTeam} (LOCAL)`));
    } else {
      sections.push(`[${homeTeam}] — estadísticas no disponibles`);
    }
    sections.push("");
    if (enrichment.awayStats) {
      sections.push(formatTeamStats(enrichment.awayStats, `${awayTeam} (VISITANTE)`));
    } else {
      sections.push(`[${awayTeam}] — estadísticas no disponibles`);
    }
  }

  // --- Injuries ---
  sections.push("\n=== BAJAS Y LESIONES CONFIRMADAS ===");
  if (enrichment?.injuries) {
    sections.push(formatInjuries(enrichment.injuries, homeTeam, awayTeam));
  } else {
    sections.push("  Información de bajas no disponible.");
  }

  // --- H2H ---
  sections.push("\n=== HISTORIAL H2H (últimos 5 duelos directos) ===");
  if (enrichment?.h2h) {
    sections.push(formatH2H(enrichment.h2h));
  } else {
    sections.push("  Historial H2H no disponible.");
  }

  // --- Odds ---
  sections.push("\n=== CUOTAS DE MERCADO REALES ===");
  if (oddsData) {
    sections.push(JSON.stringify(oddsData, null, 2));
    sections.push("(Mercados disponibles: h2h = 1X2, totals = Over/Under, btts = Ambos Anotan)");
  } else {
    sections.push("  Sin cuotas de mercado disponibles — basa el análisis en los datos estadísticos.");
  }

  sections.push(`
Devuelve EXCLUSIVAMENTE este JSON (sin markdown, sin texto adicional):
{
  "homeTeam": "${homeTeam}",
  "awayTeam": "${awayTeam}",
  "league": "${league}",
  "summary": "Resumen técnico (3-4 frases): forma reciente de ambos equipos con datos concretos de goles y rendimiento local/visitante, impacto de bajas relevantes, patrón H2H si existe, y veredicto general sobre cuál equipo tiene ventaja estadística",
  "predictions": [
    {
      "id": "vb-1",
      "market": "Nombre del mercado (1X2 | Más/Menos X.X goles | Ambos Anotan | Córners | Tarjetas)",
      "selection": "Selección específica (ej: Victoria Local | Más de 2.5 | Sí | Menos de 9.5 córners)",
      "odds": 1.85,
      "confidence": "high|medium|low",
      "reasoning": "Probabilidad estimada: XX% vs implícita: YY% (cuota Z.ZZ). Factores: [datos estadísticos concretos que sustentan la pick]"
    }
  ]
}

Genera entre 4 y 7 value bets cubriendo mercados distintos. Prioriza los mercados donde los datos estadísticos son más sólidos.`);

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function analyzeMatch(
  homeTeam: string,
  awayTeam: string,
  league: string,
  kickoffTime: string | undefined,
  oddsData?: Record<string, unknown> | null,
  enrichment?: MatchEnrichment | null,
  fixtureId?: number,
): Promise<AIAnalysis> {
  const date = new Date().toISOString().split("T")[0];

  // Cache check — served from DB if already analyzed today
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
  const userPrompt = buildUserPrompt(homeTeam, awayTeam, league, kickoffTime, oddsData, enrichment);

  logger.info(
    {
      homeTeam,
      awayTeam,
      league,
      model: GROQ_MODEL,
      hasOdds: !!oddsData,
      hasStats: !!(enrichment?.homeStats || enrichment?.awayStats),
      hasInjuries: !!(enrichment?.injuries?.length),
      hasH2H: !!(enrichment?.h2h?.length),
    },
    "Calling Groq API",
  );

  const response = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 2048,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "";
  logger.info(
    { homeTeam, awayTeam, tokensUsed: response.usage?.total_tokens },
    "Groq API call completed",
  );

  let analysis: AIAnalysis;
  try {
    analysis = JSON.parse(raw);
    analysis.predictions = (analysis.predictions ?? []).map(
      (p: AIPrediction, i: number) => ({
        ...p,
        id: p.id || `vb-${i + 1}`,
        odds: typeof p.odds === "string" ? parseFloat(p.odds) : (p.odds ?? 0),
      }),
    );
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

  // Save to cache
  try {
    await db
      .insert(analysisCacheTable)
      .values({ date, homeTeam, awayTeam, league, fixtureId: fixtureId ?? null, result: JSON.stringify(analysis) })
      .onConflictDoNothing();
    logger.info({ homeTeam, awayTeam, league, date, fixtureId }, "Analysis cached in DB");
  } catch (err) {
    logger.warn({ err }, "Failed to cache analysis");
  }

  return analysis;
}

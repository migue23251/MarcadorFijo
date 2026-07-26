import { Router, type IRouter } from "express";
import { RadarMatchesBody, AnalyzeMatchBody } from "@workspace/api-zod";
import {
  requireAuth,
  requireSubscription,
} from "../lib/auth";
import { analyzeMatch } from "../lib/groq";
import { getMatchOdds } from "../lib/odds";
import { getMatchesFromApiFootball } from "../lib/api-football";
import { db, analysisCacheTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

// GET /matches/cached-analysis
router.get(
  "/matches/cached-analysis",
  requireAuth,
  requireSubscription,
  async (req, res): Promise<void> => {
    const { homeTeam, awayTeam, league } = req.query as {
      homeTeam?: string;
      awayTeam?: string;
      league?: string;
    };

    if (!homeTeam || !awayTeam || !league) {
      res.status(400).json({ error: "homeTeam, awayTeam y league son requeridos" });
      return;
    }

    const date = new Date().toISOString().split("T")[0];

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

    if (cached.length === 0) {
      res.status(404).json({ error: "No hay análisis cacheado para este partido hoy." });
      return;
    }

    res.json(JSON.parse(cached[0].result));
  },
);

// POST /matches/radar — fetches today's fixtures from API-Football
router.post(
  "/matches/radar",
  requireAuth,
  requireSubscription,
  async (req, res): Promise<void> => {
    const parsed = RadarMatchesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const results = await getMatchesFromApiFootball(parsed.data.leagues);
      res.json(results);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al obtener partidos";
      res.status(502).json({ error: message });
    }
  },
);

// POST /matches/analyze — AI prediction via Groq + real odds from The Odds API
router.post(
  "/matches/analyze",
  requireAuth,
  requireSubscription,
  async (req, res): Promise<void> => {
    const parsed = AnalyzeMatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const { homeTeam, awayTeam, league, kickoffTime } = parsed.data;

      // Fetch real odds to enrich the AI prompt (non-fatal if unavailable)
      const oddsData = await getMatchOdds(homeTeam, awayTeam, league).catch(() => null);

      const analysis = await analyzeMatch(homeTeam, awayTeam, league, kickoffTime, oddsData);
      res.json(analysis);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al analizar el partido";
      res.status(502).json({ error: message });
    }
  },
);

export default router;

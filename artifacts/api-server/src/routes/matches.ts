import { Router, type IRouter } from "express";
import { RadarMatchesBody, AnalyzeMatchBody } from "@workspace/api-zod";
import { requireAuth, requireSubscription } from "../lib/auth";
import { analyzeMatch } from "../lib/groq";
import { getMatchOdds } from "../lib/odds";
import {
  getMatchesFromApiFootball,
  enrichMatchForAnalysis,
  type ApiFootballMatch,
} from "../lib/api-football";
import { logger } from "../lib/logger";
import { db, analysisCacheTable, radarCacheTable } from "@workspace/db";
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

// POST /matches/analyze — enriched AI prediction via Groq
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
      const date = new Date().toISOString().split("T")[0];

      // --- Early cache check: skip ALL external calls if analysis exists ---
      const existingAnalysis = await db
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

      if (existingAnalysis.length > 0) {
        logger.info({ homeTeam, awayTeam, league }, "Analysis cache hit in route — skipping enrichment");
        res.json(JSON.parse(existingAnalysis[0].result));
        return;
      }

      // --- Look up fixture metadata from radar cache for enrichment ---
      let fixtureId: number | undefined;
      let homeTeamId: number | undefined;
      let awayTeamId: number | undefined;
      let leagueId: number | undefined;

      try {
        const radarCached = await db
          .select()
          .from(radarCacheTable)
          .where(
            and(
              eq(radarCacheTable.date, date),
              eq(radarCacheTable.league, "af_all"),
            ),
          )
          .limit(1);

        if (radarCached.length > 0) {
          const fixtures = JSON.parse(radarCached[0].result) as ApiFootballMatch[];
          const match = fixtures.find(
            (m) =>
              m.homeTeam.toLowerCase() === homeTeam.toLowerCase() &&
              m.awayTeam.toLowerCase() === awayTeam.toLowerCase(),
          );
          if (match) {
            fixtureId = match.apiFootballId;
            homeTeamId = match.homeTeamId;
            awayTeamId = match.awayTeamId;
            leagueId = match.leagueId;
          }
        }
      } catch (err) {
        logger.warn({ err }, "Failed to look up fixture metadata from radar cache");
      }

      // --- Fetch all enrichment data in parallel (non-fatal if any fail) ---
      const canEnrich =
        fixtureId !== undefined &&
        homeTeamId !== undefined &&
        awayTeamId !== undefined &&
        leagueId !== undefined;

      const [oddsData, enrichment] = await Promise.all([
        getMatchOdds(homeTeam, awayTeam, league).catch(() => null),
        canEnrich
          ? enrichMatchForAnalysis(homeTeamId!, awayTeamId!, leagueId!, fixtureId!).catch(
              () => null,
            )
          : Promise.resolve(null),
      ]);

      const analysis = await analyzeMatch(
        homeTeam,
        awayTeam,
        league,
        kickoffTime,
        oddsData,
        enrichment,
      );
      res.json(analysis);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al analizar el partido";
      res.status(502).json({ error: message });
    }
  },
);

export default router;

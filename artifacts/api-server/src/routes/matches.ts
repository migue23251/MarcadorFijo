import { Router, type IRouter } from "express";
import { RadarMatchesBody, AnalyzeMatchBody } from "@workspace/api-zod";
import {
  requireAuth,
  requireSubscription,
  type AuthenticatedRequest,
} from "../lib/auth";
import { getUserGeminiKey, getUserGeminiModel } from "./config";
import { getRadarMatches, analyzeMatch, GeminiApiError } from "../lib/gemini";
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
      res.status(404).json({ error: "No hay análisis cacheado para este partido hoy. Usa el Radar para analizarlo." });
      return;
    }

    res.json(JSON.parse(cached[0].result));
  },
);

// POST /matches/radar
router.post(
  "/matches/radar",
  requireAuth,
  requireSubscription,
  async (req, res): Promise<void> => {
    const user = (req as AuthenticatedRequest).dbUser;

    const parsed = RadarMatchesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const apiKey = await getUserGeminiKey(user.clerkId);
    if (!apiKey) {
      res
        .status(400)
        .json({ error: "No tienes una API Key de Gemini configurada. Configúrala en Ajustes." });
      return;
    }

    try {
      const model = await getUserGeminiModel(user.clerkId);
      const leagues = parsed.data.leagues;
      const results = await getRadarMatches(apiKey, model, leagues);
      res.json(results);
    } catch (err) {
      if (err instanceof GeminiApiError) {
        const httpStatus = [400, 403, 404, 429].includes(err.status) ? err.status : 502;
        res.status(httpStatus).json({
          error: err.message,
          ...(err.retryAfter !== undefined && { retryAfter: err.retryAfter }),
        });
        return;
      }
      throw err;
    }
  },
);

// POST /matches/analyze
router.post(
  "/matches/analyze",
  requireAuth,
  requireSubscription,
  async (req, res): Promise<void> => {
    const user = (req as AuthenticatedRequest).dbUser;

    const parsed = AnalyzeMatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const apiKey = await getUserGeminiKey(user.clerkId);
    if (!apiKey) {
      res
        .status(400)
        .json({ error: "No tienes una API Key de Gemini configurada. Configúrala en Ajustes." });
      return;
    }

    try {
      const model = await getUserGeminiModel(user.clerkId);
      const { homeTeam, awayTeam, league, kickoffTime } = parsed.data;
      const analysis = await analyzeMatch(apiKey, model, homeTeam, awayTeam, league, kickoffTime);
      res.json(analysis);
    } catch (err) {
      if (err instanceof GeminiApiError) {
        const httpStatus = [400, 403, 404, 429].includes(err.status) ? err.status : 502;
        res.status(httpStatus).json({
          error: err.message,
          ...(err.retryAfter !== undefined && { retryAfter: err.retryAfter }),
        });
        return;
      }
      throw err;
    }
  },
);

export default router;

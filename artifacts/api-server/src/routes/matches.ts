import { Router, type IRouter } from "express";
import { RadarMatchesBody, AnalyzeMatchBody } from "@workspace/api-zod";
import {
  requireAuth,
  requireSubscription,
  type AuthenticatedRequest,
} from "../lib/auth";
import { getUserGeminiKey } from "./config";
import { getRadarMatches, analyzeMatch, GeminiApiError } from "../lib/gemini";

const router: IRouter = Router();

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
      const leagues = parsed.data.leagues;
      const results = await getRadarMatches(apiKey, leagues);
      res.json(results);
    } catch (err) {
      if (err instanceof GeminiApiError) {
        const httpStatus = err.status === 429 ? 429 : err.status === 400 ? 400 : err.status === 403 ? 403 : 502;
        res.status(httpStatus).json({ error: err.message });
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
      const { homeTeam, awayTeam, league, kickoffTime } = parsed.data;
      const analysis = await analyzeMatch(apiKey, homeTeam, awayTeam, league, kickoffTime);
      res.json(analysis);
    } catch (err) {
      if (err instanceof GeminiApiError) {
        const httpStatus = err.status === 429 ? 429 : err.status === 400 ? 400 : err.status === 403 ? 403 : 502;
        res.status(httpStatus).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;

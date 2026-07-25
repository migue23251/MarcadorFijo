import { Router, type IRouter } from "express";
import { RadarMatchesBody, AnalyzeMatchBody } from "@workspace/api-zod";
import {
  requireAuth,
  requireSubscription,
  type AuthenticatedRequest,
} from "../lib/auth";
import { getUserGeminiKey } from "./config";
import { getRadarMatches, analyzeMatch } from "../lib/gemini";

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

    const leagues = parsed.data.leagues;
    const results = await getRadarMatches(apiKey, leagues);

    res.json(results);
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

    const { homeTeam, awayTeam, league, kickoffTime } = parsed.data;
    const analysis = await analyzeMatch(apiKey, homeTeam, awayTeam, league, kickoffTime);

    res.json(analysis);
  },
);

export default router;

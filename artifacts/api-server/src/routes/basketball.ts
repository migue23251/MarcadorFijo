import { Router, type IRouter } from "express";
import { requireAuth, isSubscriptionCurrentlyActive, type AuthenticatedRequest } from "../lib/auth";
import { getBasketballMatchesForToday, type BasketballLeague } from "../lib/api-basketball";
import { logger } from "../lib/logger";
import { db, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// POST /basketball/radar — fetches today's NBA games
// Same freemium/subscription logic as football radar
router.post(
  "/basketball/radar",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = (req as AuthenticatedRequest).dbUser;

    const isSubscribed =
      user.isSubscriptionActive &&
      isSubscriptionCurrentlyActive(user.subscriptionExpiresAt);

    if (!isSubscribed) {
      const [settings] = await db
        .select()
        .from(systemSettingsTable)
        .where(eq(systemSettingsTable.id, 1))
        .limit(1);

      if (!(settings?.freemiumEnabled ?? true)) {
        res.status(403).json({
          error:
            "El acceso gratuito está desactivado. Adquiere una suscripción para usar el radar.",
          code: "FREEMIUM_DISABLED",
        });
        return;
      }
    }

    try {
      const body = req.body as any;
      // Accept either `leagues: string[]` (new) or `league: string` (legacy)
      const VALID: BasketballLeague[] = ["nba", "euroleague"];
      let leagues: BasketballLeague[];
      if (Array.isArray(body?.leagues) && body.leagues.length > 0) {
        leagues = (body.leagues as string[]).filter((l): l is BasketballLeague => VALID.includes(l as BasketballLeague));
      } else {
        const single = body?.league;
        leagues = [VALID.includes(single) ? single : "nba"];
      }
      if (leagues.length === 0) leagues = ["nba"];

      const results = await Promise.all(leagues.map(l => getBasketballMatchesForToday(l)));
      const matches = results.flat();
      res.json(matches);
    } catch (err) {
      logger.error({ err }, "Basketball radar error");
      const message =
        err instanceof Error ? err.message : "Error al obtener partidos de baloncesto";
      res.status(422).json({ error: message });
    }
  },
);

export default router;

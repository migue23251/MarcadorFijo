import { Router, type IRouter } from "express";
import { RadarMatchesBody, AnalyzeMatchBody } from "@workspace/api-zod";
import {
  requireAuth,
  requireSubscription,
  isSubscriptionCurrentlyActive,
  type AuthenticatedRequest,
} from "../lib/auth";
import { analyzeMatch } from "../lib/groq";
import { getMatchOdds } from "../lib/odds";
import {
  getMatchesFromApiFootball,
  enrichMatchForAnalysis,
  type ApiFootballMatch,
} from "../lib/api-football";
import { getTodayColombia } from "../lib/timezone";
import { logger } from "../lib/logger";
import {
  db,
  analysisCacheTable,
  radarCacheTable,
  systemSettingsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router: IRouter = Router();

// GET /matches/cached-analysis
router.get(
  "/matches/cached-analysis",
  requireAuth,
  requireSubscription,
  async (req, res): Promise<void> => {
    const { homeTeam, awayTeam, league, fixtureId: fixtureIdRaw } = req.query as {
      homeTeam?: string;
      awayTeam?: string;
      league?: string;
      fixtureId?: string;
    };

    if (!homeTeam || !awayTeam || !league) {
      res.status(400).json({ error: "homeTeam, awayTeam y league son requeridos" });
      return;
    }

    const fixtureId = fixtureIdRaw ? parseInt(fixtureIdRaw, 10) : undefined;

    // Buscar primero por fixtureId (exacto y rápido), luego fallback por nombres.
    // Sin filtro de fecha para que el historial encuentre análisis de días anteriores.
    let cached: typeof analysisCacheTable.$inferSelect[] = [];

    if (fixtureId && !isNaN(fixtureId)) {
      cached = await db
        .select()
        .from(analysisCacheTable)
        .where(eq(analysisCacheTable.fixtureId, fixtureId))
        .orderBy(desc(analysisCacheTable.createdAt))
        .limit(1);
    }

    if (cached.length === 0) {
      cached = await db
        .select()
        .from(analysisCacheTable)
        .where(
          and(
            eq(analysisCacheTable.homeTeam, homeTeam),
            eq(analysisCacheTable.awayTeam, awayTeam),
            eq(analysisCacheTable.league, league),
          ),
        )
        .orderBy(desc(analysisCacheTable.createdAt))
        .limit(1);
    }

    if (cached.length === 0) {
      res.status(404).json({ error: "No hay análisis cacheado para este partido." });
      return;
    }

    res.json(JSON.parse(cached[0].result));
  },
);

// POST /matches/radar — fetches today's fixtures from API-Football
// Subscribed users: unlimited. Freemium users: allowed when freemiumEnabled=true.
router.post(
  "/matches/radar",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = (req as AuthenticatedRequest).dbUser;
    const parsed = RadarMatchesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

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
          error: "El acceso gratuito está desactivado. Adquiere una suscripción para usar el radar.",
          code: "FREEMIUM_DISABLED",
        });
        return;
      }
    }

    try {
      const results = await getMatchesFromApiFootball(parsed.data.leagues);
      res.json(results);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al obtener partidos";
      res.status(422).json({ error: message });
    }
  },
);

// POST /matches/analyze — enriched AI prediction via Groq
// Permission order (strict):
//   1. Subscribed users → unlimited access
//   2. Freemium users → check freemiumEnabled, daily limit (1/day), then allow
// Cache hits bypass the permission check entirely (no AI cost incurred).
router.post(
  "/matches/analyze",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = (req as AuthenticatedRequest).dbUser;
    const parsed = AnalyzeMatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const { homeTeam, awayTeam, league, kickoffTime } = parsed.data;
      const date = getTodayColombia();

      // --- Early cache check: served to all users — no AI cost, no quota consumed ---
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

      // --- Permission check (subscription or freemium) ---
      const isSubscribed =
        user.isSubscriptionActive &&
        isSubscriptionCurrentlyActive(user.subscriptionExpiresAt);

      if (!isSubscribed) {
        // 1. Check if freemium mode is enabled globally
        const [settings] = await db
          .select()
          .from(systemSettingsTable)
          .where(eq(systemSettingsTable.id, 1))
          .limit(1);
        const freemiumEnabled = settings?.freemiumEnabled ?? true;

        if (!freemiumEnabled) {
          res.status(403).json({
            error:
              "El acceso gratuito está desactivado. Adquiere una suscripción para realizar análisis.",
            code: "FREEMIUM_DISABLED",
          });
          return;
        }

        // 2. Compute effective daily count (reset if last analysis was a different day)
        const dailyUsed =
          user.lastAnalysisDate === date ? user.dailyFreeAnalysesUsed : 0;

        if (dailyUsed >= 1) {
          res.status(403).json({
            error:
              "Has agotado tu análisis gratuito de hoy. Adquiere una suscripción para análisis ilimitados.",
            code: "FREEMIUM_LIMIT_REACHED",
          });
          return;
        }

        // 3. Consume the free slot before calling AI (prevents abuse on retries)
        await db
          .update(usersTable)
          .set({ dailyFreeAnalysesUsed: dailyUsed + 1, lastAnalysisDate: date })
          .where(eq(usersTable.clerkId, user.clerkId));
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
        fixtureId,
      );
      res.json(analysis);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al analizar el partido";
      res.status(422).json({ error: message });
    }
  },
);

// GET /matches/parlay-of-the-day
// Reads today's analysis cache and builds a parlay from all high-confidence picks
// (best pick per match to avoid correlated legs).
router.get(
  "/matches/parlay-of-the-day",
  requireAuth,
  requireSubscription,
  async (req, res): Promise<void> => {
    const date = getTodayColombia();

    // Load all of today's cached analyses
    const analyses = await db
      .select()
      .from(analysisCacheTable)
      .where(eq(analysisCacheTable.date, date));

    if (analyses.length === 0) {
      res.json({ date, legs: [], combinedOdds: 1, totalAnalyzed: 0 });
      return;
    }

    // Pre-load radar fixture list once for kickoffTime lookups
    let radarFixtures: ApiFootballMatch[] = [];
    try {
      const [radarRow] = await db
        .select()
        .from(radarCacheTable)
        .where(and(eq(radarCacheTable.date, date), eq(radarCacheTable.league, "af_all")))
        .limit(1);
      if (radarRow) radarFixtures = JSON.parse(radarRow.result) as ApiFootballMatch[];
    } catch { /* non-fatal */ }

    const getKickoffTime = (homeTeam: string, awayTeam: string): string | null => {
      const m = radarFixtures.find(
        (f) =>
          f.homeTeam.toLowerCase() === homeTeam.toLowerCase() &&
          f.awayTeam.toLowerCase() === awayTeam.toLowerCase(),
      );
      return m?.kickoffTime ?? null;
    };

    type ParlayLeg = {
      homeTeam: string;
      awayTeam: string;
      league: string;
      kickoffTime: string | null;
      market: string;
      selection: string;
      odds: number;
      reasoning: string | null;
    };

    const legs: ParlayLeg[] = [];

    for (const row of analyses) {
      let analysis: any;
      try { analysis = JSON.parse(row.result); } catch { continue; }

      const highPreds: any[] = (analysis.predictions ?? []).filter(
        (p: any) => p.confidence === "high" && typeof p.odds === "number" && p.odds > 1,
      );
      if (highPreds.length === 0) continue;

      // Take the highest-odds high-confidence pick from this match
      // (one pick per match avoids correlated legs)
      const best = highPreds.reduce((a: any, b: any) => (b.odds > a.odds ? b : a));

      legs.push({
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        league: row.league,
        kickoffTime: getKickoffTime(row.homeTeam, row.awayTeam),
        market: best.market,
        selection: best.selection,
        odds: typeof best.odds === "string" ? parseFloat(best.odds) : best.odds,
        reasoning: best.reasoning ?? null,
      });
    }

    // Sort by kickoff time ascending, then by odds descending as tiebreaker
    legs.sort((a, b) => {
      if (a.kickoffTime && b.kickoffTime) {
        const diff = new Date(a.kickoffTime).getTime() - new Date(b.kickoffTime).getTime();
        if (diff !== 0) return diff;
      }
      return b.odds - a.odds;
    });

    // Cap at 6 legs to keep the parlay reasonable
    const parlayLegs = legs.slice(0, 6);
    const combinedOdds = parlayLegs.reduce((acc, l) => acc * l.odds, 1);

    res.json({
      date,
      legs: parlayLegs,
      combinedOdds: parseFloat(combinedOdds.toFixed(2)),
      totalAnalyzed: analyses.length,
    });
  },
);

export default router;

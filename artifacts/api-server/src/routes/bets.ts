import { Router, type IRouter } from "express";
import { eq, and, sql, desc, count } from "drizzle-orm";
import { db, betsTable } from "@workspace/db";
import {
  ListBetsQueryParams,
  ListBetsResponse,
  CreateBetBody,
  CreateBetResponse,
  GetBetStatsResponse,
  GetBetParams,
  GetBetResponse,
  UpdateBetParams,
  UpdateBetBody,
  UpdateBetResponse,
  DeleteBetParams,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";

const router: IRouter = Router();

function serializeBet(bet: typeof betsTable.$inferSelect) {
  return {
    id: bet.id,
    homeTeam: bet.homeTeam,
    awayTeam: bet.awayTeam,
    league: bet.league,
    kickoffTime: bet.kickoffTime,
    market: bet.market,
    selection: bet.selection,
    odds: bet.odds,
    stake: bet.stake,
    fixtureId: bet.fixtureId ?? null,
    confidence: (bet.confidence as "low" | "medium" | "high" | null) ?? null,
    status: bet.status,
    returnAmount: bet.returnAmount,
    notes: bet.notes,
    finalScore: bet.finalScore ?? null,
    finalStats: bet.finalStats ? JSON.parse(bet.finalStats) : null,
    createdAt: bet.createdAt.toISOString(),
    updatedAt: bet.updatedAt.toISOString(),
  };
}

// GET /bets/stats (must be before /bets/:betId)
router.get("/bets/stats", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthenticatedRequest).dbUser;

  const [stats] = await db
    .select({
      totalBets: sql<number>`count(*)::int`,
      pendingBets: sql<number>`count(*) filter (where status = 'pending')::int`,
      wonBets: sql<number>`count(*) filter (where status = 'won')::int`,
      lostBets: sql<number>`count(*) filter (where status = 'lost')::int`,
      totalStaked: sql<number>`coalesce(sum(stake) filter (where status in ('won', 'lost')), 0)::float`,
      totalReturned: sql<number>`coalesce(sum(return_amount) filter (where status = 'won'), 0)::float`,
    })
    .from(betsTable)
    .where(eq(betsTable.clerkId, user.clerkId));

  const totalStaked = Number(stats?.totalStaked ?? 0);
  const totalReturned = Number(stats?.totalReturned ?? 0);
  const wonBets = Number(stats?.wonBets ?? 0);
  const lostBets = Number(stats?.lostBets ?? 0);
  const resolvedBets = wonBets + lostBets;

  const roi = totalStaked > 0 ? ((totalReturned - totalStaked) / totalStaked) * 100 : 0;
  const winRate = resolvedBets > 0 ? (wonBets / resolvedBets) * 100 : 0;

  res.json(
    GetBetStatsResponse.parse({
      totalBets: Number(stats?.totalBets ?? 0),
      pendingBets: Number(stats?.pendingBets ?? 0),
      wonBets,
      lostBets,
      totalStaked,
      totalReturned,
      roi: Math.round(roi * 100) / 100,
      winRate: Math.round(winRate * 100) / 100,
    }),
  );
});

// GET /bets
router.get("/bets", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthenticatedRequest).dbUser;

  const params = ListBetsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const page = params.data.page ?? 1;
  const limit = params.data.limit ?? 15;
  const offset = (page - 1) * limit;

  const conditions = [eq(betsTable.clerkId, user.clerkId)];
  if (params.data.status) {
    conditions.push(eq(betsTable.status, params.data.status));
  }

  const [totalResult, bets] = await Promise.all([
    db
      .select({ total: count() })
      .from(betsTable)
      .where(and(...conditions)),
    db
      .select()
      .from(betsTable)
      .where(and(...conditions))
      .orderBy(desc(betsTable.kickoffTime))
      .limit(limit)
      .offset(offset),
  ]);

  const total = totalResult[0]?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  res.json(ListBetsResponse.parse({
    data: bets.map(serializeBet),
    total,
    page,
    limit,
    totalPages,
  }));
});

// POST /bets
router.post("/bets", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthenticatedRequest).dbUser;

  const parsed = CreateBetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [bet] = await db
    .insert(betsTable)
    .values({
      clerkId: user.clerkId,
      ...parsed.data,
    })
    .returning();

  res.status(201).json(CreateBetResponse.parse(serializeBet(bet)));
});

// GET /bets/:betId
router.get("/bets/:betId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthenticatedRequest).dbUser;

  const params = GetBetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [bet] = await db
    .select()
    .from(betsTable)
    .where(
      and(eq(betsTable.id, params.data.betId), eq(betsTable.clerkId, user.clerkId)),
    )
    .limit(1);

  if (!bet) {
    res.status(404).json({ error: "Apuesta no encontrada" });
    return;
  }

  res.json(GetBetResponse.parse(serializeBet(bet)));
});

// PUT /bets/:betId
router.put("/bets/:betId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthenticatedRequest).dbUser;

  const params = UpdateBetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateBetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Partial<typeof betsTable.$inferInsert> = {};
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.returnAmount !== undefined) updateData.returnAmount = parsed.data.returnAmount;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

  const [bet] = await db
    .update(betsTable)
    .set(updateData)
    .where(
      and(eq(betsTable.id, params.data.betId), eq(betsTable.clerkId, user.clerkId)),
    )
    .returning();

  if (!bet) {
    res.status(404).json({ error: "Apuesta no encontrada" });
    return;
  }

  res.json(UpdateBetResponse.parse(serializeBet(bet)));
});

// DELETE /bets/:betId
router.delete("/bets/:betId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthenticatedRequest).dbUser;

  const params = DeleteBetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [bet] = await db
    .delete(betsTable)
    .where(
      and(eq(betsTable.id, params.data.betId), eq(betsTable.clerkId, user.clerkId)),
    )
    .returning();

  if (!bet) {
    res.status(404).json({ error: "Apuesta no encontrada" });
    return;
  }

  res.sendStatus(204);
});

export default router;

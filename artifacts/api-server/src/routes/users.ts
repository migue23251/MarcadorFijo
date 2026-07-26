import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  GetMeResponse,
  UpdateMeBody,
  UpdateMeResponse,
  ListUsersResponse,
  UpdateUserSubscriptionParams,
  UpdateUserSubscriptionBody,
  UpdateUserSubscriptionResponse,
} from "@workspace/api-zod";
import {
  requireAuth,
  requireAdmin,
  isSubscriptionCurrentlyActive,
  type AuthenticatedRequest,
} from "../lib/auth";

const router: IRouter = Router();

const PLAN_DURATION_MONTHS: Record<string, number> = {
  mensual: 1,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};

function defaultSubscriptionExpiry(plan: string): Date {
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + (PLAN_DURATION_MONTHS[plan] ?? 1));
  return expiresAt;
}

function userProfileResponse(user: typeof usersTable.$inferSelect) {
  return {
    clerkId: user.clerkId,
    email: user.email,
    name: user.name,
    role: user.role,
    currency: user.currency,
    activeSubscription: user.activeSubscription,
    subscriptionExpiresAt: user.subscriptionExpiresAt?.toISOString() ?? null,
    subscriptionPlan: user.subscriptionPlan,
    isSubscriptionActive: isSubscriptionCurrentlyActive(user.subscriptionExpiresAt),
    dailyFreeAnalysesUsed: user.dailyFreeAnalysesUsed,
    lastAnalysisDate: user.lastAnalysisDate,
    createdAt: user.createdAt.toISOString(),
  };
}

// GET /users/me
router.get("/users/me", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthenticatedRequest).dbUser;
  res.json(GetMeResponse.parse(userProfileResponse(user)));
});

// PUT /users/me
router.put("/users/me", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthenticatedRequest).dbUser;
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({
      name: parsed.data.name,
      ...(parsed.data.currency !== undefined && { currency: parsed.data.currency }),
    })
    .where(eq(usersTable.clerkId, user.clerkId))
    .returning();

  res.json(UpdateMeResponse.parse(userProfileResponse(updated)));
});

// GET /users (admin only)
router.get(
  "/users",
  requireAuth,
  requireAdmin,
  async (_req, res): Promise<void> => {
    const users = await db
      .select()
      .from(usersTable)
      .orderBy(usersTable.createdAt);

    res.json(
      ListUsersResponse.parse(
        users.map(userProfileResponse),
      ),
    );
  },
);

// PUT /users/:userId/subscription (admin only)
router.put(
  "/users/:userId/subscription",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateUserSubscriptionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const body = UpdateUserSubscriptionBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const expiresAt = body.data.subscriptionExpiresAt
      ? new Date(body.data.subscriptionExpiresAt)
      : null;
    const plan = body.data.subscriptionPlan ?? "mensual";
    const effectiveExpiresAt = body.data.activeSubscription
      ? expiresAt ?? defaultSubscriptionExpiry(plan)
      : null;

    const [updated] = await db
      .update(usersTable)
      .set({
        activeSubscription: body.data.activeSubscription,
        subscriptionExpiresAt: effectiveExpiresAt,
        subscriptionPlan: body.data.activeSubscription ? plan : "free",
        isSubscriptionActive: isSubscriptionCurrentlyActive(effectiveExpiresAt),
      })
      .where(eq(usersTable.clerkId, params.data.userId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    res.json(UpdateUserSubscriptionResponse.parse(userProfileResponse(updated)));
  },
);

export default router;

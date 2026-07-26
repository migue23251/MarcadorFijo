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
  type AuthenticatedRequest,
} from "../lib/auth";

const router: IRouter = Router();

// GET /users/me
router.get("/users/me", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthenticatedRequest).dbUser;
  res.json(
    GetMeResponse.parse({
      clerkId: user.clerkId,
      email: user.email,
      name: user.name,
      role: user.role,
      currency: user.currency,
      activeSubscription: user.activeSubscription,
      subscriptionExpiresAt: user.subscriptionExpiresAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    }),
  );
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

  res.json(
    UpdateMeResponse.parse({
      clerkId: updated.clerkId,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      currency: updated.currency,
      activeSubscription: updated.activeSubscription,
      subscriptionExpiresAt: updated.subscriptionExpiresAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    }),
  );
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
        users.map((u) => ({
          clerkId: u.clerkId,
          email: u.email,
          name: u.name,
          role: u.role,
          activeSubscription: u.activeSubscription,
          subscriptionExpiresAt: u.subscriptionExpiresAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        })),
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

    const [updated] = await db
      .update(usersTable)
      .set({
        activeSubscription: body.data.activeSubscription,
        subscriptionExpiresAt: expiresAt ?? undefined,
      })
      .where(eq(usersTable.clerkId, params.data.userId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    res.json(
      UpdateUserSubscriptionResponse.parse({
        clerkId: updated.clerkId,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        activeSubscription: updated.activeSubscription,
        subscriptionExpiresAt: updated.subscriptionExpiresAt?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
      }),
    );
  },
);

export default router;

import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { createClerkClient } from "@clerk/backend";
import { eq, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "./logger";
import type { User } from "@workspace/db";

export interface AuthenticatedRequest extends Request {
  dbUser: User;
}

export function isSubscriptionCurrentlyActive(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() > Date.now();
}

let _clerkClient: ReturnType<typeof createClerkClient> | null = null;

function getClerkClient() {
  if (!_clerkClient) {
    _clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  }
  return _clerkClient;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY) {
    res.status(401).json({ error: "Autenticación no configurada en este entorno" });
    return;
  }

  const auth = getAuth(req);
  const clerkId = auth?.userId;

  if (!clerkId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);

  if (!user || !user.name?.trim()) {
    // JIT provision/profile sync — keep the local profile aligned with Clerk
    let email = user?.email ?? "";
    let name: string | null = user?.name ?? null;
    try {
      const client = getClerkClient();
      const clerkUser = await client.users.getUser(clerkId);
      email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
      const clerkName = [clerkUser.firstName, clerkUser.lastName]
        .filter((part): part is string => Boolean(part?.trim()))
        .join(" ")
        .trim();
      name = clerkName || clerkUser.username?.trim() || null;
    } catch (err) {
      logger.warn({ err, clerkId }, "Could not fetch Clerk user for JIT provisioning");
    }

    if (!user) {
      // First user becomes admin and gets an active subscription
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(usersTable);

      const isFirstUser = Number(count) === 0;

      [user] = await db
        .insert(usersTable)
        .values({
          clerkId,
          email,
          name,
          role: isFirstUser ? "admin" : "user",
          activeSubscription: isFirstUser,
          subscriptionPlan: isFirstUser ? "anual" : "free",
          subscriptionExpiresAt: isFirstUser
            ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
            : null,
          isSubscriptionActive: isFirstUser,
        })
        .returning();

      logger.info({ clerkId, role: user.role, hasName: Boolean(name) }, "JIT provisioned new user");
    } else if (name) {
      [user] = await db
        .update(usersTable)
        .set({ name })
        .where(eq(usersTable.clerkId, clerkId))
        .returning();

      logger.info({ clerkId, hasName: true }, "Synchronized user name from Clerk");
    }
  }

  (req as AuthenticatedRequest).dbUser = user;
  next();
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const dbUser = (req as AuthenticatedRequest).dbUser;
  if (!dbUser || dbUser.role !== "admin") {
    res.status(403).json({ error: "Se requiere acceso de administrador" });
    return;
  }
  next();
}

export function requireSubscription(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const dbUser = (req as AuthenticatedRequest).dbUser;
  if (!dbUser?.activeSubscription || !isSubscriptionCurrentlyActive(dbUser.subscriptionExpiresAt)) {
    res.status(403).json({ error: "Se requiere suscripción activa" });
    return;
  }
  next();
}

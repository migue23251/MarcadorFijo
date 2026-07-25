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

  if (!user) {
    // JIT provision — look up email from Clerk
    let email = "";
    try {
      const client = getClerkClient();
      const clerkUser = await client.users.getUser(clerkId);
      email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
    } catch (err) {
      logger.warn({ err, clerkId }, "Could not fetch Clerk user for JIT provisioning");
    }

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
        role: isFirstUser ? "admin" : "user",
        activeSubscription: isFirstUser,
      })
      .returning();

    logger.info({ clerkId, role: user.role }, "JIT provisioned new user");
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
  if (!dbUser?.activeSubscription) {
    res.status(403).json({ error: "Se requiere suscripción activa" });
    return;
  }
  next();
}

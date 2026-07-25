import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, userConfigsTable } from "@workspace/db";
import {
  GetGeminiKeyStatusResponse,
  SaveGeminiKeyBody,
  SaveGeminiKeyResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { encrypt, decrypt } from "../lib/crypto";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /config/gemini-key
router.get(
  "/config/gemini-key",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = (req as AuthenticatedRequest).dbUser;

    const [config] = await db
      .select()
      .from(userConfigsTable)
      .where(eq(userConfigsTable.clerkId, user.clerkId))
      .limit(1);

    res.json(
      GetGeminiKeyStatusResponse.parse({
        hasKey: !!config?.geminiKeyEncrypted,
      }),
    );
  },
);

// PUT /config/gemini-key
router.put(
  "/config/gemini-key",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = (req as AuthenticatedRequest).dbUser;

    const parsed = SaveGeminiKeyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const encrypted = encrypt(parsed.data.apiKey);

    // Upsert config
    const [existing] = await db
      .select()
      .from(userConfigsTable)
      .where(eq(userConfigsTable.clerkId, user.clerkId))
      .limit(1);

    if (existing) {
      await db
        .update(userConfigsTable)
        .set({ geminiKeyEncrypted: encrypted })
        .where(eq(userConfigsTable.clerkId, user.clerkId));
    } else {
      await db.insert(userConfigsTable).values({
        clerkId: user.clerkId,
        geminiKeyEncrypted: encrypted,
      });
    }

    req.log.info({ clerkId: user.clerkId }, "Gemini API key saved");

    res.json(SaveGeminiKeyResponse.parse({ hasKey: true }));
  },
);

// DELETE /config/gemini-key
router.delete(
  "/config/gemini-key",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = (req as AuthenticatedRequest).dbUser;

    await db
      .update(userConfigsTable)
      .set({ geminiKeyEncrypted: null })
      .where(eq(userConfigsTable.clerkId, user.clerkId));

    logger.info({ clerkId: user.clerkId }, "Gemini API key deleted");

    res.sendStatus(204);
  },
);

// Internal helper — get decrypted key for a user (used by matches routes)
export async function getUserGeminiKey(clerkId: string): Promise<string | null> {
  const [config] = await db
    .select()
    .from(userConfigsTable)
    .where(eq(userConfigsTable.clerkId, clerkId))
    .limit(1);

  if (!config?.geminiKeyEncrypted) return null;

  try {
    return decrypt(config.geminiKeyEncrypted);
  } catch {
    return null;
  }
}

export default router;

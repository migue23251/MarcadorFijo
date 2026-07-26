import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, userConfigsTable } from "@workspace/db";
import {
  GetGeminiKeyStatusResponse,
  GetGeminiModelsResponse,
  SaveGeminiKeyBody,
  SaveGeminiKeyResponse,
  GetGeminiModelResponse,
  SaveGeminiModelBody,
  SaveGeminiModelResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { encrypt, decrypt } from "../lib/crypto";
import { logger } from "../lib/logger";
import { listAvailableModels, GeminiApiError } from "../lib/gemini";

export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

const router: IRouter = Router();

// GET /config/gemini-models
router.get(
  "/config/gemini-models",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = (req as AuthenticatedRequest).dbUser;
    const apiKey = await getUserGeminiKey(user.clerkId);

    if (!apiKey) {
      res.status(400).json({ error: "No Gemini API key configured." });
      return;
    }

    try {
      const models = await listAvailableModels(apiKey);
      res.json(GetGeminiModelsResponse.parse({ models }));
    } catch (err) {
      if (err instanceof GeminiApiError) {
        res.status(502).json({ error: err.message });
      } else {
        res.status(502).json({ error: "Error al consultar los modelos de Gemini." });
      }
    }
  },
);

// GET /config/gemini-model
router.get(
  "/config/gemini-model",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = (req as AuthenticatedRequest).dbUser;

    const [config] = await db
      .select()
      .from(userConfigsTable)
      .where(eq(userConfigsTable.clerkId, user.clerkId))
      .limit(1);

    res.json(
      GetGeminiModelResponse.parse({
        model: config?.geminiModel ?? DEFAULT_GEMINI_MODEL,
      }),
    );
  },
);

// PUT /config/gemini-model
router.put(
  "/config/gemini-model",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = (req as AuthenticatedRequest).dbUser;

    const parsed = SaveGeminiModelBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(userConfigsTable)
      .where(eq(userConfigsTable.clerkId, user.clerkId))
      .limit(1);

    if (existing) {
      await db
        .update(userConfigsTable)
        .set({ geminiModel: parsed.data.model })
        .where(eq(userConfigsTable.clerkId, user.clerkId));
    } else {
      await db.insert(userConfigsTable).values({
        clerkId: user.clerkId,
        geminiModel: parsed.data.model,
      });
    }

    logger.info({ clerkId: user.clerkId, model: parsed.data.model }, "Gemini model saved");

    res.json(SaveGeminiModelResponse.parse({ model: parsed.data.model }));
  },
);

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

// Internal helper — get selected Gemini model for a user (used by matches routes)
export async function getUserGeminiModel(clerkId: string): Promise<string> {
  const [config] = await db
    .select()
    .from(userConfigsTable)
    .where(eq(userConfigsTable.clerkId, clerkId))
    .limit(1);

  return config?.geminiModel ?? DEFAULT_GEMINI_MODEL;
}

export default router;

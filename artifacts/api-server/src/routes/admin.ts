/**
 * Rutas de administración.
 *
 * Todas las rutas requieren autenticación Clerk + rol "admin".
 */

import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../lib/auth";
import { verificarResultadosDelDia } from "../services/resultChecker";
import { logger } from "../lib/logger";
import { db, systemSettingsTable } from "@workspace/db";
import { GetAdminSettingsResponse, UpdateAdminSettingsBody } from "@workspace/api-zod";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

async function getOrCreateSettings() {
  const [existing] = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.id, 1)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(systemSettingsTable).values({ id: 1, freemiumEnabled: true }).returning();
  return created;
}

router.get(
  "/admin/settings",
  requireAuth,
  requireAdmin,
  async (_req, res): Promise<void> => {
    const settings = await getOrCreateSettings();
    res.json(GetAdminSettingsResponse.parse({
      freemiumEnabled: settings.freemiumEnabled,
    }));
  },
);

router.post(
  "/admin/settings",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = UpdateAdminSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [updated] = await db
      .insert(systemSettingsTable)
      .values({ id: 1, freemiumEnabled: parsed.data.freemiumEnabled })
      .onConflictDoUpdate({
        target: systemSettingsTable.id,
        set: { freemiumEnabled: parsed.data.freemiumEnabled },
      })
      .returning();

    res.json(GetAdminSettingsResponse.parse({
      freemiumEnabled: updated.freemiumEnabled,
    }));
  },
);

/**
 * POST /admin/verificar-resultados
 *
 * Dispara manualmente la verificación y liquidación de apuestas del día.
 * Solo accesible para administradores.
 */
router.post(
  "/admin/verificar-resultados",
  requireAuth,
  requireAdmin,
  async (_req, res): Promise<void> => {
    logger.info("Verificación manual iniciada por administrador");
    try {
      const summary = await verificarResultadosDelDia();
      res.json({ ok: true, summary });
    } catch (err: any) {
      logger.error({ err }, "Error en verificación manual");
      res.status(500).json({
        ok: false,
        error: err?.message ?? "Error interno durante la verificación",
      });
    }
  },
);

export default router;

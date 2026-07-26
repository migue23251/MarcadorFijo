/**
 * Rutas de administración.
 *
 * Todas las rutas requieren autenticación Clerk + rol "admin".
 */

import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../lib/auth";
import { verificarResultadosDelDia } from "../services/resultChecker";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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

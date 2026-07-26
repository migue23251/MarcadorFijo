/**
 * Programador de tareas nocturnas.
 *
 * Se ejecuta automáticamente a las 23:30 UTC todos los días para
 * verificar resultados de partidos y liquidar apuestas pendientes.
 */

import cron from "node-cron";
import { logger } from "../lib/logger";
import { verificarResultadosDelDia } from "../services/resultChecker";

let scheduled = false;

export function initScheduler(): void {
  if (scheduled) return;
  scheduled = true;

  // Cada día a las 23:30 UTC
  cron.schedule("30 23 * * *", async () => {
    logger.info("Cron: iniciando verificación nocturna de resultados");
    try {
      const summary = await verificarResultadosDelDia();
      logger.info(summary, "Cron: verificación nocturna completada");
    } catch (err) {
      logger.error({ err }, "Cron: error durante la verificación nocturna");
    }
  });

  logger.info("Scheduler iniciado — verificación nocturna programada a las 23:30 UTC");
}

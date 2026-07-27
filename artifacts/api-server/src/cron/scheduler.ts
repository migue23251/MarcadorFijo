/**
 * Programador de tareas de verificación de resultados.
 *
 * Corre cada hora para liquidar apuestas pendientes en cuanto los
 * partidos terminan, sin esperar a la verificación nocturna.
 * También mantiene una pasada nocturna a las 23:30 UTC como seguro
 * para capturar partidos tardíos.
 */

import cron from "node-cron";
import { logger } from "../lib/logger";
import { verificarResultadosDelDia } from "../services/resultChecker";

let scheduled = false;

export function initScheduler(): void {
  if (scheduled) return;
  scheduled = true;

  async function runVerification(trigger: string) {
    logger.info({ trigger }, "Iniciando verificación de resultados");
    try {
      const summary = await verificarResultadosDelDia();
      logger.info(summary, `Verificación completada (${trigger})`);
    } catch (err) {
      logger.error({ err, trigger }, "Error durante la verificación de resultados");
    }
  }

  // Verificación cada 2 horas, las 24 horas del día (12 llamadas diarias).
  cron.schedule("0 */2 * * *", () => runVerification("cron-every-2h"));

  logger.info(
    "Scheduler iniciado — verificación cada 2 horas (00:00–22:00 UTC, 12 llamadas/día)",
  );
}

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

  // Verificación cada hora, entre las 12:00 y las 23:59 UTC
  // (cubre la mayoría de horarios de partidos europeos, americanos y asiáticos).
  cron.schedule("0 12-23 * * *", () => runVerification("cron-hourly"));

  // Pasada nocturna de seguridad a las 00:30 UTC para partidos que
  // terminaron pasada la medianoche UTC.
  cron.schedule("30 0 * * *", () => runVerification("cron-midnight"));

  logger.info(
    "Scheduler iniciado — verificación cada hora (12:00–23:00 UTC) + pasada nocturna a las 00:30 UTC",
  );
}

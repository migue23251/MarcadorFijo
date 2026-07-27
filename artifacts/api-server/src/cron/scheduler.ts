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

  // Verificación cada 2 horas durante el día (02:00–22:00 UTC, 11 llamadas).
  cron.schedule("0 2,4,6,8,10,12,14,16,18,20,22 * * *", () => runVerification("cron-every-2h"));

  // Pasada de medianoche (00:00 UTC): además de los partidos del día actual,
  // el lookback automático del servicio captura las apuestas del día anterior
  // cuyos partidos terminaron entre las 22:00 y las 23:59 UTC y que no
  // pudieron resolverse en la pasada de las 22:00 (partido aún en curso).
  cron.schedule("0 0 * * *", () => runVerification("cron-midnight-lookback"));

  logger.info(
    "Scheduler iniciado — verificación cada 2 horas (02:00–22:00 UTC) + medianoche con lookback al día anterior (12 llamadas/día)",
  );
}

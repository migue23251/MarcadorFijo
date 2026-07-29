/**
 * Timezone helpers for MarcadorFijo.
 *
 * Colombia operates on UTC-5 year-round (no DST).
 * All date keys used for fixture queries and cache lookups must use
 * the Colombian date so that matches on e.g. 2025-07-29 at 20:00 COL
 * (01:00 UTC on 2025-07-30) are still fetched under the Colombian date.
 */

/** IANA timezone name for Colombia. */
export const COLOMBIA_TZ = "America/Bogota";

/**
 * Returns today's date string (YYYY-MM-DD) in Colombia time.
 * Uses the fixed UTC-5 offset — equivalent to America/Bogota which
 * observes no DST.
 */
export function getTodayColombia(): string {
  const now = new Date();
  // UTC-5: subtract 5 hours from UTC
  const colombiaMs = now.getTime() - 5 * 60 * 60 * 1000;
  return new Date(colombiaMs).toISOString().split("T")[0];
}

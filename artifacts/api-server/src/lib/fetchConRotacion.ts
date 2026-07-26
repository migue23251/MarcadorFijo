/**
 * Helper de rotación automática de API Keys.
 *
 * Intenta la petición con la primera key disponible. Si recibe HTTP 429
 * o un body con errores de límite de tasa (patrón de API-Football),
 * rota transparentemente a la siguiente key del arreglo.
 */

import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Cómo inyectar la key en la petición. */
export type KeyConfig =
  | { type: "header"; name: string; extraHeaders?: Record<string, string> }
  | { type: "param";  name: string };

// ---------------------------------------------------------------------------
// Internos
// ---------------------------------------------------------------------------

/**
 * Detecta si el body de la respuesta indica un error de límite de tasa.
 * Cubre el patrón de API-Football: `{ errors: { rateLimit: "..." } }`.
 */
function isRateLimitBody(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const errs = (body as any).errors;
  if (!errs) return false;
  if (Array.isArray(errs) ? errs.length === 0 : Object.keys(errs).length === 0) return false;
  const str = JSON.stringify(errs).toLowerCase();
  return (
    str.includes("ratelimit") ||
    str.includes("rate limit") ||
    str.includes("requests limit") ||
    str.includes("too many requests") ||
    str.includes("quota")
  );
}

// ---------------------------------------------------------------------------
// Función principal
// ---------------------------------------------------------------------------

/**
 * Realiza una petición HTTP con rotación automática de keys.
 *
 * @param baseUrl   URL base (sin la key; se añade según `keyConfig`).
 * @param keys      Array de keys a intentar en orden.
 * @param keyConfig Dónde inyectar la key: encabezado HTTP o query param.
 * @param options   Opciones extra para `fetch` (headers, method, body…).
 * @returns         Body de la respuesta ya parseado como JSON.
 * @throws          Si todas las keys están agotadas o hay un error no-rate-limit.
 */
export async function fetchConRotacion(
  baseUrl: URL | string,
  keys: string[],
  keyConfig: KeyConfig,
  options: RequestInit = {},
): Promise<any> {
  const validKeys = keys.filter(Boolean);
  if (validKeys.length === 0) {
    throw new Error("fetchConRotacion: no hay API keys configuradas");
  }

  let lastError: Error | null = null;

  for (let i = 0; i < validKeys.length; i++) {
    const key = validKeys[i];
    const url = new URL(baseUrl.toString());

    // Construir headers base
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> ?? {}),
    };

    if (keyConfig.type === "header") {
      headers[keyConfig.name] = key;
      if (keyConfig.extraHeaders) {
        Object.assign(headers, keyConfig.extraHeaders);
      }
    } else {
      url.searchParams.set(keyConfig.name, key);
    }

    // --- Intento de petición ---
    let res: Response;
    try {
      res = await fetch(url.toString(), { ...options, headers });
    } catch (err) {
      logger.warn({ err, keyIndex: i }, "fetchConRotacion: error de red");
      lastError = err instanceof Error ? err : new Error(String(err));
      continue; // red caída → probar siguiente key
    }

    // HTTP 429 → rotar
    if (res.status === 429) {
      logger.warn(
        { keyIndex: i, url: url.pathname },
        "fetchConRotacion: HTTP 429 — rotando a la siguiente key",
      );
      lastError = new Error(`HTTP 429 con key[${i}]`);
      continue;
    }

    // Otro error HTTP no relacionado con rate-limit → falla inmediata
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`fetchConRotacion: HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    // Parsear body JSON
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // Respuesta no-JSON — se devuelve null
      return null;
    }

    // Error de rate-limit en body (ej. API-Football HTTP 200 con errors.rateLimit)
    if (isRateLimitBody(body)) {
      logger.warn(
        { keyIndex: i, errors: (body as any).errors, url: url.pathname },
        "fetchConRotacion: límite de tasa en body — rotando a la siguiente key",
      );
      lastError = new Error(`Rate-limit en body con key[${i}]: ${JSON.stringify((body as any).errors)}`);
      continue;
    }

    if (i > 0) {
      logger.info(
        { keyIndex: i, url: url.pathname },
        "fetchConRotacion: petición resuelta con key de respaldo",
      );
    }

    return body;
  }

  throw lastError ?? new Error("fetchConRotacion: todas las keys agotadas");
}

/**
 * Currency formatting utility for RadarBet.
 * Uses Intl.NumberFormat so the symbol, grouping, and decimal style
 * all match the locale conventions for each currency.
 */

export const SUPPORTED_CURRENCIES = [
  { code: "COP", label: "COP — Peso colombiano" },
  { code: "USD", label: "USD — Dólar estadounidense" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "GBP", label: "GBP — Libra esterlina" },
  { code: "MXN", label: "MXN — Peso mexicano" },
  { code: "ARS", label: "ARS — Peso argentino" },
  { code: "BRL", label: "BRL — Real brasileño" },
  { code: "PEN", label: "PEN — Sol peruano" },
  { code: "CLP", label: "CLP — Peso chileno" },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

/** Format an amount using the given currency code. */
export function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback if the currency code is unrecognised
    return `${currency} ${amount.toFixed(2)}`;
  }
}

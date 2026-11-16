/** 1234 → "1.2K", 5_600_000 → "5.6M" — token counts don't need precision. */
export function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

/** Whole dollars stay whole; anything else gets cents. */
export const fmtUsd = (n: number) => (n % 1 ? n.toFixed(2) : String(n));

/** Rounded to the cent, then formatted. */
export const fmtCents = (n: number) => fmtUsd(Math.round(n * 100) / 100);

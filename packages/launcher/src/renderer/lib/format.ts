const UNITS = ["B", "KB", "MB", "GB", "TB"]

/**
 * Human byte sizes. One decimal below 10 in any unit above bytes, none above —
 * "1.4 GB" carries information, "1.4 KB" and "342.0 MB" do not.
 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "—"
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${UNITS[unit]}`
}

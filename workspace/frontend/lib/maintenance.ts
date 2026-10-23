/**
 * Scheduled maintenance window, shown as a banner across the workspace app
 * (and the Launcher, which embeds these pages). Edit or clear the window here;
 * the banner hides itself once `end` has passed, so a stale entry is harmless.
 *
 * 2026-10-14: Workspace v1.0 → v1.1 upgrade, 12:00–13:00 America/Los_Angeles
 * (PDT, UTC-7) = 19:00–20:00 UTC.
 */
export const MAINTENANCE_WINDOW: { id: string; start: string; end: string } | null = {
  id: 'upgrade-v1.1-2026-10-14',
  start: '2026-10-14T19:00:00Z',
  end: '2026-10-14T20:00:00Z',
};

export type MaintenancePhase = 'upcoming' | 'active' | 'over';

export function maintenancePhase(now: number, w = MAINTENANCE_WINDOW): MaintenancePhase {
  if (!w) return 'over';
  const start = Date.parse(w.start);
  const end = Date.parse(w.end);
  if (now >= end) return 'over';
  if (now >= start) return 'active';
  return 'upcoming';
}

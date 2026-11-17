// Shared pieces of the feature-tour scenes: the tour palette, the one-shot
// animation clock and the small building blocks every scene draws with.

import { useEffect, useState } from 'react';

export const BLUE = '#2F6BFF';
export const TEAL = '#16C79A';
// Theme-dependent colours resolve through `--tour-*` variables (TOUR_CSS),
// so the scenes follow the app's light/dark theme.
export const INK = 'var(--tour-ink)';
export const BORDER = 'var(--tour-border)';
export const MUTED = 'var(--tour-muted)';
export const FAINT = 'var(--tour-faint)';
export const TRACK = 'var(--tour-track)';
export const SUBTLE = 'var(--tour-subtle)';
export const TINT = 'var(--tour-tint)';
export const AMBER = 'var(--tour-amber)';
export const WASH = 'var(--tour-wash)';
export const TOUR_CSS = `
  .oa-tour {
    --tour-page: #ffffff; --tour-card: #ffffff; --tour-chip: #f4f4f5; --tour-subtle: #fafafa;
    --tour-lane: rgba(255,255,255,0.72); --tour-tint: #eef3ff;
    --tour-ink: #0A0A0A; --tour-muted: #71717a; --tour-faint: #a1a1aa;
    --tour-border: #ececee; --tour-track: #d4d4d8; --tour-amber: #b45309;
    --tour-wash: linear-gradient(160deg, #eaf2ff 0%, #f4f8ff 40%, #ffffff 100%);
  }
  .dark .oa-tour {
    --tour-page: var(--background); --tour-card: #18181b; --tour-chip: #27272a; --tour-subtle: #111113;
    --tour-lane: rgba(24,24,27,0.6); --tour-tint: rgba(47,107,255,0.18);
    --tour-ink: #fafafa; --tour-muted: #a1a1aa; --tour-faint: #71717a;
    --tour-border: #27272a; --tour-track: #3f3f46; --tour-amber: #fbbf24;
    --tour-wash: linear-gradient(160deg, #0f1a33 0%, #0c1222 40%, #09090b 100%);
  }
`;
export const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

// ── animation clock: plays once per `key`, clamps at total ──
export function useClock(totalMs: number, key: string | number) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const v = now - t0;
      setMs(Math.min(v, totalMs));
      if (v < totalMs) raf = requestAnimationFrame(tick);
    };
    setMs(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, totalMs]);
  return ms;
}

export function Stamp({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div style={{ visibility: show ? undefined : 'hidden', animation: show ? `tour-in 0.4s ${EASE} backwards` : undefined }}>
      {children}
    </div>
  );
}

export function Dot({ color = '#6366F1', size = 20 }: { color?: string; size?: number }) {
  return <span className="shrink-0 rounded-full" style={{ width: size, height: size, background: color }} />;
}

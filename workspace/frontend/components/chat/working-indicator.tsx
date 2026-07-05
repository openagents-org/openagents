'use client';

import { cn } from '@/lib/utils';

/**
 * Animated "agent is working" indicator — a thin ticker of hairline bars that
 * rise and fall in a slow, staggered ripple. Pure CSS (see `.working-bar` /
 * `@keyframes working-bar` in globals.css), so it stays crisp at any resolution
 * and uses a neutral `--muted-foreground` gray (adapts light/dark). Replaces
 * the old `/breathing-dots.gif`.
 */
export function WorkingIndicator({ className }: { className?: string }) {
  return (
    <div
      className={cn('flex items-center gap-[2px] h-4 text-muted-foreground', className)}
      role="status"
      aria-label="Agent is working"
    >
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <span
          key={i}
          className="working-bar w-[2px] h-[14px] rounded-[1px] bg-current"
          style={{ animationDelay: `${i * 0.13}s` }}
        />
      ))}
    </div>
  );
}

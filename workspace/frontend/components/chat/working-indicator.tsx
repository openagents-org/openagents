'use client';

import { cn } from '@/lib/utils';

/**
 * Animated "agent is working" indicator — a small equalizer of wave bars.
 * Pure CSS (see `.working-bar` / `@keyframes working-bar` in globals.css), so
 * it stays crisp at any resolution and follows the theme's `--primary` color.
 * Replaces the old `/breathing-dots.gif`.
 */
export function WorkingIndicator({ className }: { className?: string }) {
  return (
    <div
      className={cn('flex items-center gap-[3px] h-4 text-primary', className)}
      role="status"
      aria-label="Agent is working"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="working-bar w-[3px] h-[10px] rounded-full bg-current"
          style={{ animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </div>
  );
}

'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/* ────────────────────────────────────────────────────────────────────────────
 * Viewer chrome
 *
 * The furniture every preview stage puts around its content: the metadata
 * column, and the toolbar strip above the canvas. Shared so an image, a video
 * and a track read as the same viewer with different middles — the rows line
 * up, the headings weigh the same, and "still loading" looks the same in all
 * three.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * What the file is, beside what it shows.
 *
 * Hidden below xl: the detail pane is already sharing the window with two other
 * panes, and a metadata column that squeezes the picture is the wrong trade.
 */
export function InfoPanel({ open = true, children }: { open?: boolean; children: ReactNode }) {
  if (!open) return null;
  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border p-5 xl:flex">
      {children}
    </aside>
  );
}

export function InfoSection({
  title,
  rows,
  children,
}: {
  title: string;
  rows?: [string, ReactNode][];
  children?: ReactNode;
}) {
  return (
    <section className="space-y-3 border-b border-border pb-5 last:border-0 last:pb-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows && (
        <dl className="space-y-2 text-[13px]">
          {rows.map(([term, value]) => (
            <div key={term} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">{term}</dt>
              <dd className="min-w-0 truncate font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </section>
  );
}

/** A value that isn't knowable yet, saying which wait it's in. */
export function PendingValue({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5 font-normal text-muted-foreground">
      <Loader2 className="size-3 shrink-0 animate-spin" />
      {label}
    </span>
  );
}

/**
 * The status strip under a viewer, spanning the pane and its metadata column.
 *
 * Everything here is also somewhere else — the transport knows if it's playing,
 * the side panel knows the format. It earns its line by being the one place all
 * of it is legible at a glance, and by surviving the widths where the metadata
 * column is gone: below xl the footer is the only thing still saying what this
 * file is.
 */
export function ViewerFooter({
  left,
  center,
  right,
}: {
  left: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <footer className="flex h-9 shrink-0 items-center justify-between gap-3 border-t border-border bg-background/50 px-4 text-xs text-muted-foreground backdrop-blur-sm">
      <span className="hidden min-w-0 flex-1 truncate sm:block">{left}</span>
      <span className="min-w-0 flex-1 truncate text-center tabular-nums text-foreground/80">
        {center}
      </span>
      <span className="hidden min-w-0 flex-1 truncate text-right sm:block">{right}</span>
    </footer>
  );
}

/** The strip above a canvas: tools on the left, tools on the right. */
export function ViewerToolbar({
  left,
  right,
  className,
}: {
  left: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-2',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-0.5">{left}</div>
      <div className="flex shrink-0 items-center gap-0.5">{right}</div>
    </div>
  );
}

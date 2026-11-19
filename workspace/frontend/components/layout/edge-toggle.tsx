'use client';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A collapse handle on a pane's trailing edge: two small bars that splay into
 * a chevron on hover (‹ to collapse, › to expand), with a dark label that
 * fades in beside them. A plain button with a pointer cursor, so it does not
 * read as a resize grip.
 */
export function EdgeToggle({
  label,
  expanded,
  onClick,
  className,
  style,
}: {
  label: string;
  expanded: boolean;
  onClick: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      onClick={onClick}
      style={style}
      className={cn(
        'group/rail z-30 flex h-12 w-7 -translate-y-1/2 cursor-pointer items-center pl-2 outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <span className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className={cn(
            'block h-2 w-0.5 origin-bottom rounded-t-full bg-foreground/40 transition-all duration-100 ease-linear group-hover/rail:bg-foreground/60 group-focus-visible/rail:bg-foreground/60',
            expanded ? 'group-hover/rail:rotate-40 group-focus-visible/rail:rotate-40' : 'group-hover/rail:-rotate-40 group-focus-visible/rail:-rotate-40',
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'block h-2 w-0.5 origin-top rounded-b-full bg-foreground/40 transition-all duration-100 ease-linear group-hover/rail:bg-foreground/60 group-focus-visible/rail:bg-foreground/60',
            expanded ? 'group-hover/rail:-rotate-40 group-focus-visible/rail:-rotate-40' : 'group-hover/rail:rotate-40 group-focus-visible/rail:rotate-40',
          )}
        />
      </span>

      <span className="pointer-events-none absolute left-full -ml-2 -translate-x-0.5 rounded-md border border-border bg-foreground px-2 py-0.5 text-xs font-medium whitespace-nowrap text-background opacity-0 shadow-xs shadow-black/5 transition-all duration-200 ease-out group-hover/rail:translate-x-0 group-hover/rail:opacity-100 group-focus-visible/rail:translate-x-0 group-focus-visible/rail:opacity-100">
        {label}
      </span>
    </button>
  );
}

'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * An error message clamped to three lines, with a toggle to read all of it.
 *
 * Provider errors are often one unbroken JSON blob carrying a request id the
 * user needs, so the text wraps anywhere (it must never widen the card) and
 * the toggle — a neutral icon pinned bottom-right — only appears when the
 * clamp actually hides something.
 */
export function ExpandableError({ message, className }: { message: string; className?: string }) {
  const t = useT();
  const ref = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    // The card's width follows the window, and so does where the text wraps.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [message, expanded]);

  const label = expanded ? t('common.showLess') : t('common.showMore');

  return (
    <span className={cn('flex min-w-0 flex-1 flex-col', className)}>
      <span ref={ref} className={cn('wrap-anywhere select-text', !expanded && 'line-clamp-3')}>
        {message}
      </span>
      {(clamped || expanded) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-label={label}
              aria-expanded={expanded}
              className="mt-0.5 flex size-5 items-center justify-center self-end rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

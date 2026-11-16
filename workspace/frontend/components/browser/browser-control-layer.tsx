'use client';

import { useState } from 'react';
import { Bot, Eye, Hand, MousePointer2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Control layer over the live page. Watching = a glass sheet that keeps stray
 * clicks away from the agent's page and offers "Take over". Controlling = no
 * sheet; just a small pill to hand back. The pills sit on a dark scrim of
 * their own because the page beneath can be any colour.
 */
export function BrowserControlLayer({ controlling, busy, agentActive, activityLabel, onToggle }: {
  controlling: boolean;
  busy: boolean;
  agentActive: boolean;
  activityLabel: string | null;
  onToggle: () => void;
}) {
  const t = useT();
  const [nudgeTakeOver, setNudgeTakeOver] = useState(false);
  if (controlling) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center gap-2 px-3">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/60 py-1 pr-1 pl-3 text-xs text-white shadow backdrop-blur">
          <Hand className="size-3.5 text-success" />
          <span className="font-medium">{t('browser.youAreInControl')}</span>
          {agentActive && (
            <span className="hidden items-center gap-1 text-info sm:inline-flex">
              <Bot className="size-3.5" />
              {activityLabel}
            </span>
          )}
          <Button variant="secondary" size="xs" onClick={onToggle} disabled={busy} className="ml-1 rounded-full">
            {t('browser.handBack')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn('absolute inset-0 z-10 flex flex-col justify-end', agentActive ? 'cursor-default' : 'cursor-pointer')}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy) return;
        // A click on the page means "let me use it". Take over when the
        // agent is idle; while it is acting, point at the switch instead.
        if (!agentActive) void onToggle();
        else {
          setNudgeTakeOver(true);
          setTimeout(() => setNudgeTakeOver(false), 1200);
        }
      }}
    >
      <div className="pointer-events-none flex items-end justify-between gap-3 bg-linear-to-t from-black/45 to-transparent px-3 pt-10 pb-3">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white shadow backdrop-blur">
          {agentActive ? (
            <>
              <span className="relative flex size-4 items-center justify-center">
                <MousePointer2 className="size-4 text-info" />
                <span className="absolute inset-0 -m-1 animate-ping rounded-full bg-info/40" />
              </span>
              <span className="truncate font-medium">{activityLabel}</span>
            </>
          ) : (
            <>
              <Eye className="size-3.5 text-white/80" />
              <span className="truncate">{t('browser.watching')}</span>
              <span className="hidden truncate text-white/60 sm:inline">· {t('browser.watchingHint')}</span>
            </>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onToggle}
          disabled={busy}
          className={cn(
            'pointer-events-auto rounded-full shadow transition-transform',
            nudgeTakeOver && 'scale-110 ring-4 ring-info/30',
          )}
        >
          <Hand data-icon="inline-start" />
          {t('browser.takeOver')}
        </Button>
      </div>
    </div>
  );
}

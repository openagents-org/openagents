'use client';

import { useEffect, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { AgentCatalogEntry } from '@/lib/types';
import { agentDisplayName, agentDisplayTagline } from './agent-display-name';
import { MarketLogo } from './agent-setup';
import { MarketStatusBadge, marketStatusMeta, type GalleryStatus } from './agent-setup-status';

/** Rotating featured spotlight above the marketplace grid. */
export function MarketHero({ slides, statusOf, checkingOf, onPick, onPreload }: {
  slides: AgentCatalogEntry[];
  statusOf: (name: string) => GalleryStatus;
  checkingOf: (name: string) => boolean;
  onPick: (name: string) => void;
  onPreload?: (name: string) => void;
}) {
  const t = useT();
  const [i, setI] = useState(0);
  // Held still under the pointer: a slide should not change under someone
  // about to click its button.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (slides.length < 2 || paused) return;
    const timer = setInterval(() => setI((v) => (v + 1) % slides.length), 6000);
    return () => clearInterval(timer);
  }, [slides.length, paused]);
  const a = slides[i % slides.length];
  if (!a) return null;
  const status = statusOf(a.name);
  const current = i % slides.length;

  return (
    <Card onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <CardContent key={a.name} className="flex items-center gap-5 animate-in fade-in duration-300">
        <MarketLogo name={a.name} size={72} className="rounded-xl" />
        <div className="flex-1 min-w-0">
          <Badge variant="secondary"><Sparkles data-icon="inline-start" />{t('connect.marketFeatured')}</Badge>
          <h2 className="mt-1.5 text-lg font-semibold tracking-tight truncate">{agentDisplayName(a)}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground max-w-lg line-clamp-2">{agentDisplayTagline(a)}</p>
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" onClick={() => onPick(a.name)} onPointerEnter={() => onPreload?.(a.name)} onFocus={() => onPreload?.(a.name)}>
              <Plus data-icon="inline-start" />{t('connect.marketAddToDevice')}
            </Button>
            <MarketStatusBadge status={status} checking={checkingOf(a.name)} className="hidden sm:inline-flex" />
          </div>
        </div>
        <dl className="hidden lg:flex flex-col gap-1.5 w-44 shrink-0">
          {[
            [t('connect.marketVendor'), a.vendor || '—'],
            [t('connect.marketRuntime'), t('connect.marketRuntimeValue')],
            [t('connect.marketOnDevice'), marketStatusMeta(t, status).label],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md bg-muted px-3 py-1.5">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="text-xs font-medium truncate">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>

      {/* One button per slide, named for its agent, to jump straight to it. */}
      {slides.length > 1 && (
        <CardContent className="flex gap-1">
          {slides.map((s, idx) => (
            <Button
              key={s.name}
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setI(idx)}
              aria-label={agentDisplayName(s)}
              aria-current={idx === current}
            >
              <span className={cn('size-1.5 rounded-full transition-colors', idx === current ? 'bg-foreground' : 'bg-muted-foreground/30')} />
            </Button>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

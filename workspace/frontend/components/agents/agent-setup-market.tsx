'use client';

import React, { useEffect, useState } from 'react';
import { ArrowRight, ChevronRight, Plus, RefreshCw, Search, Sparkles } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AgentCatalogEntry } from '@/lib/types';
import { CatalogStateNotice, MarketLogo, MarketStatusBadge, marketStatusMeta, type CatalogState, type GalleryStatus } from './agent-setup';

/** Listed first, under "Popular", in this order. */
const MARKET_POPULAR_AGENTS = ['claude', 'openclaw', 'codex', 'cursor', 'opencode', 'hermes', 'pi', 'kimi', 'deepseek'];

// The gallery draws in the app's own tokens — cards on `bg-card`, the
// near-black (near-white in dark) `primary` for the one filled button — so it
// reads as part of the workspace in both themes. It used to carry an indigo
// and violet accent of its own, which no other page uses.

/** Rotating featured spotlight above the marketplace grid. */
function MarketHero({ slides, statusOf, checkingOf, onPick }: {
  slides: AgentCatalogEntry[];
  statusOf: (name: string) => GalleryStatus;
  checkingOf: (name: string) => boolean;
  onPick: (name: string) => void;
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

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div key={a.name} className="flex items-center gap-5 px-5 py-5 sm:px-6 animate-in fade-in duration-300">
        <MarketLogo name={a.name} size={72} className="rounded-xl" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3" /> {t('connect.marketFeatured')}
          </div>
          <h2 className="mt-1 text-lg font-semibold tracking-tight truncate">{a.label}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground max-w-lg line-clamp-2">{a.tagline || a.description}</p>
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" onClick={() => onPick(a.name)}>
              <Plus /> {t('connect.marketAddToDevice')}
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
            <div key={k} className="rounded-md bg-muted/60 px-3 py-1.5">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="text-xs font-medium truncate">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {slides.length > 1 && (
        <div className="flex items-center gap-1.5 px-5 sm:px-6 pb-3.5">
          {slides.map((s, idx) => (
            <button
              key={s.name}
              onClick={() => setI(idx)}
              aria-label={s.label}
              aria-current={idx === i % slides.length}
              className={cn(
                'h-1.5 rounded-full transition-colors',
                idx === i % slides.length ? 'w-6 bg-foreground' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MarketCard({ entry, status, checking, onPick }: {
  entry: AgentCatalogEntry;
  status: GalleryStatus;
  checking: boolean;
  onPick: () => void;
}) {
  const t = useT();
  return (
    <button
      onClick={onPick}
      data-testid={`market-card-${entry.name}`}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:border-foreground/20 hover:bg-accent/40"
    >
      <div className="flex items-center gap-3">
        <MarketLogo name={entry.name} size={32} className="rounded-lg" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold leading-tight truncate">{entry.label}</div>
          <div className="mt-0.5 font-mono text-xs text-muted-foreground truncate">{entry.vendor || entry.tags?.[0] || ''}</div>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2 min-h-8">{entry.description}</p>

      {/* Footer: live device status + an always-visible Add label (the whole
          card is the click target; this span only names what it does). */}
      <div className="mt-auto flex items-center justify-between border-t pt-3">
        <MarketStatusBadge status={status} checking={checking} />
        <span className={buttonVariants({ variant: 'outline', size: 'sm', className: 'pointer-events-none group-hover:bg-background' })}>
          {t('connect.marketAdd')} <ArrowRight />
        </span>
      </div>
    </button>
  );
}

/**
 * The web app's add-agent gallery: the featured spotlight, search and
 * category chips, then the types as cards — popular ones first.
 */
export function MarketGallery({
  catalog, catalogState, visible, featured, readyCount, detecting, detectTimedOut, onReDetect,
  categories, category, onCategory, query, onQuery, statusOf, checkingOf, subtitle, onPick, onBack,
}: {
  catalog: AgentCatalogEntry[];
  catalogState?: CatalogState;
  visible: AgentCatalogEntry[];
  featured: AgentCatalogEntry[];
  readyCount: number;
  detecting: boolean;
  detectTimedOut: boolean;
  onReDetect: () => void;
  categories: { key: string; label: string }[];
  category: string;
  onCategory: (key: string) => void;
  query: string;
  onQuery: (q: string) => void;
  statusOf: (name: string) => GalleryStatus;
  checkingOf: (name: string) => boolean;
  /** Which workspace and device the agent is added to. */
  subtitle: React.ReactNode;
  onPick: (name: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  const q = query.trim();
  const popular = MARKET_POPULAR_AGENTS
    .map((n) => visible.find((e) => e.name === n))
    .filter((e): e is AgentCatalogEntry => !!e);
  const others = visible.filter((e) => !MARKET_POPULAR_AGENTS.includes(e.name));

  const section = (title: string, entries: AgentCatalogEntry[]) => entries.length > 0 && (
    <div className="space-y-2.5">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {entries.map((entry) => (
          <MarketCard key={entry.name} entry={entry} status={statusOf(entry.name)} checking={checkingOf(entry.name)}
            onPick={() => onPick(entry.name)} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Button variant="ghost" mode="icon" size="sm" className="shrink-0" onClick={onBack} title={t('connect.nodeBack')}>
          <ChevronRight className="size-4 rotate-180" />
        </Button>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold tracking-tight">{t('connect.agentAddTitle')}</h3>
          <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {detecting
              ? t('connect.nodeDetectingAgents')
              : detectTimedOut
                ? t('connect.nodeDetectTimedOut')
                : t('connect.marketSummary', { count: catalog.length, ready: readyCount })}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onReDetect} disabled={detecting}>
          <RefreshCw className={cn(detecting && 'animate-spin')} />
          {detecting ? t('connect.nodeDetecting') : t('connect.nodeReDetect')}
        </Button>
      </div>

      <MarketHero slides={featured} statusOf={statusOf} checkingOf={checkingOf} onPick={onPick} />

      {/* Toolbar: search + category chips */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t('connect.marketSearch')}
            aria-label={t('connect.marketSearch')}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {categories.map((c) => (
            <button
              key={c.key}
              onClick={() => onCategory(c.key)}
              aria-pressed={category === c.key}
              className={cn(
                'whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                category === c.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* An empty catalog is a load that has not landed (or failed), never a
          search result — say so instead of "nothing matches". */}
      {catalog.length === 0 && catalogState && catalogState.status !== 'ready' ? (
        <CatalogStateNotice state={catalogState} />
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed py-14 text-center text-sm text-muted-foreground">
          {q ? t('connect.marketNoMatch', { query: q }) : t('connect.marketNoneInCategory')}{' '}
          <button className="font-medium text-foreground underline-offset-4 hover:underline" onClick={() => { onQuery(''); onCategory('all'); }}>
            {t('connect.marketReset')}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {section(t('connect.marketPopular'), popular)}
          {section(t('connect.marketOthers'), others)}
        </div>
      )}
    </div>
  );
}

'use client';

import React from 'react';
import { ArrowRight, ChevronLeft, Search } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { AgentCatalogEntry } from '@/lib/types';
import { CatalogStateNotice, MarketLogo, MarketStatusBadge, type CatalogState, type GalleryStatus } from './agent-setup';

/**
 * The desktop app's agent-type picker: one compact two-column list instead of
 * the gallery and its spotlight. Search, the category filter and each type's
 * status on this device stay; picking a type goes straight to its form.
 */
export function CompactTypePicker({
  catalog,
  catalogState,
  visible,
  readyCount,
  detecting,
  categories,
  category,
  onCategory,
  query,
  onQuery,
  statusOf,
  checkingOf,
  breadcrumbRoot,
  onPick,
  onBack,
}: {
  catalog: AgentCatalogEntry[];
  catalogState?: CatalogState;
  visible: AgentCatalogEntry[];
  readyCount: number;
  detecting: boolean;
  categories: { key: string; label: string }[];
  category: string;
  onCategory: (key: string) => void;
  query: string;
  onQuery: (q: string) => void;
  statusOf: (name: string) => GalleryStatus;
  checkingOf: (name: string) => boolean;
  breadcrumbRoot?: string;
  onPick: (name: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-5 px-9 pt-6 pb-8">
        <nav className="flex items-center gap-3 text-sm">
          <button onClick={onBack} className="inline-flex items-center gap-1 text-primary hover:underline">
            <ChevronLeft className="size-4" />{t('connect.nodeBack')}
          </button>
          {breadcrumbRoot && (
            <>
              <span aria-hidden className="h-4 w-px bg-border" />
              <span className="text-muted-foreground">{breadcrumbRoot}</span>
              <span aria-hidden className="text-muted-foreground">/</span>
              <span>{t('connect.agentAddTitle')}</span>
            </>
          )}
        </nav>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('connect.compactPickTitle')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('connect.compactPickSubtitle')}</p>
          </div>
          <p className="pt-1 text-sm text-muted-foreground">
            {detecting
              ? t('connect.nodeDetectingAgents')
              : t('connect.compactSummary', { count: catalog.length, ready: readyCount })}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={t('connect.marketSearch')}
              aria-label={t('connect.marketSearch')}
              className="h-9 w-full rounded-md border bg-card pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>
          <div role="radiogroup" className="flex shrink-0 overflow-hidden rounded-md border">
            {categories.map((c, i) => (
              <button
                key={c.key}
                role="radio"
                aria-checked={category === c.key}
                onClick={() => onCategory(c.key)}
                className={cn(
                  'h-9 whitespace-nowrap px-4 text-sm transition-colors',
                  i > 0 && 'border-l',
                  category === c.key ? 'bg-primary/10 font-medium text-primary' : 'bg-card hover:bg-muted',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {catalog.length === 0 && catalogState && catalogState.status !== 'ready' ? (
          <CatalogStateNotice state={catalogState} />
        ) : visible.length === 0 ? (
          <div className="rounded-md border border-dashed py-14 text-center text-sm text-muted-foreground">
            {query.trim() ? t('connect.marketNoMatch', { query: query.trim() }) : t('connect.marketNoneInCategory')}{' '}
            <button className="font-medium text-primary" onClick={() => { onQuery(''); onCategory('all'); }}>
              {t('connect.marketReset')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 overflow-hidden rounded-md border bg-card">
            {visible.map((entry, i) => (
              <div
                key={entry.name}
                data-testid={`agent-type-${entry.name}`}
                className={cn(
                  'flex min-w-0 items-center gap-4 border-b px-4 py-3',
                  i % 2 === 1 && 'border-l',
                )}
              >
                <MarketLogo name={entry.name} size={44} className="rounded-md" />
                <div className="w-28 shrink-0 truncate text-sm font-semibold" title={entry.label}>{entry.label}</div>
                <p className="line-clamp-2 min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">{entry.description}</p>
                <MarketStatusBadge className="w-16 shrink-0 text-xs" status={statusOf(entry.name)} checking={checkingOf(entry.name)} />
                <button
                  onClick={() => onPick(entry.name)}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-primary px-3 text-sm text-primary transition-colors hover:bg-primary/10"
                >
                  {t('connect.compactConfigure')}<ArrowRight className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

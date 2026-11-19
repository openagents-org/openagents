'use client';
import { agentDisplayName } from './agent-display-name';

import React from 'react';
import { ArrowRight, ChevronLeft, Search } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { AgentCatalogEntry } from '@/lib/types';
import { MarketLogo, type CatalogState } from './agent-setup';
import { CatalogStateNotice, MarketStatusBadge, type GalleryStatus } from './agent-setup-status';

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
  detectTimedOut = false,
  onReDetect,
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
  /** Detection hit its deadline with nothing reported. */
  detectTimedOut?: boolean;
  onReDetect?: () => void;
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
      <div className="flex flex-col gap-5 px-9 pt-6 pb-8">
        <nav className="flex items-center gap-3 text-sm">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
            <ChevronLeft data-icon="inline-start" />{t('connect.nodeBack')}
          </Button>
          {breadcrumbRoot && (
            <>
              <Separator orientation="vertical" className="data-vertical:h-4" />
              <span className="text-muted-foreground">{breadcrumbRoot}</span>
              <span aria-hidden className="text-muted-foreground">/</span>
              <span>{t('connect.agentAddTitle')}</span>
            </>
          )}
        </nav>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{t('connect.compactPickTitle')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('connect.compactPickSubtitle')}</p>
          </div>
          <p className="pt-1 text-sm text-muted-foreground">
            {detecting
              ? t('connect.nodeDetectingAgents')
              : detectTimedOut
                ? <>
                    {t('connect.nodeDetectTimedOut')}
                    {onReDetect && (
                      <Button variant="link" size="xs" className="ms-2 h-auto px-0" onClick={onReDetect}>
                        {t('connect.nodeReDetect')}
                      </Button>
                    )}
                  </>
                : t('connect.compactSummary', { count: catalog.length, ready: readyCount })}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <InputGroup className="flex-1">
            <InputGroupInput
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={t('connect.marketSearch')}
              aria-label={t('connect.marketSearch')}
            />
            <InputGroupAddon><Search /></InputGroupAddon>
          </InputGroup>
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={0}
            value={category}
            onValueChange={(v) => v && onCategory(v)}
            className="shrink-0"
          >
            {categories.map((c) => (
              <ToggleGroupItem key={c.key} value={c.key} className="px-4">{c.label}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {catalog.length === 0 && catalogState && catalogState.status !== 'ready' ? (
          <CatalogStateNotice state={catalogState} />
        ) : visible.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyDescription>
                {query.trim() ? t('connect.marketNoMatch', { query: query.trim() }) : t('connect.marketNoneInCategory')}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={() => { onQuery(''); onCategory('all'); }}>
                {t('connect.marketReset')}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="grid grid-cols-2 overflow-hidden rounded-lg border bg-card">
            {visible.map((entry, i) => (
              <div
                key={entry.name}
                data-testid={`agent-type-${entry.name}`}
                className={cn(
                  'flex min-w-0 items-center gap-4 border-b px-4 py-3',
                  i % 2 === 1 && 'border-l',
                )}
              >
                <MarketLogo name={entry.name} size={32} className="rounded-lg" />
                <div className="w-28 shrink-0 truncate text-sm font-semibold" title={agentDisplayName(entry)}>{agentDisplayName(entry)}</div>
                <p className="line-clamp-2 min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">{entry.description}</p>
                <MarketStatusBadge className="w-16 shrink-0 text-xs" status={statusOf(entry.name)} checking={checkingOf(entry.name)} />
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => onPick(entry.name)}>
                  {t('connect.compactConfigure')}<ArrowRight data-icon="inline-end" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

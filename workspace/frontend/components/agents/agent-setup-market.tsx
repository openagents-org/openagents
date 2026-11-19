'use client';
import { agentDisplayName, agentDisplayTagline } from './agent-display-name';

import React from 'react';
import { ArrowRight, ChevronLeft, RefreshCw, Search, Sparkles } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { WithTooltip } from '@/components/ui/with-tooltip';
import type { AgentCatalogEntry } from '@/lib/types';
import { MarketLogo, type CatalogState } from './agent-setup';
import { CatalogStateNotice, MarketStatusBadge, type GalleryStatus } from './agent-setup-status';
import { MarketHero } from './agent-setup-market-hero';

/** Display order from the official agent catalog at https://openagents.org/agents. */
const MARKET_AGENT_ORDER = [
  'codex', 'claude', 'opencode', 'hermes', 'cursor', 'deepseek', 'openclaw',
  'gemini', 'codebuddy', 'antigravity', 'pi', 'kimi', 'copilot', 'cline',
  'aider', 'goose', 'amp', 'codearts', 'commandcode', 'openworker',
  'nanoclaw', 'mini-swe-agent',
];
const MARKET_FEATURED_AGENTS = MARKET_AGENT_ORDER.slice(0, 7);

// The gallery draws in the app's own tokens — cards on `bg-card`, the
// near-black (near-white in dark) `primary` for the one filled button — so it
// reads as part of the workspace in both themes.

function MarketCard({ entry, status, checking, featured, onPick, onPreload }: {
  entry: AgentCatalogEntry;
  status: GalleryStatus;
  checking: boolean;
  featured: boolean;
  onPick: () => void;
  onPreload?: () => void;
}) {
  const t = useT();
  // The whole card picks the agent; hover only tints it, so nothing depends
  // on a hover that touch screens never fire.
  return (
    <button
      type="button"
      onClick={onPick}
      onPointerEnter={onPreload}
      onFocus={onPreload}
      data-testid={`market-card-${entry.name}`}
      className="group rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full gap-3 transition-colors group-hover:bg-muted/50">
        <CardHeader className="flex items-center gap-3">
          <MarketLogo name={entry.name} size={32} className="rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <CardTitle className="truncate text-sm">{agentDisplayName(entry)}</CardTitle>
            <CardDescription className="truncate font-mono text-xs">{entry.vendor || entry.tags?.[0] || ''}</CardDescription>
          </div>
          {featured && (
            <Badge variant="secondary" className="self-start"><Sparkles data-icon="inline-start" />{t('connect.marketFeatured')}</Badge>
          )}
        </CardHeader>
        <CardContent>
          <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2 min-h-8">{entry.description}</p>
        </CardContent>
        {/* Live device status, and what picking the card does. */}
        <CardFooter className="mt-auto justify-between">
          <MarketStatusBadge status={status} checking={checking} />
          <span className="inline-flex items-center gap-1 text-xs font-medium">
            {t('connect.marketAdd')}<ArrowRight className="size-3.5" />
          </span>
        </CardFooter>
      </Card>
    </button>
  );
}

/**
 * The web app's add-agent gallery: the featured spotlight, search and
 * category chips, then the types as cards — popular ones first.
 */
export function MarketGallery({
  catalog, catalogState, visible, readyCount, detecting, detectTimedOut, onReDetect,
  categories, category, onCategory, query, onQuery, statusOf, checkingOf, subtitle, onPick, onPreload, onBack,
}: {
  catalog: AgentCatalogEntry[];
  catalogState?: CatalogState;
  visible: AgentCatalogEntry[];
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
  onPreload?: (name: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  const q = query.trim();
  const featured = MARKET_FEATURED_AGENTS
    .map((n) => catalog.find((e) => e.name === n))
    .filter((e): e is AgentCatalogEntry => !!e);
  const popular = MARKET_FEATURED_AGENTS
    .map((n) => visible.find((e) => e.name === n))
    .filter((e): e is AgentCatalogEntry => !!e);
  const rank = (name: string) => {
    const index = MARKET_AGENT_ORDER.indexOf(name);
    return index < 0 ? MARKET_AGENT_ORDER.length : index;
  };
  const others = visible
    .filter((e) => !MARKET_FEATURED_AGENTS.includes(e.name))
    .sort((a, b) => rank(a.name) - rank(b.name));

  const section = (title: string, entries: AgentCatalogEntry[]) => entries.length > 0 && (
    <div className="flex flex-col gap-2.5">
      <h4 className="text-sm font-medium">{title}</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {entries.map((entry) => (
          <MarketCard key={entry.name} entry={entry} status={statusOf(entry.name)} checking={checkingOf(entry.name)}
            featured={MARKET_FEATURED_AGENTS.includes(entry.name)}
            onPick={() => onPick(entry.name)} onPreload={() => onPreload?.(entry.name)} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="p-6 flex flex-col gap-4 max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-start gap-2">
        <WithTooltip label={t('connect.nodeBack')}><Button variant="ghost" size="icon-sm" className="shrink-0" onClick={onBack} aria-label={t('connect.nodeBack')}>
              <ChevronLeft />
            </Button></WithTooltip>
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
          <RefreshCw data-icon="inline-start" className={cn(detecting && 'animate-spin')} />
          {detecting ? t('connect.nodeDetecting') : t('connect.nodeReDetect')}
        </Button>
      </div>

      <MarketHero slides={featured} statusOf={statusOf} checkingOf={checkingOf} onPick={onPick} onPreload={onPreload} />

      {/* Toolbar: search + category chips */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
        <InputGroup className="flex-1">
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t('connect.marketSearch')}
            aria-label={t('connect.marketSearch')}
          />
        </InputGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={category}
          onValueChange={(v) => v && onCategory(v)}
          className="shrink-0 overflow-x-auto"
        >
          {categories.map((c) => (
            <ToggleGroupItem key={c.key} value={c.key} className="px-3 whitespace-nowrap">{c.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* An empty catalog is a load that has not landed (or failed), never a
          search result — say so instead of "nothing matches". */}
      {catalog.length === 0 && catalogState && catalogState.status !== 'ready' ? (
        <CatalogStateNotice state={catalogState} />
      ) : visible.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{q ? t('connect.marketNoMatch', { query: q }) : t('connect.marketNoneInCategory')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={() => { onQuery(''); onCategory('all'); }}>{t('connect.marketReset')}</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col gap-5">
          {section(t('connect.marketPopular'), popular)}
          {section(t('connect.marketOthers'), others)}
        </div>
      )}
    </div>
  );
}

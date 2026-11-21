'use client';

import type { ReactNode, RefObject } from 'react';
import { ChevronDown, Globe, Moon, Plus, PanelsTopLeft, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WithTooltip } from '@/components/ui/with-tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { BrowserTab, BrowserTabLimits } from '@/lib/types';
import { displayUrl, type PermanentEntry, type TabEntry, type buildTabEntries } from './tab-model';

type Entries = ReturnType<typeof buildTabEntries>;

function TabChip({
  tabKey, active, awake, label, sub, icon, onSelect, onClose, closeTitle, busy,
}: {
  tabKey: string; active: boolean; awake: boolean; label: string; sub?: string;
  icon: ReactNode; onSelect: () => void; onClose?: () => void; closeTitle?: string; busy?: boolean;
}) {
  return (
    <WithTooltip label={sub ? `${label} — ${sub}` : label} side="bottom">
      <div
        data-tab-key={tabKey}
        role="tab"
        aria-selected={active}
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
        className={cn(
          'group relative outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset flex h-9 max-w-52 min-w-36 shrink-0 cursor-pointer items-center gap-2 rounded-t-lg border border-b-0 px-2.5 text-xs transition-colors select-none',
          active
            ? 'z-10 border-border bg-background font-medium text-foreground shadow-xs'
            : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
          busy && 'motion-safe:animate-pulse',
        )}
      >
        <span className={cn("shrink-0 text-muted-foreground [&_svg]:size-3.5", !awake && "opacity-60")}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {onClose && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className={cn('size-5 text-muted-foreground/70', active ? 'opacity-100' : 'opacity-60 group-hover:opacity-100')}
            aria-label={closeTitle}
          >
            <X />
          </Button>
        )}
      </div>
    </WithTooltip>
  );
}

/** Every tab, by name, including the ones scrolled out of the strip. */
function AllTabsMenu({ permanent, temporary, limits, onSelect }: Entries & { limits?: BrowserTabLimits | null; onSelect: (entry: TabEntry) => void }) {
  const t = useT();
  const tabCount = permanent.length + temporary.length;
  if (tabCount === 0) return null;
  return (
    <DropdownMenu>
      <WithTooltip label={t('browser.allTabs')}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className="mb-1 ml-1 shrink-0 gap-1.5 text-muted-foreground tabular-nums"
            aria-label={t('browser.allTabsCount', { count: tabCount })}
          >
            <PanelsTopLeft className="size-3.5" />
            {tabCount}
            <ChevronDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
      </WithTooltip>
      <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-y-auto">
        <DropdownMenuLabel className="flex items-center justify-between gap-3">
          {t('browser.allTabsCount', { count: tabCount })}
          {limits && <span className="text-xs font-normal text-muted-foreground">{t('browser.awakeOfMax', { used: limits.concurrent.used, max: limits.concurrent.max })}</span>}
        </DropdownMenuLabel>
        {permanent.length > 0 && <DropdownMenuSeparator />}
        {permanent.length > 0 && (
          <DropdownMenuGroup>
            {permanent.map((entry) => {
              const awake = !!entry.tab && !entry.tab.asleep;
              return (
                <DropdownMenuItem key={entry.key} onSelect={() => onSelect(entry)}>
                  {awake ? <Globe className="text-muted-foreground" /> : <Moon className="text-muted-foreground" />}
                  <span className={cn('min-w-0 flex-1 truncate', !awake && 'italic')}>{entry.context.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{t(awake ? 'browser.live' : 'browser.asleep')}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        )}
        {temporary.length > 0 && <DropdownMenuSeparator />}
        {temporary.length > 0 && (
          <DropdownMenuGroup>
            {temporary.map((entry) => (
              <DropdownMenuItem key={entry.key} onSelect={() => onSelect(entry)}>
                <Globe className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{entry.tab.title || displayUrl(entry.tab.url, 30) || t('browser.untitled')}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{t('browser.kindTemporary')}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Saved (permanent) tabs, then temporary ones, a "+" and the capacity. */
export function BrowserTabStrip({ stripRef, permanent, temporary, tab, selectedTabId, selectedContextId, wakingId, limits, onSelectEntry, onSelectLive, onCloseOrSleep, onForget, onNewTab }: Entries & {
  stripRef: RefObject<HTMLDivElement | null>;
  tab: BrowserTab | undefined;
  selectedTabId: string | null | undefined;
  selectedContextId: string | null;
  wakingId: string | null;
  limits: BrowserTabLimits | null | undefined;
  onSelectEntry: (entry: TabEntry) => void;
  onSelectLive: (tab: BrowserTab) => void;
  onCloseOrSleep: (tab: BrowserTab) => void;
  onForget: (entry: PermanentEntry) => void;
  onNewTab: () => void;
}) {
  const t = useT();
  return (
    <div className="flex h-12 shrink-0 items-end gap-1 border-b border-border bg-muted/40 px-2 pt-2">
      <div ref={stripRef} aria-label={t('browser.allTabs')} role="tablist" className="no-scrollbar flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
        {permanent.map((entry) => {
          const awake = !!entry.tab && !entry.tab.asleep;
          const active = entry.tab ? entry.tab.id === selectedTabId : entry.context.id === selectedContextId && !tab;
          return (
            <TabChip
              key={entry.key}
              tabKey={entry.key}
              active={active}
              awake={awake}
              label={entry.context.name}
              sub={awake ? displayUrl(entry.tab!.url) : t('browser.asleepHint')}
              busy={wakingId === entry.context.id}
              icon={awake ? <Globe /> : <Moon />}
              onSelect={() => onSelectEntry(entry)}
              // An asleep tab has nothing left to close, so its × removes it
              // (after a confirm: its saved sign-in goes with it). Without one
              // there was no way to get rid of a tab from the strip at all.
              onClose={awake ? () => onCloseOrSleep(entry.tab!) : () => onForget(entry)}
              closeTitle={t(awake ? 'browser.closeTab' : 'browser.deleteSavedSession')}
            />
          );
        })}
        {temporary.map((entry) => (
          <TabChip
            key={entry.key}
            tabKey={entry.key}
            active={entry.tab.id === selectedTabId}
            awake
            label={entry.tab.title || displayUrl(entry.tab.url, 30) || t('browser.untitled')}
            sub={displayUrl(entry.tab.url)}
            icon={<Globe />}
            onSelect={() => onSelectLive(entry.tab)}
            onClose={() => onCloseOrSleep(entry.tab)}
            closeTitle={t('browser.closeTab')}
          />
        ))}
      </div>
      <WithTooltip label={t('browser.openNewTab')}>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onNewTab}
          className="mb-1 ml-0.5 text-muted-foreground"
          aria-label={t('browser.openNewTab')}
        >
          <Plus />
        </Button>
      </WithTooltip>
      {limits && (
        <span
          className="mb-2 ml-2 hidden shrink-0 items-center gap-1 text-xs xl:inline-flex text-muted-foreground tabular-nums"
          title={t('browser.sessionCapacityHint')}
        >
          <Globe className="size-3" />
          <span>{t('browser.awakeOfMax', { used: limits.concurrent.used, max: limits.concurrent.max })}</span>
        </span>
      )}
      <AllTabsMenu permanent={permanent} temporary={temporary} limits={limits} onSelect={onSelectEntry} />
    </div>
  );
}

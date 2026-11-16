'use client';

import type { ReactNode, RefObject } from 'react';
import { ChevronDown, Globe, Moon, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    <div
      data-tab-key={tabKey}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      title={sub ? `${label} — ${sub}` : label}
      className={cn(
        'group relative flex h-8 max-w-52 min-w-30 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 text-xs transition-colors select-none',
        active
          ? 'z-10 border-border bg-background text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
        !awake && 'italic',
        busy && 'animate-pulse',
      )}
    >
      <span className="shrink-0 text-muted-foreground [&_svg]:size-3.5">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {onClose && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className={cn('size-5 text-muted-foreground/70', active ? 'opacity-100' : 'opacity-60 group-hover:opacity-100')}
          title={closeTitle}
          aria-label={closeTitle}
        >
          <X />
        </Button>
      )}
    </div>
  );
}

/** Every tab, by name, including the ones scrolled out of the strip. */
function AllTabsMenu({ permanent, temporary, onSelect }: Entries & { onSelect: (entry: TabEntry) => void }) {
  const t = useT();
  const tabCount = permanent.length + temporary.length;
  if (tabCount === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="mb-1 shrink-0 text-muted-foreground tabular-nums"
          title={t('browser.allTabs')}
          aria-label={t('browser.allTabsCount', { count: tabCount })}
        >
          {tabCount}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-y-auto">
        <DropdownMenuLabel>{t('browser.allTabsCount', { count: tabCount })}</DropdownMenuLabel>
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
    <div className="flex h-10 shrink-0 items-end border-b border-border bg-muted px-2 pt-1.5">
      <div ref={stripRef} className="no-scrollbar flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
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
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onNewTab}
          className="mb-1 ml-0.5 text-muted-foreground"
          title={t('browser.openNewTab')}
          aria-label={t('browser.openNewTab')}
        >
          <Plus />
        </Button>
      </div>
      {limits && (
        <span
          className="mb-1.5 ml-2 inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums"
          title={t('browser.sessionCapacityHint')}
        >
          <Globe className="size-3" />
          <span>{t('browser.awakeOfMax', { used: limits.concurrent.used, max: limits.concurrent.max })}</span>
        </span>
      )}
      <AllTabsMenu permanent={permanent} temporary={temporary} onSelect={onSelectEntry} />
    </div>
  );
}

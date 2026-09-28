'use client';

import { useState } from 'react';
import { Bot, Globe, Hourglass, Moon, Pin, Play, Plus, Trash2, X } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useFormatters, useT } from '@/lib/i18n';
import { useLayout } from '@/components/layout/layout-context';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { BrowserTab } from '@/lib/types';
import { NewBrowserTabDialog } from './new-browser-tab-dialog';
import { actorName, tabHasFreshAgentActivity } from './agent-activity';
import { buildTabEntries, displayUrl, idleMinutesLeft, whoLabel, type PermanentEntry, type TemporaryEntry } from './tab-model';

/**
 * Sidebar list for the cloud browser. Two sections, never mixed: permanent
 * tabs (awake or asleep) on top, temporary tabs below, each with its quota.
 */
export function BrowserTabList() {
  const t = useT();
  const { timeAgoShort: timeAgo } = useFormatters();
  const {
    browserTabs, browserContexts, browserTabLimits, agents,
    selectedBrowserTabId, setSelectedBrowserTabId,
    selectedBrowserContextId, setSelectedBrowserContextId,
    closeBrowserTab, openBrowserTabWithContext, deleteBrowserContext,
  } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();
  const confirm = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [wakingId, setWakingId] = useState<string | null>(null);

  const { permanent, temporary } = buildTabEntries(browserTabs, browserContexts);
  const idleMinutes = browserTabLimits?.temporaryIdleMinutes ?? 30;
  const hasContent = permanent.length > 0 || temporary.length > 0;

  const selectTab = (tab: BrowserTab) => {
    setSelectedBrowserTabId(tab.id);
    setSelectedBrowserContextId(null);
    if (isMobile) openMobileDetail();
  };

  const focusAsleep = (contextId: string) => {
    setSelectedBrowserTabId(null);
    setSelectedBrowserContextId(contextId);
    if (isMobile) openMobileDetail();
  };

  const wake = async (contextId: string) => {
    if (wakingId) return;
    setWakingId(contextId);
    try {
      const tab = await openBrowserTabWithContext(contextId);
      setSelectedBrowserTabId(tab.id);
      setSelectedBrowserContextId(null);
      if (isMobile) openMobileDetail();
      toast.success(t('browser.openedWithSession'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.tabOpenFailed'));
    } finally {
      setWakingId(null);
    }
  };

  const sleep = async (entry: PermanentEntry) => {
    if (!entry.tab) return;
    try {
      await closeBrowserTab(entry.tab.id);
      if (selectedBrowserTabId === entry.tab.id) setSelectedBrowserContextId(entry.context.id);
      toast.success(t('browser.sleptToast'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.tabCloseFailed'));
    }
  };

  const forget = async (entry: PermanentEntry) => {
    const ok = await confirm({
      title: t('browser.deleteSavedSessionTitle'),
      description: t('browser.deleteSavedSessionDescription', { name: entry.context.name }),
      confirmText: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      if (entry.tab) await closeBrowserTab(entry.tab.id);
      await deleteBrowserContext(entry.context.id);
      if (selectedBrowserContextId === entry.context.id) setSelectedBrowserContextId(null);
      toast.success(t('browser.savedSessionDeleted'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.savedSessionDeleteFailed'));
    }
  };

  const close = async (tab: BrowserTab) => {
    try {
      await closeBrowserTab(tab.id);
      toast.success(t('browser.tabClosed'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.tabCloseFailed'));
    }
  };

  const agentChip = (tab: BrowserTab | null) => {
    if (!tab || !tabHasFreshAgentActivity(tab)) return null;
    const who = actorName(tab.activity?.actor, agents) || t('browser.agentGeneric');
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-1.5 py-px text-[10px] font-medium text-sky-600 dark:text-sky-400">
        <Bot className="size-3" />
        <span className="truncate max-w-[9rem]">{t('browser.agentBrowsing', { agent: who })}</span>
      </span>
    );
  };

  const quota = (used: number, max: number, tone: 'emerald' | 'amber') => (
    <span
      className={cn(
        'ml-auto shrink-0 tabular-nums text-[10px] font-medium',
        used >= max ? 'text-red-500' : tone === 'emerald' ? 'text-emerald-600/80 dark:text-emerald-400/80' : 'text-amber-600/80 dark:text-amber-400/80',
      )}
      title={t('browser.slotsUsed', { used, max })}
    >
      {used}/{max}
    </span>
  );

  const PermanentRow = ({ entry }: { entry: PermanentEntry }) => {
    const awake = !!entry.tab;
    const selected = awake ? selectedBrowserTabId === entry.tab!.id : selectedBrowserContextId === entry.context.id;
    const waking = wakingId === entry.context.id;
    return (
      <div
        onClick={() => (awake ? selectTab(entry.tab!) : focusAsleep(entry.context.id))}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
          selected ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
          !awake && 'opacity-80',
        )}
      >
        <span className="relative shrink-0">
          <Pin className={cn('size-4', awake ? 'text-emerald-500' : 'text-zinc-400 dark:text-zinc-500')} />
          {awake && (
            <span className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-emerald-500 ring-2 ring-background" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-[13px] font-medium', !awake && 'text-muted-foreground')}>
            {entry.context.name}
          </p>
          <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            {awake ? (
              agentChip(entry.tab) ?? (
                <>
                  <span className="truncate">{displayUrl(entry.tab!.url, 36)}</span>
                  {entry.tab!.lastActiveAt && <span>· {timeAgo(entry.tab!.lastActiveAt)}</span>}
                </>
              )
            ) : (
              <>
                <Moon className="size-3 shrink-0" />
                <span>{t('browser.asleep')}</span>
                {entry.context.domain && <span className="truncate">· {entry.context.domain}</span>}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {awake ? (
            <button
              onClick={(e) => { e.stopPropagation(); sleep(entry); }}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-zinc-200 hover:text-foreground dark:hover:bg-zinc-700"
              title={t('browser.sleepHint')}
              aria-label={t('browser.sleep')}
            >
              <Moon className="size-3.5" />
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); wake(entry.context.id); }}
              disabled={!!wakingId}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-zinc-200 hover:text-emerald-600 disabled:opacity-50 dark:hover:bg-zinc-700"
              title={t('browser.openWithSession')}
              aria-label={t('browser.wake')}
            >
              <Play className={cn('size-3.5', waking && 'animate-pulse')} />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); forget(entry); }}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-zinc-200 hover:text-red-500 dark:hover:bg-zinc-700"
            title={t('browser.deleteSavedSession')}
            aria-label={t('browser.deleteSavedSession')}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    );
  };

  const TemporaryRow = ({ entry }: { entry: TemporaryEntry }) => {
    const { tab } = entry;
    const selected = selectedBrowserTabId === tab.id;
    const left = idleMinutesLeft(tab, idleMinutes);
    return (
      <div
        onClick={() => selectTab(tab)}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
          selected ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
        )}
      >
        <Hourglass className="size-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{tab.title || displayUrl(tab.url, 36) || t('browser.untitled')}</p>
          <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            {agentChip(tab) ?? (
              <>
                <span className="truncate">{displayUrl(tab.url, 28)}</span>
                <span>· {whoLabel(tab.createdBy)}</span>
                <span className="text-amber-600/80 dark:text-amber-400/80">· {t('browser.idleClosesIn', { minutes: left })}</span>
              </>
            )}
          </p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); close(tab); }}
          className="rounded p-1 text-muted-foreground opacity-0 transition-all hover:bg-zinc-200 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-zinc-700"
          title={t('browser.closeTab')}
          aria-label={t('browser.closeTab')}
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold leading-relaxed">{t('browser.title')}</span>
          <span className="hidden items-center gap-1 rounded-full bg-foreground/5 px-1.5 py-px text-[10px] text-muted-foreground sm:inline-flex">
            <Globe className="size-3" />
            {t('browser.cloudBrowser')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                mode="icon"
                size="sm"
                aria-label={t('browser.openNewTab')}
                onClick={() => setDialogOpen(true)}
                className="text-muted-foreground"
              >
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('browser.openNewTab')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {!hasContent ? (
        <div className="flex flex-1 items-center justify-center px-6 text-muted-foreground">
          <div className="space-y-3 text-center">
            <Globe className="mx-auto size-10 opacity-30" />
            <p className="text-sm font-medium">{t('browser.emptyTitle')}</p>
            <p className="text-xs leading-relaxed">{t('browser.emptyBody')}</p>
            <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
              <Plus className="size-3.5" />
              {t('browser.newTab')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-1 pb-2">
          {/* Permanent */}
          <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Pin className="size-3 text-emerald-500" />
            {t('browser.persistent')}
            <span className="hidden font-normal normal-case tracking-normal text-muted-foreground/70 xl:inline">
              · {t('browser.permanentSectionHint')}
            </span>
            {browserTabLimits && quota(browserTabLimits.permanent.used, browserTabLimits.permanent.max, 'emerald')}
          </div>
          {permanent.length === 0 ? (
            <p className="px-2.5 pb-2 text-[11px] text-muted-foreground/70">{t('browser.permanentHint')}</p>
          ) : (
            permanent.map((entry) => <PermanentRow key={entry.key} entry={entry} />)
          )}

          {/* Temporary */}
          <div className="mt-2 flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Hourglass className="size-3 text-amber-500" />
            {t('browser.activeTabs')}
            <span className="hidden font-normal normal-case tracking-normal text-muted-foreground/70 xl:inline">
              · {t('browser.temporarySectionHint', { minutes: idleMinutes })}
            </span>
            {browserTabLimits && quota(browserTabLimits.temporary.used, browserTabLimits.temporary.max, 'amber')}
          </div>
          {temporary.length === 0 ? (
            <p className="px-2.5 pb-2 text-[11px] text-muted-foreground/70">{t('browser.temporaryHint', { minutes: idleMinutes })}</p>
          ) : (
            temporary.map((entry) => <TemporaryRow key={entry.key} entry={entry} />)
          )}
        </div>
      )}

      <NewBrowserTabDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Globe, Plus, X, Lock, Play, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useFormatters, useT } from '@/lib/i18n';
import { useLayout } from '@/components/layout/layout-context';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useConfirm, usePrompt } from '@/components/ui/dialogs-provider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function truncateUrl(url: string, max = 40): string {
  try {
    const u = new URL(url);
    const display = u.hostname + (u.pathname !== '/' ? u.pathname : '');
    return display.length > max ? display.slice(0, max) + '...' : display;
  } catch {
    return url.length > max ? url.slice(0, max) + '...' : url;
  }
}

export function BrowserTabList() {
  const t = useT();
  const { timeAgoShort: timeAgo } = useFormatters();
  const {
    browserTabs, selectedBrowserTabId, setSelectedBrowserTabId,
    openBrowserTab, closeBrowserTab,
    browserContexts, openBrowserTabWithContext, deleteBrowserContext,
  } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [opening, setOpening] = useState(false);

  // Split tabs into persistent (on top) and regular
  const persistentTabs = browserTabs.filter((t) => t.contextId);
  const regularTabs = browserTabs.filter((t) => !t.contextId);

  // Idle contexts — persistent contexts with no active tab
  const activeContextIds = new Set(persistentTabs.map((t) => t.contextId));
  const idleContexts = browserContexts.filter((c) => !activeContextIds.has(c.id));

  const handleOpen = async () => {
    const url = await prompt({
      title: t('browser.openTabTitle'),
      description: t('browser.openTabDescription'),
      placeholder: 'https://',
      defaultValue: 'https://',
      confirmText: 'Open',
    });
    if (url === null) return;
    setOpening(true);
    try {
      const tab = await openBrowserTab(url || 'about:blank');
      setSelectedBrowserTabId(tab.id);
      toast.success(t('browser.tabOpened'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open tab');
    } finally {
      setOpening(false);
    }
  };

  const handleClose = async (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    try {
      await closeBrowserTab(tabId);
      toast.success(t('browser.tabClosed'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.tabCloseFailed'));
    }
  };

  const handleOpenWithContext = async (e: React.MouseEvent, contextId: string) => {
    e.stopPropagation();
    setOpening(true);
    try {
      const tab = await openBrowserTabWithContext(contextId);
      setSelectedBrowserTabId(tab.id);
      if (isMobile) openMobileDetail();
      toast.success(t('browser.openedWithSession'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open tab');
    } finally {
      setOpening(false);
    }
  };

  const handleDeleteContext = async (e: React.MouseEvent, contextId: string, name: string) => {
    e.stopPropagation();
    const ok = await confirm({
      title: t('browser.deleteSavedSessionTitle'),
      description: `"${name}" will be permanently removed, including its stored cookies and login state.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteBrowserContext(contextId);
      toast.success(t('browser.savedSessionDeleted'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.savedSessionDeleteFailed'));
    }
  };

  const hasContent = browserTabs.length > 0 || browserContexts.length > 0;

  const selectTab = (tabId: string) => {
    setSelectedBrowserTabId(tabId);
    if (isMobile) openMobileDetail();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm leading-relaxed font-semibold">{t('browser.title')}</span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                mode="icon"
                size="sm"
                aria-label={t('browser.openNewTab')}
                onClick={handleOpen}
                disabled={opening}
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
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <Globe className="size-10 mx-auto opacity-30" />
            <p className="text-sm font-medium">{t('browser.emptyTitle')}</p>
            <p className="text-xs">{t('browser.emptyBody')}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-1">
          {/* Persistent tabs — always on top */}
          {(persistentTabs.length > 0 || idleContexts.length > 0) && (
            <>
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('browser.persistent')}
              </div>
              {/* Active persistent tabs */}
              {persistentTabs.map((tab) => {
                const ctx = browserContexts.find((c) => c.id === tab.contextId);
                return (
                  <div
                    key={tab.id}
                    onClick={() => selectTab(tab.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors group cursor-pointer',
                      selectedBrowserTabId === tab.id
                        ? 'bg-zinc-100 dark:bg-zinc-800'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    )}
                  >
                    <Lock className="size-4 text-green-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate">
                        {ctx?.name || tab.title || truncateUrl(tab.url)}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {truncateUrl(tab.url)}
                        {tab.lastActiveAt && ` · ${timeAgo(tab.lastActiveAt)}`}
                      </p>
                    </div>
                    <button
                      onClick={(e) => handleClose(e, tab.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-muted-foreground hover:text-red-500 transition-all"
                      title={t('browser.closeTab')}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                );
              })}
              {/* Idle persistent contexts (no active tab) */}
              {idleContexts.map((ctx) => (
                <div
                  key={ctx.id}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors group"
                >
                  <Lock className="size-4 text-zinc-400 dark:text-zinc-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate text-muted-foreground">{ctx.name}</p>
                    <p className="text-[11px] text-muted-foreground/60 truncate">
                      {ctx.domain || 'no domain'}
                      {ctx.lastUsedAt && ` · ${timeAgo(ctx.lastUsedAt)}`}
                      {' · idle'}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={(e) => handleOpenWithContext(e, ctx.id)}
                      disabled={opening}
                      className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-muted-foreground hover:text-green-500 transition-colors disabled:opacity-50"
                      title={t('browser.openWithSession')}
                    >
                      <Play className="size-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleDeleteContext(e, ctx.id, ctx.name)}
                      className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-muted-foreground hover:text-red-500 transition-colors"
                      title={t('browser.deleteSavedSession')}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Regular (temporal) active tabs */}
          {regularTabs.length > 0 && (
            <>
              <div className={cn(
                "px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
                (persistentTabs.length > 0 || idleContexts.length > 0) && "mt-2"
              )}>
                {t('browser.activeTabs')}
              </div>
              {regularTabs.map((tab) => (
                <div
                  key={tab.id}
                  onClick={() => selectTab(tab.id)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors group cursor-pointer',
                    selectedBrowserTabId === tab.id
                      ? 'bg-zinc-100 dark:bg-zinc-800'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  )}
                >
                  <Globe className="size-4 text-foreground/70 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate">
                      {tab.title || truncateUrl(tab.url)}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {truncateUrl(tab.url)}
                      {' · '}
                      {(tab.createdBy || 'unknown').replace(/^(openagents:|human:)/, '')}
                      {tab.lastActiveAt && ` · ${timeAgo(tab.lastActiveAt)}`}
                    </p>
                  </div>
                  <button
                    onClick={(e) => handleClose(e, tab.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-muted-foreground hover:text-red-500 transition-all"
                    title={t('browser.closeTab')}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

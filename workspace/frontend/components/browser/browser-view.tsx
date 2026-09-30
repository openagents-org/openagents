'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bot, Eye, Globe, Hand, Hourglass, Maximize2, Minimize2, Moon, MousePointer2,
  Pin, PinOff, Play, Plus, RefreshCw, Users, X,
} from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { FeatureTourBanner } from '@/components/tours/feature-tours';
import { workspaceApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useConfirm, usePrompt } from '@/components/ui/dialogs-provider';
import { useFormatters, useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n';
import type { BrowserTab } from '@/lib/types';
import { NewBrowserTabDialog } from './new-browser-tab-dialog';
import { actorName, useAgentActivity } from './agent-activity';
import { buildTabEntries, displayUrl, idleMinutesLeft, normalizeUrl, whoLabel, type PermanentEntry } from './tab-model';

type ControlMode = 'watching' | 'controlling';

/** The live view is embedded chrome-less; the workspace draws the browser around it. */
function embedUrl(liveUrl: string): string {
  return liveUrl + (liveUrl.includes('?') ? '&' : '?') + 'embed=1';
}

/**
 * The cloud browser. Reads like a remote Chrome window: a tab strip (permanent
 * tabs pinned first, temporary tabs after), an address bar, the live page, and
 * a status bar that says who is driving — with a take-over / hand-back switch.
 */
export function BrowserView() {
  const t = useT();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { timeAgoShort: timeAgo } = useFormatters();
  const {
    browserTabs, browserContexts, browserTabLimits, agents,
    selectedBrowserTabId, setSelectedBrowserTabId,
    selectedBrowserContextId, setSelectedBrowserContextId,
    closeBrowserTab, navigateBrowserTab, reconnectBrowserTab, persistBrowserTab, unpersistBrowserTab,
    openBrowserTabWithContext, deleteBrowserContext, refreshBrowserTabs,
  } = useWorkspace();
  const { isMobile, isDetailExpanded, toggleDetailExpanded } = useLayout();

  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [sessionDead, setSessionDead] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [editingUrl, setEditingUrl] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [wakingId, setWakingId] = useState<string | null>(null);
  const [control, setControl] = useState<ControlMode>('watching');
  const urlInputRef = useRef<HTMLInputElement>(null);
  const prevBlobRef = useRef<string | null>(null);
  const failCountRef = useRef(0);

  const tab = browserTabs.find((x) => x.id === selectedBrowserTabId);
  const { permanent, temporary } = buildTabEntries(browserTabs, browserContexts);
  const asleepEntry = !tab && selectedBrowserContextId
    ? permanent.find((e) => e.context.id === selectedBrowserContextId && !e.tab) ?? null
    : null;
  const idleMinutes = browserTabLimits?.idleMinutes ?? 15;
  const activity = useAgentActivity(tab);

  // Who starts in control: a tab a human opened is theirs; an agent's tab is
  // watched until the human explicitly takes over. Re-decided per tab only.
  useEffect(() => {
    if (!tab) return;
    setControl(tab.createdBy?.startsWith('human:') && !activity.active ? 'controlling' : 'watching');
  }, [tab?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Validate the live session on mount / tab switch, then keep checking. The
  // backend probes the BF session and auto-reconnects if it can, returning
  // fresh tab data (including a new live_url). See git history for why this
  // repeats: a dead share link silently swaps in BF's own error page.
  const hasLiveUrl = !!tab?.liveUrl;
  useEffect(() => {
    if (!selectedBrowserTabId || !hasLiveUrl) return;
    let cancelled = false;
    const validate = async (initial: boolean) => {
      if (initial) setReconnecting(true);
      try {
        await workspaceApi.validateBrowserTab(selectedBrowserTabId);
        if (cancelled) return;
        setSessionDead(false);
        await refreshBrowserTabs();
      } catch {
        if (!cancelled) setSessionDead(true);
      } finally {
        if (!cancelled && initial) setReconnecting(false);
      }
    };
    validate(true);
    const interval = setInterval(() => validate(false), 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedBrowserTabId, hasLiveUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Screenshot polling — only for local (non-cloud) tabs without a live view.
  useEffect(() => {
    if (!selectedBrowserTabId || !tab || tab.liveUrl) {
      setScreenshotUrl(null);
      return;
    }
    let cancelled = false;
    failCountRef.current = 0;
    setSessionDead(false);
    const fetchScreenshot = async () => {
      try {
        const url = workspaceApi.getBrowserScreenshotUrl(selectedBrowserTabId);
        const headers: Record<string, string> = {};
        const token = (workspaceApi as unknown as { token: string }).token;
        if (token) headers['X-Workspace-Token'] = token;
        const bearerToken = (workspaceApi as unknown as { bearerToken: string }).bearerToken;
        if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;
        const res = await fetch(url, { headers });
        if (cancelled) return;
        if (!res.ok) {
          failCountRef.current++;
          if (failCountRef.current >= 3) { setSessionDead(true); setLoading(false); }
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        failCountRef.current = 0;
        setSessionDead(false);
        if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);
        const blobUrl = URL.createObjectURL(blob);
        prevBlobRef.current = blobUrl;
        setScreenshotUrl(blobUrl);
        setLoading(false);
      } catch {
        failCountRef.current++;
        if (failCountRef.current >= 3) { setSessionDead(true); setLoading(false); }
      }
    };
    setLoading(true);
    fetchScreenshot();
    const interval = setInterval(fetchScreenshot, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (prevBlobRef.current) { URL.revokeObjectURL(prevBlobRef.current); prevBlobRef.current = null; }
    };
  }, [selectedBrowserTabId, tab]);

  // ── actions ──────────────────────────────────────────────────────────────

  const selectLive = (x: BrowserTab) => {
    setSelectedBrowserTabId(x.id);
    setSelectedBrowserContextId(null);
  };

  const wake = async (contextId: string) => {
    if (wakingId) return;
    setWakingId(contextId);
    try {
      const opened = await openBrowserTabWithContext(contextId);
      selectLive(opened);
      toast.success(t('browser.openedWithSession'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.tabOpenFailed'));
    } finally {
      setWakingId(null);
    }
  };

  const handleReconnect = async () => {
    if (!tab || reconnecting) return;
    setReconnecting(true);
    try {
      await reconnectBrowserTab(tab.id);
      setSessionDead(false);
      failCountRef.current = 0;
      setLoading(true);
      toast.success(t('browser.reconnected'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.reconnectFailed'));
    } finally {
      setReconnecting(false);
    }
  };

  const startEditingUrl = () => {
    if (!tab) return;
    setUrlDraft(tab.url);
    setEditingUrl(true);
    setTimeout(() => urlInputRef.current?.select(), 0);
  };

  const handleNavigate = async () => {
    setEditingUrl(false);
    const trimmed = urlDraft.trim();
    if (!trimmed || !tab || trimmed === tab.url) return;
    setNavigating(true);
    try {
      await navigateBrowserTab(tab.id, normalizeUrl(trimmed));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.navigateFailed'));
    } finally {
      setNavigating(false);
    }
  };

  /** Temporary tab → gone. Permanent tab → asleep (session freed, state kept). */
  const handleCloseOrSleep = async (x: BrowserTab) => {
    try {
      await closeBrowserTab(x.id);
      if (x.contextId) {
        if (selectedBrowserTabId === x.id) setSelectedBrowserContextId(x.contextId);
        toast.success(t('browser.sleptToast'));
      } else {
        toast.success(t('browser.tabClosed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.tabCloseFailed'));
    }
  };

  const handleForget = async (entry: PermanentEntry) => {
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

  const handlePersist = async () => {
    if (!tab || tab.contextId) return;
    const name = await prompt({
      title: t('browser.savePersistentTitle'),
      description: t('browser.savePersistentDescription'),
      placeholder: t('browser.savePersistentPlaceholder'),
      defaultValue: displayUrl(tab.url, 40).split('/')[0],
      confirmText: t('common.save'),
    });
    if (!name?.trim()) return;
    try {
      await persistBrowserTab(tab.id, name.trim());
      toast.success(t('browser.nowPersistent', { name: name.trim() }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.makePersistentFailed'));
    }
  };

  const handleUnpersist = async () => {
    if (!tab || !tab.contextId) return;
    const ctx = browserContexts.find((c) => c.id === tab.contextId);
    const label = ctx?.name || tab.contextName || t('browser.thisTab');
    const ok = await confirm({
      title: t('browser.removePersistentTitle'),
      description: t('browser.removePersistentDescription', { label }),
      confirmText: t('common.remove'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await unpersistBrowserTab(tab.id);
      toast.success(t('browser.nowTemporal'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.removePersistentFailed'));
    }
  };

  // ── derived labels ────────────────────────────────────────────────────────

  const agentWho = actorName(activity.actor, agents) || t('browser.agentGeneric');
  const activityLabel = activity.active
    ? t(`browser.agentAction.${activity.action ?? 'other'}` as MessageKey, { agent: agentWho })
    : null;
  const currentContextName = tab?.contextId
    ? browserContexts.find((c) => c.id === tab.contextId)?.name || tab.contextName || t('browser.kindPermanent')
    : null;
  const liveState: 'live' | 'connecting' | 'expired' | 'none' = !tab
    ? 'none'
    : sessionDead
      ? 'expired'
      : reconnecting || (!tab.liveUrl && loading && !screenshotUrl)
        ? 'connecting'
        : 'live';

  // ── tab strip ─────────────────────────────────────────────────────────────

  const TabChip = ({
    active, awake, kind, label, sub, icon, onSelect, onClose, closeTitle, busy,
  }: {
    active: boolean; awake: boolean; kind: 'permanent' | 'temporary'; label: string; sub?: string;
    icon: React.ReactNode; onSelect: () => void; onClose?: () => void; closeTitle?: string; busy?: boolean;
  }) => (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      title={sub ? `${label} — ${sub}` : label}
      className={cn(
        'group relative flex h-8 min-w-[7.5rem] max-w-[13rem] shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 text-[12px] transition-colors',
        active
          ? 'z-10 border-border bg-background text-foreground shadow-[0_1px_0_0_var(--background)]'
          : 'border-transparent text-muted-foreground hover:bg-zinc-200/60 hover:text-foreground dark:hover:bg-zinc-800/60',
        kind === 'temporary' && !active && 'border-dashed border-border/50',
        !awake && 'italic',
        busy && 'animate-pulse',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {onClose && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className={cn(
            'shrink-0 rounded p-0.5 text-muted-foreground/70 transition-all hover:bg-zinc-300/70 hover:text-foreground dark:hover:bg-zinc-700',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          title={closeTitle}
          aria-label={closeTitle}
        >
          {kind === 'permanent' ? <Moon className="size-3" /> : <X className="size-3" />}
        </button>
      )}
    </div>
  );

  const tabStrip = (
    <div className="flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-border bg-zinc-100/80 px-2 pt-1.5 dark:bg-zinc-900/80 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {permanent.map((entry) => {
        const awake = !!entry.tab;
        const active = awake ? entry.tab!.id === selectedBrowserTabId : entry.context.id === selectedBrowserContextId && !tab;
        return (
          <TabChip
            key={entry.key}
            active={active}
            awake={awake}
            kind="permanent"
            label={entry.context.name}
            sub={awake ? displayUrl(entry.tab!.url) : t('browser.asleepHint')}
            busy={wakingId === entry.context.id}
            icon={awake
              ? <Pin className="size-3.5 text-emerald-500" />
              : <Moon className="size-3.5 text-zinc-400" />}
            onSelect={() => {
              if (awake) selectLive(entry.tab!);
              else { setSelectedBrowserTabId(null); setSelectedBrowserContextId(entry.context.id); }
            }}
            onClose={awake ? () => handleCloseOrSleep(entry.tab!) : undefined}
            closeTitle={t('browser.sleepHint')}
          />
        );
      })}
      {permanent.length > 0 && temporary.length > 0 && (
        <span className="mx-1 mb-1.5 h-5 w-px shrink-0 bg-border" aria-hidden />
      )}
      {temporary.map((entry) => (
        <TabChip
          key={entry.key}
          active={entry.tab.id === selectedBrowserTabId}
          awake
          kind="temporary"
          label={entry.tab.title || displayUrl(entry.tab.url, 30) || t('browser.untitled')}
          sub={t('browser.idleClosesIn', { minutes: idleMinutesLeft(entry.tab, idleMinutes) })}
          icon={<Hourglass className="size-3.5 text-amber-500" />}
          onSelect={() => selectLive(entry.tab)}
          onClose={() => handleCloseOrSleep(entry.tab)}
          closeTitle={t('browser.closeTab')}
        />
      ))}
      <button
        onClick={() => setDialogOpen(true)}
        className="mb-1 ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-zinc-200/70 hover:text-foreground dark:hover:bg-zinc-800"
        title={t('browser.openNewTab')}
        aria-label={t('browser.openNewTab')}
      >
        <Plus className="size-4" />
      </button>
      {browserTabLimits && (
        <div className="mb-1.5 ml-auto hidden shrink-0 items-center gap-2 pl-3 text-[10px] tabular-nums text-muted-foreground md:flex">
          <span
            className="inline-flex items-center gap-1"
            title={t('browser.awakeSlots', { max: browserTabLimits.concurrent.max, minutes: idleMinutes })}
          >
            <Hourglass className="size-3 text-amber-500" />
            <span className={cn(browserTabLimits.concurrent.used >= browserTabLimits.concurrent.max && 'text-red-500')}>
              {browserTabLimits.concurrent.used}/{browserTabLimits.concurrent.max}
            </span>
          </span>
        </div>
      )}
    </div>
  );

  // ── address bar ───────────────────────────────────────────────────────────

  const toolbar = tab && (
    <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2">
      <button
        onClick={handleReconnect}
        disabled={reconnecting}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        title={t('browser.reconnectHint')}
        aria-label={t('browser.reconnect')}
      >
        <RefreshCw className={cn('size-3.5', (reconnecting || navigating) && 'animate-spin')} />
      </button>

      <div
        className={cn(
          'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-zinc-50 px-3 dark:bg-zinc-900',
          editingUrl && 'border-foreground/40 bg-background',
        )}
      >
        {tab.contextId
          ? <Pin className="size-3 shrink-0 text-emerald-500" />
          : <Globe className="size-3 shrink-0 text-muted-foreground/60" />}
        {editingUrl ? (
          <input
            ref={urlInputRef}
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={() => setEditingUrl(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNavigate();
              if (e.key === 'Escape') setEditingUrl(false);
            }}
            className="w-full bg-transparent font-mono text-xs outline-none"
            autoFocus
            spellCheck={false}
          />
        ) : (
          <p
            className="min-w-0 flex-1 cursor-text truncate font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={startEditingUrl}
            title={t('browser.editUrl')}
          >
            {tab.url}
          </p>
        )}
      </div>

      {tab.sharedWith.length > 0 && (
        <div className="hidden shrink-0 items-center gap-1 lg:flex" title={tab.sharedWith.join(', ')}>
          <Users className="size-3.5 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">{tab.sharedWith.length}</span>
        </div>
      )}

      {tab.contextId ? (
        <button
          onClick={handleUnpersist}
          className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
          title={t('browser.removePersistentHint')}
        >
          <Pin className="size-3" />
          <span className="hidden max-w-[8rem] truncate sm:inline">{currentContextName}</span>
        </button>
      ) : (
        <button
          onClick={handlePersist}
          className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 text-[11px] font-medium text-amber-700 transition-colors hover:bg-emerald-500/15 hover:text-emerald-700 dark:text-amber-300 dark:hover:text-emerald-300"
          title={t('browser.makePersistentHint')}
        >
          <PinOff className="size-3" />
          <span className="hidden sm:inline">{t('browser.makePersistent')}</span>
        </button>
      )}

      <button
        onClick={() => handleCloseOrSleep(tab)}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-red-500"
        title={tab.contextId ? t('browser.sleepHint') : t('browser.closeTab')}
        aria-label={tab.contextId ? t('browser.sleep') : t('browser.closeTab')}
      >
        {tab.contextId ? <Moon className="size-3.5" /> : <X className="size-3.5" />}
      </button>
    </div>
  );

  // ── viewport ──────────────────────────────────────────────────────────────

  const viewport = tab && (
    <div
      className={cn(
        'relative flex flex-1 items-start justify-center overflow-hidden bg-zinc-50 transition-shadow dark:bg-zinc-950',
        activity.active && 'shadow-[inset_0_0_0_2px_rgba(14,165,233,0.55)]',
      )}
    >
      {sessionDead ? (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <div className="space-y-3 text-center">
            <Globe className="mx-auto size-10 opacity-20" />
            <p className="text-sm font-medium">{t('browser.expiredTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('browser.expiredBody')}</p>
            <button
              onClick={handleReconnect}
              disabled={reconnecting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <RefreshCw className={cn('size-3.5', reconnecting && 'animate-spin')} />
              {t('browser.reconnect')}
            </button>
          </div>
        </div>
      ) : tab.liveUrl && !reconnecting ? (
        <iframe
          src={embedUrl(tab.liveUrl)}
          className="h-full w-full border-0"
          allow="clipboard-read; clipboard-write"
          title={t('browser.liveBrowser', { url: tab.url })}
        />
      ) : loading && !screenshotUrl ? (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <RefreshCw className="size-6 animate-spin" />
        </div>
      ) : screenshotUrl ? (
        <div className="flex w-full justify-center overflow-auto p-4">
          <img
            src={screenshotUrl}
            alt={t('browser.screenshotOf', { url: tab.url })}
            className="max-w-full rounded-lg border border-zinc-200 shadow-sm dark:border-zinc-700"
          />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <p className="text-sm">{t('browser.noScreenshot')}</p>
        </div>
      )}

      {/* Control layer. Watching = a glass sheet that keeps stray clicks away
          from the agent's page and offers "Take over". Controlling = no sheet;
          just a small pill to hand back. */}
      {tab.liveUrl && !sessionDead && !reconnecting && (
        control === 'watching' ? (
          <div
            className="absolute inset-0 z-10 flex cursor-default flex-col justify-end"
            onDoubleClick={() => setControl('controlling')}
          >
            <div className="pointer-events-none flex items-end justify-between gap-3 bg-gradient-to-t from-black/45 to-transparent px-3 pb-3 pt-10">
              <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-[12px] text-white shadow backdrop-blur">
                {activity.active ? (
                  <>
                    <span className="relative flex size-4 items-center justify-center">
                      <MousePointer2 className="size-4 text-sky-300" />
                      <span className="absolute inset-0 -m-1 animate-ping rounded-full bg-sky-400/40" />
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
              <button
                onClick={() => setControl('controlling')}
                className="pointer-events-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[12px] font-semibold text-zinc-900 shadow transition-transform hover:scale-[1.03] active:scale-100"
              >
                <Hand className="size-3.5" />
                {t('browser.takeOver')}
              </button>
            </div>
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center gap-2 px-3">
            <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/60 py-1 pl-3 pr-1 text-[12px] text-white shadow backdrop-blur">
              <Hand className="size-3.5 text-emerald-300" />
              <span className="font-medium">{t('browser.youAreInControl')}</span>
              {activity.active && (
                <span className="hidden items-center gap-1 text-sky-200 sm:inline-flex">
                  <Bot className="size-3.5" />
                  {activityLabel}
                </span>
              )}
              <button
                onClick={() => setControl('watching')}
                className="ml-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium hover:bg-white/25"
                title={t('browser.watchingHint')}
              >
                {t('browser.handBack')}
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );

  // ── status bar ────────────────────────────────────────────────────────────

  const statusBar = tab && (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-zinc-50 px-3 text-[11px] text-muted-foreground dark:bg-zinc-900">
      <span className="inline-flex items-center gap-1.5">
        <span
          className={cn(
            'size-1.5 rounded-full',
            liveState === 'live' && 'bg-emerald-500 animate-pulse',
            liveState === 'connecting' && 'bg-amber-500 animate-pulse',
            liveState === 'expired' && 'bg-red-500',
          )}
        />
        {liveState === 'live' ? t('browser.live') : liveState === 'expired' ? t('browser.expiredTitle') : t('browser.opening')}
        <span className="hidden text-muted-foreground/60 sm:inline">· {t('browser.cloudBrowser')}</span>
      </span>
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {tab.contextId ? (
          <>
            <Pin className="size-3 text-emerald-500" />
            <span className="truncate">{t('browser.kindPermanent')}</span>
          </>
        ) : (
          <>
            <Hourglass className="size-3 text-amber-500" />
            <span className="truncate">
              {t('browser.kindTemporary')} · {t('browser.idleClosesIn', { minutes: idleMinutesLeft(tab, idleMinutes) })}
            </span>
          </>
        )}
      </span>
      <span className="ml-auto hidden items-center gap-1.5 md:inline-flex">
        <span className="truncate">
          {t('browser.openedBy', { who: tab.createdBy?.startsWith('human:') ? t('browser.you') : whoLabel(tab.createdBy) })}
        </span>
        {tab.lastActiveAt && <span>· {timeAgo(tab.lastActiveAt)}</span>}
      </span>
    </div>
  );

  // ── empty / asleep states ────────────────────────────────────────────────

  const placeholder = !tab && (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 p-6 text-muted-foreground dark:bg-zinc-950">
      {asleepEntry ? (
        <div className="max-w-sm space-y-4 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-zinc-200/70 dark:bg-zinc-800">
            <Moon className="size-7 text-zinc-500" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">{asleepEntry.context.name}</p>
            <p className="text-sm font-medium">{t('browser.sessionAsleepTitle')}</p>
            <p className="text-xs leading-relaxed">{t('browser.sessionAsleepBody')}</p>
            {asleepEntry.context.domain && (
              <p className="font-mono text-[11px] text-muted-foreground/70">{asleepEntry.context.domain}</p>
            )}
          </div>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => wake(asleepEntry.context.id)}
              disabled={!!wakingId}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Play className={cn('size-3.5', wakingId && 'animate-pulse')} />
              {wakingId ? t('browser.waking') : t('browser.wake')}
            </button>
            <button
              onClick={() => handleForget(asleepEntry)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-red-500"
            >
              {t('browser.deleteSavedSession')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-center">
          <Globe className="mx-auto size-12 opacity-20" />
          <p className="text-sm font-medium">
            {permanent.length + temporary.length > 0 ? t('browser.selectTabTitle') : t('browser.emptyTitle')}
          </p>
          <p className="text-xs">
            {permanent.length + temporary.length > 0 ? t('browser.selectTabBody') : t('browser.emptyBody')}
          </p>
          <button
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Plus className="size-3.5" />
            {t('browser.newTab')}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <DetailHeader
        title={<>
          <Globe className={cn('size-4 shrink-0', navigating ? 'animate-pulse text-amber-500' : 'text-foreground/70')} />
          <p className="truncate text-sm font-medium">{tab?.title || asleepEntry?.context.name || t('browser.cloudBrowser')}</p>
        </>}
      >
        {!isMobile && (
          <button
            onClick={toggleDetailExpanded}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title={isDetailExpanded ? t('browser.restoreSize') : t('browser.expandFullPage')}
          >
            {isDetailExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        )}
      </DetailHeader>

      <FeatureTourBanner feature="browser" />

      {tabStrip}
      {toolbar}
      {viewport}
      {placeholder}
      {statusBar}

      <NewBrowserTabDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

'use client';

import type { RefObject } from 'react';
import { Globe, Hand, Moon, Play, Plus, RefreshCw, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { useFormatters, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { BrowserTab } from '@/lib/types';
import { whoLabel, type PermanentEntry } from './tab-model';

export type LiveState = 'live' | 'connecting' | 'unavailable' | 'asleep' | 'none';

/** Reconnect, the address (click to edit), who it is shared with, take over and close. */
export function BrowserToolbar({ tab, urlInputRef, editingUrl, urlDraft, onUrlDraft, onStartEditing, onStopEditing, onNavigate, reconnecting, navigating, onReconnect, controlling, controlDisabled, onToggleControl, onClose }: {
  tab: BrowserTab;
  urlInputRef: RefObject<HTMLInputElement | null>;
  editingUrl: boolean;
  urlDraft: string;
  onUrlDraft: (value: string) => void;
  onStartEditing: () => void;
  onStopEditing: () => void;
  onNavigate: () => void;
  reconnecting: boolean;
  navigating: boolean;
  onReconnect: () => void;
  controlling: boolean;
  controlDisabled: boolean;
  onToggleControl: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onReconnect}
        disabled={reconnecting}
        className="text-muted-foreground"
        title={t('browser.reconnectHint')}
        aria-label={t('browser.reactivate')}
      >
        <RefreshCw className={cn((reconnecting || navigating) && 'animate-spin')} />
      </Button>

      <div
        className={cn(
          'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-muted px-3',
          editingUrl && 'border-foreground/40 bg-background',
        )}
      >
        <Globe className="size-3 shrink-0 text-muted-foreground/60" />
        {editingUrl ? (
          <input
            ref={urlInputRef}
            value={urlDraft}
            onChange={(e) => onUrlDraft(e.target.value)}
            onBlur={onStopEditing}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onNavigate();
              if (e.key === 'Escape') onStopEditing();
            }}
            className="w-full bg-transparent font-mono text-xs outline-none"
            autoFocus
            spellCheck={false}
          />
        ) : (
          <p
            className="min-w-0 flex-1 cursor-text truncate font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={onStartEditing}
            title={t('browser.editUrl')}
          >
            {tab.url}
          </p>
        )}
      </div>

      {tab.sharedWith.length > 0 && (
        <div className="hidden shrink-0 items-center gap-1 lg:flex" title={tab.sharedWith.join(', ')}>
          <Users className="size-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{tab.sharedWith.length}</span>
        </div>
      )}

      <Button
        variant="secondary"
        size="xs"
        onClick={onToggleControl}
        disabled={controlDisabled}
        className="rounded-full"
        title={controlling ? t('browser.handBack') : t('browser.takeOver')}
      >
        <Hand data-icon="inline-start" />
        {controlling ? t('browser.handBack') : t('browser.takeOver')}
      </Button>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        className="text-muted-foreground hover:text-destructive"
        title={t('browser.closeTab')}
        aria-label={t('browser.closeTab')}
      >
        <X />
      </Button>
    </div>
  );
}

/** Whether the page is live, who is driving, who opened it and when. */
export function BrowserStatusBar({ tab, liveState, controlling }: { tab: BrowserTab; liveState: LiveState; controlling: boolean }) {
  const t = useT();
  const { timeAgoShort: timeAgo } = useFormatters();
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-muted px-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span
          className={cn(
            'size-1.5 rounded-full',
            liveState === 'live' && 'animate-pulse bg-success',
            liveState === 'connecting' && 'animate-pulse bg-warning',
            liveState === 'unavailable' && 'bg-destructive',
          )}
        />
        {liveState === 'live' ? t('browser.live') : liveState === 'unavailable' ? t('browser.unavailableTitle') : liveState === 'asleep' ? t('browser.sleepingTitle') : t('browser.opening')}
        <span className="hidden text-muted-foreground/60 sm:inline">· {t('browser.cloudBrowser')}</span>
      </span>
      <span className="min-w-0 truncate" title={controlling ? t('browser.controlInstructions') : undefined}>
        {controlling ? t('browser.youAreInControl') : t('browser.watching')}
      </span>
      <span className="ml-auto hidden items-center gap-1.5 md:inline-flex">
        <span className="truncate">
          {t('browser.openedBy', { who: tab.createdBy?.startsWith('human:') ? t('browser.you') : whoLabel(tab.createdBy) })}
        </span>
        {tab.lastActiveAt && <span>· {timeAgo(tab.lastActiveAt)}</span>}
      </span>
    </div>
  );
}

/** No tab open: a saved session that sleeps, or nothing picked yet. */
export function BrowserPlaceholder({ asleepEntry, hasTabs, wakingId, onWake, onForget, onNewTab }: {
  asleepEntry: PermanentEntry | null;
  hasTabs: boolean;
  wakingId: string | null;
  onWake: (contextId: string) => void;
  onForget: (entry: PermanentEntry) => void;
  onNewTab: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-1 items-center justify-center bg-muted p-6">
      {asleepEntry ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Moon /></EmptyMedia>
            <EmptyTitle>{asleepEntry.context.name}</EmptyTitle>
            <EmptyDescription>
              <span className="block font-medium text-foreground">{t('browser.sessionAsleepTitle')}</span>
              {t('browser.sessionAsleepBody')}
            </EmptyDescription>
            {asleepEntry.context.domain && (
              <p className="font-mono text-xs text-muted-foreground/70">{asleepEntry.context.domain}</p>
            )}
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button size="sm" onClick={() => onWake(asleepEntry.context.id)} disabled={!!wakingId}>
              <Play data-icon="inline-start" className={cn(wakingId && 'animate-pulse')} />
              {wakingId ? t('browser.waking') : t('browser.wake')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onForget(asleepEntry)} className="text-muted-foreground hover:text-destructive">
              {t('browser.deleteSavedSession')}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Globe /></EmptyMedia>
            <EmptyTitle>{hasTabs ? t('browser.selectTabTitle') : t('browser.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{hasTabs ? t('browser.selectTabBody') : t('browser.emptyBody')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="outline" onClick={onNewTab}>
              <Plus data-icon="inline-start" />
              {t('browser.newTab')}
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </div>
  );
}

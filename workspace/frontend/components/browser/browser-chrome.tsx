'use client';

import type { RefObject } from 'react';
import { Globe, Hand, Moon, Play, Plus, RefreshCw, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { useFormatters, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { BrowserTab } from '@/lib/types';
import type { StreamQuality } from '@/lib/browser-stream-quality';
import { whoLabel, type PermanentEntry } from './tab-model';

export type LiveState = 'live' | 'connecting' | 'unavailable' | 'asleep' | 'none';

/** Reconnect, the editable address, who it is shared with, take over and close. */
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
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <WithTooltip label={t('browser.reconnectHint')}>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onReconnect}
          disabled={reconnecting}
          className="text-muted-foreground"
          aria-label={t('browser.reactivate')}
        >
          <RefreshCw className={cn((reconnecting || navigating) && 'animate-spin')} />
        </Button>
      </WithTooltip>

      {/* Always an input: focusing it starts an edit, Enter navigates, Escape or blur cancels. */}
      <InputGroup className="h-8 min-w-0 flex-1 bg-muted/40 shadow-none">
        <InputGroupAddon><Globe className="size-3.5" /></InputGroupAddon>
        <InputGroupInput
          ref={urlInputRef}
          value={editingUrl ? urlDraft : tab.url}
          onFocus={() => { if (!editingUrl) onStartEditing(); }}
          onChange={(e) => onUrlDraft(e.target.value)}
          onBlur={onStopEditing}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { onNavigate(); e.currentTarget.blur(); }
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
          aria-label={t('browser.addressLabel')}
          className={cn('text-xs md:text-xs', !editingUrl && 'text-muted-foreground')}
          spellCheck={false}
        />
      </InputGroup>

      {tab.sharedWith.length > 0 && (
        <WithTooltip label={tab.sharedWith.join(', ')}><div className="hidden shrink-0 items-center gap-1 lg:flex">
          <Users className="size-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{tab.sharedWith.length}</span>
        </div></WithTooltip>
      )}

      <Button
        variant={controlling ? "default" : "outline"}
        onClick={onToggleControl}
        disabled={controlDisabled}
        className="shrink-0"
      >
        <Hand data-icon="inline-start" />
        {controlling ? t('browser.handBack') : t('browser.takeOver')}
      </Button>

      <WithTooltip label={t('browser.closeTab')}>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="text-muted-foreground"
          aria-label={t('browser.closeTab')}
        >
          <X />
        </Button>
      </WithTooltip>
    </div>
  );
}

/** Whether the page is live, who is driving, who opened it and when. */
export function BrowserStatusBar({ tab, liveState, controlling, quality, onQuality }: {
  tab: BrowserTab;
  liveState: LiveState;
  controlling: boolean;
  /** Shown as a choice only where the person may pick (not in small previews). */
  quality?: StreamQuality;
  onQuality?: (quality: StreamQuality) => void;
}) {
  const t = useT();
  const { timeAgoShort: timeAgo } = useFormatters();
  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-t border-border bg-background px-3 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span
          className={cn(
            'size-1.5 rounded-full',
            liveState === 'live' && 'bg-success',
            liveState === 'connecting' && 'motion-safe:animate-pulse bg-warning',
            liveState === 'unavailable' && 'bg-warning',
            (liveState === 'asleep' || liveState === 'none') && 'bg-muted-foreground',
          )}
        />
        {liveState === 'live' ? t('browser.live') : liveState === 'unavailable' ? t('browser.unavailableTitle') : liveState === 'asleep' ? t('browser.sleepingTitle') : t('browser.opening')}
        <span className="hidden text-muted-foreground/60 sm:inline">· {t('browser.cloudBrowser')}</span>
      </span>
      {liveState === 'live' && <WithTooltip label={controlling ? t('browser.controlInstructions') : undefined}><span className="min-w-0 truncate">
        {controlling ? t('browser.youAreInControl') : t('browser.watching')}
      </span></WithTooltip>}
      {quality && onQuality && (
        <ToggleGroup type="single" variant="outline" size="sm" value={quality} aria-label={t('browser.streamQuality')} className="ml-auto shrink-0 md:ml-0"
          onValueChange={(next) => { if (next) onQuality(next as StreamQuality); }}>
          {(['high', 'low'] as const).map((option) => (
            <WithTooltip key={option} label={t(option === 'high' ? 'browser.streamHighHint' : 'browser.streamLowHint')}>
              <ToggleGroupItem value={option} className="h-6 px-1.5 text-xs">
                {t(option === 'high' ? 'browser.streamHigh' : 'browser.streamLow')}
              </ToggleGroupItem>
            </WithTooltip>
          ))}
        </ToggleGroup>
      )}
      <span className="ml-auto hidden min-w-0 items-center gap-1.5 md:inline-flex">
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
    <div className="flex flex-1 items-center justify-center bg-muted/30 p-6">
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
            <Button size="sm" variant="destructive" onClick={() => onForget(asleepEntry)}>
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

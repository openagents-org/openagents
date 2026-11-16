'use client';

import { useRef } from 'react';
import { Globe, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { BrowserTab } from '@/lib/types';
import type { useBrowserControl } from './use-browser-control';
import type { BrowserSession } from './use-browser-session';
import { BrowserControlLayer } from './browser-control-layer';

type SendInput = ReturnType<typeof useBrowserControl>['input'];

/**
 * The live view is embedded chrome-less; the workspace draws the browser around it.
 * This is the surface people take over to read and type, so ask for the sharper
 * stream: the default preset downscales a 1920px page to 1024px JPEG.
 */
function embedUrl(liveUrl: string): string {
  return liveUrl + (liveUrl.includes('?') ? '&' : '?') + 'embed=1&q=high';
}

/** A local tab's screenshot, clickable and typed into while you have control. */
function ScreenshotSurface({ tab, src, controlling, keyboardRef, sendInput }: {
  tab: BrowserTab;
  src: string;
  controlling: boolean;
  keyboardRef: BrowserSession['keyboardRef'];
  sendInput: SendInput;
}) {
  const t = useT();
  const composingRef = useRef(false);
  return (
    <div className="flex w-full justify-center overflow-auto p-4">
      <textarea ref={keyboardRef} className="sr-only" tabIndex={controlling ? 0 : -1} disabled={!controlling}
        aria-label={t('browser.controlInstructions')} autoComplete="off" autoCapitalize="off" spellCheck={false}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={event => {
          composingRef.current = false;
          if (controlling && event.data) sendInput({ kind: 'text', text: event.data });
          event.currentTarget.value = '';
        }}
        onInput={event => {
          if (composingRef.current || !controlling) return;
          const text = event.currentTarget.value;
          if (text) sendInput({ kind: 'text', text: text.slice(0, 10000) });
          event.currentTarget.value = '';
        }}
        onKeyDown={event => {
          if (!controlling) return;
          event.stopPropagation();
          if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Escape') { event.currentTarget.blur(); return; }
          if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) return;
          event.preventDefault();
          sendInput({ kind: 'key', key: [event.ctrlKey && 'Control', event.metaKey && 'Meta', event.altKey && 'Alt', event.shiftKey && 'Shift', event.key].filter(Boolean).join('+') });
        }}
        onKeyUp={event => event.stopPropagation()}
        onPaste={event => {
          if (!controlling) return;
          event.preventDefault(); event.stopPropagation();
          sendInput({ kind: 'text', text: event.clipboardData.getData('text/plain').slice(0, 10000) });
        }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={t('browser.screenshotOf', { url: tab.url })}
        className={cn('max-w-full rounded-lg border border-border shadow-sm outline-none focus:ring-2 focus:ring-primary', controlling && 'cursor-pointer')}
        draggable={false}
        tabIndex={-1}
        role={controlling ? 'application' : undefined}
        aria-label={controlling ? t('browser.controlInstructions') : undefined}
        onClick={(event) => {
          if (!controlling) return;
          keyboardRef.current?.focus({ preventScroll: true });
          const rect = event.currentTarget.getBoundingClientRect();
          sendInput({ kind: 'click', x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
        }}
        onWheel={(event) => {
          if (!controlling) return;
          const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 500 : 1;
          sendInput({ kind: 'scroll', delta_x: Math.max(-2000, Math.min(2000, event.deltaX * scale)), delta_y: Math.max(-2000, Math.min(2000, event.deltaY * scale)) });
        }}
      />
    </div>
  );
}

/** The page itself: the live view, a screenshot, or why there is neither. */
export function BrowserViewport({ tab, session, controlling, controlBusy, onToggleControl, sendInput, agentActive, activityLabel }: {
  tab: BrowserTab;
  session: BrowserSession;
  controlling: boolean;
  controlBusy: boolean;
  onToggleControl: () => void;
  sendInput: SendInput;
  agentActive: boolean;
  activityLabel: string | null;
}) {
  const t = useT();
  const { sessionDead, sessionAsleep, reconnecting, recoveryError, screenshotUrl, loading, liveRevision, liveFrameRef } = session;
  const asleep = sessionAsleep || tab.asleep;
  return (
    <div
      className={cn(
        'relative flex flex-1 items-start justify-center overflow-hidden bg-muted transition-shadow',
        agentActive && 'ring-2 ring-info/55 ring-inset',
      )}
    >
      {sessionDead || asleep ? (
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Globe /></EmptyMedia>
            <EmptyTitle>{t(asleep ? 'browser.sleepingTitle' : 'browser.unavailableTitle')}</EmptyTitle>
            <EmptyDescription role={recoveryError ? 'alert' : undefined}>{recoveryError || t(asleep ? 'browser.sleepingBody' : 'browser.unavailableBody')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={session.handleReconnect} disabled={reconnecting}>
              <RefreshCw data-icon="inline-start" className={cn(reconnecting && 'animate-spin')} />
              {t('browser.reactivate')}
            </Button>
            {sessionDead && tab.contextId && (
              <Button variant="link" size="xs" onClick={session.handleReplace} disabled={reconnecting}>{t('browser.replace')}</Button>
            )}
          </EmptyContent>
        </Empty>
      ) : reconnecting || (!tab.liveUrl && loading && !screenshotUrl) ? (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <Spinner className="size-6" />
        </div>
      ) : tab.liveUrl ? (
        <iframe
          key={`${tab.id}:${liveRevision}`}
          ref={liveFrameRef}
          onLoad={() => { if (controlling) liveFrameRef.current?.focus(); }}
          src={embedUrl(tab.liveUrl)}
          tabIndex={controlling ? 0 : -1}
          inert={!controlling}
          className="h-full w-full border-0"
          allow="clipboard-read; clipboard-write"
          title={t('browser.liveBrowser', { url: tab.url })}
        />
      ) : screenshotUrl ? (
        <ScreenshotSurface tab={tab} src={screenshotUrl} controlling={controlling} keyboardRef={session.keyboardRef} sendInput={sendInput} />
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <p className="text-sm">{t('browser.noScreenshot')}</p>
        </div>
      )}

      {tab.liveUrl && !sessionDead && !asleep && !reconnecting && (
        <BrowserControlLayer controlling={controlling} busy={controlBusy} agentActive={agentActive} activityLabel={activityLabel} onToggle={onToggleControl} />
      )}
    </div>
  );
}

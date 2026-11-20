'use client';

import { useState } from 'react';
import { ImageIcon, Globe, Moon, RefreshCw, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { BrowserTab } from '@/lib/types';
import { hostOf } from './tab-model';

/** Shared recovery surface; reconnect keeps the current session, replacement stays explicit. */
export function BrowserRecoveryCard({ tab, asleep, reconnecting, error, onReconnect, onReplace, screenshotUrl }: {
  screenshotUrl?: string | null;
  tab: BrowserTab;
  asleep: boolean;
  reconnecting: boolean;
  error: string | null;
  onReconnect: () => void;
  onReplace?: () => void;
}) {
  const t = useT();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const showScreenshot = !!screenshotUrl && failedImage !== screenshotUrl;
  // Internal Chrome error URLs aren't a useful identity for a saved session.
  const domain = /^https?:\/\//i.test(tab.url) ? hostOf(tab.url) : null;
  const name = tab.contextName || tab.title || domain || t('browser.cloudBrowser');
  return (
    <div className="relative isolate flex h-full w-full flex-col items-center overflow-auto p-5 sm:p-8">
      {showScreenshot && <>
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={screenshotUrl} alt="" onError={() => setFailedImage(screenshotUrl)} className="h-full w-full object-cover object-top" draggable={false} />
          <div className="absolute inset-0 bg-background/45" />
        </div>
        <div className="mb-5 flex shrink-0 items-center gap-2 self-start rounded-lg border bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-sm">
          <ImageIcon className="size-3.5" />{t('browser.previousScreenshot')}
        </div>
      </>}
      <section className="my-auto w-full max-w-md shrink-0 overflow-hidden rounded-2xl border border-border bg-background shadow-sm" aria-label={t(asleep ? 'browser.sleepingTitle' : 'browser.unavailableTitle')}>
        <div className="flex items-center gap-3 border-b bg-muted/30 px-5 py-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground"><Globe className="size-4" /></div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={name}>{name}</p>
            <p className="truncate text-xs text-muted-foreground">{domain && domain !== name ? domain : t('browser.cloudBrowser')}</p>
          </div>
          {asleep ? <Moon className="ml-auto size-4 shrink-0 text-muted-foreground" /> : <Unplug className="ml-auto size-4 shrink-0 text-muted-foreground" />}
        </div>
        <div className="px-6 py-7 text-center sm:px-8">
          <h2 className="text-lg font-semibold tracking-tight">{t(asleep ? 'browser.sleepingTitle' : 'browser.unavailableTitle')}</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground" role={error ? 'alert' : undefined}>{error || t(asleep ? 'browser.sleepingBody' : 'browser.unavailableBody')}</p>
          <Button className="mt-6 h-9 w-full" onClick={onReconnect} disabled={reconnecting}>
            <RefreshCw className={cn('size-4', reconnecting && 'motion-safe:animate-spin')} />
            {t(reconnecting ? 'browser.opening' : 'browser.reactivate')}
          </Button>
          {onReplace && <Button className="mt-2 w-full text-xs text-muted-foreground" variant="ghost" onClick={onReplace} disabled={reconnecting}>{t('browser.replace')}</Button>}
        </div>
      </section>
    </div>
  );
}

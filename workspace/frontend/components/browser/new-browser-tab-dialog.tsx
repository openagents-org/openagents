'use client';

import { useEffect, useMemo, useState } from 'react';
import { Hourglass, Loader2, Pin } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { BrowserTabKind } from '@/lib/types';
import { hostOf, normalizeUrl } from './tab-model';

/**
 * "Open a new tab" for the cloud browser. The one decision that matters is
 * the tab kind, so it is a visible two-way choice with the quota next to each
 * option — not a checkbox tucked under the URL. Permanent is the default.
 */
export function NewBrowserTabDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { openBrowserTab, browserTabLimits, setSelectedBrowserTabId } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();

  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<BrowserTabKind>('permanent');
  const [busy, setBusy] = useState(false);

  // One limit for both kinds: tabs currently awake. Sleeping tabs are free.
  const quotaFull = !!browserTabLimits && browserTabLimits.concurrent.used >= browserTabLimits.concurrent.max;
  const idleMinutes = browserTabLimits?.idleMinutes ?? 15;

  // Fresh form on every open.
  useEffect(() => {
    if (!open) return;
    setUrl('');
    setName('');
    setBusy(false);
    setKind('permanent');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestedName = useMemo(() => hostOf(normalizeUrl(url)) || '', [url]);
  const chosenFull = quotaFull;

  const submit = async () => {
    if (busy || chosenFull) return;
    setBusy(true);
    try {
      const tab = await openBrowserTab(normalizeUrl(url), {
        persistent: kind === 'permanent',
        name: kind === 'permanent' ? name.trim() || undefined : undefined,
      });
      setSelectedBrowserTabId(tab.id);
      if (isMobile) openMobileDetail();
      toast.success(t('browser.tabOpened'));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.tabOpenFailed'));
    } finally {
      setBusy(false);
    }
  };

  const KindOption = ({
    value,
    icon: Icon,
    label,
    hint,
    used,
    max,
    full,
    badge,
  }: {
    value: BrowserTabKind;
    icon: typeof Pin;
    label: string;
    hint: string;
    used?: number;
    max?: number;
    full: boolean;
    badge?: string;
  }) => {
    const selected = kind === value;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => setKind(value)}
        className={cn(
          'flex flex-1 flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors',
          selected
            ? value === 'permanent'
              ? 'border-emerald-500/60 bg-emerald-500/5 ring-1 ring-emerald-500/40'
              : 'border-amber-500/60 bg-amber-500/5 ring-1 ring-amber-500/40'
            : 'border-border hover:bg-accent/60',
        )}
      >
        <span className="flex items-center gap-2">
          <Icon
            className={cn(
              'size-4 shrink-0',
              value === 'permanent' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
            )}
          />
          <span className="text-sm font-medium">{label}</span>
          {badge && (
            <span className="ml-auto rounded-full bg-foreground/10 px-1.5 py-px text-[10px] font-medium text-foreground/70">
              {badge}
            </span>
          )}
        </span>
        <span className="text-xs leading-snug text-muted-foreground">{hint}</span>
        {typeof used === 'number' && typeof max === 'number' && (
          <span className={cn('mt-0.5 text-[11px] tabular-nums', full ? 'text-red-500' : 'text-muted-foreground/80')}>
            {t('browser.slotsUsed', { used, max })}
          </span>
        )}
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-2 px-6 pt-6 pb-1">
          <DialogTitle className="text-lg">{t('browser.openTabTitle')}</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">
            {t('browser.openTabDescription')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4 px-6 py-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-tab-url">{t('browser.urlLabel')}</Label>
            <Input
              id="new-tab-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder={t('browser.urlPlaceholder')}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-[13px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('browser.tabKindLabel')}</Label>
            <div role="radiogroup" className="flex gap-2">
              <KindOption
                value="permanent"
                icon={Pin}
                label={t('browser.keepPermanent')}
                badge={t('browser.keepPermanentDefault')}
                hint={t('browser.permanentHint', { minutes: idleMinutes })}
                full={quotaFull}
              />
              <KindOption
                value="temporary"
                icon={Hourglass}
                label={t('browser.keepTemporary')}
                hint={t('browser.temporaryHint', { minutes: idleMinutes })}
                full={quotaFull}
              />
            </div>
            {browserTabLimits && (
              <p className={cn('text-xs', quotaFull ? 'text-red-500' : 'text-muted-foreground/80')}>
                {quotaFull
                  ? t('browser.quotaFull', { max: browserTabLimits.concurrent.max, minutes: idleMinutes })
                  : t('browser.awakeSlots', { max: browserTabLimits.concurrent.max, minutes: idleMinutes })}
                {' '}
                ({t('browser.slotsUsed', { used: browserTabLimits.concurrent.used, max: browserTabLimits.concurrent.max })})
              </p>
            )}
          </div>

          {kind === 'permanent' && (
            <div className="space-y-1.5">
              <Label htmlFor="new-tab-name">{t('browser.nameLabel')}</Label>
              <Input
                id="new-tab-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
                placeholder={suggestedName || t('browser.namePlaceholder')}
                autoComplete="off"
              />
            </div>
          )}
        </DialogBody>

        <DialogFooter className="px-6 pb-6 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={busy || chosenFull}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : kind === 'permanent' ? <Pin className="size-4" /> : <Hourglass className="size-4" />}
            {busy ? t('browser.opening') : t('browser.open')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

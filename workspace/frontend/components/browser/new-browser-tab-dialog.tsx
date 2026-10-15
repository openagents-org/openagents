'use client';

import { useEffect, useMemo, useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';
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
import { hostOf, normalizeUrl } from './tab-model';

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
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestedName = useMemo(() => hostOf(normalizeUrl(url)) || '', [url]);
  const chosenFull = quotaFull;

  const submit = async () => {
    if (busy || chosenFull) return;
    setBusy(true);
    try {
      const tab = await openBrowserTab(normalizeUrl(url), {
        persistent: true,
        name: name.trim() || undefined,
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
        </DialogBody>

        <DialogFooter className="px-6 pb-6 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={busy || chosenFull}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
            {busy ? t('browser.opening') : t('browser.open')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

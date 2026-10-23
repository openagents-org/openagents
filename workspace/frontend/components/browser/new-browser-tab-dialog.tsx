'use client';

import { useEffect, useState } from 'react';
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
import { toast } from 'sonner';
import { normalizeUrl } from './tab-model';

export function NewBrowserTabDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { openBrowserTab, browserTabLimits, refreshBrowserTabs, setSelectedBrowserTabId } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();

  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  // Fresh form on every open.
  useEffect(() => {
    if (!open) return;
    setUrl('');
    setBusy(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps


  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const tab = await openBrowserTab(normalizeUrl(url), {
        persistent: true,
      });
      setSelectedBrowserTabId(tab.id);
      if (isMobile) openMobileDetail();
      toast.success(t('browser.tabOpened'));
      onOpenChange(false);
    } catch (err) {
      const capacity = err instanceof Error && /concurrent (?:tab|session) limit|active.session.{0,20}limit/i.test(err.message);
      toast.error(t(capacity ? 'browser.activeSessionLimit' : 'browser.tabOpenFailed'));
      void refreshBrowserTabs().catch(() => {});
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

          <p className="text-xs text-muted-foreground/80">{t('browser.sessionCapacityHint')}
            {browserTabLimits && <> {t('browser.workspaceActiveSessions', { count: browserTabLimits.concurrent.used })}</>}
          </p>

        </DialogBody>

        <DialogFooter className="px-6 pb-6 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
            {busy ? t('browser.opening') : t('browser.open')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

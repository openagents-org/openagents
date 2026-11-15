'use client';

import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
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
import { Field, FieldLabel } from '@/components/ui/field';
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
        <DialogHeader>
          <DialogTitle className="text-lg">{t('browser.openTabTitle')}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {t('browser.openTabDescription')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="new-tab-url">{t('browser.urlLabel')}</FieldLabel>
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
              className="font-mono text-sm"
            />
          </Field>

          <p className="text-xs text-muted-foreground/80">{t('browser.sessionCapacityHint')}
            {browserTabLimits && <> {t('browser.workspaceActiveSessions', { count: browserTabLimits.concurrent.used })}</>}
          </p>

        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <Globe className="size-4" />}
            {busy ? t('browser.opening') : t('browser.open')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

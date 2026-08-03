'use client';

import { useState } from 'react';
import { Check, Copy, Link, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
}

export function ShareDialog({ open, onOpenChange, sessionId }: ShareDialogProps) {
  const [loading, setLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const t = useT();

  const handleCreateShare = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await workspaceApi.createShare(sessionId);
      const url = `${window.location.origin}/share/${result.shareToken}`;
      setShareUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('share.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setShareUrl(null);
      setError(null);
      setLoading(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-3 px-7 pt-7 pb-2">
          <DialogTitle className="text-xl">{t('share.title')}</DialogTitle>
          <DialogDescription className="text-[15px] leading-relaxed">
            {t('share.description')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3 px-7 py-2">
          {shareUrl ? (
            <div className="space-y-2">
              <Label variant="secondary">{t('share.shareLink')}</Label>
              <Input
                readOnly
                value={shareUrl}
                className="font-mono select-all"
                onFocus={(e) => e.target.select()}
              />
            </div>
          ) : (
            <div className="rounded-md border border-input bg-muted/40 px-4 py-3.5">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t('share.snapshotNote')}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogBody>

        <DialogFooter className="px-7 pt-7 pb-7 sm:space-x-3">
          <Button
            variant="outline"
            className="min-w-24"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
          >
            {shareUrl ? t('common.done') : t('common.cancel')}
          </Button>
          {shareUrl ? (
            <Button className="min-w-24" onClick={() => copyToClipboard(shareUrl)}>
              {isCopied ? <Check /> : <Copy />}
              {isCopied ? t('common.copied') : t('share.copyLink')}
            </Button>
          ) : (
            <Button className="min-w-24" onClick={handleCreateShare} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <Link />}
              {loading ? t('share.creating') : error ? t('share.tryAgain') : t('share.createLink')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

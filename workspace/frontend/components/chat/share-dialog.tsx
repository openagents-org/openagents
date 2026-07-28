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

  const handleCreateShare = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await workspaceApi.createShare(sessionId);
      const url = `${window.location.origin}/share/${result.shareToken}`;
      setShareUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create share link');
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share conversation</DialogTitle>
          <DialogDescription>
            Create a public link to a snapshot of this conversation. Anyone with the link can view it.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3 py-1">
          {shareUrl ? (
            <div className="space-y-2">
              <Label variant="secondary">Share link</Label>
              <Input
                readOnly
                value={shareUrl}
                className="font-mono select-all"
                onFocus={(e) => e.target.select()}
              />
            </div>
          ) : (
            <div className="rounded-md border border-input bg-muted/40 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">
                The snapshot includes all chat messages. Internal tool use and thinking steps are excluded.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
            {shareUrl ? 'Done' : 'Cancel'}
          </Button>
          {shareUrl ? (
            <Button onClick={() => copyToClipboard(shareUrl)}>
              {isCopied ? <Check /> : <Copy />}
              {isCopied ? 'Copied' : 'Copy link'}
            </Button>
          ) : (
            <Button onClick={handleCreateShare} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <Link />}
              {loading ? 'Creating snapshot…' : error ? 'Try again' : 'Create share link'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

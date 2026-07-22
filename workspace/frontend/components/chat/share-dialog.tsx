'use client';

import { useState } from 'react';
import { Check, Copy, Link, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogTitle, DialogDescription } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
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

        <DialogBody className="space-y-4 py-1">
          {!shareUrl && !loading && !error && (
            <Button onClick={handleCreateShare} className="w-full">
              <Link className="size-4 mr-2" />
              Create share link
            </Button>
          )}

          {loading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Creating snapshot...</span>
            </div>
          )}

          {error && (
            <div className="space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button onClick={handleCreateShare} variant="outline" size="sm">
                Try again
              </Button>
            </div>
          )}

          {shareUrl && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 rounded-md border border-input bg-muted px-3 py-2 text-sm font-mono select-all"
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(shareUrl)}
                  className="shrink-0"
                >
                  {isCopied ? (
                    <>
                      <Check className="size-4 mr-1" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-4 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This snapshot includes all chat messages. Internal tool use and thinking steps are excluded.
              </p>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

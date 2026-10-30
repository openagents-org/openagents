'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { shareOrigin } from '@/lib/share-origin';
import { threadLink } from '@/lib/thread-link';

export function ShareDialog({ open, onOpenChange, sessionId }: {
  open: boolean; onOpenChange: (open: boolean) => void; sessionId: string;
}) {
  const t = useT();
  const { workspace } = useWorkspace();
  const [mode, setMode] = useState('thread');
  const [loading, setLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const liveCopy = useCopyToClipboard();
  const snapshotCopy = useCopyToClipboard();
  const [liveUrl, setLiveUrl] = useState('');
  useEffect(() => {
    let active = true;
    setLiveUrl('');
    if (open && workspace) void workspaceApi.getThreadLink(sessionId).then(link => {
      if (active) setLiveUrl(threadLink(shareOrigin(), workspace.slug || workspace.workspaceId, link.id));
    }).catch(() => { if (active) setError(t('share.threadUnavailable')); });
    return () => { active = false; };
  }, [open, sessionId, workspace?.workspaceId]);
  useEffect(() => {
    setMode('thread'); setShareUrl(null); setError(null); setLoading(false);
    ++requestVersion.current;
    return () => { ++requestVersion.current; };
  }, [open, sessionId]);
  const createShare = async () => {
    const version = ++requestVersion.current;
    setLoading(true); setError(null);
    try {
      const result = await workspaceApi.createShare(sessionId);
      if (version === requestVersion.current) setShareUrl(`${shareOrigin()}/share/${result.shareToken}`);
    } catch (err) {
      if (version === requestVersion.current) setError(err instanceof Error ? err.message : t('share.createFailed'));
    } finally { if (version === requestVersion.current) setLoading(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('share.title')}</DialogTitle>
          <DialogDescription>{t('share.chooseType')}</DialogDescription>
        </DialogHeader>
        <Tabs value={mode} onValueChange={setMode}>
          <DialogBody className="space-y-4">
            <TabsList className="w-full">
              <TabsTrigger value="thread">{t('share.threadLink')}</TabsTrigger>
              <TabsTrigger value="snapshot">{t('share.snapshot')}</TabsTrigger>
            </TabsList>
            <TabsContent value="thread" className="space-y-3">
              <p className="text-sm text-muted-foreground">{t('share.threadLinkHint')}</p>
              <Input aria-label={t('share.threadLink')} readOnly value={liveUrl} className="select-all" onFocus={e => e.target.select()} />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </TabsContent>
            <TabsContent value="snapshot" className="space-y-3">
              <p className="text-sm text-muted-foreground">{t('collab.shareSnapshotHint')}</p>
              {shareUrl ? <Input aria-label={t('share.shareLink')} readOnly value={shareUrl} className="select-all" onFocus={e => e.target.select()} />
                : <p className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{t('share.snapshotNote')}</p>}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </TabsContent>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
            {mode === 'thread' ? (
              <Button disabled={!liveUrl} onClick={() => liveCopy.copyToClipboard(liveUrl)}>
                {liveCopy.isCopied ? <Check /> : <Copy />}{liveCopy.isCopied ? t('common.copied') : t('share.copyThreadLink')}
              </Button>
            ) : shareUrl ? (
              <Button onClick={() => snapshotCopy.copyToClipboard(shareUrl)}>{snapshotCopy.isCopied ? <Check /> : <Copy />}{snapshotCopy.isCopied ? t('common.copied') : t('share.copyLink')}</Button>
            ) : (
              <Button onClick={createShare} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <Link />}{loading ? t('share.creating') : t('share.createLink')}</Button>
            )}
          </DialogFooter>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

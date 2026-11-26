'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Link } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { shareOrigin } from '@/lib/share-origin';
import { threadLink } from '@/lib/thread-link';
import { agentLabel } from '@/lib/helpers';
import { isSharedThreadName, showGuestLinkPanel } from '@/lib/guest-links';
import { GuestLinkPanel, useGuestLinks } from './guest-link-panel';

function ShareError({ message }: { message: string }) {
  return <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert>;
}

export function ShareDialog({ open, onOpenChange, sessionId }: {
  open: boolean; onOpenChange: (open: boolean) => void; sessionId: string;
}) {
  const t = useT();
  const { workspace, sessions, agents } = useWorkspace();
  // A thread published by OpenAgents Share opens on its guest link.
  const defaultMode = isSharedThreadName(sessionId) ? 'guest' : 'thread';
  const [mode, setMode] = useState(defaultMode);
  const guestLinks = useGuestLinks(sessionId, open && !!workspace);
  const showGuest = showGuestLinkPanel(sessionId, guestLinks.links) && guestLinks.error !== 'forbidden';
  // Fall back to the thread link when the guest tab isn't available here.
  const activeMode = mode === 'guest' && !showGuest ? 'thread' : mode;
  const guestAgent = useMemo(() => {
    const participants = sessions?.find((s) => s.sessionId === sessionId)?.participants || [];
    const name = participants.find((p) => p && p !== '__no_response__');
    if (!name) return null;
    const agent = agents?.find((a) => a.agentName === name);
    return agent ? agentLabel(agent) : name;
  }, [sessions, agents, sessionId]);
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
    setMode(defaultMode); setShareUrl(null); setError(null); setLoading(false);
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
        <Tabs value={activeMode} onValueChange={setMode}>
          <DialogBody className="flex flex-col gap-4">
            <TabsList className="w-full">
              {showGuest && <TabsTrigger value="guest">{t('share.guestLink')}</TabsTrigger>}
              <TabsTrigger value="thread">{t('share.threadLink')}</TabsTrigger>
              <TabsTrigger value="snapshot">{t('share.snapshot')}</TabsTrigger>
            </TabsList>
            {showGuest && (
              <TabsContent value="guest" className="flex flex-col gap-3">
                <GuestLinkPanel channel={sessionId} agentName={guestAgent} links={guestLinks.links} error={guestLinks.error} setLinks={guestLinks.setLinks} />
              </TabsContent>
            )}
            <TabsContent value="thread" className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t('share.threadLinkHint')}</p>
              <Input aria-label={t('share.threadLink')} readOnly value={liveUrl} className="select-all" onFocus={e => e.target.select()} />
              {error && <ShareError message={error} />}
            </TabsContent>
            <TabsContent value="snapshot" className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t('collab.shareSnapshotHint')}</p>
              {shareUrl ? <Input aria-label={t('share.shareLink')} readOnly value={shareUrl} className="select-all" onFocus={e => e.target.select()} />
                : <Alert role="note" className="bg-muted/40"><AlertDescription>{t('share.snapshotNote')}</AlertDescription></Alert>}
              {error && <ShareError message={error} />}
            </TabsContent>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
            {activeMode === 'guest' ? null : activeMode === 'thread' ? (
              <Button disabled={!liveUrl} onClick={() => liveCopy.copyToClipboard(liveUrl)}>
                {liveCopy.isCopied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{liveCopy.isCopied ? t('common.copied') : t('share.copyThreadLink')}
              </Button>
            ) : shareUrl ? (
              <Button onClick={() => snapshotCopy.copyToClipboard(shareUrl)}>{snapshotCopy.isCopied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{snapshotCopy.isCopied ? t('common.copied') : t('share.copyLink')}</Button>
            ) : (
              <Button onClick={createShare} disabled={loading}>{loading ? <Spinner data-icon="inline-start" /> : <Link data-icon="inline-start" />}{loading ? t('share.creating') : t('share.createLink')}</Button>
            )}
          </DialogFooter>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

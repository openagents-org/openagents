'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookmarkPlus, ExternalLink, Share2 } from 'lucide-react';
import { useGuestLinks } from '@/components/chat/guest-link-panel';
import { GuestLinkState } from '@/components/guest-thread/guest-link-state';
import { GuestThreadView } from '@/components/guest-thread/guest-thread-view';
import { useOwnerRoom } from '@/components/guest-thread/use-owner-room';
import { Button } from '@/components/ui/button';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { agentDisplayName } from '@/lib/guest-thread';
import { useT } from '@/lib/i18n';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { roomGuestLinksClient, roomToThreadInfo, threadPath } from '@/lib/share-room-api';
import { GuestLinkDialog } from './guest-link-dialog';
import { KeepConversationDialog, takeKeepIntent } from './keep-conversation-dialog';

/**
 * The owner link's single-room view: the shared thread as guests see it,
 * with the owner posting as "You", the guest link controls, and "Keep this
 * conversation" instead of the full workspace UI.
 */
export function OwnerRoom({ slug, token, navigate }: { slug: string; token: string; navigate?: (href: string) => void }) {
  const t = useT();
  const room = useOwnerRoom(slug, token);
  const { user, idToken, loading } = useOpenAgentsAuth();
  const [keepOpen, setKeepOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const data = room.room;
  const threadName = data?.thread.name ?? '';
  const claimed = !!data?.share?.claimed;
  const info = useMemo(() => (data ? roomToThreadInfo(data) : null), [data]);
  const linksClient = useMemo(() => roomGuestLinksClient(room.creds), [room.creds]);
  const guestLinks = useGuestLinks(threadName, room.status === 'ready' && !!threadName, linksClient);

  // Back from signing in to keep it: reopen the dialog on the choice step.
  useEffect(() => {
    if (loading || !user || !idToken || room.status !== 'ready' || claimed) return;
    if (takeKeepIntent(slug)) setKeepOpen(true);
  }, [loading, user, idToken, room.status, claimed, slug]);

  if (room.status === 'moved') {
    const href = room.movedTo ? threadPath(room.movedTo.slug, room.movedTo.channel) : null;
    return <GuestLinkState state="moved" variant="owner" movedHref={href} />;
  }
  if (room.status !== 'ready' || !info || !data) {
    return <GuestLinkState state={room.status === 'ready' ? 'loading' : room.status} variant="owner" onRetry={() => { void room.reload(); }} />;
  }

  const firstAgent = data.agents[0] ?? null;
  const primary = claimed ? (
    <Button size="sm" asChild data-owner-open="">
      <a href={threadPath(slug, threadName)}>
        <ExternalLink data-icon="inline-start" />
        <span className="hidden sm:inline">{t('shareRoom.openInWorkspace')}</span>
        <span className="sm:hidden">{t('shareRoom.open')}</span>
      </a>
    </Button>
  ) : (
    <Button size="sm" onClick={() => setKeepOpen(true)} data-owner-keep="">
      <BookmarkPlus data-icon="inline-start" />
      <span className="hidden sm:inline">{t('shareRoom.keep')}</span>
      <span className="sm:hidden">{t('shareRoom.keepShort')}</span>
    </Button>
  );
  // The workspace thread header's share button, opening the guest link controls.
  const headerActions = (
    <>
      <WithTooltip label={t('shareRoom.guestLinkButton')}>
        <Button variant="ghost" size="icon-sm" onClick={() => setLinkOpen(true)} aria-label={t('shareRoom.guestLinkButton')} data-owner-link-button="">
          <Share2 />
        </Button>
      </WithTooltip>
      {primary}
    </>
  );

  return (
    <>
      <GuestThreadView
        viewer="owner"
        info={info}
        messages={room.messages}
        hasOlder={room.hasOlder}
        olderState={room.olderState}
        onLoadOlder={room.loadOlder}
        sendTick={room.sendTick}
        send={room.send}
        retry={room.retry}
        headerActions={headerActions}
      />
      <GuestLinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        channel={threadName}
        agentName={firstAgent ? agentDisplayName(firstAgent) : null}
        links={guestLinks.links}
        error={guestLinks.error}
        setLinks={guestLinks.setLinks}
        client={linksClient}
      />
      {!claimed && (
        <KeepConversationDialog
          open={keepOpen}
          onOpenChange={setKeepOpen}
          network={slug}
          token={token}
          threadName={threadName}
          navigate={navigate}
        />
      )}
    </>
  );
}

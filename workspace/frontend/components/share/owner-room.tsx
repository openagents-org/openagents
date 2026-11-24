'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkPlus, ExternalLink, LayoutList, Share2, ShieldAlert } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { PinnedArtifact } from '@/lib/guest-thread-api';
import { DismissibleStrip, GuestPreviewDialog, OwnerPanel, SaveCard, guestPreviewUrl, useDismissed } from './owner-panel';
import { useGuestLinks } from '@/components/chat/guest-link-panel';
import { GuestLinkState } from '@/components/guest-thread/guest-link-state';
import { GuestThreadView } from '@/components/guest-thread/guest-thread-view';
import { useOwnerRoom } from '@/components/guest-thread/use-owner-room';
import { Button } from '@/components/ui/button';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { agentDisplayName } from '@/lib/guest-thread';
import { useT } from '@/lib/i18n';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { claimShare, pinRoomArtifact, roomGuestLinksClient, roomToThreadInfo, threadPath } from '@/lib/share-room-api';
import { liveLink } from '@/lib/guest-links';
import { roomResourceSource } from '@/lib/share-resources';
import { GuestLinkDialog, type GuestLinkSection } from './guest-link-dialog';
import { AddAgentDialog } from '@/components/guest-thread/add-agent-dialog';
import { KeepConversationDialog, takeKeepIntent } from './keep-conversation-dialog';

/**
 * The owner link's single-room view: the shared thread as guests see it,
 * with the owner posting as "You", the guest link controls, and "Keep this
 * conversation" instead of the full workspace UI.
 */
export function OwnerRoom({ slug, token, navigate }: { slug: string; token: string; navigate?: (href: string) => void }) {
  const t = useT();
  const { user, idToken, loading } = useOpenAgentsAuth();
  const idTokenRef = useRef(idToken);
  idTokenRef.current = idToken;
  const getIdToken = useCallback(() => idTokenRef.current, []);
  // A signed-in owner opens their room without the owner link's token.
  const room = useOwnerRoom(slug, token, { idToken: getIdToken, signedIn: !!user && !!idToken, ready: !loading });
  const [keepOpen, setKeepOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkFocus, setLinkFocus] = useState<GuestLinkSection | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [ownerSheetOpen, setOwnerSheetOpen] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [guestCount, setGuestCount] = useState<number | null>(null);
  const [savedHere, setSavedHere] = useState(false);
  const [phoneWarned, dismissPhoneWarning] = useDismissed(`oa-owner-warned:${slug}`);
  const [saveNudged, dismissSaveNudge] = useDismissed(`oa-owner-save-nudge:${slug}`);
  /** The artifact the owner has open, ahead of the server (guests see it open). */
  const [pinOverride, setPinOverride] = useState<PinnedArtifact | null | undefined>(undefined);
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pinTimer.current) clearTimeout(pinTimer.current); }, []);

  const data = room.room;
  const threadName = data?.thread.name ?? '';
  const claimed = !!data?.share?.claimed || savedHere;
  const kept = !!data?.share?.keptAsWorkspace;
  const linksClient = useMemo(() => roomGuestLinksClient(room.creds), [room.creds]);
  const resourceSource = useMemo(() => roomResourceSource(room.creds), [room.creds]);
  const guestLinks = useGuestLinks(threadName, room.status === 'ready' && !!threadName, linksClient);
  // The approval mode follows the link as changed in the dialog, before the room refreshes.
  const currentLink = guestLinks.links ? liveLink(guestLinks.links) : null;
  const info = useMemo(() => {
    if (!data) return null;
    const base = roomToThreadInfo(data);
    const withPin = pinOverride === undefined ? base : { ...base, pinnedArtifact: pinOverride };
    return currentLink ? { ...withPin, approvalMode: currentLink.approvalMode ?? 'none', guestsCanPost: currentLink.canPost } : withPin;
  }, [data, currentLink, pinOverride]);

  // How many guests there are (for the owner panel); again after the settings close.
  useEffect(() => {
    if (room.status !== 'ready' || !threadName || linkOpen || !linksClient.listGuests) return;
    let active = true;
    linksClient.listGuests(threadName)
      .then((list) => { if (active) setGuestCount(list.filter((g) => !g.removed).length); })
      .catch(() => {});
    return () => { active = false; };
  }, [room.status, threadName, linkOpen, linksClient]);

  // What the owner opens is what guests see open; settle quick open/close flips first.
  const changePin = useCallback((ref: PinnedArtifact | null) => {
    setPinOverride(ref);
    if (pinTimer.current) clearTimeout(pinTimer.current);
    pinTimer.current = setTimeout(() => { void pinRoomArtifact(room.creds, ref).catch(() => {}); }, 500);
  }, [room.creds]);

  // Back from signing in to keep it: reopen the dialog on the choice step.
  useEffect(() => {
    if (loading || !user || !idToken || room.status !== 'ready' || kept) return;
    if (takeKeepIntent(slug)) setKeepOpen(true);
  }, [loading, user, idToken, room.status, kept, slug]);

  if (room.status === 'moved') {
    const href = room.movedTo ? threadPath(room.movedTo.slug, room.movedTo.channel) : null;
    return <GuestLinkState state="moved" variant="owner" movedHref={href} />;
  }
  if (room.status !== 'ready' || !info || !data) {
    return <GuestLinkState state={room.status === 'ready' ? 'loading' : room.status} variant="owner" onRetry={() => { void room.reload(); }} />;
  }

  const firstAgent = data.agents[0] ?? null;
  const signedIn = !!user && !!idToken;
  const openSettings = (section: GuestLinkSection | null) => { setOwnerSheetOpen(false); setLinkFocus(section); setLinkOpen(true); };
  const openPreview = () => { setOwnerSheetOpen(false); setLinkOpen(false); setPreviewOpen(true); };
  // Signed in: one click saves it to their rooms. Signed out: the keep dialog asks to sign in first.
  const save = async () => {
    if (!signedIn || !idToken) { setOwnerSheetOpen(false); setKeepOpen(true); return; }
    try {
      await claimShare({ ...room.creds }, idToken);
      setSavedHere(true);
      void room.refresh();
    } catch {
      setKeepOpen(true);
    }
  };
  const ownerPanel = (
    <OwnerPanel link={currentLink} guestCount={guestCount} onOpenSettings={openSettings} onPreview={openPreview}
      saveCard={kept ? null : <SaveCard saved={claimed} signedIn={signedIn} onSave={() => void save()} />} />
  );
  // Phone: a one-time warning that this is the owner's link; then the save nudge (desktop shows both cards in the sidebar).
  const topBanner = (
    <>
      {!phoneWarned && (
        <DismissibleStrip tone="warning" icon={<ShieldAlert />} onDismiss={dismissPhoneWarning} className="lg:hidden" data-owner-phone-warning="">
          {t('shareRoom.phoneWarning')}
        </DismissibleStrip>
      )}
      {!claimed && !kept && !saveNudged && (
        <DismissibleStrip icon={<BookmarkPlus />} onDismiss={dismissSaveNudge} className={cn(!phoneWarned && 'max-lg:hidden')} data-owner-save-strip=""
          action={<Button size="xs" variant="outline" className="bg-background" onClick={() => void save()}>{signedIn ? t('shareRoom.saveToRoomsShort') : t('shareRoom.signInToSave')}</Button>}>
          <strong className="font-medium">{t('shareRoom.notSaved')}.</strong> {t('shareRoom.notSavedBody')}
        </DismissibleStrip>
      )}
    </>
  );
  const primary = kept ? (
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
      {/* Phone: the owner panel behind a visible "Owner" control. */}
      <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setOwnerSheetOpen(true)} data-owner-sheet-button="">
        <ShieldAlert data-icon="inline-start" />{t('shareRoom.ownerButton')}
      </Button>
      <WithTooltip label={t('shareRoom.guestLinkButton')}>
        <Button variant="ghost" size="icon-sm" className="max-lg:hidden" onClick={() => openSettings(null)} aria-label={t('shareRoom.guestLinkButton')} data-owner-link-button="">
          <Share2 />
        </Button>
      </WithTooltip>
      {user && (
        <WithTooltip label={t('rooms.myRooms')}>
          <Button variant="ghost" size="icon-sm" asChild className="max-lg:hidden" aria-label={t('rooms.myRooms')} data-owner-my-rooms="">
            <a href="/rooms"><LayoutList /></a>
          </Button>
        </WithTooltip>
      )}
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
        requests={room.requests}
        resourceSource={resourceSource}
        decisions={room.decisions}
        onDecide={room.decide}
        ownerPanel={ownerPanel}
        topBanner={topBanner}
        onPinChange={changePin}
        agentActions={{
          canAdd: true,
          onAdd: () => setAddAgentOpen(true),
          // Not the agent the room was shared for: turning the link off is how to stop that.
          canRemove: (agent) => agent.name !== data.agents[0]?.name,
          onRemove: room.removeAgent,
        }}
      />
      <AddAgentDialog open={addAgentOpen} onOpenChange={setAddAgentOpen} viewer="owner" firstAgent={firstAgent?.name ?? null} onAdd={room.addAgent} />
      <Sheet open={ownerSheetOpen} onOpenChange={setOwnerSheetOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] gap-0 overflow-y-auto rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" data-owner-sheet="">
          <SheetHeader className="p-0 pb-3">
            <SheetTitle>{t('shareRoom.ownerSheetTitle')}</SheetTitle>
            <SheetDescription className="sr-only">{t('shareRoom.ownerPageHelp')}</SheetDescription>
          </SheetHeader>
          {ownerPanel}
          {user && <Button variant="ghost" size="sm" asChild className="mt-2 self-start"><a href="/rooms"><LayoutList data-icon="inline-start" />{t('rooms.myRooms')}</a></Button>}
        </SheetContent>
      </Sheet>
      <GuestPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} url={currentLink ? guestPreviewUrl(currentLink.url) : null} inviteOnly={currentLink?.access === 'invited'} />
      <GuestLinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        channel={threadName}
        agentName={firstAgent ? agentDisplayName(firstAgent) : null}
        links={guestLinks.links}
        error={guestLinks.error}
        setLinks={guestLinks.setLinks}
        client={linksClient}
        focus={linkFocus}
        onPreview={currentLink ? openPreview : undefined}
      />
      {!kept && (
        <KeepConversationDialog
          open={keepOpen}
          onOpenChange={setKeepOpen}
          network={slug}
          token={token}
          threadName={threadName}
          navigate={navigate}
          saved={claimed}
          onSaved={() => { setSavedHere(true); void room.refresh(); }}
        />
      )}
    </>
  );
}

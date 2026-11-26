'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { AlertTriangle, Bot, Eye, Laptop, Lock, Menu, MessageSquare, PanelRight, Plus, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { STRIP as BANNER_STRIP } from '@/components/chat/chat-view-banners';
import { IntermediateSteps } from '@/components/chat/intermediate-steps';
import { ROSTER_TRIGGER, RosterList } from '@/components/chat/thread-roster-list';
import { WorkingBubble } from '@/components/chat/working-bubble';
import { filterThreadSteps, groupMessages, groupKey } from '@/components/chat/chat-message-groups';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { Spinner } from '@/components/ui/spinner';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { isControlMessage } from '@/lib/control-messages';
import { useFormatters, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { WorkspaceAgent, WorkspaceMessage } from '@/lib/types';
import type { GuestIdentity, GuestThreadAgent, GuestThreadInfo, PinnedArtifact } from '@/lib/guest-thread-api';
import {
  agentDisplayName,
  agentTypeLabel,
  composeOutgoing,
  defaultAskAgent,
  guestAvatarSeed,
  humanSeed,
  isOptimistic,
  newPendingSend,
  splitSeed,
  mentionsAgent,
  guestOf,
  threadPeople,
  toWorkspaceAgents,
  type ThreadPerson,
  type ThreadViewer,
} from '@/lib/guest-thread';
import { GuestComposer } from './guest-composer';
import { GuestMessageRow, PersonAvatar } from './guest-message-row';
import { GuestNameDialog } from './guest-name-dialog';
import type { DecideRequest } from './share-request-status';
import { ShareArtifactViewer, ShareResourceShelf, fileSelection, selectionKey, shareAttachmentSource, useFreshSelection, type ShareSelection } from './share-resources';
import { useShareResources } from './use-share-resources';
import type { ShareResourceSource, ShareResources } from '@/lib/share-resources';
import type { AttachmentSource } from '@/components/chat/message-attachments';
import { GuestRequestsBanner, type PendingGuestRequest } from '@/components/share/guest-requests-banner';
import { isReleasedCopy, isShareNotice, requestDecisions, requestStatus, shareRequestOf, type ShareRequestStatus } from '@/lib/share-requests';
import type { SendResult } from './use-guest-thread';

/** How long after asking an agent we keep showing "working…" with no reply. */
const WORKING_WINDOW_MS = 10 * 60 * 1000;

interface GuestThreadViewProps {
  info: GuestThreadInfo;
  messages: WorkspaceMessage[];
  hasOlder: boolean;
  olderState?: 'idle' | 'loading' | 'error';
  onLoadOlder?: () => void;
  /** Who is looking: a guest (default) or the share's owner in the owner page. */
  viewer?: 'guest' | 'owner';
  guest?: GuestIdentity | null;
  nameRequest?: { reason: 'first-post' | 'session-expired' } | null;
  sendTick: number;
  send: (pending: ReturnType<typeof newPendingSend>) => SendResult;
  retry: (localId: string) => void;
  join?: (name: string) => Promise<unknown>;
  cancelName?: () => void;
  /** Buttons at the end of the thread header (owner: guest link, "Keep this conversation"; guest: "Continue in my workspace"). */
  headerActions?: ReactNode;
  /** Owner page: guests' requests waiting (a strip under the status banner). */
  requests?: PendingGuestRequest[];
  /** Owner page: decisions recorded here, before the thread's notice arrives. */
  decisions?: Record<string, ShareRequestStatus>;
  /** Owner page: approve or decline a held guest request. */
  onDecide?: DecideRequest;
  /** Where the thread's artifacts, routines and attachment bytes come from (guest link or owner page). */
  resourceSource?: ShareResourceSource | null;
  /** Guest page: the owner removed this guest; they can still read. */
  removed?: boolean;
  /** Owner page: the owner's panel at the top of the sidebar (and its phone sheet). */
  ownerPanel?: ReactNode;
  /** A strip at the top of the conversation (owner page: "not saved yet", phone warning). */
  topBanner?: ReactNode;
  /** Owner page: the artifact the owner opens is open for guests (null = closed). */
  onPinChange?: (ref: PinnedArtifact | null) => void;
  /** Guest page: where "I closed the owner's artifact" is remembered (sessionStorage). */
  pinStorageKey?: string;
  /** Guest page in the owner's preview: read only, nothing posts. */
  preview?: boolean;
  /** Add or remove the jam's agents (owner: theirs; guest: their own, when allowed). */
  agentActions?: AgentActions;
}

/** Was the owner's open artifact closed by this guest (this tab, this link)? */
function pinClosed(key?: string): boolean {
  if (!key) return false;
  try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
}
function setPinClosed(key: string | undefined, closed: boolean) {
  if (!key) return;
  try { if (closed) sessionStorage.setItem(key, '1'); else sessionStorage.removeItem(key); } catch { /* ignore */ }
}

/** The shelf's entry for a pinned artifact, once the thread's resources have it. */
function selectionForPin(pin: PinnedArtifact | null | undefined, resources: ShareResources): ShareSelection | null {
  if (!pin) return null;
  if (pin.kind === 'file') {
    const file = resources.files.find((f) => f.id === pin.id);
    return file ? fileSelection(file) : null;
  }
  const tab = resources.browsers.find((b) => b.id === pin.id);
  return tab ? { kind: 'browser', id: tab.id, title: tab.title, url: tab.url } : null;
}

/**
 * The shared thread in the workspace's shell: the sidebar on the app
 * background, the conversation in the inset card (header, banners, messages,
 * composer). On a phone: the workspace's mobile top bar, the sidebar in a sheet.
 */
export function GuestThreadView({ info, messages, hasOlder, olderState = 'idle', onLoadOlder, viewer = 'guest', guest = null, nameRequest = null, sendTick, send, retry, join, cancelName, headerActions, requests, decisions, onDecide, resourceSource = null, removed = false, ownerPanel, topBanner, onPinChange, pinStorageKey, preview = false, agentActions }: GuestThreadViewProps) {
  const t = useT();
  const isOwner = viewer === 'owner';
  const threadViewer = useMemo<ThreadViewer>(
    () => ({ guestId: guest?.id ?? null, isOwner, ownerName: info.owner.name }),
    [guest?.id, isOwner, info.owner.name],
  );
  const title = info.thread.title || info.thread.name;
  const agents = useMemo(() => toWorkspaceAgents(info.agents), [info.agents]);
  const agentNames = useMemo(() => agents.map((a) => a.agentName), [agents]);
  const agentLabels = useMemo(() => Object.fromEntries(info.agents.map((a) => [a.name, agentDisplayName(a)])), [info.agents]);
  const people = useMemo(() => threadPeople(messages, info.owner.name, guest, isOwner), [messages, info.owner.name, guest, isOwner]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState('');
  // The owner can stop guests asking the agent: their messages are comments then.
  const asksOff = info.approvalMode === 'off';
  const guestAsksOff = asksOff && !isOwner;
  // Ask is on by default: always for the owner (it's their agent), with one agent for guests.
  const askByDefault = (list: GuestThreadAgent[]) => !guestAsksOff && (isOwner ? list.length > 0 : defaultAskAgent(list));
  const [askAgent, setAskAgentState] = useState<string | null>(() => (askByDefault(info.agents) ? info.agents[0].name : null));
  const askTouched = useRef(false);
  const setAskAgent = (name: string | null) => { askTouched.current = true; setAskAgentState(name); };
  useEffect(() => { if (guestAsksOff) setAskAgentState(null); }, [guestAsksOff]);
  // The agent list can arrive (or come back) after the first render: turn the default on then.
  useEffect(() => {
    if (!askTouched.current && !askAgent && askByDefault(info.agents)) setAskAgentState(info.agents[0].name);
  }, [info.agents]); // eslint-disable-line react-hooks/exhaustive-deps

  // The chip can't point at an agent that left the thread.
  useEffect(() => {
    if (askAgent && !info.agents.some((a) => a.name === askAgent)) setAskAgentState(null);
  }, [askAgent, info.agents]);

  useEffect(() => {
    document.title = `${title} · ${info.workspace.name}`;
  }, [title, info.workspace.name]);

  const statusAgent = info.agents.find((a) => a.name === askAgent) ?? info.agents[0] ?? null;
  const needsApproval = info.approvalMode === 'owner';
  const guestsCanPost = info.guestsCanPost ?? info.canPost;
  // On a phone the waiting-requests strip carries the agent's state too, so
  // two strips don't stack: an offline agent shows as its lead, all-well hides.
  const waiting = onDecide && requests && requests.length > 0 ? requests : null;
  const offline = !!statusAgent && !statusAgent.online;
  const statusFolds = !!waiting && (!!statusAgent && (offline || statusAgent.acceptsGuests !== false));
  const identity = isOwner
    ? { name: info.owner.name, seed: humanSeed(info.owner.name), role: t('shareJam.ownerYou') }
    : guest ? { name: guest.name, seed: guestAvatarSeed(guest.id), role: t('guestThread.guestBadge') } : null;

  // The thread's artifacts and routines, re-read when an agent posts (it may have made a file).
  const agentPosts = useMemo(() => messages.filter((m) => m.senderType === 'agent').length, [messages]);
  const resources = useShareResources(resourceSource, agentPosts);
  const [selection, setSelection] = useState<ShareSelection | null>(null);
  const openSelection = useFreshSelection(selection, resources);
  const wide = useWideLayout();
  const pin = info.pinnedArtifact ?? null;
  const pinKey = pin ? `${pin.kind}:${pin.id}` : '';
  const pinnedSelection = selectionForPin(pin, resources);
  // Someone opens or closes an artifact. The owner's choice is what guests see open.
  const openArtifact = (next: ShareSelection) => {
    setSelection(next);
    if (isOwner) onPinChange?.({ kind: next.kind, id: next.id });
    else setPinClosed(pinStorageKey, false);
  };
  const closeArtifact = () => {
    setSelection(null);
    if (isOwner) onPinChange?.(null);
    else setPinClosed(pinStorageKey, true);
  };
  const openRef = useRef(openArtifact);
  openRef.current = openArtifact;
  const attachmentSource = useMemo(() => (resourceSource ? shareAttachmentSource(resourceSource, (next) => openRef.current(next)) : undefined), [resourceSource]);
  // The owner's open artifact opens here too (desktop only; on a phone a banner offers it).
  // The owner gets it back on load; a guest also when it changes, unless they closed it.
  const appliedPin = useRef<string | null>(null);
  useEffect(() => {
    if (!resourceSource || !wide || appliedPin.current === pinKey) return;
    if (!pinKey) { appliedPin.current = pinKey; return; }
    if (!pinnedSelection) return; // wait for the shelf to know it
    const first = appliedPin.current === null;
    appliedPin.current = pinKey;
    if (isOwner) { if (first) setSelection((prev) => prev ?? pinnedSelection); return; }
    if (pinClosed(pinStorageKey)) return;
    setSelection(pinnedSelection);
  }, [pinKey, pinnedSelection?.id, wide, resourceSource]); // eslint-disable-line react-hooks/exhaustive-deps
  const showPinBanner = !isOwner && !wide && !!pinnedSelection && selectionKey(openSelection) !== pinKey;
  const guestsSeeOpen = isOwner && !!openSelection && selectionKey(openSelection) === pinKey;

  const handleSubmit = () => {
    const content = composeOutgoing(draft, !!askAgent, askAgent);
    if (!content) return;
    const result = send(newPendingSend(content));
    if (result === 'sent') setDraft('');
  };

  const handleJoin = async (name: string) => {
    if (!join) return;
    const delivered = await join(name);
    if (delivered) setDraft('');
  };

  const sidebar = (
    <ShareSidebar
      workspaceName={info.workspace.name}
      subtitle={isOwner ? t('shareJam.yourShare') : t('guestThread.guestWorkspace')}
      title={title}
      agents={info.agents}
      people={people}
      identity={identity}
      expiresAt={isOwner ? undefined : info.expiresAt}
      ownerPanel={ownerPanel}
      agentActions={agentActions}
      notice={isOwner ? t('shareJam.ownerNotice') : removed ? t('guestThread.removedNotice') : info.canPost ? t('guestThread.guestNotice') : t('guestThread.readOnlyNotice')}
    />
  );

  return (
    <SidebarProvider
      open
      onOpenChange={() => {}}
      className="h-dvh min-h-0 bg-background lg:bg-sidebar"
      // A little wider with the owner's sharing block, so its lines read in full.
      style={{ '--sidebar-width': ownerPanel ? '17rem' : '15rem' } as React.CSSProperties}
    >
      <Sidebar collapsible="none" className="hidden h-full shrink-0 lg:flex" aria-label={info.workspace.name}>
        {sidebar}
      </Sidebar>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:py-2 lg:pe-2">
        {/* Phone: the workspace's mobile top bar — menu, logo, workspace name. */}
        <div className="flex shrink-0 items-center gap-2 border-b bg-background/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-sm lg:hidden" data-share-mobile-bar="">
          <div className="flex h-14 min-w-0 flex-1 items-center gap-2">
            <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => setMenuOpen(true)} aria-label={t('guestThread.detailsTitle')}>
              <Menu />
            </Button>
            <Logo size={24} />
            <span className="min-w-0 truncate text-sm font-medium">{info.workspace.name}</span>
          </div>
          {identity && <PersonAvatar seed={identity.seed} className="size-8" />}
        </div>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background lg:rounded-xl lg:border">
          <header className="flex h-12 min-w-0 shrink-0 items-center gap-1 border-b px-2 sm:gap-1.5 sm:px-4">
            <div className="flex w-0 flex-1 items-center gap-1">
              <h1 className="font-heading min-w-0 truncate px-1 text-base font-medium text-foreground" title={title}>{title}</h1>
              <ThreadCounters agents={info.agents} people={people} />
              {info.access === 'invited' && (
                <Badge variant="secondary" className="hidden shrink-0 gap-1 sm:inline-flex" data-invite-only-badge="">
                  <Lock aria-hidden="true" />{t('guestThread.inviteOnlyBadge')}
                </Badge>
              )}
            </div>
            {headerActions && (
              <div role="toolbar" aria-label={title} className="ml-auto flex shrink-0 items-center gap-1">
                {headerActions}
              </div>
            )}
          </header>

          <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {topBanner}
          {showPinBanner && pinnedSelection && (
            <Alert role="status" className={cn(BANNER_STRIP, 'bg-primary/5')} data-pin-banner="">
              <PanelRight />
              <AlertDescription className="flex min-w-0 items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{t('guestThread.ownerShowing', { owner: info.owner.name, name: pinnedSelection.kind === 'file' ? pinnedSelection.name : pinnedSelection.title })}</span>
                <Button size="xs" variant="outline" onClick={() => openArtifact(pinnedSelection)} data-pin-banner-open="">{t('guestThread.ownerShowingOpen')}</Button>
              </AlertDescription>
            </Alert>
          )}
          {statusAgent && <AgentStatusBanner agent={statusAgent} ownerName={info.owner.name} isOwner={isOwner} canPost={info.canPost && !removed} guestsCanPost={guestsCanPost} needsApproval={needsApproval} asksOff={asksOff} className={statusFolds ? 'max-sm:hidden' : undefined} />}
          {waiting && onDecide && (
            <GuestRequestsBanner
              requests={waiting}
              onDecide={onDecide}
              lead={statusFolds && offline && statusAgent ? `${agentDisplayName(statusAgent)} · ${t('guestThread.offline')}` : null}
            />
          )}

          {resourceSource && (
            <ShareResourceShelf resources={resources} agents={info.agents} source={resourceSource} selected={openSelection}
              onOpen={(next) => (selectionKey(openSelection) === selectionKey(next) ? closeArtifact() : openArtifact(next))} />
          )}

          <GuestMessageList
            attachmentSource={attachmentSource}
            info={info}
            messages={messages}
            hasOlder={hasOlder}
            olderState={olderState}
            onLoadOlder={onLoadOlder}
            agents={agents}
            agentNames={agentNames}
            agentLabels={agentLabels}
            viewer={threadViewer}
            sendTick={sendTick}
            onRetry={retry}
            decisions={decisions}
            onDecide={onDecide}
          />

          {/* Same reading width as the workspace's composer at its widest. */}
          <div className="mx-auto w-full max-w-6xl shrink-0 px-3 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:px-5 lg:pb-3">
            {preview ? (
              <div className="flex flex-col gap-2" data-guest-preview="">
                <Alert role="note" className="border-primary/30 bg-primary/5">
                  <Eye />
                  <AlertDescription className="text-foreground">{t('guestThread.previewBar')}</AlertDescription>
                </Alert>
                <div className="pointer-events-none opacity-50" aria-hidden="true">
                  <GuestComposer agents={info.agents} askAgent={askAgent} onAskAgentChange={() => {}} draft="" onDraftChange={() => {}} onSubmit={() => {}}
                    askBlocked={guestAsksOff && statusAgent ? t('guestThread.askDisabled', { owner: info.owner.name, agent: agentDisplayName(statusAgent) }) : null} />
                </div>
              </div>
            ) : removed ? (
              <Alert role="note" className="bg-muted/40" data-guest-removed-notice="">
                <AlertDescription>{t('guestThread.removedNotice')}</AlertDescription>
              </Alert>
            ) : info.canPost ? (
              <GuestComposer
                agents={info.agents}
                askAgent={askAgent}
                onAskAgentChange={setAskAgent}
                draft={draft}
                onDraftChange={setDraft}
                onSubmit={handleSubmit}
                approvalOwner={needsApproval && !isOwner ? info.owner.name : null}
                askBlocked={guestAsksOff && statusAgent ? t('guestThread.askDisabled', { owner: info.owner.name, agent: agentDisplayName(statusAgent) }) : null}
              />
            ) : (
              <Alert role="note" className="bg-muted/40">
                <AlertDescription>{t('guestThread.readOnlyNotice')}</AlertDescription>
              </Alert>
            )}
          </div>
          </div>
          {/* Desktop: the artifact beside the conversation, as the workspace's preview panel. */}
          {resourceSource && openSelection && wide && (
            <aside className="flex w-[min(46%,720px)] min-w-80 shrink-0 flex-col border-l" aria-label={t('artifactPanel.title')} data-share-artifact-panel="">
              <ShareArtifactViewer source={resourceSource} selection={openSelection} onClose={closeArtifact}
                {...(isOwner && onPinChange ? { guestsSee: guestsSeeOpen, onGuestsSeeChange: (see: boolean) => onPinChange(see ? { kind: openSelection.kind, id: openSelection.id } : null) } : {})} />
            </aside>
          )}
          </div>
        </main>
      </div>

      {/* Phone: the artifact in a sheet over the conversation. */}
      {resourceSource && !wide && (
        <Sheet open={!!openSelection} onOpenChange={(open) => { if (!open) closeArtifact(); }}>
          <SheetContent side="bottom" showCloseButton={false} className="h-[88dvh] gap-0 rounded-t-xl p-0 pb-[env(safe-area-inset-bottom)] data-[side=bottom]:h-[88dvh]">
            <SheetHeader className="sr-only">
              <SheetTitle>{openSelection ? (openSelection.kind === 'file' ? openSelection.name : openSelection.title) : t('artifactPanel.title')}</SheetTitle>
              <SheetDescription>{t('artifactPanel.title')}</SheetDescription>
            </SheetHeader>
            {openSelection && <ShareArtifactViewer source={resourceSource} selection={openSelection} onClose={closeArtifact}
                {...(isOwner && onPinChange ? { guestsSee: guestsSeeOpen, onGuestsSeeChange: (see: boolean) => onPinChange(see ? { kind: openSelection.kind, id: openSelection.id } : null) } : {})} />}
          </SheetContent>
        </Sheet>
      )}

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-70 gap-0 bg-sidebar p-0 pt-[env(safe-area-inset-top)] text-sidebar-foreground">
          <SheetHeader className="sr-only">
            <SheetTitle>{t('guestThread.detailsTitle')}</SheetTitle>
            <SheetDescription>{info.workspace.name} / {title}</SheetDescription>
          </SheetHeader>
          <SheetBody className="flex min-h-0 flex-1 flex-col p-0">{sidebar}</SheetBody>
        </SheetContent>
      </Sheet>

      {!isOwner && cancelName && (
        <GuestNameDialog open={!!nameRequest} reason={nameRequest?.reason ?? null} onJoin={handleJoin} onCancel={cancelName} />
      )}
    </SidebarProvider>
  );
}

function Logo({ size }: { size: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden" style={{ width: size, height: size }}>
      <Image src="/logo-black.png" alt="OpenAgents" width={size} height={size} className="size-full object-contain dark:hidden" />
      <Image src="/logo-white.png" alt="" width={size} height={size} className="hidden size-full object-contain dark:block" />
    </span>
  );
}

// ── Sidebar ──

/** The workspace sidebar, cut down to this one thread: brand, the thread,
 * its agents and people, and who you are. */
/** What the viewer may do with the jam's agents (add one; remove some). */
export interface AgentActions {
  canAdd: boolean;
  onAdd: () => void;
  canRemove: (agent: GuestThreadAgent) => boolean;
  onRemove: (name: string) => Promise<void>;
}

/** One agent in the sidebar: who brought it, and a remove that asks once more. */
function AgentRow({ agent, rowClass, onRemove }: { agent: GuestThreadAgent; rowClass: string; onRemove?: () => Promise<void> }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);
  const remove = async () => {
    if (!onRemove) return;
    if (!confirming) { setConfirming(true); return; }
    setBusy(true); setFailed(false);
    try { await onRemove(); } catch { setFailed(true); } finally { setBusy(false); setConfirming(false); }
  };
  const name = agentDisplayName(agent);
  return (
    <SidebarMenuItem className="group/agent" data-agent-row={agent.name}>
      <SidebarMenuButton asChild className={cn(rowClass, agent.broughtBy && 'h-auto py-1', onRemove && 'pr-8')}>
        <div title={agent.online ? t('guestThread.online') : t('guestThread.offline')}>
          <AgentAvatar name={agent.name} size={20} showStatus status={agent.online ? 'online' : 'offline'} className="[&_svg]:size-full!" />
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate">{name}</span>
            {agent.broughtBy && <span className="truncate text-xs text-muted-foreground" data-agent-brought-by="">{t('jamAgents.broughtBy', { name: agent.broughtBy })}</span>}
            {failed && <span className="truncate text-xs text-destructive" role="alert">{t('jamAgents.removeFailed')}</span>}
          </span>
          {!agent.online && !onRemove && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{t('guestThread.offline')}</span>}
        </div>
      </SidebarMenuButton>
      {onRemove && (confirming ? (
        <Button size="xs" variant="destructive" className="absolute top-1/2 right-1 h-6 -translate-y-1/2 px-2 text-xs" disabled={busy} onClick={() => void remove()} data-agent-remove-confirm={agent.name}>
          {busy ? <Spinner /> : t('jamAgents.removeConfirm')}
        </Button>
      ) : (
        <WithTooltip label={t('jamAgents.remove', { name })}>
          <SidebarMenuAction showOnHover className="[@media(hover:none)]:opacity-100" aria-label={t('jamAgents.remove', { name })} onClick={() => void remove()} data-agent-remove={agent.name}>
            <X />
          </SidebarMenuAction>
        </WithTooltip>
      ))}
    </SidebarMenuItem>
  );
}

function ShareSidebar({ workspaceName, subtitle, title, agents, people, identity, expiresAt, notice, ownerPanel, agentActions }: {
  workspaceName: string;
  subtitle: string;
  title: string;
  agents: GuestThreadAgent[];
  people: ThreadPerson[];
  identity: { name: string; seed: string; role: string } | null;
  /** Guests: when the link stops working (null = never). */
  expiresAt?: string | null;
  /** What this viewer can do here. */
  notice: string;
  /** Owner page: the owner's panel, above the thread. */
  ownerPanel?: ReactNode;
  agentActions?: AgentActions;
}) {
  const t = useT();
  const { formatDateTime } = useFormatters();
  const online = agents.filter((a) => a.online).length;
  // Rows aren't links here: no hover highlight.
  const row = 'cursor-default hover:bg-transparent active:bg-transparent';
  return (
    <div className="flex h-full min-h-0 w-full flex-col" data-share-sidebar="">
      <SidebarHeader className="px-1.5 pt-3 pb-0">
        <div className="flex h-8 w-full items-center gap-2 p-1.5">
          <Logo size={20} />
          <span className="min-w-0 flex-1 truncate text-base font-semibold" title={workspaceName}>{workspaceName}</span>
        </div>
        <p className="truncate px-2 text-xs text-muted-foreground">{subtitle}</p>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-1.5">
          <SidebarGroupLabel className="px-2">{t('guestThread.threads')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive className="cursor-default">
                  <div aria-current="page">
                    <MessageSquare />
                    <span className="truncate">{title}</span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="px-3"><Separator /></div>
        <SidebarGroup className="px-1.5">
          {/* Laid out as the workspace's agents header: the label, then "+" to add one. */}
          <div className="flex items-center">
            <SidebarGroupLabel className="min-w-0 flex-1 px-2">{t('nav.agentsWithCount', { online, total: agents.length })}</SidebarGroupLabel>
            {agentActions?.canAdd && (
              <WithTooltip label={t('jamAgents.add')}>
                <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label={t('jamAgents.add')} onClick={agentActions.onAdd} data-add-agent-button="">
                  <Plus />
                </Button>
              </WithTooltip>
            )}
          </div>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {agents.map((agent) => (
                <AgentRow key={agent.name} agent={agent} rowClass={row}
                  onRemove={agentActions?.canRemove(agent) ? () => agentActions.onRemove(agent.name) : undefined} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="px-3"><Separator /></div>
        <SidebarGroup className="px-1.5">
          <SidebarGroupLabel className="px-2">{t('guestThread.membersHeading', { count: people.length })}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {people.map((person) => (
                <SidebarMenuItem key={person.key}>
                  <SidebarMenuButton asChild className={row}>
                    <div>
                      <PersonAvatar seed={person.avatarSeed} />
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="truncate">{person.name}</span>
                        {person.isSelf && <span className="shrink-0 text-xs text-muted-foreground">({t('guestThread.you')})</span>}
                      </span>
                      {person.role !== 'member' && (
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {person.role === 'owner' ? t('guestThread.ownerBadge') : t('guestThread.guestBadge')}
                        </span>
                      )}
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-1 px-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {/* Owner page: the sharing settings, at hand above who you are. */}
        {ownerPanel && <div className="px-1.5 pb-1" data-owner-panel-slot="">{ownerPanel}</div>}
        <p className="px-2 text-xs text-muted-foreground lg:hidden" data-share-notice="">{notice}</p>
        {expiresAt !== undefined && (
          <p className="px-2 text-xs text-muted-foreground" data-guest-link-expiry="">
            {expiresAt ? t('guestThread.expiresOn', { date: formatDateTime(expiresAt) }) : t('guestThread.noExpiry')}
          </p>
        )}
        {identity && (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg" className={row}>
                <div data-share-identity="">
                  <PersonAvatar seed={identity.seed} className="size-8" />
                  <span className="grid min-w-0 flex-1 leading-tight">
                    <span className="truncate font-medium">{identity.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{identity.role}</span>
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>
    </div>
  );
}

// ── Header ──

/** The workspace thread header's people / agents counters, each opening its list. */
function ThreadCounters({ agents, people }: { agents: GuestThreadAgent[]; people: ThreadPerson[] }) {
  const t = useT();
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5" data-thread-counters="">
      <Popover>
        <WithTooltip label={t('header.viewPeople', { count: people.length })}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className={ROSTER_TRIGGER} aria-label={t('header.viewPeople', { count: people.length })}>
              <Users aria-hidden="true" />
              <span>{people.length}</span>
            </Button>
          </PopoverTrigger>
        </WithTooltip>
        <PopoverContent align="start" aria-label={t('header.threadPeople')}>
          <RosterList
            title={t('header.threadPeople')}
            empty={t('header.noThreadPeople')}
            items={people.map((person) => ({
              key: person.key,
              media: <PersonAvatar seed={person.avatarSeed} />,
              title: person.isSelf ? `${person.name} (${t('guestThread.you')})` : person.name,
              description: person.role === 'owner' ? t('guestThread.ownerBadge') : person.role === 'guest' ? t('guestThread.guestBadge') : undefined,
            }))}
            add={null}
          />
        </PopoverContent>
      </Popover>
      <Popover>
        <WithTooltip label={t('header.viewAgents', { count: agents.length })}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className={ROSTER_TRIGGER} aria-label={t('header.viewAgents', { count: agents.length })}>
              <Bot aria-hidden="true" />
              <span>{agents.length}</span>
            </Button>
          </PopoverTrigger>
        </WithTooltip>
        <PopoverContent align="start" aria-label={t('header.threadAgents')}>
          <RosterList
            title={t('header.threadAgents')}
            empty={t('header.noThreadAgents')}
            items={agents.map((agent) => ({
              key: agent.name,
              media: <AgentAvatar name={agent.name} size={28} showStatus status={agent.online ? 'online' : 'offline'} />,
              title: agentDisplayName(agent),
              // The name is the handle; the runtime ("Claude Code") is the secondary label.
              description: [agent.broughtBy ? t('jamAgents.broughtBy', { name: agent.broughtBy }) : null, agentTypeLabel(agent.type), agent.online ? t('guestThread.online') : t('guestThread.offline')].filter(Boolean).join(' · '),
            }))}
            add={null}
          />
        </PopoverContent>
      </Popover>
    </span>
  );
}

/**
 * Where the agent runs and what this viewer can do, as a workspace thread
 * banner: a quiet strip while all is well, a warning when the agent can't answer.
 */
function AgentStatusBanner({ agent, ownerName, isOwner, canPost, guestsCanPost, needsApproval, asksOff, className }: { agent: GuestThreadAgent; ownerName: string; isOwner: boolean; canPost: boolean; guestsCanPost: boolean; needsApproval: boolean; asksOff: boolean; className?: string }) {
  const t = useT();
  const params = { agent: agentDisplayName(agent), owner: ownerName };
  const warning = !agent.online || agent.acceptsGuests === false;
  const status = isOwner
    ? !agent.online ? t('shareJam.offlineNotice', params) : agent.acceptsGuests === false ? t('shareJam.noGuestRuns', params) : t('shareJam.runsOn', params)
    : !agent.online ? t('guestThread.offlineNotice', params) : agent.acceptsGuests === false ? t('guestThread.noGuestRuns', params) : t('guestThread.runsOn', params);
  const notice = isOwner
    ? (!guestsCanPost ? t('shareJam.ownerReadOnlyNotice') : asksOff ? t('shareJam.ownerAgentOffNotice', params) : needsApproval ? t('shareJam.ownerApprovalNotice') : t('shareJam.ownerNotice'))
    : !canPost ? null : asksOff ? t('guestThread.agentOffNotice', params) : needsApproval ? t('guestThread.approvalNotice', params) : t('guestThread.guestNotice');
  // On a phone the rule for guests' requests (it changes what a message does) wins the one line.
  const approvalFirst = (needsApproval || asksOff || (isOwner && !guestsCanPost)) && !warning && !!notice;
  return (
    <Alert
      role="status"
      data-agent-status={warning ? 'warning' : 'ok'}
      className={cn(BANNER_STRIP, warning ? 'border-warning/30 bg-warning/10 text-warning' : 'bg-muted/30 text-muted-foreground', className)}
    >
      {warning ? <AlertTriangle /> : <Laptop />}
      <AlertDescription className={cn('flex flex-wrap items-center gap-x-1.5 text-xs', warning ? 'text-warning' : 'text-muted-foreground')}>
        {/* On a phone the strip stays one line: the approval rule when all is
            well (it changes what a request does), else the agent's state; the
            sidebar sheet repeats the notice. */}
        <span className={cn('font-medium', !warning && 'text-foreground/80', approvalFirst && 'max-sm:hidden')}>{status}</span>
        {notice && <><span aria-hidden="true" className="hidden sm:inline">·</span><span className={approvalFirst ? undefined : 'hidden sm:inline'}>{notice}</span></>}
      </AlertDescription>
    </Alert>
  );
}

// ── Message list ──

function GuestMessageList({ info, messages, hasOlder, olderState, onLoadOlder, agents, agentNames, agentLabels, viewer, sendTick, onRetry, decisions, onDecide, attachmentSource }: {
  info: GuestThreadInfo;
  messages: WorkspaceMessage[];
  hasOlder: boolean;
  olderState: 'idle' | 'loading' | 'error';
  onLoadOlder?: () => void;
  agents: WorkspaceAgent[];
  agentNames: string[];
  agentLabels: Record<string, string>;
  viewer: ThreadViewer;
  sendTick: number;
  onRetry: (localId: string) => void;
  decisions?: Record<string, ShareRequestStatus>;
  onDecide?: DecideRequest;
  attachmentSource?: AttachmentSource;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const firstScrollRef = useRef(true);
  /** Set just before an earlier page is requested; restores the reading position after it lands. */
  const anchorRef = useRef<{ height: number; top: number } | null>(null);

  const { seed, groups } = useMemo(() => {
    // An approved request's copy re-posted for the agent shows as "Approved" on the original.
    const visible = messages.filter((m) => !isControlMessage(m) && m.messageType !== 'loading' && !isReleasedCopy(m));
    const split = splitSeed(visible);
    return { seed: split.seed, groups: groupMessages(filterThreadSteps(split.rest)) };
  }, [messages]);

  const seedAgent = useMemo(() => {
    const names = new Set(seed.filter((m) => m.senderType === 'agent').map((m) => m.senderName));
    return info.agents.find((a) => names.has(a.name)) ?? info.agents[0] ?? null;
  }, [seed, info.agents]);
  const seedAgentType = agentTypeLabel(seedAgent?.type) ?? (seedAgent ? agentDisplayName(seedAgent) : null);

  const seen = useMemo(() => requestDecisions(messages), [messages]);
  const statusOf = (message: WorkspaceMessage): ShareRequestStatus | undefined => {
    const req = shareRequestOf(message);
    return req ? requestStatus(req, decisions, seen) : undefined;
  };
  const guestAsksOff = info.approvalMode === 'off';
  const working = useMemo(() => workingAgent(groups, info.agents, (m) => {
    const req = shareRequestOf(m);
    return req ? requestStatus(req, decisions, seen) : undefined;
  }, guestAsksOff), [groups, info.agents, decisions, seen, guestAsksOff]);
  const lastKey = groups.length ? groupKey(groups[groups.length - 1]) : '';
  const firstKey = seed[0]?.messageId ?? (groups.length ? groupKey(groups[0]) : '');

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const anchor = anchorRef.current;
    if (anchor && el.scrollHeight !== anchor.height) {
      // Earlier messages were prepended: keep the same message under the eye.
      el.scrollTop = el.scrollHeight - anchor.height + anchor.top;
      anchorRef.current = null;
      return;
    }
    if (firstScrollRef.current || nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      firstScrollRef.current = false;
    }
  }, [firstKey, lastKey, seed.length, working]);

  const loadOlder = () => {
    const el = containerRef.current;
    if (!onLoadOlder || olderState === 'loading') return;
    if (el) anchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
    onLoadOlder();
  };
  // Runs after the layout effect above: once a load settles there is nothing left to restore.
  useEffect(() => { if (olderState !== 'loading') anchorRef.current = null; }, [olderState]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el && sendTick > 0) el.scrollTop = el.scrollHeight;
  }, [sendTick]);

  const row = (message: WorkspaceMessage, live: boolean) => isShareNotice(message) ? (
    // A system line, as the workspace marks thread events.
    <Marker key={message.messageId} className="justify-center py-1" data-share-notice={message.messageId}>
      <MarkerContent className="text-xs">{message.content}</MarkerContent>
    </Marker>
  ) : (
    <GuestMessageRow
      key={message.messageId}
      message={message}
      agents={agents}
      agentNames={agentNames}
      agentLabels={agentLabels}
      currentGuestId={viewer.guestId}
      viewer={viewer}
      showTime={live}
      showAudience={live}
      onRetry={onRetry}
      requestStatus={statusOf(message)}
      onDecide={onDecide}
      ownerName={info.owner.name}
      attachmentSource={attachmentSource}
    />
  );

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        // Reaching the top loads the next earlier page (not after a failure: the button retries).
        if (el.scrollTop < 80 && hasOlder && olderState === 'idle' && !firstScrollRef.current) loadOlder();
      }}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-3 outline-none lg:px-8"
      aria-live="polite"
      aria-relevant="additions"
    >
      <div className="mx-auto w-full max-w-6xl">
        {hasOlder && (
          <div className="flex flex-col items-center gap-1 py-2" data-guest-load-earlier="">
            <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={olderState === 'loading' || !onLoadOlder} onClick={loadOlder}>
              {olderState === 'loading' && <Spinner data-icon="inline-start" />}
              {olderState === 'loading' ? t('guestThread.loadingEarlier') : t('guestThread.loadEarlier')}
            </Button>
            {olderState === 'error' && <p className="text-xs text-destructive" role="alert">{t('guestThread.loadEarlierFailed')}</p>}
          </div>
        )}
        {seed.length > 0 && (
          <section aria-label={t('guestThread.seedDividerNoAgent', { owner: info.owner.name })}>
            {/* A system divider, as the workspace marks thread events. */}
            <Marker variant="separator" className="py-2">
              <MarkerContent className="text-xs">
                {seedAgentType
                  ? t('guestThread.seedDivider', { owner: info.owner.name, agent: seedAgentType })
                  : t('guestThread.seedDividerNoAgent', { owner: info.owner.name })}
              </MarkerContent>
            </Marker>
            {seed.map((m) => row(m, false))}
          </section>
        )}
        {seed.length > 0 && groups.length > 0 && <div className="my-2 h-px bg-border/60" aria-hidden="true" />}
        {groups.length === 0 && seed.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('guestThread.emptyThread')}</p>
        )}
        {groups.map((group, index) => group.type === 'chat'
          ? row(group.message, true)
          : <IntermediateSteps key={groupKey(group)} steps={group.messages} agents={agents} isActive={index === groups.length - 1} />)}
        {working && <WorkingBubble agentName={working} agents={agents} />}
      </div>
    </div>
  );
}

/**
 * The agent a guest is waiting on: the newest message asked it (`@agent …`),
 * it is online, and nothing has come back yet. Steps already show their own
 * activity, so this only covers the gap before the first one.
 */
function workingAgent(groups: ReturnType<typeof groupMessages>, agents: GuestThreadAgent[], statusOf: (m: WorkspaceMessage) => ShareRequestStatus | undefined, guestAsksOff = false): string | null {
  // Decision notices don't count as an answer.
  let index = groups.length - 1;
  while (index >= 0) {
    const g = groups[index];
    if (g.type === 'chat' && isShareNotice(g.message)) index -= 1;
    else break;
  }
  const last = groups[index];
  if (!last || last.type !== 'chat') return null;
  const m = last.message;
  if (m.senderType === 'agent' || m.metadata?.send_status === 'failed') return null;
  // A guest's message is only a comment when the owner doesn't let guests ask.
  if (guestAsksOff && guestOf(m)) return null;
  // A held request runs only once approved.
  const held = statusOf(m);
  if (held && held !== 'approved') return null;
  if (!isOptimistic(m) && m.createdAt && Date.now() - new Date(m.createdAt).getTime() > WORKING_WINDOW_MS) return null;
  const agent = agents.find((a) => mentionsAgent(m.content, a.name));
  return agent && agent.online ? agent.name : null;
}

/** Desktop layout (the artifact beside the conversation) vs. phone (a sheet). */
function useWideLayout(): boolean {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return wide;
}

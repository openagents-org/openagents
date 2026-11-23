'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { Hash, Info } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { IntermediateSteps } from '@/components/chat/intermediate-steps';
import { WorkingBubble } from '@/components/chat/working-bubble';
import { filterThreadSteps, groupMessages, groupKey } from '@/components/chat/chat-message-groups';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { isControlMessage } from '@/lib/control-messages';
import { useFormatters, useT } from '@/lib/i18n';
import type { WorkspaceAgent, WorkspaceMessage } from '@/lib/types';
import type { GuestIdentity, GuestThreadAgent, GuestThreadInfo } from '@/lib/guest-thread-api';
import {
  agentDisplayName,
  agentTypeLabel,
  composeOutgoing,
  defaultAskAgent,
  isOptimistic,
  newPendingSend,
  splitSeed,
  startsWithMention,
  threadPeople,
  toWorkspaceAgents,
  type ThreadPerson,
  type ThreadViewer,
} from '@/lib/guest-thread';
import { GuestComposer } from './guest-composer';
import { GuestMessageRow, PersonAvatar } from './guest-message-row';
import { GuestNameDialog } from './guest-name-dialog';
import type { SendResult } from './use-guest-thread';

/** How long after asking an agent we keep showing "working…" with no reply. */
const WORKING_WINDOW_MS = 10 * 60 * 1000;

interface GuestThreadViewProps {
  info: GuestThreadInfo;
  messages: WorkspaceMessage[];
  hasOlder: boolean;
  olderState?: 'idle' | 'loading' | 'error';
  onLoadOlder?: () => void;
  /** Who is looking: a guest (default) or the share's owner in the owner room. */
  viewer?: 'guest' | 'owner';
  guest?: GuestIdentity | null;
  nameRequest?: { reason: 'first-post' | 'session-expired' } | null;
  sendTick: number;
  send: (pending: ReturnType<typeof newPendingSend>) => SendResult;
  retry: (localId: string) => void;
  join?: (name: string) => Promise<unknown>;
  cancelName?: () => void;
  /** Owner room: actions at the end of the top bar (e.g. "Keep this conversation"). */
  headerActions?: ReactNode;
  /** Owner room: extra panel (the guest link card) in the sidebar and details sheet. */
  ownerPanel?: ReactNode;
}

export function GuestThreadView({ info, messages, hasOlder, olderState = 'idle', onLoadOlder, viewer = 'guest', guest = null, nameRequest = null, sendTick, send, retry, join, cancelName, headerActions, ownerPanel }: GuestThreadViewProps) {
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [askAgent, setAskAgent] = useState<string | null>(() => (defaultAskAgent(info.agents) ? info.agents[0].name : null));

  // The chip can't point at an agent that left the thread.
  useEffect(() => {
    if (askAgent && !info.agents.some((a) => a.name === askAgent)) setAskAgent(null);
  }, [askAgent, info.agents]);

  useEffect(() => {
    document.title = `${title} · ${info.workspace.name}`;
  }, [title, info.workspace.name]);

  const statusAgent = info.agents.find((a) => a.name === askAgent) ?? info.agents[0] ?? null;

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

  return (
    <div className="flex h-dvh min-h-0 bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground lg:flex" aria-label={info.workspace.name}>
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
          <Image src="/logo-icon.png" alt="OpenAgents" width={24} height={24} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{info.workspace.name}</p>
            <p className="truncate text-xs text-muted-foreground">{isOwner ? t('shareRoom.yourShare') : t('guestThread.guestWorkspace')}</p>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <SectionHeading>{t('guestThread.threads')}</SectionHeading>
          <div aria-current="page" className="flex items-center gap-1.5 rounded-md bg-sidebar-accent px-2 py-1.5 text-sm font-medium text-sidebar-accent-foreground">
            <Hash className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{title}</span>
          </div>
          <ThreadRoster agents={info.agents} people={people} />
          {ownerPanel && <div className="mt-4 px-2" data-owner-panel="sidebar">{ownerPanel}</div>}
        </div>
        {isOwner && (
          <div className="flex items-center gap-2.5 border-t px-4 py-3">
            <PersonAvatar seed={`name:${info.owner.name.trim().toLowerCase()}`} className="size-8" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{info.owner.name}</p>
              <p className="text-xs text-muted-foreground">{t('shareRoom.ownerYou')}</p>
            </div>
          </div>
        )}
        {!isOwner && guest && (
          <div className="flex items-center gap-2.5 border-t px-4 py-3">
            <PersonAvatar seed={`guest:${guest.id}`} className="size-8" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{guest.name}</p>
              <p className="text-xs text-muted-foreground">{t('guestThread.guestBadge')}</p>
            </div>
          </div>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] lg:px-6">
          <Image src="/logo-icon.png" alt="OpenAgents" width={22} height={22} className="lg:hidden" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground">{info.workspace.name} / {t('guestThread.threads')}</p>
            <h1 className="flex min-w-0 items-center gap-1 text-base font-semibold">
              <Hash className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{title}</span>
            </h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => setDetailsOpen(true)} aria-label={t('guestThread.details')}>
            <AvatarStack agents={info.agents} people={people} />
            <span className="hidden sm:inline">{t('guestThread.details')}</span>
            <Info className="sm:hidden" />
          </Button>
          {headerActions}
        </header>

        <GuestMessageList
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
        />

        <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:px-5 lg:pb-3 xl:max-w-4xl">
          {info.canPost ? (
            <GuestComposer
              agents={info.agents}
              askAgent={askAgent}
              onAskAgentChange={setAskAgent}
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={handleSubmit}
            />
          ) : (
            <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">{t('guestThread.readOnlyNotice')}</p>
          )}
          {statusAgent && (
            <p className="mt-1.5 truncate px-1 text-xs text-muted-foreground" role="status">
              <span className={statusAgent.online ? 'mr-1.5 inline-block size-1.5 rounded-full bg-success align-middle' : 'mr-1.5 inline-block size-1.5 rounded-full bg-muted-foreground/40 align-middle'} aria-hidden="true" />
              <AgentStatusText agent={statusAgent} ownerName={info.owner.name} isOwner={isOwner} />
            </p>
          )}
          {info.canPost && <p className="mt-0.5 truncate px-1 text-[11px] text-muted-foreground/80">{isOwner ? t('shareRoom.ownerNotice') : t('guestThread.guestNotice')}</p>}
        </div>
      </main>

      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="right" className="w-80 max-w-[85vw]">
          <SheetHeader>
            <SheetTitle>{t('guestThread.detailsTitle')}</SheetTitle>
            <SheetDescription>{info.workspace.name} / {title}</SheetDescription>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-1">
            <ThreadRoster agents={info.agents} people={people} />
            {isOwner ? (
              ownerPanel && <div className="mt-4 px-2" data-owner-panel="sheet">{ownerPanel}</div>
            ) : (
              <>
                <ExpiryLine expiresAt={info.expiresAt} />
                <p className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{info.canPost ? t('guestThread.guestNotice') : t('guestThread.readOnlyNotice')}</p>
              </>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {!isOwner && cancelName && (
        <GuestNameDialog open={!!nameRequest} reason={nameRequest?.reason ?? null} onJoin={handleJoin} onCancel={cancelName} />
      )}
    </div>
  );
}

// ── Message list ──

function GuestMessageList({ info, messages, hasOlder, olderState, onLoadOlder, agents, agentNames, agentLabels, viewer, sendTick, onRetry }: {
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
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const firstScrollRef = useRef(true);
  /** Set just before an earlier page is requested; restores the reading position after it lands. */
  const anchorRef = useRef<{ height: number; top: number } | null>(null);

  const { seed, groups } = useMemo(() => {
    const visible = messages.filter((m) => !isControlMessage(m) && m.messageType !== 'loading');
    const split = splitSeed(visible);
    return { seed: split.seed, groups: groupMessages(filterThreadSteps(split.rest)) };
  }, [messages]);

  const seedAgent = useMemo(() => {
    const names = new Set(seed.filter((m) => m.senderType === 'agent').map((m) => m.senderName));
    return info.agents.find((a) => names.has(a.name)) ?? info.agents[0] ?? null;
  }, [seed, info.agents]);
  const seedAgentType = agentTypeLabel(seedAgent?.type) ?? (seedAgent ? agentDisplayName(seedAgent) : null);

  const working = useMemo(() => workingAgent(groups, info.agents), [groups, info.agents]);
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

  const row = (message: WorkspaceMessage, showTime: boolean) => (
    <GuestMessageRow
      key={message.messageId}
      message={message}
      agents={agents}
      agentNames={agentNames}
      agentLabels={agentLabels}
      currentGuestId={viewer.guestId}
      viewer={viewer}
      showTime={showTime}
      onRetry={onRetry}
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
          <div className="flex items-center gap-3 py-2 text-xs text-muted-foreground">
            <span className="shrink-0">
              {seedAgentType
                ? t('guestThread.seedDivider', { owner: info.owner.name, agent: seedAgentType })
                : t('guestThread.seedDividerNoAgent', { owner: info.owner.name })}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
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
  );
}

/**
 * The agent a guest is waiting on: the newest message asked it (`@agent …`),
 * it is online, and nothing has come back yet. Steps already show their own
 * activity, so this only covers the gap before the first one.
 */
function workingAgent(groups: ReturnType<typeof groupMessages>, agents: GuestThreadAgent[]): string | null {
  const last = groups[groups.length - 1];
  if (!last || last.type !== 'chat') return null;
  const m = last.message;
  if (m.senderType === 'agent' || m.metadata?.send_status === 'failed') return null;
  if (!isOptimistic(m) && m.createdAt && Date.now() - new Date(m.createdAt).getTime() > WORKING_WINDOW_MS) return null;
  const agent = agents.find((a) => startsWithMention(m.content, a.name));
  return agent && agent.online ? agent.name : null;
}

function AgentStatusText({ agent, ownerName, isOwner }: { agent: GuestThreadAgent; ownerName: string; isOwner: boolean }) {
  const t = useT();
  const params = { agent: agentDisplayName(agent), owner: ownerName };
  if (isOwner) {
    if (!agent.online) return <>{t('shareRoom.offlineNotice', params)}</>;
    if (agent.acceptsGuests === false) return <>{t('shareRoom.noGuestRuns', params)}</>;
    return <>{t('shareRoom.runsOn', params)}</>;
  }
  if (!agent.online) return <>{t('guestThread.offlineNotice', params)}</>;
  if (agent.acceptsGuests === false) return <>{t('guestThread.noGuestRuns', params)}</>;
  return <>{t('guestThread.runsOn', params)}</>;
}

// ── Roster ──

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 mb-1.5 px-2 text-xs font-medium text-muted-foreground first:mt-0">{children}</p>;
}

function ThreadRoster({ agents, people }: { agents: GuestThreadAgent[]; people: ThreadPerson[] }) {
  const t = useT();
  return (
    <>
      <SectionHeading>{t('guestThread.agentsHeading', { count: agents.length })}</SectionHeading>
      <ul className="flex flex-col gap-0.5">
        {agents.map((agent) => (
          <li key={agent.name} className="flex items-center gap-2 px-2 py-1 text-sm">
            <AgentAvatar name={agent.name} size={20} showStatus status={agent.online ? 'online' : 'offline'} />
            <span className="min-w-0 flex-1 truncate">{agentDisplayName(agent)}</span>
            <span className="text-xs text-muted-foreground">{agent.online ? t('guestThread.online') : t('guestThread.offline')}</span>
          </li>
        ))}
      </ul>
      <SectionHeading>{t('guestThread.membersHeading', { count: people.length })}</SectionHeading>
      <ul className="flex flex-col gap-0.5">
        {people.map((person) => (
          <li key={person.key} className="flex items-center gap-2 px-2 py-1 text-sm">
            <PersonAvatar seed={person.avatarSeed} className="size-5" />
            <span className="min-w-0 flex-1 truncate">{person.isSelf ? `${person.name} (${t('guestThread.you')})` : person.name}</span>
            {person.role === 'owner' && <Badge variant="secondary">{t('guestThread.ownerBadge')}</Badge>}
            {person.role === 'guest' && <Badge variant="outline">{t('guestThread.guestBadge')}</Badge>}
          </li>
        ))}
      </ul>
    </>
  );
}

function AvatarStack({ agents, people }: { agents: GuestThreadAgent[]; people: ThreadPerson[] }) {
  const shown = [
    ...people.slice(0, 2).map((p) => <PersonAvatar key={p.key} seed={p.avatarSeed} className="size-5 ring-2 ring-background" />),
    ...agents.slice(0, 1).map((a) => <AgentAvatar key={a.name} name={a.name} size={20} className="rounded-full ring-2 ring-background" />),
  ];
  return <span className="flex -space-x-1.5" aria-hidden="true">{shown}</span>;
}

function ExpiryLine({ expiresAt }: { expiresAt: string | null }) {
  const t = useT();
  const { formatDateTime } = useFormatters();
  return (
    <p className="mt-4 px-2 text-xs text-muted-foreground">
      {expiresAt ? t('guestThread.expiresOn', { date: formatDateTime(expiresAt) }) : t('guestThread.noExpiry')}
    </p>
  );
}

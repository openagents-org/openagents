'use client';

import { ThreadLiveBrowser } from './thread-live-browser';
import { AgentMessageAccessProvider } from './agent-message-access';
import { ThreadResources } from './thread-resources';
import { useRef, useState, useEffect, useMemo } from 'react';
import { ChatMessages } from './chat-messages';
import { YumiGuide } from './yumi-guide';
import { ChatInput } from './chat-input';
import { ReplyCitation, citationFor } from './reply-citation';
import { ThreadStatusBar } from './thread-status-bar';
import { useWorkspace } from '@/lib/workspace-context';
import { useMessagePolling } from '@/hooks/use-polling';
import { useThreadBrowserMessages } from '@/hooks/use-thread-browser-messages';
import { useComposingSignal } from '@/hooks/use-composing-signal';
import { Spinner } from '@/components/ui/spinner';
import { ShareDialog } from './share-dialog';
import { isGuestAddress } from '@/lib/guest-sender';
import { HumanProfile } from './human-profile';
import { arrangeQueuedMessages } from './use-queued-messages';
import { useLayout } from '@/components/layout/layout-context';
import { RoutineDetails } from '@/components/routines/routine-details';
import { useRoutines } from '@/components/routines/use-routines';
import { useRoutineNavigation } from '@/components/routines/use-routine-navigation';
import { RoutineDialog } from '@/components/routines/routine-dialog';
import type { RoutineItem, WorkspaceMessage } from '@/lib/types';
import { isYumiWelcome } from '@/lib/yumi-onboarding';
import { useT } from '@/lib/i18n';
import { useBrief } from './work-brief';
import { useMe } from '@/hooks/use-me';
import { messageCache, messagesForSession, normalizeAgentAddress } from './chat-message-cache';
import { useThreadDraft } from './use-thread-draft';
import { useSessionPrefetch } from './use-session-prefetch';
import { useAgentProbes } from './use-agent-probes';
import { useThreadOptimistic } from './use-thread-optimistic';
import { usePendingQueue } from './use-pending-queue';
import { useThreadActivity } from './use-thread-activity';
import { useThreadDm } from './use-thread-dm';
import { useChatSend, type ReplyTargets } from './use-chat-send';
import { ChatViewHeader } from './chat-view-header';
import { ConnectAgentNotice, OfflineAgentsBanner, ProbeFailureBanner, type FailingProbe } from './chat-view-banners';
import { KeepWorkspaceBanner } from '@/components/share/keep-workspace-banner';
import { WorkspaceGuestRequests } from '@/components/share/workspace-guest-requests';
import { isSharedThreadName } from '@/lib/guest-links';
import { isReleasedCopy } from '@/lib/share-requests';
import { NoThreadSelected, ThreadEmpty } from './chat-view-empty';

export { resetOptimisticStoreForTests } from './chat-message-cache';

export function ChatView() {
  const { workspace, token: workspaceToken, agents, loading: workspaceLoading, workspaceLoadError, currentUser, currentSessionId, setCurrentSessionId, sessions, markSessionUnarchived, consumeSkipFocus, createRoutine, routines, updateRoutine, knowledge } = useWorkspace();
  const hasConnectedAgent = agents.some((agent) => !agent.builtin && agent.status === 'online');
  const needsConnection = !workspaceLoading && !workspaceLoadError && !hasConnectedAgent;
  const t = useT();
  // Snapshot on open: polling replaces routine objects, and the dialog resets
  // its form whenever the routine it is given changes.
  const [editingRoutine, setEditingRoutine] = useState<RoutineItem | null>(null);
  // An open routine queue is edited right here, not only from the Routines list.
  const queueRoutines = routines.filter(r => r.channelName === currentSessionId && r.status !== 'cancelled');
  const currentRoutine = queueRoutines.length === 1 ? queueRoutines[0] : null;
  const { agentProbes, dismissedProbes, dismissProbe, retesting, retestAgent } = useAgentProbes();
  const { openView, viewMode, openNewThread, selectedRoutineId, setSelectedRoutineId, isMobile } = useLayout();
  useRoutines();
  const { openRoutineThread, editInThread } = useRoutineNavigation();
  const selectedRoutine = routines.find(r => r.id === selectedRoutineId && r.sourceChannelName === currentSessionId && r.status !== 'cancelled');
  const currentSessionIdRef = useSessionPrefetch(sessions, currentSessionId);

  // Look up cached messages for the current session (read once per session switch)
  const initialMessagesRef = useRef<WorkspaceMessage[] | undefined>(undefined);
  const initialMessagesSessionRef = useRef<string | null>(null);
  if (currentSessionId !== initialMessagesSessionRef.current) {
    initialMessagesRef.current = currentSessionId
      ? messagesForSession(currentSessionId, messageCache.get(currentSessionId) || [])
      : undefined;
    initialMessagesSessionRef.current = currentSessionId;
  }

  const { messages, loading, forceRefresh, loadOlder, hasOlder, loadingOlder } = useMessagePolling({
    sessionId: currentSessionId,
    initialMessages: initialMessagesRef.current,
  });
  const { notifyFocus, notifyBlur, notifyTyping } = useComposingSignal(currentSessionId);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  const workspaceKey = workspace?.workspaceId ?? '';
  const sessionMessages = useMemo(
    () => currentSessionId ? messagesForSession(currentSessionId, messages) : [],
    [currentSessionId, messages]
  );
  const { displayMessages, setOptimisticMessages, setOptimisticSessionId } = useThreadOptimistic(workspaceKey, currentSessionId, sessionMessages);
  // Only sending a message explicitly forces a scroll. History refreshes
  // follow the message list's existing scroll intent.
  const [scrollKey, setScrollKey] = useState(0);
  const [replyTargets, setReplyTargets] = useState<ReplyTargets>({});
  const replyTarget = currentSessionId ? replyTargets[currentSessionId] : undefined;
  const { currentDraft, setCurrentDraft, handleDraftChange, focusKey, focusComposer, prevSessionIdRef } = useThreadDraft({
    currentSessionId, currentSessionIdRef, messages, notifyTyping, consumeSkipFocus,
    // Bring back this session's pending optimistic messages, if any
    onSwitch: setOptimisticSessionId,
  });

  const dm = useThreadDm(currentSessionId, currentUser, agents);
  const { isDM, counterpart: dmCounterpart, writable: dmWritable, withPerson: dmWithPerson } = dm;
  const currentSession = sessions.find((s) => s.sessionId === currentSessionId);
  const personalAssistantConversation = agents.some(agent => agent.builtin && (
    isDM ? dmCounterpart === `openagents:${agent.agentName}`
      : currentSession?.participants?.length === 1 && currentSession.participants[0] === agent.agentName
  ));
  const [profileEmail, setProfileEmail] = useState<string | null>(null);
  useEffect(() => { setProfileEmail(null); }, [currentSessionId, viewMode]);

  // ── v1.1 M5: the thread's brief and who directs it ──
  // The brief carries director_email, so both the "Directed by" chip and the
  // composer hint come from the same fetch. DMs have no Channel row → no brief.
  const me = useMe(workspace?.workspaceId);
  const { brief } = useBrief(!isDM ? currentSessionId : null, sessionMessages.length);
  const myEmail = (me?.email || (currentUser.id.includes('@') ? currentUser.id : '')).trim().toLowerCase();
  const composerHint = dmWithPerson
    ? dm.self ? t('peopleMessaging.selfDmHint') : t('peopleMessaging.dmPersonHint', { name: dm.title ?? '' })
    : brief?.directorEmail && myEmail && brief.directorEmail !== myEmail
      ? t('brief.composerHint')
      : null;

  const browserMessages = useThreadBrowserMessages(displayMessages);
  const { sessionPendingQueue, setPendingQueue } = usePendingQueue(currentSessionId);
  // Queued messages wait in the Queue tab, not in the chat log.
  // A guest request approved by the owner is re-posted for the agent; the original stays in the log.
  const chatLogMessages = useMemo(() => arrangeQueuedMessages(displayMessages.filter((m) => !isReleasedCopy(m)), sessionPendingQueue), [displayMessages, sessionPendingQueue]);
  useThreadActivity(currentSessionId, chatLogMessages, displayMessages);

  const handleSend = useChatSend({
    currentSessionId, currentSession, currentUser, agents, displayMessages, dm, replyTarget, setReplyTargets,
    setOptimisticMessages, setPendingQueue, setScrollKey, setCurrentSessionId, markSessionUnarchived,
    forceRefresh, prevSessionIdRef, setCurrentDraft,
  });


  if (!currentSessionId) {
    return <NoThreadSelected routines={viewMode === 'routines'} canStart={agents.length > 0} onNewThread={openNewThread} />;
  }

  const participants = currentSession?.participants || [];
  const failingProbes: FailingProbe[] = participants.flatMap((name) => {
    const entry = agentProbes.get(name);
    if (!entry || entry.probe.ok !== false || entry.probe.code === 'static_only') return [];
    const dismissKey = JSON.stringify([workspaceKey, currentSessionId, entry.nodeId, name, entry.probe.at]);
    return dismissedProbes.has(dismissKey) ? [] : [{ name, entry, dismissKey }];
  });
  const yumi = agents.find((agent) => agent.builtin && agent.agentName === 'yumi');
  const isYumiDm = !!yumi && isDM && dmCounterpart === `openagents:${yumi.agentName}`;
  const hasYumi = !!yumi && (isYumiDm || (!isDM && participants.includes(yumi.agentName)));
  const lastMessage = chatLogMessages.at(-1);
  const hasInlineWelcome = !!lastMessage && isYumiWelcome(lastMessage, yumi);
  const showYumiGuide = hasYumi && !loading && !hasInlineWelcome && (!isYumiDm || displayMessages.length > 0);
  const canCompose = !isDM || dmWritable;
  const appendMention = (email: string) => {
    const separator = currentDraft && !/\s$/.test(currentDraft) ? ' ' : '';
    handleDraftChange(`${currentDraft}${separator}@${email} `);
  };

  return (
    <AgentMessageAccessProvider><div className="flex h-full min-w-0"><div data-thread-conversation className={`min-w-0 flex-1 h-full flex-col ${selectedRoutine && isMobile ? 'hidden' : 'flex'}`}>
      <ChatViewHeader
        sessionId={currentSessionId}
        session={currentSession}
        dm={dm}
        onOpenProfile={setProfileEmail}
        canShare={!personalAssistantConversation}
        onShare={() => setShareDialogOpen(true)}
        routine={currentRoutine}
        onEditRoutine={setEditingRoutine}
      />
      <ThreadResources key={currentSessionId} messages={browserMessages} queueMessages={displayMessages} pendingQueue={sessionPendingQueue} />

      {workspace && workspaceToken && !workspace.creatorEmail
        && Boolean((workspace.settings as Record<string, unknown> | undefined)?.openagents_share) && (
        <KeepWorkspaceBanner
          workspaceId={workspace.workspaceId}
          slug={workspace.slug}
          threadName={currentSessionId || undefined}
          token={workspaceToken}
          share={Boolean((workspace.settings as Record<string, unknown> | undefined)?.openagents_share)}
          claimed={Boolean(workspace.creatorEmail)}
        />
      )}
      {!isDM && currentSessionId && isSharedThreadName(currentSessionId) && <WorkspaceGuestRequests key={currentSessionId} channel={currentSessionId} />}
      {!needsConnection && <OfflineAgentsBanner participants={participants} agents={agents} />}
      <ProbeFailureBanner failing={failingProbes} retesting={retesting} onRetest={retestAgent} onDismiss={dismissProbe} />
      {needsConnection && !dmWithPerson && !hasYumi && <ConnectAgentNotice onConnect={() => openView('connect')} />}

      {/* Messages */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <ThreadLiveBrowser key={`live-browser:${currentSessionId}`} messages={browserMessages} />
        {showYumiGuide && <YumiGuide showSetup={!agents.some((agent) => !agent.builtin)} canStartThread={hasConnectedAgent} />}
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        ) : displayMessages.length === 0 ? (
          <ThreadEmpty dm={dm} agents={agents} hasConnectedAgent={hasConnectedAgent} onQuick={(text) => handleSend(text)} />
        ) : (
          <ChatMessages
            messages={chatLogMessages}
            agents={agents}
            scrollKey={scrollKey}
            loadOlder={loadOlder}
            hasOlder={hasOlder}
            loadingOlder={loadingOlder}
            targetSessionId={currentSessionId}
            onReply={canCompose ? (message) => {
              setReplyTargets(previous => ({ ...previous, [currentSessionId]: message }));
              const email = message.senderType === 'agent' ? normalizeAgentAddress(message.senderAddress || message.senderName) : (message.senderAddress || '').replace(/^human:/, '');
              // A shared-thread guest has no mentionable address; the citation names them.
              if (email && !isGuestAddress(email) && (message.senderType === 'agent' || email.includes('@')) && !currentDraft.includes(`@${email}`)) appendMention(email);
              focusComposer();
            } : undefined}
            onSaveKnowledge={canCompose ? (message) => {
              const agentName = normalizeAgentAddress(message.senderAddress || message.senderName);
              if (!agentName) return;
              const excerpt = message.content.replace(/\s+/g, ' ').trim();
              void handleSend(t('reactions.saveKnowledgePrompt', {
                agent: agentName,
                id: message.messageId,
                excerpt: excerpt.length > 160 ? `${excerpt.slice(0, 160)}…` : excerpt,
              }), [agentName], [], [], { replyTo: message });
            } : undefined}
            onMentionPerson={canCompose ? (email) => {
              appendMention(email);
              focusComposer();
            } : undefined}
            onSuggestion={(text) => {
              void handleSend(text);
            }}
            className="flex-1 overflow-y-auto px-4 py-3 lg:px-8"
          />
        )}

        {/* Input — shown for channels and for DMs the viewer participates in
            (human↔agent / human↔human); hidden only for read-only agent↔agent
            DM observation views. Capped at a fixed reading width rather than
            tracking the pane, but the cap steps up on large displays: 768px is
            cramped on a 27" 4K, where the pane itself is 2000px+ wide. */}
        {canCompose && (
          <div className="mx-auto w-full max-w-3xl px-3 pt-1 pb-2 lg:px-5 lg:pb-3 xl:max-w-4xl 2xl:max-w-6xl">
            <ThreadStatusBar channelName={currentSessionId} />
            {replyTarget && <ReplyCitation citation={citationFor(replyTarget)} onCancel={() => setReplyTargets(previous => ({ ...previous, [currentSessionId]: undefined }))} />}
            <ChatInput conversationId={currentSessionId}
              onSend={handleSend}
              agents={agents}
              knowledge={knowledge}
              draft={currentDraft}
              onDraftChange={handleDraftChange}
              onFocusChange={(focused) => focused ? notifyFocus() : notifyBlur()}
              focusKey={focusKey}
              onCreateRoutine={() => { handleDraftChange(`${currentDraft}${currentDraft ? '\n\n' : ''}${t('routineHub.newPrompt')}`); focusComposer(); }}
              hint={composerHint}
              disabled={!currentUser.name.trim()}
            />
          </div>
        )}

        <HumanProfile email={profileEmail} onClose={() => setProfileEmail(null)} />

        {editingRoutine && (
          <RoutineDialog
            open
            onOpenChange={(open) => { if (!open) setEditingRoutine(null); }}
            agents={agents}
            routine={editingRoutine}
            onCreateRoutine={createRoutine}
            onUpdateRoutine={updateRoutine}
          />
        )}

        <ShareDialog
          key={currentSessionId}
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          sessionId={currentSessionId}
        />
      </div>
    </div>{selectedRoutine && <RoutineDetails key={selectedRoutine.id} routine={selectedRoutine} onClose={() => setSelectedRoutineId(null)} onOpenThread={openRoutineThread} onEditInThread={editInThread} onLinkThread={() => {}}/>}</div></AgentMessageAccessProvider>
  );
}

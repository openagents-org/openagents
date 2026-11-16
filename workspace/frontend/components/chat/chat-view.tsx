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
import { HumanProfile } from './human-profile';
import { arrangeQueuedMessages } from './use-queued-messages';
import { useLayout } from '@/components/layout/layout-context';
import { RoutineDialog } from '@/components/routines/routine-dialog';
import type { RoutineItem, WorkspaceMessage } from '@/lib/types';
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
import { NoThreadSelected, ThreadEmpty } from './chat-view-empty';

export { resetOptimisticStoreForTests } from './chat-message-cache';

export function ChatView() {
  const { workspace, agents, loading: workspaceLoading, workspaceLoadError, currentUser, currentSessionId, setCurrentSessionId, sessions, markSessionUnarchived, consumeSkipFocus, createRoutine, routines, updateRoutine, knowledge } = useWorkspace();
  const hasConnectedAgent = agents.some((agent) => !agent.builtin && agent.status === 'online');
  const needsConnection = !workspaceLoading && !workspaceLoadError && !hasConnectedAgent;
  const t = useT();
  const [showCreateRoutine, setShowCreateRoutine] = useState(false);
  // Snapshot on open: polling replaces routine objects, and the dialog resets
  // its form whenever the routine it is given changes.
  const [editingRoutine, setEditingRoutine] = useState<RoutineItem | null>(null);
  // An open routine queue is edited right here, not only from the Routines list.
  const currentRoutine = currentSessionId ? routines.find((r) => r.channelName === currentSessionId) ?? null : null;
  const { agentProbes, dismissedProbes, dismissProbe, retesting, retestAgent } = useAgentProbes();
  const { openView, viewMode, openNewThread } = useLayout();
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
  const chatLogMessages = useMemo(() => arrangeQueuedMessages(displayMessages, sessionPendingQueue), [displayMessages, sessionPendingQueue]);
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
  // Yumi guidance — pinned above the thread when the built-in assistant is a
  // participant; collapsible, remembered per browser.
  const hasYumi = !isDM && agents.some((a) => a.builtin && participants.includes(a.agentName));
  const canCompose = !isDM || dmWritable;
  const appendMention = (email: string) => {
    const separator = currentDraft && !/\s$/.test(currentDraft) ? ' ' : '';
    handleDraftChange(`${currentDraft}${separator}@${email} `);
  };

  return (
    <AgentMessageAccessProvider><div data-thread-conversation className="flex h-full flex-col">
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

      {!needsConnection && <OfflineAgentsBanner participants={participants} agents={agents} />}
      <ProbeFailureBanner failing={failingProbes} retesting={retesting} onRetest={retestAgent} onDismiss={dismissProbe} />
      {needsConnection && !dmWithPerson && <ConnectAgentNotice onConnect={() => openView('connect')} />}

      {/* Messages */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <ThreadLiveBrowser key={`live-browser:${currentSessionId}`} messages={browserMessages} />
        {hasYumi && <YumiGuide />}
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
              if (email && (message.senderType === 'agent' || email.includes('@')) && !currentDraft.includes(`@${email}`)) appendMention(email);
              focusComposer();
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
              onCreateRoutine={() => setShowCreateRoutine(true)}
              hint={composerHint}
              disabled={!currentUser.name.trim()}
            />
          </div>
        )}

        <HumanProfile email={profileEmail} onClose={() => setProfileEmail(null)} />

        <RoutineDialog
          open={showCreateRoutine}
          onOpenChange={setShowCreateRoutine}
          agents={agents}
          conversationHistory={(() => {
            const recent = sessionMessages.filter((m) => m.messageType === 'chat').slice(-20);
            if (!recent.length) return undefined;
            return recent.map((m) => `${m.senderName}: ${m.content}`).join('\n');
          })()}
          onCreateRoutine={createRoutine}
        />

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
    </div></AgentMessageAccessProvider>
  );
}

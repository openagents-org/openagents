'use client';

import { ThreadLiveBrowser } from './thread-live-browser';
import { AgentMessageAccessProvider } from './agent-message-access';
import { ThreadResources } from './thread-resources';
import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { ChatMessages } from './chat-messages';
import { hasCollapsedSteps } from './intermediate-steps';
import { YumiGuide } from './yumi-guide';
import { YumiDmIntro } from './yumi-dm-intro';
import { ChatInput, type PendingFile } from './chat-input';
import { ReplyCitation, citationFor } from './reply-citation';
import { ThreadStatusBar } from './thread-status-bar';
import { EmptyConversation, EmptyState } from './empty-state';
import { useWorkspace } from '@/lib/workspace-context';
import { useMessagePolling } from '@/hooks/use-polling';
import { useThreadBrowserMessages } from '@/hooks/use-thread-browser-messages';
import { useComposingSignal } from '@/hooks/use-composing-signal';
import { ApiError, workspaceApi } from '@/lib/api';
import { capture } from '@/lib/analytics';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ListTree, MessageSquare, CalendarClock, Square, ChevronLeft, Plus, PanelRight, Globe, Lock, Share2, AlertTriangle, RefreshCw, Cpu } from 'lucide-react';
import { ShareDialog } from './share-dialog';
import { ThreadPrivacyControl, threadPrivacyApplies } from './thread-privacy-control';
import { ThreadParticipantCount } from './thread-participant-count';
import { HumanProfile } from './human-profile';
import { AddThreadParticipants } from './add-thread-participants';
import { ResponseModeControl } from './response-mode-control';
import { ThreadSettings } from './thread-settings';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { cn } from '@/lib/utils';
import { DmAvatars } from './dm-avatars';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { CreateRoutineDialog } from '@/components/routines/create-routine-dialog';
import { eventToMessage } from '@/lib/types';
import type { WorkspaceMessage } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { acknowledgeMessage, pendingMessagesForDisplay } from '@/lib/optimistic-messages';
import { pendingResponderName, expectsAgentResponse } from '@/lib/pending-responder';
import { useBrief } from './work-brief';
import { subscribeComposerPrefill } from './composer-prefill';
import { useMe } from '@/hooks/use-me';
import { useHumanNames } from '@/hooks/use-team-roster';
import { myAddress, dmPair, dmCounterpart as dmCounterpartOf, dmSessionId } from '@/lib/dm';
import { nextOptimisticExpiry, pendingOptimisticMessages } from '@/lib/optimistic-messages';

// Module-level message cache — survives component re-renders/unmounts.
// Keyed by sessionId, stores the last known messages for instant thread switching.
const messageCache = new Map<string, WorkspaceMessage[]>();
const CACHE_MAX_SESSIONS = 10;
// Track last seen message ID per cached session for incremental refresh
const cacheLastSeenId = new Map<string, string>();
// Module-level per-thread input drafts. Switching the sidebar to Files, Shared
// Browser etc. unmounts ChatView, so drafts held in component state or a ref
// were lost on the way back.
const draftStore: Record<string, string> = {};
// Module-level optimistic messages (the sent message + "…" waiting bubble) per
// thread, keyed `${workspaceId}:${sessionId}` — DM ids like `dm:a,b` repeat
// across workspaces. ChatView unmounts on mobile (thread list pane) and on a
// detour through Files/Browser, so component state alone lost the bubble.
// Each thread holds at most one send (2 entries); empty threads are deleted.
const optimisticStore = new Map<string, WorkspaceMessage[]>();

function readOptimistic(workspaceKey: string): WorkspaceMessage[] {
  const prefix = `${workspaceKey}:`;
  const all: WorkspaceMessage[] = [];
  optimisticStore.forEach((msgs, key) => {
    if (key.startsWith(prefix)) all.push(...msgs);
  });
  return all;
}

function writeOptimistic(workspaceKey: string, msgs: WorkspaceMessage[]) {
  const prefix = `${workspaceKey}:`;
  Array.from(optimisticStore.keys()).forEach((key) => {
    if (key.startsWith(prefix)) optimisticStore.delete(key);
  });
  for (const m of msgs) {
    const key = `${prefix}${m.sessionId}`;
    optimisticStore.set(key, [...(optimisticStore.get(key) ?? []), m]);
  }
}

/** Test hook: forget every stored optimistic message. */
export function resetOptimisticStoreForTests() {
  optimisticStore.clear();
}

function parseDMSession(sessionId: string | null): [string, string] | null {
  if (!sessionId?.startsWith('dm:')) return null;
  const parts = sessionId.slice(3).split(',', 2);
  if (parts.length === 2) return [parts[0], parts[1]];
  return null;
}

function normalizeAgentAddress(address: string): string {
  return address.replace(/^openagents:/, '');
}

function messagesForSession(sessionId: string, msgs: WorkspaceMessage[]): WorkspaceMessage[] {
  const dmPair = parseDMSession(sessionId);
  return msgs.flatMap((msg) => {
    const belongsToSession = dmPair
      ? msg.sessionId === sessionId ||
        dmPair.includes(msg.sessionId) ||
        dmPair.map(normalizeAgentAddress).includes(normalizeAgentAddress(msg.sessionId))
      : msg.sessionId === sessionId;
    if (!belongsToSession) return [];
    return dmPair ? [{ ...msg, sessionId }] : [msg];
  });
}

function cacheMessages(sessionId: string, msgs: WorkspaceMessage[]) {
  const scopedMessages = messagesForSession(sessionId, msgs);
  messageCache.set(sessionId, scopedMessages);
  if (scopedMessages.length > 0) {
    cacheLastSeenId.set(sessionId, scopedMessages[scopedMessages.length - 1].messageId);
  } else {
    cacheLastSeenId.delete(sessionId);
  }
  // Evict oldest entries if cache grows too large
  if (messageCache.size > CACHE_MAX_SESSIONS) {
    const oldest = messageCache.keys().next().value;
    if (oldest) {
      messageCache.delete(oldest);
      cacheLastSeenId.delete(oldest);
    }
  }
}

const PREFETCH_COUNT = 6;
const CACHE_REFRESH_INTERVAL = 5_000; // refresh caches every 5s

/** Fetch recent messages for a session (cache prefetch). */
async function fetchSessionMessages(sessionId: string): Promise<WorkspaceMessage[]> {
  try {
    const result = await workspaceApi.loadMessageHistory(sessionId, { limit: 50 });
    // Events come newest-first from sort=desc, reverse for chronological display
    return messagesForSession(sessionId, result.events.map(eventToMessage)).reverse();
  } catch {
    return [];
  }
}

/** Incrementally refresh a cached session — fetch only new messages since last seen. */
async function refreshCachedSession(sessionId: string): Promise<void> {
  const lastId = cacheLastSeenId.get(sessionId);
  if (!lastId) {
    // No cache yet — do full fetch
    const msgs = await fetchSessionMessages(sessionId);
    cacheMessages(sessionId, msgs);
    return;
  }
  try {
    const result = await workspaceApi.pollMessages(sessionId, lastId);
    const scopedMessages = messagesForSession(sessionId, result.messages);
    if (scopedMessages.length > 0) {
      const existing = messageCache.get(sessionId) || [];
      const existingIds = new Set(existing.map((m) => m.messageId));
      const unique = scopedMessages.filter((m) => !existingIds.has(m.messageId));
      if (unique.length > 0) {
        cacheMessages(sessionId, [...existing, ...unique]);
      }
    }
  } catch {
    // Best-effort
  }
}

export function ChatView() {
  const { workspace, agents, currentUser, currentSessionId, setCurrentSessionId, sessions, updateLastMessage, setSessionActive, updateAgentMode, stopAllAgents, activeSessionIds, stoppingSessionIds, renameSession, setSessionOrchestration, consumeSkipFocus, createRoutine, knowledge } = useWorkspace();
  const t = useT();
  const [showCreateRoutine, setShowCreateRoutine] = useState(false);

  // Per-agent smoke-test results ride the node heartbeat's roster. A failing
  // probe means a participant will likely never answer even though it shows
  // online — surface it in the thread BEFORE the user invests in a message.
  // Probes refresh hourly on the device, so a slow poll here is plenty.
  const [agentProbes, setAgentProbes] = useState<Map<string, { probe: import('@/lib/types').NodeProbe; nodeId: string }>>(new Map());
  const [retesting, setRetesting] = useState<Set<string>>(new Set());
  const loadProbes = useCallback(async () => {
    const nodes = await workspaceApi.listNodes();
    const m = new Map<string, { probe: import('@/lib/types').NodeProbe; nodeId: string }>();
    for (const n of nodes) {
      for (const a of n.agents || []) if (a.probe) m.set(a.name, { probe: a.probe, nodeId: n.nodeId });
    }
    setAgentProbes(m);
    return m;
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = () => loadProbes().catch(() => { /* transient — banner stays */ });
    load();
    const id = setInterval(() => { if (!cancelled) load(); }, 90_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [loadProbes]);

  // Re-run the smoke test on demand: enqueue probe_agent on the agent's node,
  // then fast-poll until a probe with a NEWER timestamp arrives (the daemon
  // picks the command up on its next poll and reports via heartbeat).
  const retestAgent = useCallback(async (name: string, nodeId: string, prevAt: string) => {
    setRetesting((s) => new Set(s).add(name));
    try {
      await workspaceApi.enqueueNodeCommand(nodeId, 'probe_agent', { name });
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const m = await loadProbes().catch(() => null);
        const fresh = m?.get(name);
        if (fresh && fresh.probe.at !== prevAt) return; // new verdict rendered
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRetesting((s) => { const n = new Set(s); n.delete(name); return n; });
    }
  }, [loadProbes]);
  const {
    isMobile,
    openMobileList,
    viewMode,
    splitBrowser,
    setSplitBrowser,
    showBrowserPreview,
    setShowBrowserPreview,
    openNewThread,
    setSelectedAgentName,
  } = useLayout();

  // Continuously refresh message caches for top recent sessions in the background.
  // This ensures clicking any recent thread shows messages instantly and up-to-date.
  const currentSessionIdRef = useRef<string | null>(currentSessionId);
  currentSessionIdRef.current = currentSessionId;

  useEffect(() => {
    if (sessions.length === 0) return;

    const getTopSessions = () =>
      [...sessions]
        .filter((s) => s.status === 'active')
        .sort((a, b) => {
          const aTime = a.lastEventAt || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
          const bTime = b.lastEventAt || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
          return bTime - aTime;
        })
        .slice(0, PREFETCH_COUNT);

    // Initial fetch — staggered
    const initial = getTopSessions();
    initial.forEach((s, i) => {
      if (!messageCache.has(s.sessionId)) {
        setTimeout(() => fetchSessionMessages(s.sessionId).then((msgs) => {
          if (msgs.length > 0) cacheMessages(s.sessionId, msgs);
        }), i * 300);
      }
    });

    // Periodic incremental refresh — skip the session the user is currently viewing
    // (useMessagePolling handles that one)
    const interval = setInterval(async () => {
      const top = getTopSessions();
      for (const s of top) {
        if (s.sessionId === currentSessionIdRef.current) continue;
        await refreshCachedSession(s.sessionId);
      }
    }, CACHE_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [sessions]);

  // Look up cached messages for the current session (read once per session switch)
  const initialMessagesRef = useRef<WorkspaceMessage[] | undefined>(undefined);
  const initialMessagesSessionRef = useRef<string | null>(null);
  if (currentSessionId !== initialMessagesSessionRef.current) {
    initialMessagesRef.current = currentSessionId
      ? messagesForSession(currentSessionId, messageCache.get(currentSessionId) || [])
      : undefined;
    initialMessagesSessionRef.current = currentSessionId;
  }

  const { messages, loading, forceRefresh, generation, loadOlder, hasOlder, loadingOlder } = useMessagePolling({
    sessionId: currentSessionId,
    initialMessages: initialMessagesRef.current,
  });
  const { notifyFocus, notifyBlur, notifyTyping } = useComposingSignal(currentSessionId);
  const [showAllSteps, setShowAllSteps] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Optimistic message state for instant feedback. Holds the pending messages
  // of every thread (each carries its sessionId), not just the open one —
  // wiping it on a thread switch dropped the "…" waiting bubble, so a thread
  // the agent had not acknowledged yet looked idle on the way back.
  // Seeded from and written through to optimisticStore so it survives an unmount.
  const workspaceKey = workspace?.workspaceId ?? '';
  const workspaceKeyRef = useRef(workspaceKey);
  workspaceKeyRef.current = workspaceKey;
  const [optimisticMessages, setOptimisticState] = useState<WorkspaceMessage[]>(() => readOptimistic(workspaceKey));
  // The store is the source of truth, so updates still land after an unmount
  // (e.g. a failed send whose request settles once the user has left).
  const setOptimisticMessages = useCallback((update: (prev: WorkspaceMessage[]) => WorkspaceMessage[]) => {
    const key = workspaceKeyRef.current;
    const prev = readOptimistic(key);
    const next = update(prev);
    if (next === prev) return;
    writeOptimistic(key, next);
    setOptimisticState(next);
  }, []);
  useEffect(() => {
    setOptimisticState(readOptimistic(workspaceKey));
  }, [workspaceKey]);
  // The thread whose optimistic messages may be shown. Trails currentSessionId
  // by one render (set in the switch effect below), in step with the polling
  // hook swapping in that thread's messages. On the render in between the
  // list is empty and must stay empty: that is what remounts ChatMessages and
  // lands the thread at the bottom. A lone bubble would keep it mounted, and
  // the real messages arriving above it would read as older history being
  // prepended — which never scrolls.
  // Starts at null so a remount takes the same one-render delay as a switch.
  const [optimisticSessionId, setOptimisticSessionId] = useState<string | null>(null);
  // scrollKey triggers scroll-to-bottom: incremented on user send + backfill completion
  const [scrollKey, setScrollKey] = useState(0);
  const [focusKey, setFocusKey] = useState(0);
  const [replyTargets, setReplyTargets] = useState<Record<string, WorkspaceMessage | undefined>>({});
  const replyTarget = currentSessionId ? replyTargets[currentSessionId] : undefined;

  // v1.1 M5 — "Request revision" on an artifact card (and anything else that
  // wants to hand the person a starting sentence) replaces this thread's draft
  // and focuses the input.
  useEffect(() => subscribeComposerPrefill((text) => {
    const sid = currentSessionIdRef.current;
    if (!sid) return;
    draftStore[sid] = text;
    setCurrentDraft(text);
    setFocusKey((k) => k + 1);
  }), []);

  // Scroll to bottom when backfill replaces messages (generation changes)
  useEffect(() => {
    if (generation > 0) setScrollKey((k) => k + 1);
  }, [generation]);

  const sessionMessages = useMemo(
    () => currentSessionId ? messagesForSession(currentSessionId, messages) : [],
    [currentSessionId, messages]
  );

  // Per-thread message drafts
  const [currentDraft, setCurrentDraft] = useState(() =>
    currentSessionId ? (draftStore[currentSessionId] ?? '') : ''
  );

  // Save/restore draft when switching threads + cache messages
  const prevSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Save draft and messages from previous session
    if (prevSessionIdRef.current && prevSessionIdRef.current !== currentSessionId) {
      draftStore[prevSessionIdRef.current] = currentDraft;
      // Cache messages for instant switching back
      if (messages.length > 0) {
        cacheMessages(prevSessionIdRef.current, messages);
      }
    }
    // Restore draft for new session
    setCurrentDraft(currentSessionId ? (draftStore[currentSessionId] ?? '') : '');
    prevSessionIdRef.current = currentSessionId;
    // Bring back this session's pending optimistic messages, if any
    setOptimisticSessionId(currentSessionId);
    // Focus the input when switching threads — unless the switch was made
    // via a keyboard shortcut (e.g. 1-9 from the sidebar), in which case
    // the user wanted to navigate, not start typing.
    if (currentSessionId && !consumeSkipFocus()) setFocusKey((k) => k + 1);
  }, [currentSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep cache updated with latest messages for the current session
  useEffect(() => {
    if (currentSessionId) {
      cacheMessages(currentSessionId, messages);
    }
  }, [currentSessionId, messages]);

  const handleDraftChange = useCallback((draft: string) => {
    setCurrentDraft(draft);
    if (currentSessionId) {
      draftStore[currentSessionId] = draft;
    }
    notifyTyping();
  }, [currentSessionId, notifyTyping]);

  const isDM = currentSessionId?.startsWith('dm:') ?? false;
  // DM pair analysis: when the viewer (a human) is part of the pair, the DM is
  // writable and titled by the counterpart alone. Agent↔agent DMs stay a
  // read-only observation view.
  const myAddr = myAddress(currentUser);
  const humanNames = useHumanNames();
  const dmPairAddrs = isDM ? dmPair(currentSessionId) : [];
  const dmCounterpart = isDM ? dmCounterpartOf(dmPairAddrs, myAddr) : null;
  const dmHasHuman = !!dmCounterpart;
  const dmWritable = isDM && !!dmCounterpart;
  // DM titles show the display label; the session id / addresses stay canonical.
  const dmAddrLabel = (addr: string) => {
    const name = addr.replace(/^openagents:/, '').replace(/^human:/, '');
    if (addr.startsWith('human:') && humanNames[name.toLowerCase()]) return humanNames[name.toLowerCase()];
    const a = agents.find((x) => x.agentName === name);
    return a ? agentLabel(a) : name;
  };
  const dmTitle = isDM
    ? (dmHasHuman
        ? dmCounterpart === myAddr ? t('threads.you') : dmAddrLabel(dmCounterpart ?? '')
        : dmPairAddrs.map(dmAddrLabel).join(' ↔ '))
    : null;
  const currentSession = sessions.find((s) => s.sessionId === currentSessionId);
  const [profileEmail, setProfileEmail] = useState<string | null>(null);
  useEffect(() => { setProfileEmail(null); }, [currentSessionId, viewMode]);

  // ── v1.1 M5: the thread's brief and who directs it ──
  // The brief carries director_email, so both the "Directed by" chip and the
  // composer hint come from the same fetch. DMs have no Channel row → no brief.
  const me = useMe(workspace?.workspaceId);
  const { brief } = useBrief(!isDM ? currentSessionId : null, sessionMessages.length);
  const myEmail = (me?.email || (currentUser.id.includes('@') ? currentUser.id : '')).trim().toLowerCase();
  const dmWithPerson = isDM && !!dmCounterpart?.startsWith('human:');
  const composerHint = dmWithPerson
    ? dmCounterpart === myAddr ? t('peopleMessaging.selfDmHint') : t('peopleMessaging.dmPersonHint', { name: dmTitle ?? '' })
    : brief?.directorEmail && myEmail && brief.directorEmail !== myEmail
      ? t('brief.composerHint')
      : null;
  // Optimistic messages the server has not confirmed yet, for the current session only:
  // 1. the optimistic user msg, until the real user message arrives from the server
  // 2. the optimistic loading msg, until any real agent message arrives after the user msg
  const optimisticShown = !!currentSessionId && optimisticSessionId === currentSessionId;
  // Bumped when a shown optimistic entry expires (see the timer below).
  const [expiryTick, setExpiryTick] = useState(0);
  const sessionOptimisticMessages = useMemo(
    () => optimisticShown
      ? pendingOptimisticMessages(messagesForSession(currentSessionId, optimisticMessages), sessionMessages)
      : [],
    [optimisticShown, currentSessionId, optimisticMessages, sessionMessages, expiryTick] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Drop the confirmed ones from state so they cannot reappear later
  useEffect(() => {
    if (!optimisticShown) return;
    const pendingIds = new Set(sessionOptimisticMessages.map((m) => m.messageId));
    setOptimisticMessages((prev) => {
      const next = prev.filter((m) => m.sessionId !== currentSessionId || pendingIds.has(m.messageId));
      return next.length === prev.length ? prev : next;
    });
  }, [optimisticShown, currentSessionId, sessionOptimisticMessages, setOptimisticMessages]);

  // Re-check when the oldest shown entry expires, so a bubble whose reply
  // never arrives goes away even if nothing else re-renders the thread.
  useEffect(() => {
    const at = nextOptimisticExpiry(sessionOptimisticMessages);
    if (at === null) return;
    const timer = setTimeout(() => setExpiryTick((t) => t + 1), Math.max(0, at - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [sessionOptimisticMessages]);

  // Merge real messages with optimistic messages for display
  const displayMessages = useMemo(
    () => [...sessionMessages, ...pendingMessagesForDisplay(sessionMessages, sessionOptimisticMessages)],
    [sessionMessages, sessionOptimisticMessages]
  );
  const browserMessages = useThreadBrowserMessages(displayMessages);

  const startEditingTitle = () => {
    setTitleDraft(currentSession?.title || '');
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  };

  const commitTitle = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && currentSessionId && trimmed !== currentSession?.title) {
      renameSession(currentSessionId, trimmed);
    }
  };

  // Update last message cache for thread list preview
  useEffect(() => {
    if (!currentSessionId) return;
    const lastMsg = displayMessages[displayMessages.length - 1];
    if (lastMsg) {
      const isTerminalStatus = /stopped|stopping failed/i.test(lastMsg.content);
      const isWorking = !isTerminalStatus && (
        lastMsg.messageType === 'status' ||
        lastMsg.messageType === 'thinking' ||
        lastMsg.messageType === 'loading'
      );
      updateLastMessage(currentSessionId, lastMsg.senderName, lastMsg.content, isWorking);
    } else {
      updateLastMessage(currentSessionId, '', '');
    }
  }, [currentSessionId, displayMessages, updateLastMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track whether the agent is actively working in this session
  const prevActiveSessionRef = useRef<string | null>(null);
  useEffect(() => {
    // Clear active state for previously viewed session when switching
    if (prevActiveSessionRef.current && prevActiveSessionRef.current !== currentSessionId) {
      setSessionActive(prevActiveSessionRef.current, false);
    }
    prevActiveSessionRef.current = currentSessionId;

    if (!currentSessionId || displayMessages.length === 0) {
      if (currentSessionId) setSessionActive(currentSessionId, false);
      return;
    }
    const lastMsg = displayMessages[displayMessages.length - 1];
    const isTerminalStatus = /stopped|stopping failed/i.test(lastMsg.content);
    const isAgentWorking = lastMsg.senderType === 'agent' && !isTerminalStatus && (
      lastMsg.messageType === 'status' ||
      lastMsg.messageType === 'thinking' ||
      lastMsg.messageType === 'loading'
    );
    setSessionActive(currentSessionId, isAgentWorking);
  }, [currentSessionId, displayMessages, setSessionActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Extract agent mode from status message metadata
  useEffect(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const msg: WorkspaceMessage = displayMessages[i];
      if (msg.senderType === 'agent' && msg.metadata?.agent_mode) {
        updateAgentMode(msg.senderName, msg.metadata.agent_mode as string);
        break;
      }
    }
  }, [displayMessages, updateAgentMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(
    async (content: string, mentions: string[] = [], files: PendingFile[] = [], mentionedHumans: string[] = []) => {
      if (!currentSessionId) return;
      if (!currentUser.id || !currentUser.name.trim()) return;

      const replyingTo = replyTarget;
      if (replyingTo?.senderType === 'agent') {
        const recipient = normalizeAgentAddress(replyingTo.senderAddress || replyingTo.senderName);
        if (recipient) mentions = [...new Set([...mentions, recipient])];
      }
      setReplyTargets(previous => ({ ...previous, [currentSessionId]: undefined }));
      // Create optimistic messages for instant feedback
      const timestamp = Date.now();
      const userContent = content || (files.length > 0 ? files.map((f) => f.file.name).join(', ') : '');
      const userOptimisticMsg: WorkspaceMessage = {
        messageId: `optimistic-user-${timestamp}`,
        sessionId: currentSessionId,
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderType: 'human',
        content: userContent,
        messageType: 'chat',
        mentions: [],
        targetAgents: null,
        createdAt: new Date().toISOString(),
        metadata: replyingTo ? { reply_to: citationFor(replyingTo) } : {},
      };
      const loadingOptimisticMsg: WorkspaceMessage = {
        messageId: `optimistic-loading-${timestamp}`,
        sessionId: currentSessionId,
        // The waiting bubble is attributed to whoever will answer — always
        // someone in this thread, never the workspace-wide master.
        senderName: pendingResponderName({
          agents,
          participants: currentSession?.participants || [],
          master: currentSession?.master,
          mentions,
          dmCounterpart: isDM && dmCounterpart ? normalizeAgentAddress(dmCounterpart) : null,
        }),
        senderType: 'agent',
        content: '',
        messageType: 'loading',
        mentions: [],
        targetAgents: null,
        createdAt: new Date().toISOString(),
        metadata: {},
      };

      // Add optimistic messages immediately and scroll to bottom
      // People-only mentions and human DMs do not request an agent response.
      const expectResponse = expectsAgentResponse({
        content, mentions, mentionedHumans, dmCounterpart: isDM ? dmCounterpart : null,
        responseMode: threadPrivacyApplies(currentSessionId) && !currentSessionId.startsWith('routines:') ? currentSession?.responseMode || 'proactive' : undefined,
      });
      setOptimisticMessages((prev) => [
        ...prev.filter((m) => m.sessionId !== currentSessionId),
        userOptimisticMsg,
        ...(expectResponse ? [loadingOptimisticMsg] : []),
      ]);
      setScrollKey((k) => k + 1);

      try {
        if (isDM && dmCounterpart) {
          // Direct message — targeted at the counterpart address, not a
          // channel. Attachments/mentions aren't supported in DMs yet.
          const sent = await workspaceApi.sendDirectMessage(dmCounterpart, content, currentUser.name, currentUser.id, myAddr, replyingTo?.messageId);
          setOptimisticMessages(prev => acknowledgeMessage(prev, userOptimisticMsg.messageId, loadingOptimisticMsg.messageId, sent, loadingOptimisticMsg));
          capture('message_sent', { dm: true });
          // A legacy `human:user` conversation: the new message is stored under
          // the viewer's own address, so follow it to the canonical session.
          const canonical = dmSessionId(myAddr, dmCounterpart);
          if (canonical !== currentSessionId) {
            setOptimisticMessages((prev) => prev.filter((m) => m.sessionId !== currentSessionId));
            setCurrentSessionId(canonical);
            return;
          }
          forceRefresh();
          return;
        }

        // Upload files first, then send message with attachment metadata
        let attachments: { fileId: string; filename: string; contentType: string; url: string }[] | undefined;
        if (files.length > 0) {
          const uploaded = await Promise.all(
            files.map((pf) => workspaceApi.uploadFile(pf.file, currentSessionId))
          );
          attachments = uploaded.map((f) => ({
            fileId: f.id,
            filename: f.filename,
            contentType: f.contentType,
            url: workspaceApi.getFileUrl(f.id),
          }));
        }

        const sent = await workspaceApi.sendMessage(
          currentSessionId,
          content || (attachments ? attachments.map((a) => a.filename).join(', ') : ''),
          currentUser.name,
          mentions.length > 0 ? mentions : undefined,
          attachments,
          currentUser.id,
          mentionedHumans.length > 0 ? mentionedHumans : undefined,
          replyingTo?.messageId,
        );
        // The server can also suppress replies (for example, the director rule).
        if (sent.metadata?.router_unavailable) toast.warning(t('responseMode.routerUnavailable'));
        setOptimisticMessages(prev => acknowledgeMessage(prev, userOptimisticMsg.messageId, loadingOptimisticMsg.messageId, sent, loadingOptimisticMsg));
        capture('message_sent', {
          has_attachments: (attachments?.length ?? 0) > 0,
          has_mentions: mentions.length > 0,
          attachment_count: attachments?.length ?? 0,
        });
        forceRefresh();
      } catch (err) {
        if (replyingTo) setReplyTargets(previous => ({ ...previous, [currentSessionId]: previous[currentSessionId] || replyingTo }));
        // Remove optimistic messages on error
        setOptimisticMessages((prev) =>
          prev.filter(
            (m) => m.messageId !== userOptimisticMsg.messageId && m.messageId !== loadingOptimisticMsg.messageId
          )
        );
        // Surface the failure — silently dropping the message makes it look
        // like it was sent and then vanished.
        const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
        if (err instanceof ApiError && err.status === 401) {
          // Already retried with a refreshed sign-in (see WorkspaceApi.request):
          // this account may not post here, or its sign-in can't be renewed.
          toast.error(t('chat.sendForbidden'));
        } else {
          toast.error(
            files.length > 0
              ? `Failed to send message — attachments could not be uploaded${detail}. Please re-attach and try again.`
              : `Failed to send message${detail}. Please try again.`
          );
        }
        // Restore the typed text as this thread's draft, unless the user has
        // already started a new draft in the meantime.
        if (content && !draftStore[currentSessionId]) {
          draftStore[currentSessionId] = content;
          if (prevSessionIdRef.current === currentSessionId) setCurrentDraft(content);
        }
      }
    },
    [replyTarget, currentSessionId, currentUser.id, currentUser.name, forceRefresh, agents, isDM, dmCounterpart, myAddr, setCurrentSessionId, currentSession?.participants, currentSession?.master, currentSession?.responseMode]
  );

  const hasCollapsibleSteps = hasCollapsedSteps(displayMessages);

  if (!currentSessionId) {
    const isRoutinesView = viewMode === 'routines';
    return (
      <div className="flex flex-col h-full items-center justify-center text-center text-muted-foreground px-8">
        {isRoutinesView ? (
          <>
            <div className="opacity-20 mb-3">
              <CalendarClock className="size-10" />
            </div>
            <p className="text-sm font-medium">{t('chat.noRoutinesTitle')}</p>
            <p className="text-xs mt-1">{t('chat.noRoutinesBody')}</p>
          </>
        ) : (
          <>
            <div className="flex items-center p-4 rounded-full bg-primary/10 mb-4">
              <MessageSquare className="size-8 text-primary" />
            </div>
            <p className="text-lg font-semibold text-foreground">{t('chat.newSessionTitle')}</p>
            <p className="text-sm mt-1 max-w-xs">
              {t('chat.newSessionBody')}
            </p>
            {agents.length > 0 && (
              <Button className="mt-5 gap-1.5" onClick={openNewThread}>
                <Plus className="size-4" />
                {t('chat.newThread')}
              </Button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <AgentMessageAccessProvider><div data-thread-conversation className="flex flex-col h-full">
      {/* Thread header — title on desktop lives in the shell's app header */}
      <DetailHeader
        titleInHeader={isDM}
        title={<>
          {/* Back button — mobile only */}
          {isMobile && (
            <button
              onClick={openMobileList}
              className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0 -ml-1"
            >
              <ChevronLeft className="size-5" />
            </button>
          )}
          {isDM ? (
            <h2 className="text-sm font-semibold truncate flex items-center gap-1.5">
              <DmAvatars addresses={dmCounterpart ? [dmCounterpart] : dmPairAddrs} />
              <button type="button" className="truncate text-left hover:text-primary" disabled={!dmCounterpart} onClick={() => {
                if (dmCounterpart?.startsWith('openagents:')) setSelectedAgentName(dmCounterpart.slice('openagents:'.length));
                else if (dmCounterpart?.startsWith('human:')) setProfileEmail(dmCounterpart.slice('human:'.length));
              }}>{dmTitle}</button>
              {!dmWritable && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">
                  {t('header.readOnly')}
                </span>
              )}
            </h2>
          ) : editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle();
                if (e.key === 'Escape') setEditingTitle(false);
              }}
              className="text-sm font-semibold bg-transparent border-b border-primary outline-none min-w-0 max-w-[300px]"
              autoFocus
            />
          ) : (
            <h2
              className="text-sm font-semibold truncate cursor-pointer hover:text-primary transition-colors"
              onClick={startEditingTitle}
              title={t('header.clickToRename')}
            >
              {currentSession?.title || t('header.untitledThread')}
            </h2>
          )}
          {!isDM && threadPrivacyApplies(currentSessionId) && currentSession && (
            <span className="inline-flex shrink-0 text-muted-foreground" title={t(currentSession.visibility === 'private' ? 'threadAccess.private' : 'threadAccess.public')} aria-label={t(currentSession.visibility === 'private' ? 'threadAccess.private' : 'threadAccess.public')}>
              {currentSession.visibility === 'private' ? <Lock className="size-3.5" /> : <Globe className="size-3.5" />}
            </span>
          )}
          {isMobile && !isDM && currentSessionId && <ThreadParticipantCount channelName={currentSessionId} />}
          {(() => {
            const participants = currentSession?.participants || [];
            const sessionAgents = agents.filter((a) => participants.includes(a.agentName));
            return (
              <>
                {sessionAgents.length > 1 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium shrink-0">
                    {t('chat.groupBadge')}
                  </span>
                )}
              </>
            );
          })()}
        </>}
      >
          {/* Model chip — the model of the thread's leader (or its only
              agent). Hidden when that agent runs on its own default. */}
          {!isDM && (() => {
            const participants = currentSession?.participants || [];
            const sessionAgents = agents.filter((a) => participants.includes(a.agentName));
            const leader = currentSession?.master
              ? sessionAgents.find((a) => a.agentName === currentSession.master)
              : null;
            const modelAgent = leader || (sessionAgents.length === 1 ? sessionAgents[0] : null);
            if (!modelAgent?.model) return null;
            return (
              <span
                className="hidden sm:inline-flex items-center gap-1 max-w-[180px] text-[10px] px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium shrink-0"
                title={t('chat.modelBadgeTitle', { agent: agentLabel(modelAgent) })}
              >
                <Cpu className="size-2.5 shrink-0" />
                <span className="truncate font-mono">{modelAgent.model}</span>
              </span>
            );
          })()}

          {/* Stop button — visible when agents are working */}
          {currentSessionId && (activeSessionIds.has(currentSessionId) || stoppingSessionIds.has(currentSessionId)) && (
            <button
              onClick={() => stopAllAgents(currentSessionId!)}
              disabled={stoppingSessionIds.has(currentSessionId)}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors shrink-0 disabled:opacity-60 disabled:pointer-events-none"
            >
              <Square className="size-3 fill-current" />
              {stoppingSessionIds.has(currentSessionId) ? t('chat.stopping') : t('chat.stop')}
            </button>
          )}

          {/* All steps toggle — the tooltip says what a click does */}
          {hasCollapsibleSteps && (
            <Button
              variant={showAllSteps ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => setShowAllSteps((prev) => !prev)}
              className={cn(
                'gap-1.5 h-7 text-xs font-medium',
                showAllSteps && 'border-primary/30 text-primary bg-primary/5'
              )}
              aria-pressed={showAllSteps}
              title={showAllSteps ? t('chat.showLatestSteps') : t('chat.showAllSteps')}
            >
              <ListTree className="size-3.5" />
            </Button>
          )}

          {!isDM && currentSessionId && threadPrivacyApplies(currentSessionId) && currentSession && (
            <AddThreadParticipants key={`add-participants:${currentSessionId}`} channelName={currentSessionId} />
          )}

          {!isDM && currentSessionId && threadPrivacyApplies(currentSessionId) && !currentSessionId.startsWith('routines:') && currentSession && (
            <ResponseModeControl key={`response-mode:${currentSessionId}`} session={currentSession} onChange={(updates) => setSessionOrchestration(currentSessionId, updates)} />
          )}

          {/* Thread access — Private/Public, owner, Join */}
          {!isDM && currentSessionId && threadPrivacyApplies(currentSessionId) && currentSession && (
            <div className="mr-1 flex min-w-0 max-w-[22rem] items-center gap-0.5">
              <ThreadPrivacyControl channelName={currentSessionId} joinOnly className="flex-nowrap whitespace-nowrap" />
            </div>
          )}

          {/* Share conversation */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShareDialogOpen(true)}
            className="gap-1.5 h-7 text-xs font-medium"
            title={t('chat.shareConversation')}
          >
            <Share2 className="size-3.5" />
          </Button>
          {!isDM && currentSessionId && threadPrivacyApplies(currentSessionId) && !currentSessionId.startsWith('routines:') && currentSession && (
            <ThreadSettings key={`thread-settings:${currentSessionId}`} session={currentSession} />
          )}

          {/* Artifact preview toggle */}
          {(
            <Button
              variant={splitBrowser && showBrowserPreview ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => {
                if (!splitBrowser) setSplitBrowser(true);
                setShowBrowserPreview(!(splitBrowser && showBrowserPreview));
              }}
              className={cn(
                'gap-1.5 h-7 text-xs font-medium',
                splitBrowser && showBrowserPreview && 'border-primary/30 text-primary bg-primary/5'
              )}
              aria-label={splitBrowser && showBrowserPreview ? t('artifactPanel.close') : t('artifactPanel.open')}
              title={splitBrowser && showBrowserPreview ? t('artifactPanel.close') : t('artifactPanel.open')}
            >
              <PanelRight className="size-3.5" />
            </Button>
          )}
      </DetailHeader>
      <ThreadResources key={currentSessionId} messages={browserMessages} />

      {/* Offline-agent warning — surfaces when any participant is offline so the
          user knows a reply may not come. When ALL are offline it's a stronger
          notice (the backend also posts an inline "no agent online" message on
          send). Shown for single-agent threads too, not just groups. */}
      {(() => {
        const participants = currentSession?.participants || [];
        if (participants.length === 0) return null;
        const byName = new Map(agents.map((a) => [a.agentName, a]));
        const offline = participants.filter((p) => byName.get(p)?.status === 'offline');
        if (offline.length === 0) return null;
        const allOffline = offline.length === participants.length;
        return (
          <div className="flex items-center gap-2 px-2 lg:px-4 py-1.5 border-b shrink-0 overflow-x-auto bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="text-[11px] leading-snug shrink-0">
              {allOffline
                ? t('chat.offlineAllAgents')
                : t('chat.offlineSomeAgents')}
            </span>
            {offline.map((name) => {
              const member = byName.get(name);
              return (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 shrink-0"
                >
                  <AgentAvatar name={name} size={14} />
                  {member ? agentLabel(member) : name}
                </span>
              );
            })}
          </div>
        );
      })()}

      {/* Failing smoke test — a participant's last health check failed, so it
          will likely not answer even if it shows online. Includes the probe's
          own guidance so the user can fix it before starting a conversation. */}
      {(() => {
        const participants = currentSession?.participants || [];
        const failing = participants
          .map((name) => ({ name, entry: agentProbes.get(name) }))
          .filter((x): x is { name: string; entry: { probe: import('@/lib/types').NodeProbe; nodeId: string } } =>
            !!x.entry && x.entry.probe.ok === false && x.entry.probe.code !== 'static_only');
        if (failing.length === 0) return null;
        return (
          <div className="px-2 lg:px-4 py-2 border-b shrink-0 bg-red-50 dark:bg-red-950/25 text-red-800 dark:text-red-300 space-y-1.5">
            {failing.map(({ name, entry }) => {
              const busy = retesting.has(name);
              return (
                <div key={name} className="text-[11px] leading-snug">
                  <div className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    <span className="min-w-0 break-words">
                      {t('chat.probeFailing', { agent: name })}
                      {entry.probe.message ? ` — ${entry.probe.message}` : ''}
                    </span>
                    <button
                      onClick={() => retestAgent(name, entry.nodeId, entry.probe.at)}
                      disabled={busy}
                      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-red-300 dark:border-red-800 bg-white dark:bg-red-950/40 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300 transition-colors hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-60"
                      title={t('chat.probeRetest')}
                    >
                      <RefreshCw className={`size-3 ${busy ? 'animate-spin' : ''}`} />
                      {busy ? t('chat.probeRetesting') : t('chat.probeRetest')}
                    </button>
                  </div>
                  {(entry.probe.guidance || []).slice(0, 3).map((line, i) => (
                    <div key={i} className="pl-5 text-red-700/90 dark:text-red-300/80">→ {line}</div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Messages */}
      <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        <ThreadLiveBrowser key={`live-browser:${currentSessionId}`} messages={browserMessages} />
        {/* Yumi guidance — pinned above the thread when the built-in
            assistant is a participant; collapsible, remembered per browser. */}
        {!isDM && (() => {
          const participants = currentSession?.participants || [];
          const hasYumi = agents.some((a) => a.builtin && participants.includes(a.agentName));
          return hasYumi ? <YumiGuide /> : null;
        })()}
        {loading ? (
          <div className="flex items-center justify-center flex-1">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : displayMessages.length === 0 ? (
          (() => {
            // A fresh DM with the built-in assistant opens on her intro (what
            // she can do + the connect steps) instead of a blank thread.
            const dmBuiltin = isDM
              ? agents.find((a) => a.builtin && `openagents:${a.agentName}` === dmCounterpart)
              : undefined;
            return dmBuiltin ? (
              <YumiDmIntro agentLabel={agentLabel(dmBuiltin)} onQuick={(text) => handleSend(text)} />
            ) : (
              isDM ? <EmptyConversation name={dmTitle || undefined} human={dmWithPerson} self={dmCounterpart === myAddr} /> : <EmptyState />
            );
          })()
        ) : (
          <ChatMessages
            messages={displayMessages}
            agents={agents}
            showAllSteps={showAllSteps}
            scrollKey={scrollKey}
            loadOlder={loadOlder}
            hasOlder={hasOlder}
            loadingOlder={loadingOlder}
            targetSessionId={currentSessionId}
            onReply={(!isDM || dmWritable) ? (message) => {
              setReplyTargets(previous => ({ ...previous, [currentSessionId]: message }));
              const email = message.senderType === 'agent' ? normalizeAgentAddress(message.senderAddress || message.senderName) : (message.senderAddress || '').replace(/^human:/, '');
              if (email && (message.senderType === 'agent' || email.includes('@')) && !currentDraft.includes(`@${email}`)) {
                handleDraftChange(`${currentDraft}${currentDraft && !/\s$/.test(currentDraft) ? ' ' : ''}@${email} `);
              }
              setFocusKey(key => key + 1);
            } : undefined}
            onMentionPerson={(!isDM || dmWritable) ? (email) => {
              const separator = currentDraft && !/\s$/.test(currentDraft) ? ' ' : '';
              handleDraftChange(`${currentDraft}${separator}@${email} `);
              setFocusKey((key) => key + 1);
            } : undefined}
            onSuggestion={(text) => {
              capture('suggestion_chip_tapped', { text });
              void handleSend(text);
            }}
            className="flex-1 overflow-y-auto px-4 lg:px-8 py-3"
          />
        )}

        {/* Input — shown for channels and for DMs the viewer participates in
            (human↔agent / human↔human); hidden only for read-only agent↔agent
            DM observation views. Capped at a fixed reading width rather than
            tracking the pane, but the cap steps up on large displays: 768px is
            cramped on a 27" 4K, where the pane itself is 2000px+ wide. */}
        {(!isDM || dmWritable) && (
          <div className="mx-auto w-full max-w-3xl px-3 lg:px-5 pt-1 pb-2 xl:max-w-4xl 2xl:max-w-6xl lg:pb-3">
            {currentSessionId && <ThreadStatusBar channelName={currentSessionId} messages={displayMessages} />}
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

        <CreateRoutineDialog
          open={showCreateRoutine}
          onOpenChange={setShowCreateRoutine}
          agents={agents}
          conversationHistory={(() => {
            if (!sessionMessages.length) return undefined;
            const recent = sessionMessages.filter((m) => m.messageType === 'chat').slice(-20);
            if (!recent.length) return undefined;
            return recent.map((m) => `${m.senderName}: ${m.content}`).join('\n');
          })()}
          onCreateRoutine={createRoutine}
        />

        {currentSessionId && (
          <ShareDialog
            key={currentSessionId}
            open={shareDialogOpen}
            onOpenChange={setShareDialogOpen}
            sessionId={currentSessionId}
          />
        )}
      </div>
    </div></AgentMessageAccessProvider>
  );
}

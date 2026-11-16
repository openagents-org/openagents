'use client';

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { ApiError, workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { dmSessionId } from '@/lib/dm';
import { acknowledgeMessage } from '@/lib/optimistic-messages';
import { pendingResponderName, expectsAgentResponse, needsProactiveRouting } from '@/lib/pending-responder';
import type { WorkspaceAgent, WorkspaceMessage, WorkspaceSession } from '@/lib/types';
import type { PendingFile } from './chat-input';
import { citationFor } from './reply-citation';
import { threadPrivacyApplies } from './thread-privacy-control';
import { agentBusyInThread } from './use-queued-messages';
import { draftStore, normalizeAgentAddress } from './chat-message-cache';
import type { SetOptimisticMessages } from './use-thread-optimistic';
import type { SessionPendingEntry } from './use-pending-queue';

export type ReplyTargets = Record<string, WorkspaceMessage | undefined>;

/** Sends from the composer: optimistic echo, upload, routing and failure recovery. */
export function useChatSend({ currentSessionId, currentSession, currentUser, agents, displayMessages, dm, replyTarget, setReplyTargets, setOptimisticMessages, setPendingQueue, setScrollKey, setCurrentSessionId, markSessionUnarchived, forceRefresh, prevSessionIdRef, setCurrentDraft }: {
  currentSessionId: string | null;
  currentSession: WorkspaceSession | undefined;
  currentUser: { id: string; name: string };
  agents: WorkspaceAgent[];
  displayMessages: WorkspaceMessage[];
  dm: { isDM: boolean; counterpart: string | null; myAddr: string };
  replyTarget: WorkspaceMessage | undefined;
  setReplyTargets: Dispatch<SetStateAction<ReplyTargets>>;
  setOptimisticMessages: SetOptimisticMessages;
  setPendingQueue: Dispatch<SetStateAction<SessionPendingEntry[]>>;
  setScrollKey: Dispatch<SetStateAction<number>>;
  setCurrentSessionId: (sessionId: string) => void;
  markSessionUnarchived: (sessionId: string) => void;
  forceRefresh: () => void;
  prevSessionIdRef: MutableRefObject<string | null>;
  setCurrentDraft: (draft: string) => void;
}) {
  const t = useT();
  const { isDM, counterpart: dmCounterpart, myAddr } = dm;
  return useCallback(
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
      const routingPending = needsProactiveRouting({
        content, mentions, mentionedHumans,
        participants: currentSession?.participants || [], humanCount: currentSession?.humanCount,
        responseMode: currentSession?.responseMode || 'proactive',
        direct: !threadPrivacyApplies(currentSessionId) || currentSessionId.startsWith('routines:') || currentSessionId.startsWith('task:'),
      });
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
        metadata: { ...(replyingTo ? { reply_to: citationFor(replyingTo) } : {}),
          ...(routingPending && !files.length ? { _routingPending: true } : {}) },
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
      // An agent here that is mid-task will queue anything routed to it. The
      // routing result (below) confirms or clears this guess.
      const busyHere = new Set(isDM ? [] : agents
        .filter((a) => (currentSession?.participants || []).includes(a.agentName) && agentBusyInThread(a, currentSessionId, displayMessages))
        .map((a) => a.agentName));
      const mentionedAgents = mentions.map((m) => normalizeAgentAddress(m) || m);
      const maybeQueued = busyHere.size > 0 && !!userContent.trim()
        && (mentionedAgents.length ? mentionedAgents.some((name) => busyHere.has(name)) : mentionedHumans.length === 0);
      const pendingId = `pending-${timestamp}`;
      if (maybeQueued) {
        setPendingQueue((prev) => [...prev, { id: pendingId, sessionId: currentSessionId, content: userContent, sentAt: timestamp }]);
      }
      setOptimisticMessages((prev) => [
        ...prev.filter((m) => m.sessionId !== currentSessionId),
        userOptimisticMsg,
        ...(expectResponse && !maybeQueued ? [loadingOptimisticMsg] : []),
      ]);
      setScrollKey((k) => k + 1);

      try {
        if (isDM && dmCounterpart) {
          // Direct message — targeted at the counterpart address, not a
          // channel. Attachments/mentions aren't supported in DMs yet.
          const sent = await workspaceApi.sendDirectMessage(dmCounterpart, content, currentUser.name, currentUser.id, myAddr, replyingTo?.messageId);
          setOptimisticMessages(prev => acknowledgeMessage(prev, userOptimisticMsg.messageId, loadingOptimisticMsg.messageId, sent, loadingOptimisticMsg));
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

        // Uploading is separate from classification. Start routing feedback
        // only when the message is ready to reach the router.
        if (routingPending && files.length) setOptimisticMessages(previous => previous.map(message =>
          message.messageId === userOptimisticMsg.messageId
            ? { ...message, metadata: { ...message.metadata, _routingPending: true } } : message));
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
        if (sent.metadata?.thread_unarchived) markSessionUnarchived(currentSessionId);
        // Still queued only if routing picked a busy agent; otherwise show it now.
        const routedTo: string[] = Array.isArray(sent.metadata?.target_agents) ? sent.metadata.target_agents : [];
        const queuedNow = maybeQueued && routedTo.some((name) => busyHere.has(name));
        if (maybeQueued && !queuedNow) setPendingQueue((prev) => prev.filter((p) => p.id !== pendingId));
        // The server can also suppress replies (for example, the director rule).
        setOptimisticMessages(prev => acknowledgeMessage(prev, userOptimisticMsg.messageId, loadingOptimisticMsg.messageId, sent, queuedNow ? undefined : loadingOptimisticMsg));
        forceRefresh();
      } catch (err) {
        if (replyingTo) setReplyTargets(previous => ({ ...previous, [currentSessionId]: previous[currentSessionId] || replyingTo }));
        setPendingQueue((prev) => prev.filter((p) => p.id !== `pending-${timestamp}`));
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
    [replyTarget, currentSessionId, currentUser.id, currentUser.name, forceRefresh, agents, displayMessages, isDM, dmCounterpart, myAddr, setCurrentSessionId, currentSession?.participants, currentSession?.master, currentSession?.responseMode, currentSession?.humanCount] // eslint-disable-line react-hooks/exhaustive-deps
  );
}

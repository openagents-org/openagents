'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { ChatMessages } from '@/components/chat/chat-messages';
import { ChatInput, type PendingFile } from '@/components/chat/chat-input';
import { CreateRoutineDialog } from '@/components/routines/create-routine-dialog';
import { useWorkspace } from '@/lib/workspace-context';
import { useMessagePolling } from '@/hooks/use-polling';
import { workspaceApi } from '@/lib/api';
import { Square } from 'lucide-react';
import type { WorkspaceMessage, WorkspaceSession } from '@/lib/types';

interface MonitorOverlayProps {
  sessionId: string;
  session: WorkspaceSession;
  /** Pre-loaded messages for instant display (from grid cache). */
  initialMessages?: WorkspaceMessage[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MonitorOverlay({ sessionId, session, initialMessages, open, onOpenChange }: MonitorOverlayProps) {
  const { agents, currentUser, activeSessionIds, stoppingSessionIds, stopAllAgents, renameSession, createRoutine } = useWorkspace();
  const [showCreateRoutine, setShowCreateRoutine] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const { messages, loading, forceRefresh, generation } = useMessagePolling({
    sessionId: open ? sessionId : null,
    initialMessages,
  });

  const [optimisticMessages, setOptimisticMessages] = useState<WorkspaceMessage[]>([]);
  const [scrollKey, setScrollKey] = useState(0);
  const [focusKey, setFocusKey] = useState(0);

  // Scroll to bottom when backfill replaces messages
  useEffect(() => {
    if (generation > 0) setScrollKey((k) => k + 1);
  }, [generation]);
  const displayMessages = useMemo(() => [...messages, ...optimisticMessages], [messages, optimisticMessages]);

  // Clear optimistic messages progressively:
  // 1. Remove optimistic user msg once the real user message arrives from the server
  // 2. Remove optimistic loading indicator once any real agent message arrives after the user msg
  useEffect(() => {
    if (optimisticMessages.length === 0) return;
    let updated = [...optimisticMessages];

    // Check if the real user message has arrived
    const optimisticUser = updated.find((m) => m.messageId.startsWith('optimistic-user-'));
    if (optimisticUser) {
      const realUserFound = messages.some(
        (m) => m.senderType !== 'agent' && m.content === optimisticUser.content
      );
      if (realUserFound) {
        updated = updated.filter((m) => !m.messageId.startsWith('optimistic-user-'));
      }
    }

    // Check if a real agent message has arrived AFTER the user message — clear loading indicator
    const optimisticLoading = updated.find((m) => m.messageId.startsWith('optimistic-loading-'));
    if (optimisticLoading) {
      const userMsgIdx = messages.findIndex(
        (m) => m.senderType !== 'agent' && m.content === optimisticLoading.metadata?._userContent
      );
      const hasAgentAfterUser = userMsgIdx >= 0 && messages.slice(userMsgIdx + 1).some(
        (m) => m.senderType === 'agent'
      );
      if (hasAgentAfterUser) {
        updated = updated.filter((m) => !m.messageId.startsWith('optimistic-loading-'));
      }
    }

    if (updated.length !== optimisticMessages.length) {
      setOptimisticMessages(updated);
    }
  }, [messages, optimisticMessages]);

  // Reset state when overlay opens/closes
  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (open !== prevOpenRef.current) {
      setOptimisticMessages([]);
      setEditingTitle(false);
      if (open) setFocusKey((k) => k + 1);
      prevOpenRef.current = open;
    }
  }, [open]);

  const startEditingTitle = () => {
    setTitleDraft(session.title || '');
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  };

  const commitTitle = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== session.title) {
      renameSession(sessionId, trimmed);
    }
  };

  const handleSend = useCallback(
    async (content: string, mentions: string[] = [], files: PendingFile[] = []) => {
      if (!currentUser.id || !currentUser.name.trim()) return;

      // Optimistic messages
      const timestamp = Date.now();
      const userContent = content || (files.length > 0 ? files.map((f) => f.file.name).join(', ') : '');
      const userOptimisticMsg: WorkspaceMessage = {
        messageId: `optimistic-user-${timestamp}`,
        sessionId,
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderType: 'human',
        content: userContent,
        messageType: 'chat',
        mentions: [],
        targetAgents: null,
        createdAt: new Date().toISOString(),
        metadata: {},
      };

      const loadingOptimisticMsg: WorkspaceMessage = {
        messageId: `optimistic-loading-${timestamp}`,
        sessionId,
        senderName: agents.find((a) => a.role === 'master')?.agentName || agents[0]?.agentName || 'Agent',
        senderType: 'agent',
        content: '',
        messageType: 'loading',
        mentions: [],
        targetAgents: null,
        createdAt: new Date().toISOString(),
        metadata: { _userContent: userContent },
      };

      setOptimisticMessages([userOptimisticMsg, loadingOptimisticMsg]);
      setScrollKey((k) => k + 1);

      try {
        let attachments: { fileId: string; filename: string; contentType: string; url: string }[] | undefined;
        if (files.length > 0) {
          const uploaded = await Promise.all(
            files.map((pf) => workspaceApi.uploadFile(pf.file, sessionId))
          );
          attachments = uploaded.map((f) => ({
            fileId: f.id,
            filename: f.filename,
            contentType: f.contentType,
            url: workspaceApi.getFileUrl(f.id),
          }));
        }

        await workspaceApi.sendMessage(
          sessionId,
          content || (attachments ? attachments.map((a) => a.filename).join(', ') : ''),
          currentUser.name,
          mentions.length > 0 ? mentions : undefined,
          attachments,
          currentUser.id,
        );
        forceRefresh();
      } catch {
        setOptimisticMessages([]);
      }
    },
    [sessionId, currentUser.id, currentUser.name, forceRefresh, agents]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullscreen" className="flex flex-col p-0 gap-0" showCloseButton>
        <DialogTitle className="sr-only">{session.title || 'Thread'}</DialogTitle>

        {/* Header — pr-12 leaves room for the absolute-positioned close button */}
        <div className="flex items-center gap-3 pl-5 pr-12 py-3 border-b shrink-0">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle();
                if (e.key === 'Escape') setEditingTitle(false);
              }}
              className="text-sm font-semibold bg-transparent border-b border-primary outline-none min-w-0 max-w-[300px] flex-1"
              autoFocus
            />
          ) : (
            <h2
              className="text-sm font-semibold truncate flex-1 cursor-pointer hover:text-primary transition-colors"
              onClick={startEditingTitle}
              title="Click to rename"
            >
              {session.title || 'Thread'}
            </h2>
          )}
          {/* Stop button — visible when a Claude agent is working */}
          {(() => {
            const masterName = session.master;
            const masterAgent = masterName ? agents.find((a) => a.agentName === masterName) : null;
            const isClaude = masterAgent?.agentType === 'claude';
            const isWorking = activeSessionIds.has(sessionId);
            const isStopping = stoppingSessionIds.has(sessionId);
            if (!isClaude || (!isWorking && !isStopping)) return null;
            return (
              <button
                onClick={() => stopAllAgents(sessionId)}
                disabled={isStopping}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors shrink-0 disabled:opacity-60 disabled:pointer-events-none"
              >
                <Square className="size-3 fill-current" />
                {isStopping ? 'Stopping...' : 'Stop'}
              </button>
            );
          })()}
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {loading && messages.length === 0 ? (
            <div className="flex items-center justify-center flex-1">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <ChatMessages
              messages={displayMessages}
              agents={agents}
              showAllSteps={false}
              scrollKey={scrollKey}
              className="flex-1 overflow-y-auto px-5 py-3"
            />
          )}

          {/* Input */}
          <div className="px-4 py-3 border-t">
            <div className="max-w-3xl mx-auto w-full">
              <ChatInput onSend={handleSend} agents={agents} disabled={!currentUser.name.trim()} focusKey={focusKey} onCreateRoutine={() => setShowCreateRoutine(true)} />
            </div>
          </div>
        </div>
      </DialogContent>

      <CreateRoutineDialog
        open={showCreateRoutine}
        onOpenChange={setShowCreateRoutine}
        agents={agents}
        onCreateRoutine={createRoutine}
      />
    </Dialog>
  );
}

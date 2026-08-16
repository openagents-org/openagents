'use client';

import { useCallback, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import { ChatMessages } from '@/components/chat/chat-messages';
import { ChatInput, type PendingFile } from '@/components/chat/chat-input';
import { useMessagePolling } from '@/hooks/use-polling';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { AgentAvatar } from '@/components/agents/agent-avatar';

interface TaskChatPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The task's hidden working thread (channel name). */
  sessionId: string;
  taskTitle: string;
  assignee: string | null;
  /** Optional status line under the title, e.g. workflow step progress. */
  subtitle?: string;
}

/**
 * A lightweight, self-contained chat window over a single task thread.
 *
 * The task thread is hidden from the main thread list, so this popup is the
 * only place a human drops into it. Rather than reuse the full `ChatView`
 * (hard-coupled to the global `currentSessionId`), we compose the same two
 * children it uses — `ChatMessages` + `ChatInput` — against a `sessionId` prop.
 */
export function TaskChatPopup({ open, onOpenChange, sessionId, taskTitle, assignee, subtitle }: TaskChatPopupProps) {
  const { agents, currentUser } = useWorkspace();
  const { messages, forceRefresh, generation, loadOlder, hasOlder, loadingOlder } = useMessagePolling({
    sessionId,
    enabled: open,
  });
  const [scrollKey, setScrollKey] = useState(0);

  const handleSend = useCallback(
    async (content: string, mentions: string[] = [], files: PendingFile[] = []) => {
      if (!content.trim() && files.length === 0) return;
      setScrollKey((k) => k + 1);
      try {
        let attachments:
          | { fileId: string; filename: string; contentType: string; url: string }[]
          | undefined;
        if (files.length > 0) {
          const uploaded = await Promise.all(files.map((pf) => workspaceApi.uploadFile(pf.file, sessionId)));
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
        // Surface via missing message; polling will reconcile.
      }
    },
    [sessionId, currentUser.name, currentUser.id, forceRefresh],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 py-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            {assignee && <AgentAvatar name={assignee} size={20} />}
            <span className="truncate">{taskTitle}</span>
          </DialogTitle>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
          )}
        </DialogHeader>

        {/* ChatMessages' root is `flex-1 min-h-0`, so it must be a DIRECT child
            of this flex column to get a bounded height and scroll — wrapping it
            in a plain div collapses that and the list overflows the dialog. */}
        <div className="flex flex-col h-[60vh] min-h-0">
          <ChatMessages
            messages={messages}
            agents={agents}
            showAllSteps={false}
            scrollKey={scrollKey + generation}
            loadOlder={loadOlder}
            hasOlder={hasOlder}
            loadingOlder={loadingOlder}
            className="h-full overflow-y-auto px-4 py-3"
          />
          <div className="border-t border-border p-3">
            <ChatInput onSend={handleSend} agents={agents} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

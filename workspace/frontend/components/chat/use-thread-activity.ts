'use client';

import { useEffect, useRef } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import type { WorkspaceMessage } from '@/lib/types';
import { TERMINAL_STATUS_RE } from './chat-message-groups';

// Any message type counts here (not only `status`), as before the split.
const isTerminalStatus = (msg: WorkspaceMessage) => TERMINAL_STATUS_RE.test(msg.content);
const isWorkingType = (msg: WorkspaceMessage) =>
  msg.messageType === 'status' || msg.messageType === 'thinking' || msg.messageType === 'loading';

/**
 * Mirrors the open thread into workspace state: the thread list's last-message
 * preview, whether an agent is working here, and each agent's reported mode.
 */
export function useThreadActivity(currentSessionId: string | null, chatLogMessages: WorkspaceMessage[], displayMessages: WorkspaceMessage[]) {
  const { updateLastMessage, setSessionActive, updateAgentMode } = useWorkspace();

  // Update last message cache for thread list preview
  useEffect(() => {
    if (!currentSessionId) return;
    const lastMsg = chatLogMessages[chatLogMessages.length - 1];
    if (lastMsg) {
      const isWorking = !isTerminalStatus(lastMsg) && isWorkingType(lastMsg);
      updateLastMessage(currentSessionId, lastMsg.senderName, lastMsg.content, isWorking, lastMsg.senderType === 'agent');
    } else {
      updateLastMessage(currentSessionId, '', '', false, false);
    }
  }, [currentSessionId, chatLogMessages, updateLastMessage]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const isAgentWorking = lastMsg.senderType === 'agent' && !isTerminalStatus(lastMsg) && isWorkingType(lastMsg);
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
}

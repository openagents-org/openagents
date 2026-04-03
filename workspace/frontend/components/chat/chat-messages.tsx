'use client';

import { cn } from '@/lib/utils';
import { ChatMessage } from './chat-message';
import { IntermediateSteps } from './intermediate-steps';
import { Button } from '@/components/ui/button';
import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';

// ── Message Grouping ──

type MessageGroup =
  | { type: 'chat'; message: WorkspaceMessage }
  | { type: 'steps'; messages: WorkspaceMessage[] };

function groupMessages(messages: WorkspaceMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let currentSteps: WorkspaceMessage[] = [];

  const flushSteps = () => {
    if (currentSteps.length > 0) {
      groups.push({ type: 'steps', messages: [...currentSteps] });
      currentSteps = [];
    }
  };

  messages.forEach((msg) => {
    if (msg.messageType === 'status' || msg.messageType === 'thinking') {
      currentSteps.push(msg);
    } else {
      flushSteps();
      groups.push({ type: 'chat', message: msg });
    }
  });

  flushSteps();
  return groups;
}

// Stable key for a group
function groupKey(group: MessageGroup): string {
  return group.type === 'chat'
    ? group.message.messageId
    : `steps-${group.messages[0].messageId}`;
}

// ── Component ──

interface ChatMessagesProps {
  messages: WorkspaceMessage[];
  agents?: WorkspaceAgent[];
  showAllSteps: boolean;
  className?: string;
  /** Increment to force scroll to bottom (e.g. after user sends a message). */
  scrollKey?: number;
  /** Callback to load older messages (infinite scroll upward). */
  loadOlder?: () => Promise<void>;
  /** Whether there are older messages available to load. */
  hasOlder?: boolean;
  /** Whether older messages are currently being loaded. */
  loadingOlder?: boolean;
}

export function ChatMessages({ messages, agents, showAllSteps, className, scrollKey, loadOlder, hasOlder, loadingOlder }: ChatMessagesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const prevLengthRef = useRef(0);
  // Track session identity to reset scroll state on thread switch
  const prevSessionRef = useRef<string | null>(null);

  // Separate loading indicators (optimistic) from real messages
  const loadingMessages = useMemo(() => messages.filter((m) => m.messageType === 'loading'), [messages]);
  const realMessages = useMemo(() => messages.filter((m) => m.messageType !== 'loading'), [messages]);

  // Filter: skip empty status messages; when toggle is off, only show status messages after the last chat message
  const filteredMessages = useMemo(() => {
    const isStep = (msg: WorkspaceMessage) => msg.messageType === 'status' || msg.messageType === 'thinking';

    // Deduplicate: if a chat message follows thinking from the same agent
    // with matching content, hide the thinking (it was the final answer
    // streamed early as "thinking" before being posted as "chat").
    const deduped = realMessages.filter((msg, i) => {
      if (msg.messageType !== 'thinking') return true;
      // Look ahead for a chat message from the same agent
      for (let j = i + 1; j < realMessages.length; j++) {
        const next = realMessages[j];
        if (next.senderName !== msg.senderName) continue;
        if (next.messageType === 'status' || next.messageType === 'thinking') continue;
        // Found a chat message from the same agent — check content overlap.
        // Thinking is truncated to 500 chars + "...", so check if chat
        // starts with the thinking text (minus trailing "...").
        const thinkText = msg.content.replace(/\.\.\.$/,'').trim();
        if (thinkText && next.content.startsWith(thinkText)) return false;
        break;
      }
      return true;
    });

    const nonEmpty = deduped.filter((msg) => !isStep(msg) || msg.content.trim());
    if (showAllSteps) return nonEmpty;

    let lastChatIndex = -1;
    for (let i = nonEmpty.length - 1; i >= 0; i--) {
      if (!isStep(nonEmpty[i])) {
        lastChatIndex = i;
        break;
      }
    }

    // Check if the very last message is a step (agent still working)
    const lastIsStep = nonEmpty.length > 0 && isStep(nonEmpty[nonEmpty.length - 1]);

    // Keep: all non-step messages, all thinking messages (they persist),
    // and trailing status only if agent is still actively working
    const trailing = nonEmpty.filter((msg, index) => {
      if (!isStep(msg)) return true;
      // Always keep thinking messages — they provide reasoning context
      if (msg.messageType === 'thinking') return true;
      // Only keep trailing status if agent is still working
      // (last message is a step, meaning no chat response yet)
      return lastIsStep && index > lastChatIndex;
    });
    // Find the last status-only message and keep only that one
    let lastStatusIndex = -1;
    for (let i = trailing.length - 1; i >= 0; i--) {
      if (trailing[i].messageType === 'status') {
        lastStatusIndex = i;
        break;
      }
    }
    return trailing.filter((msg, index) => {
      if (msg.messageType !== 'status') return true;
      return index === lastStatusIndex;
    });
  }, [realMessages, showAllSteps]);

  // Group into chat messages and intermediate step clusters
  const groups = useMemo(() => groupMessages(filteredMessages), [filteredMessages]);

  // Loading indicator counts as a virtual row when present
  const hasLoading = loadingMessages.length > 0;
  const totalCount = groups.length + (hasLoading ? 1 : 0);

  // ── Virtualizer ──
  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 80, // rough estimate; dynamic measurement corrects it
    overscan: 10,
    getItemKey: (index) => {
      if (index < groups.length) return groupKey(groups[index]);
      return 'loading-indicator';
    },
  });

  const scrollToBottom = useCallback(() => {
    if (totalCount > 0) {
      virtualizer.scrollToIndex(totalCount - 1, { align: 'end' });
      // Also nudge the native scroll in case the virtualizer hasn't measured the last item yet
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }
  }, [totalCount, virtualizer]);

  // Derive the current session from messages for thread-switch detection
  const currentSessionId = messages.length > 0 ? messages[0].sessionId : null;

  // Auto-scroll on new messages
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Detect thread switch: reset prevLength so wasEmpty triggers scroll-to-bottom
    if (currentSessionId !== prevSessionRef.current) {
      prevSessionRef.current = currentSessionId;
      prevLengthRef.current = 0;
    }

    const wasEmpty = prevLengthRef.current === 0;
    prevLengthRef.current = messages.length;

    // Always scroll on initial load or thread switch; otherwise only if near bottom
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (wasEmpty || isNearBottom) {
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
  }, [messages.length, currentSessionId, scrollToBottom]);

  // Force scroll when scrollKey changes (user sent a message)
  useEffect(() => {
    if (scrollKey) {
      requestAnimationFrame(() => scrollToBottom());
    }
  }, [scrollKey, scrollToBottom]);

  // Track scroll position for "scroll to bottom" button + infinite scroll upward
  const loadingOlderInternalRef = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = async () => {
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      setShowScrollBtn(!isNearBottom);

      // Infinite scroll: load older messages when near the top
      if (
        el.scrollTop < 100 &&
        hasOlder &&
        !loadingOlder &&
        !loadingOlderInternalRef.current &&
        loadOlder
      ) {
        loadingOlderInternalRef.current = true;
        const prevScrollHeight = el.scrollHeight;
        await loadOlder();
        // Maintain scroll position after prepending older messages
        requestAnimationFrame(() => {
          const newScrollHeight = el.scrollHeight;
          el.scrollTop = newScrollHeight - prevScrollHeight;
          loadingOlderInternalRef.current = false;
        });
      }
    };

    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasOlder, loadingOlder, loadOlder]);

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        className={cn('h-full overflow-y-auto', className)}
      >
        {loadingOlder && (
          <div className="flex items-center justify-center py-3">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {hasOlder && !loadingOlder && loadOlder && (
          <button
            onClick={async () => {
              const el = containerRef.current;
              if (!el) return;
              const prevScrollHeight = el.scrollHeight;
              await loadOlder();
              requestAnimationFrame(() => {
                el.scrollTop = el.scrollHeight - prevScrollHeight;
              });
            }}
            className="flex items-center justify-center py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Load older messages
          </button>
        )}
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const index = virtualRow.index;

            // Loading indicator row (last virtual item when loading)
            if (index >= groups.length) {
              return (
                <div
                  key="loading-indicator"
                  ref={virtualizer.measureElement}
                  data-index={index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="flex items-start gap-3 py-1">
                    <div className="size-8 shrink-0" />
                    <div className="py-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/breathing-dots.gif" alt="Agent is working" width={44} height={14} className="opacity-90" />
                    </div>
                  </div>
                </div>
              );
            }

            const group = groups[index];
            return (
              <div
                key={groupKey(group)}
                ref={virtualizer.measureElement}
                data-index={index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {group.type === 'chat' ? (
                  <ChatMessage
                    message={group.message}
                    agents={agents}
                  />
                ) : (
                  <IntermediateSteps
                    steps={group.messages}
                    agents={agents}
                    isActive={index === groups.length - 1}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showScrollBtn && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full shadow-lg"
            onClick={scrollToBottom}
          >
            <ArrowDown className="size-4 mr-1" />
            New messages
          </Button>
        </div>
      )}
    </div>
  );
}

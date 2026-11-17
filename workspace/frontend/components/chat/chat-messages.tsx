'use client';

import { applyMessageRecalls } from '@/lib/message-recall';
import { workspaceApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { MessageReactionsProvider } from './message-reactions';
import { ChatMessage } from './chat-message';
import { IntermediateSteps } from './intermediate-steps';
import { ThinkingMessage } from './thinking-message';
import { WorkingBubble } from './working-bubble';
import { Button } from '@/components/ui/button';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { Spinner } from '@/components/ui/spinner';
import { ArrowDown } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';
import { isControlMessage } from '@/lib/control-messages';
import { useT } from '@/lib/i18n';
import { filterThreadSteps, groupKey, groupMessages, isTerminalStatus } from './chat-message-groups';
import { useChatScroll } from './use-chat-scroll';
import { useMessageTarget, useScrollToTarget } from './use-message-target';

// ── Component ──

interface ChatMessagesProps {
  messages: WorkspaceMessage[];
  agents?: WorkspaceAgent[];
  className?: string;
  /** Increment to force scroll to bottom (e.g. after user sends a message). */
  scrollKey?: number;
  /** Callback to load older messages (infinite scroll upward). */
  loadOlder?: () => Promise<void>;
  /** Whether there are older messages available to load. */
  hasOlder?: boolean;
  /** Whether older messages are currently being loaded. */
  loadingOlder?: boolean;
  /** Send a suggested prompt as the user's message (tap-to-ask chips). */
  onSuggestion?: (text: string) => void;
  onMentionPerson?: (email: string) => void;
  onReply?: (message: WorkspaceMessage) => void;
  /** The thread shown, when this is the main view: message links opened in-app scroll here. */
  targetSessionId?: string | null;
}

function ChatMessagesContent({ messages, agents, className, scrollKey, loadOlder, hasOlder, loadingOlder, onSuggestion, onMentionPerson, onReply, targetSessionId }: ChatMessagesProps) {
  const t = useT();
  const target = useMessageTarget(targetSessionId);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Separate loading indicators (optimistic) from real messages
  const [locallyRecalled, setLocallyRecalled] = useState<Set<string>>(new Set());
  const visibleMessages = useMemo(() => applyMessageRecalls(messages, locallyRecalled), [messages, locallyRecalled]);
  const recall = async (message: WorkspaceMessage) => {
    await workspaceApi.recallMessage(message.messageId);
    setLocallyRecalled(previous => new Set([...previous, message.messageId]));
  };
  const loadingMessages = useMemo(() => visibleMessages.filter((m) => m.messageType === 'loading'), [visibleMessages]);
  // Assignment events dispatch the original request internally; they are not
  // another conversation message. Keep any actual approval cards visible.
  // Control signals (a queue cancel) are bookkeeping, never a bubble — this
  // covers every view that renders a thread through ChatMessages.
  const realMessages = useMemo(() => visibleMessages.filter((m) =>
    m.messageType !== 'loading' && !isControlMessage(m) &&
    (!m.metadata?.routing_assignment || m.messageType === 'approval' || !!m.metadata?.approval)
  ), [visibleMessages]);

  // Filter: skip empty steps and thinking that only previewed the reply
  const filteredMessages = useMemo(() => filterThreadSteps(realMessages), [realMessages]);

  // Group into chat messages and intermediate step clusters
  const groups = useMemo(() => groupMessages(filteredMessages), [filteredMessages]);

  const hasTerminalStatus = realMessages.some(isTerminalStatus);

  // Loading indicator counts as a virtual row when present
  const hasLoading = loadingMessages.length > 0 && !hasTerminalStatus;
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

  const { showScrollBtn, userScrolledUpRef, settlingRef, scrollFrameRef, loadOlderFromTop, jumpToLatest } = useChatScroll({
    containerRef, contentRef, messages, totalCount, scrollKey, loadOlder, hasOlder, loadingOlder, targetSessionId,
    targetPendingRef: target.targetPendingRef,
  });
  useScrollToTarget({ target, containerRef, userScrolledUpRef, settlingRef, scrollFrameRef, virtualizer, realMessages, groups, loadOlder, hasOlder, loadingOlder });
  const { highlightedMessage } = target;

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        tabIndex={0}
        className={cn('h-full overflow-y-auto', className)}
      >
        {loadingOlder && (
          <div className="flex items-center justify-center py-3 text-muted-foreground">
            <Spinner />
          </div>
        )}
        {hasOlder && !loadingOlder && loadOlder && (
          <Marker variant="separator" asChild className="py-2 transition-colors hover:text-foreground">
            <button type="button" onClick={() => { void loadOlderFromTop(); }}>
              <MarkerContent>{t('chat.loadOlderMessages')}</MarkerContent>
            </button>
          </Marker>
        )}
        <div
          ref={contentRef}
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
                  <div className="w-full">
                    {/* Optimistic "waiting for a reply" row, attributed to the
                        agent the placeholder was created for (see chat-view). */}
                    <WorkingBubble
                      agentName={loadingMessages[loadingMessages.length - 1]?.senderName}
                      agents={agents}
                    />
                  </div>
                </div>
              );
            }

            const group = groups[index];
            return (
              <div
                key={groupKey(group)}
                data-message-id={groupKey(group)}
                className={highlightedMessage === groupKey(group) ? "rounded-md bg-primary/10 ring-1 ring-inset ring-primary/30" : undefined}
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
                {/* Full-bleed conversation column, Slack/Feishu-style: the text
                    tracks the pane width; only the gutters are fixed. Individual
                    bubbles cap their own width (see chat-message). */}
                <div className="w-full">
                  {group.type === 'chat' ? (
                    <ChatMessage
                      message={group.message}
                      agents={agents}
                      isLast={index === groups.length - 1}
                      onSuggestion={onSuggestion}
                      onMentionPerson={onMentionPerson}
                      onReply={onReply}
                      onRecall={recall}
                    />
                  ) : group.type === 'thinking' ? (
                    <ThinkingMessage
                      sender={group.sender}
                      messages={group.messages}
                      agents={agents}
                      isActive={index === groups.length - 1}
                    />
                  ) : (
                    <IntermediateSteps
                      steps={group.messages}
                      agents={agents}
                      isActive={index === groups.length - 1}
                    />
                  )}
                </div>
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
            onClick={jumpToLatest}
          >
            <ArrowDown data-icon="inline-start" />
            {t('chat.newMessages')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ChatMessages(props: ChatMessagesProps) {
  return <MessageReactionsProvider messages={props.messages}><ChatMessagesContent key={props.messages[0]?.sessionId} {...props} /></MessageReactionsProvider>;
}

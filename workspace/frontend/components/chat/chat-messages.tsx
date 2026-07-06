'use client';

import { cn } from '@/lib/utils';
import { ChatMessage } from './chat-message';
import { IntermediateSteps } from './intermediate-steps';
import { ThinkingMessage } from './thinking-message';
import { WorkingIndicator } from './working-indicator';
import { Button } from '@/components/ui/button';
import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';

// ── Message Grouping ──

type MessageGroup =
  | { type: 'chat'; message: WorkspaceMessage }
  | { type: 'thinking'; sender: string; messages: WorkspaceMessage[] }
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
    if (msg.messageType === 'thinking') {
      // Thinking is a first-level block (shown with its author), so flush any
      // pending sub-level steps first to keep ordering. Consecutive thinking
      // chunks from the same sender collapse into one block.
      flushSteps();
      const last = groups[groups.length - 1];
      if (last && last.type === 'thinking' && last.sender === msg.senderName) {
        last.messages.push(msg);
      } else {
        groups.push({ type: 'thinking', sender: msg.senderName, messages: [msg] });
      }
    } else if (msg.messageType === 'status' || msg.messageType === 'todos') {
      // Tool calls / status / todos stay clustered at the sub level.
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
  if (group.type === 'chat') return group.message.messageId;
  if (group.type === 'thinking') return `thinking-${group.messages[0].messageId}`;
  return `steps-${group.messages[0].messageId}`;
}

function isTerminalStatus(msg: WorkspaceMessage) {
  return (
    msg.messageType === 'status' &&
    /stopped|stopping failed/i.test(msg.content)
  );
}

// Scroll diagnostics. Always on in dev; in production it's opt-in via
// `localStorage.setItem('oa_debug_scroll','1')` so we can diagnose the rare
// scroll-jump in the wild (e.g. on network reconnect) without shipping console
// noise to every user. Evaluated once at module load.
const DEBUG_SCROLL =
  process.env.NODE_ENV !== 'production' ||
  (() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem('oa_debug_scroll') === '1';
    } catch {
      return false;
    }
  })();
function scrollDebug(source: string, el: HTMLElement | null, extra?: Record<string, unknown>) {
  if (!DEBUG_SCROLL || !el) return;
  const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  // eslint-disable-next-line no-console
  console.debug('[chat-scroll]', source, {
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    isNearBottom,
    ...extra,
  });
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
  // Track first/last message identity to distinguish prepend (older history
  // loaded at the top) from append (new message at the bottom).
  const prevFirstIdRef = useRef<string | null>(null);
  const prevLastIdRef = useRef<string | null>(null);
  // Track the last scrollKey value so the force-scroll effect only fires when
  // scrollKey *actually* changes — not when scrollToBottom's identity changes
  // (which it does on every message-count change, including history prepend).
  const prevScrollKeyRef = useRef(scrollKey);
  // Track session identity to reset scroll state on thread switch
  const prevSessionRef = useRef<string | null>(null);
  // True when the user has intentionally scrolled away from the bottom.
  // Prevents auto-scroll from yanking them back while reading history.
  const userScrolledUpRef = useRef(false);

  // Separate loading indicators (optimistic) from real messages
  const loadingMessages = useMemo(() => messages.filter((m) => m.messageType === 'loading'), [messages]);
  const realMessages = useMemo(() => messages.filter((m) => m.messageType !== 'loading'), [messages]);

  // Filter: skip empty status messages; when toggle is off, only show status messages after the last chat message
  const filteredMessages = useMemo(() => {
    const isStep = (msg: WorkspaceMessage) => msg.messageType === 'status' || msg.messageType === 'thinking' || msg.messageType === 'todos';

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
      // Always keep thinking and todos — they provide reasoning context
      if (msg.messageType === 'thinking' || msg.messageType === 'todos') return true;
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

  // A settle-to-bottom pass is in progress. Any real user scroll gesture
  // cancels it (see the wheel/touch/mousedown listeners below) so we never
  // fight the user, and it self-terminates once the height stabilizes.
  const settlingRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    if (totalCount === 0) return;
    // Why a loop and not a single scrollTop=scrollHeight: the virtualizer
    // estimates every unmeasured row at 80px, so one corrective pin lands at
    // the *estimated* bottom. The real bottom rows (tall markdown, tables) are
    // then measured, the total height grows, and the view is left ABOVE the
    // true bottom — the visible "flash then not at the bottom". Two frames
    // isn't enough for tall rows to finish measuring. So re-pin every frame
    // until scrollHeight stops changing (measurement done), with a safety cap
    // to guarantee termination.
    settlingRef.current = true;
    let lastHeight = -1;
    let stableFrames = 0;
    let frames = 0;
    const step = () => {
      const el = containerRef.current;
      if (!el || !settlingRef.current) return;
      el.scrollTop = el.scrollHeight;
      if (el.scrollHeight === lastHeight) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        lastHeight = el.scrollHeight;
      }
      frames += 1;
      // Done once the height has held steady for a few frames, or after a
      // ~1s cap (60 frames) as an unconditional backstop.
      if (stableFrames >= 3 || frames >= 60) {
        settlingRef.current = false;
        scrollDebug('scroll-settled', el, { frames, scrollHeight: el.scrollHeight });
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [totalCount]);

  // Derive the current session + first/last message identity from messages.
  const currentSessionId = messages.length > 0 ? messages[0].sessionId : null;
  const firstId = messages.length > 0 ? messages[0].messageId : null;
  const lastId = messages.length > 0 ? messages[messages.length - 1].messageId : null;

  // Auto-scroll on new messages — but NOT when the user has scrolled up to read
  // history, and NOT when older history is prepended at the top.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // ① Thread switch (incl. first mount, cache-seeded switch): always scroll
    //    to bottom. This is the only scroll-to-bottom source for cache-hit
    //    switches, where scrollKey may not change.
    if (currentSessionId !== prevSessionRef.current) {
      prevSessionRef.current = currentSessionId;
      prevLengthRef.current = messages.length;
      prevFirstIdRef.current = firstId;
      prevLastIdRef.current = lastId;
      userScrolledUpRef.current = false;
      scrollDebug('session-switch', el, { messageCount: messages.length, totalCount });
      requestAnimationFrame(() => scrollToBottom());
      return;
    }

    // ② Prepend detection: count grew, the first message changed, but the last
    //    message is unchanged → older history loaded at the top. Never scroll.
    const grew = messages.length > prevLengthRef.current;
    const isPrepend = grew && firstId !== prevFirstIdRef.current && lastId === prevLastIdRef.current;
    prevLengthRef.current = messages.length;
    prevFirstIdRef.current = firstId;
    prevLastIdRef.current = lastId;
    if (isPrepend) {
      scrollDebug('history-prepend', el, { messageCount: messages.length, totalCount });
      return;
    }

    // ③ Append / replace / new (streamed) message: follow only when the user is
    //    already near the bottom.
    if (userScrolledUpRef.current) {
      scrollDebug('append-skip-userUp', el, { messageCount: messages.length, totalCount });
      return;
    }
    scrollDebug('append-follow', el, { messageCount: messages.length, totalCount });
    requestAnimationFrame(() => scrollToBottom());
  }, [messages.length, currentSessionId, firstId, lastId, totalCount, scrollToBottom]);

  // Force scroll when scrollKey *actually* changes (user sent a message, clicked
  // "New messages", or a backfill bumped it). Guard on the real value so a mere
  // scrollToBottom identity change (from a message-count change such as history
  // prepend) does not re-trigger a scroll-to-bottom.
  useEffect(() => {
    if (scrollKey !== prevScrollKeyRef.current) {
      prevScrollKeyRef.current = scrollKey;
      userScrolledUpRef.current = false;
      scrollDebug('scrollKey-change', containerRef.current, { scrollKey });
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
      userScrolledUpRef.current = !isNearBottom;

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
        scrollDebug('load-older-start', el, { prevScrollHeight });
        await loadOlder();
        // Maintain scroll position after prepending older messages
        requestAnimationFrame(() => {
          const newScrollHeight = el.scrollHeight;
          el.scrollTop = newScrollHeight - prevScrollHeight;
          loadingOlderInternalRef.current = false;
          scrollDebug('load-older-compensate', el, { prevScrollHeight, newScrollHeight, delta: newScrollHeight - prevScrollHeight });
        });
      }
    };

    // A real user scroll gesture cancels any in-flight settle-to-bottom so we
    // never yank them back while they're reading. Measurement-driven reflows
    // (which are what the settle loop exists to absorb) don't fire these.
    const cancelSettle = () => { settlingRef.current = false; };

    el.addEventListener('scroll', onScroll);
    el.addEventListener('wheel', cancelSettle, { passive: true });
    el.addEventListener('touchmove', cancelSettle, { passive: true });
    el.addEventListener('mousedown', cancelSettle);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', cancelSettle);
      el.removeEventListener('touchmove', cancelSettle);
      el.removeEventListener('mousedown', cancelSettle);
    };
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
              scrollDebug('load-older-start(button)', el, { prevScrollHeight });
              await loadOlder();
              requestAnimationFrame(() => {
                const newScrollHeight = el.scrollHeight;
                el.scrollTop = newScrollHeight - prevScrollHeight;
                scrollDebug('load-older-compensate(button)', el, { prevScrollHeight, newScrollHeight, delta: newScrollHeight - prevScrollHeight });
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
                      <WorkingIndicator />
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
                ) : group.type === 'thinking' ? (
                  <ThinkingMessage
                    sender={group.sender}
                    messages={group.messages}
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
            onClick={() => { scrollDebug('user-click-scroll-bottom', containerRef.current); userScrolledUpRef.current = false; scrollToBottom(); }}
          >
            <ArrowDown className="size-4 mr-1" />
            New messages
          </Button>
        </div>
      )}
    </div>
  );
}

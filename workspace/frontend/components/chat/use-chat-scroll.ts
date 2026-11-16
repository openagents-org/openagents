'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import type { WorkspaceMessage } from '@/lib/types';
import { scrollDebug } from './chat-scroll-debug';

interface UseChatScrollOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  messages: WorkspaceMessage[];
  /** Virtual row count (groups plus the loading row). */
  totalCount: number;
  scrollKey?: number;
  loadOlder?: () => Promise<void>;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  targetSessionId?: string | null;
  /** Set while a linked message is being scrolled to; pauses bottom-follow. */
  targetPendingRef: MutableRefObject<string | null>;
}

/**
 * Bottom-follow, history prepend and "new messages" state for the virtualized
 * chat list. Follows the live edge until a real user gesture leaves it, keeps
 * the reading position when older history loads at the top, and settles on the
 * true bottom once the virtualizer has measured the tall rows.
 */
export function useChatScroll({ containerRef, contentRef, messages, totalCount, scrollKey, loadOlder, hasOlder, loadingOlder, targetSessionId, targetPendingRef }: UseChatScrollOptions) {
  const scrollFrameRef = useRef<number | null>(null);
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

  // A settle-to-bottom pass is in progress. Any real user scroll gesture
  // cancels it (see the wheel/touch/mousedown listeners below) so we never
  // fight the user, and it self-terminates once the height stabilizes.
  const settlingRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    if (totalCount === 0 || targetPendingRef.current) return;
    // Land on the estimated bottom synchronously. On a thread switch the
    // layout effect below runs before paint; waiting for the first animation
    // frame would briefly show the top of a long conversation.
    const initialElement = containerRef.current;
    if (initialElement) initialElement.scrollTop = initialElement.scrollHeight;
    // Why a loop and not a single scrollTop=scrollHeight: the virtualizer
    // estimates every unmeasured row at 80px, so one corrective pin lands at
    // the *estimated* bottom. The real bottom rows (tall markdown, tables) are
    // then measured, the total height grows, and the view is left ABOVE the
    // true bottom — the visible "flash then not at the bottom". Two frames
    // isn't enough for tall rows to finish measuring. So re-pin every frame
    // until scrollHeight stops changing (measurement done), with a safety cap
    // to guarantee termination.
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    userScrolledUpRef.current = false;
    settlingRef.current = true;
    let lastHeight = -1;
    let stableFrames = 0;
    let frames = 0;
    const step = () => {
      scrollFrameRef.current = null;
      const el = containerRef.current;
      if (!el || !settlingRef.current || userScrolledUpRef.current) return;
      el.scrollTop = el.scrollHeight;
      setShowScrollBtn(false);
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
      scrollFrameRef.current = requestAnimationFrame(step);
    };
    scrollFrameRef.current = requestAnimationFrame(step);
  }, [totalCount]);

  // Images and virtual rows can change height long after the initial settle.
  // Keep following layout changes until a user gesture leaves the bottom.
  useEffect(() => {
    const el = containerRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const observer = new ResizeObserver(() => {
      if (!userScrolledUpRef.current && !loadingOlderInternalRef.current) scrollToBottom();
    });
    observer.observe(content);
    observer.observe(el);
    return () => {
      observer.disconnect();
      settlingRef.current = false;
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    };
  }, [scrollToBottom]);

  // Derive the current session + first/last message identity from messages.
  const currentSessionId = targetSessionId ?? (messages.length > 0 ? messages[0].sessionId : prevSessionRef.current);
  const firstId = messages.length > 0 ? messages[0].messageId : null;
  const lastId = messages.length > 0 ? messages[messages.length - 1].messageId : null;

  // Auto-scroll on new messages — but NOT when the user has scrolled up to read
  // history, and NOT when older history is prepended at the top.
  useLayoutEffect(() => {
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
      scrollToBottom();
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
    scrollToBottom();
  }, [messages.length, currentSessionId, firstId, lastId, totalCount, scrollToBottom]);

  // Force scroll when scrollKey *actually* changes (user sent a message, clicked
  // "New messages"). Guard on the real value so a mere
  // scrollToBottom identity change (from a message-count change such as history
  // prepend) does not re-trigger a scroll-to-bottom.
  useEffect(() => {
    if (scrollKey !== prevScrollKeyRef.current) {
      prevScrollKeyRef.current = scrollKey;
      userScrolledUpRef.current = false;
      scrollDebug('scrollKey-change', containerRef.current, { scrollKey });
      scrollToBottom();
    }
  }, [scrollKey, scrollToBottom]);

  // Track scroll position for "scroll to bottom" button + infinite scroll upward
  const loadingOlderInternalRef = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let resumeOnScroll = false;
    let scrollbarDragging = false;
    let lastScrollTop = el.scrollTop;
    let lastTouchY: number | null = null;

    const onScroll = async () => {
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      const movingDown = el.scrollTop > lastScrollTop;
      lastScrollTop = el.scrollTop;
      setShowScrollBtn(!isNearBottom);
      // A reflow/programmatic scroll is not evidence of user intent. Only
      // resume following here after an actual gesture has scrolled back down.
      if (userScrolledUpRef.current && isNearBottom && (resumeOnScroll || (scrollbarDragging && movingDown))) {
        userScrolledUpRef.current = false;
      }
      resumeOnScroll = false;

      // Infinite scroll: load older messages when near the top
      if (
        !targetPendingRef.current &&
        userScrolledUpRef.current &&
        el.scrollTop < 100 &&
        hasOlder &&
        !loadingOlder &&
        !loadingOlderInternalRef.current &&
        loadOlder
      ) {
        loadingOlderInternalRef.current = true;
        const prevScrollHeight = el.scrollHeight;
        const prevScrollTop = el.scrollTop;
        const loadingSession = prevSessionRef.current;
        scrollDebug('load-older-start', el, { prevScrollHeight });
        await loadOlder();
        // Maintain scroll position after prepending older messages
        requestAnimationFrame(() => {
          if (containerRef.current !== el || prevSessionRef.current !== loadingSession) { loadingOlderInternalRef.current = false; return; }
          const newScrollHeight = el.scrollHeight;
          el.scrollTop = prevScrollTop + newScrollHeight - prevScrollHeight;
          loadingOlderInternalRef.current = false;
          scrollDebug('load-older-compensate', el, { prevScrollHeight, newScrollHeight, delta: newScrollHeight - prevScrollHeight });
        });
      }
    };

    // A real user scroll gesture cancels any in-flight settle-to-bottom so we
    // never yank them back while they're reading. Measurement-driven reflows
    // (which are what the settle loop exists to absorb) don't fire these.
    const cancelSettle = (allowResume = false) => {
      settlingRef.current = false;
      userScrolledUpRef.current = true;
      resumeOnScroll = allowResume;
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    };
    const onWheel = (event: WheelEvent) => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 1;
      if (event.deltaY < 0 || !atBottom) cancelSettle(event.deltaY > 0);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (event.target === el) { scrollbarDragging = true; cancelSettle(); }
    };
    const onMouseUp = () => { scrollbarDragging = false; };
    const onTouchStart = (event: TouchEvent) => { lastTouchY = event.touches[0]?.clientY ?? null; };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? null;
      cancelSettle(y !== null && lastTouchY !== null && y < lastTouchY);
      lastTouchY = y;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
        && event.target === el) cancelSettle(['ArrowDown', 'PageDown', 'End'].includes(event.key) || (event.key === ' ' && !event.shiftKey));
    };

    el.addEventListener('scroll', onScroll);
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('keydown', onKeyDown);
    };
  }, [hasOlder, loadingOlder, loadOlder]);

  /** "Load older messages" row: prepend history and keep the reading position. */
  const loadOlderFromTop = async () => {
    const el = containerRef.current;
    if (!el || !loadOlder) return;
    userScrolledUpRef.current = true;
    settlingRef.current = false;
    const prevScrollHeight = el.scrollHeight;
    scrollDebug('load-older-start(button)', el, { prevScrollHeight });
    await loadOlder();
    requestAnimationFrame(() => {
      const newScrollHeight = el.scrollHeight;
      el.scrollTop = newScrollHeight - prevScrollHeight;
      scrollDebug('load-older-compensate(button)', el, { prevScrollHeight, newScrollHeight, delta: newScrollHeight - prevScrollHeight });
    });
  };

  /** "New messages" button: resume following and jump to the live edge. */
  const jumpToLatest = () => {
    scrollDebug('user-click-scroll-bottom', containerRef.current);
    userScrolledUpRef.current = false;
    scrollToBottom();
  };

  return { showScrollBtn, userScrolledUpRef, settlingRef, scrollFrameRef, loadOlderFromTop, jumpToLatest };
}

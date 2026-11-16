'use client';

import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { toast } from 'sonner';
import type { Virtualizer } from '@tanstack/react-virtual';
import { requestedMessageId } from '@/lib/thread-link';
import { desktopHost } from '@/lib/desktop-host';
import { MESSAGE_TARGET_EVENT, takeMessageTarget } from '@/lib/message-target';
import { useT } from '@/lib/i18n';
import type { WorkspaceMessage } from '@/lib/types';
import { groupKey, type MessageGroup } from './chat-message-groups';

/**
 * The message a link asked to open: read from the URL on mount, and from
 * in-app message links aimed at `targetSessionId` afterwards.
 */
export function useMessageTarget(targetSessionId?: string | null) {
  const [targetMessage, setTargetMessage] = useState(() => {
    if (typeof window === 'undefined') return null;
    // The desktop app routes in the hash, so its message links live there.
    return requestedMessageId(desktopHost() ? window.location.hash.slice(1) : window.location.href);
  });
  const [highlightedMessage, setHighlightedMessage] = useState<string | null>(null);
  const targetPendingRef = useRef(targetMessage);
  targetPendingRef.current = targetMessage;
  const lastTargetPageRef = useRef<string | null>(null);
  useEffect(() => {
    if (targetSessionId === undefined) return;
    const take = () => {
      const id = takeMessageTarget(targetSessionId);
      if (!id) return;
      lastTargetPageRef.current = null;
      setTargetMessage(id);
    };
    take();
    window.addEventListener(MESSAGE_TARGET_EVENT, take);
    return () => window.removeEventListener(MESSAGE_TARGET_EVENT, take);
  }, [targetSessionId]);

  return { targetMessage, setTargetMessage, highlightedMessage, setHighlightedMessage, targetPendingRef, lastTargetPageRef };
}

interface UseScrollToTargetOptions {
  target: ReturnType<typeof useMessageTarget>;
  containerRef: RefObject<HTMLDivElement | null>;
  userScrolledUpRef: MutableRefObject<boolean>;
  settlingRef: MutableRefObject<boolean>;
  scrollFrameRef: MutableRefObject<number | null>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  realMessages: WorkspaceMessage[];
  groups: MessageGroup[];
  loadOlder?: () => Promise<void>;
  hasOlder?: boolean;
  loadingOlder?: boolean;
}

/**
 * Scroll the linked message into the middle of the view and highlight it,
 * paging older history in until it is loaded (or reporting that it is gone).
 */
export function useScrollToTarget({ target, containerRef, userScrolledUpRef, settlingRef, scrollFrameRef, virtualizer, realMessages, groups, loadOlder, hasOlder, loadingOlder }: UseScrollToTargetOptions) {
  const t = useT();
  const { targetMessage, setTargetMessage, setHighlightedMessage, lastTargetPageRef } = target;
  useEffect(() => {
    if (!targetMessage || !realMessages.length || loadingOlder) return;
    userScrolledUpRef.current = true;
    settlingRef.current = false;
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    const index = groups.findIndex(group => group.type === 'chat' ? group.message.messageId === targetMessage : group.messages.some(message => message.messageId === targetMessage));
    if (index >= 0) {
      let frame = 0;
      let stable = 0;
      let lastTop = -1;
      let id = 0;
      const settle = () => {
        virtualizer.scrollToIndex(index, { align: 'center' });
        const top = containerRef.current?.scrollTop ?? 0;
        stable = top === lastTop ? stable + 1 : 0;
        lastTop = top;
        if (++frame < 60 && stable < 4) { id = requestAnimationFrame(settle); return; }
        setHighlightedMessage(groupKey(groups[index]));
        setTargetMessage(null);
      };
      id = requestAnimationFrame(settle);
      return () => cancelAnimationFrame(id);
    }
    if (hasOlder && loadOlder) {
      const page = realMessages[0].messageId;
      if (lastTargetPageRef.current === page) return;
      lastTargetPageRef.current = page;
      void loadOlder().catch(() => { setTargetMessage(null); toast.error(t('reactions.linkMissing')); });
    } else {
      setTargetMessage(null);
      toast.error(t('reactions.linkMissing'));
    }
  }, [targetMessage, realMessages, groups, hasOlder, loadingOlder, loadOlder, virtualizer, t]);
}

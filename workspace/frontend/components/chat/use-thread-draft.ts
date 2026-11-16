'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { WorkspaceMessage } from '@/lib/types';
import { subscribeComposerPrefill } from './composer-prefill';
import { cacheMessages, draftStore } from './chat-message-cache';

/**
 * Per-thread composer drafts and the thread-switch bookkeeping that goes with
 * them: save the old thread's draft and messages, restore the new one's,
 * reveal its optimistic messages, and focus the composer.
 */
export function useThreadDraft({ currentSessionId, currentSessionIdRef, messages, notifyTyping, consumeSkipFocus, onSwitch }: {
  currentSessionId: string | null;
  currentSessionIdRef: MutableRefObject<string | null>;
  messages: WorkspaceMessage[];
  notifyTyping: () => void;
  consumeSkipFocus: () => boolean;
  /** Runs inside the switch effect, after the draft is restored. */
  onSwitch: (sessionId: string | null) => void;
}) {
  const [focusKey, setFocusKey] = useState(0);
  const focusComposer = useCallback(() => setFocusKey((k) => k + 1), []);

  // v1.1 M5 — "Request revision" on an artifact card (and anything else that
  // wants to hand the person a starting sentence) replaces this thread's draft
  // and focuses the input.
  useEffect(() => subscribeComposerPrefill((text) => {
    const sid = currentSessionIdRef.current;
    if (!sid) return;
    draftStore[sid] = text;
    setCurrentDraft(text);
    setFocusKey((k) => k + 1);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

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
    onSwitch(currentSessionId);
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

  return { currentDraft, setCurrentDraft, handleDraftChange, focusKey, focusComposer, prevSessionIdRef };
}

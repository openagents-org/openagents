'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import type { SearchHit } from './thread-list-utils';

/** Debounced message-content search; one hit per channel, first wins. */
export function useThreadSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const hits = await workspaceApi.searchMessages(searchQuery.trim());
        setSearchResults(hits);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  const hitsByChannel = useMemo(() => {
    const map = new Map<string, SearchHit>();
    for (const hit of searchResults) {
      if (!map.has(hit.channelName)) map.set(hit.channelName, hit);
    }
    return map;
  }, [searchResults]);

  return { searchQuery, setSearchQuery, searching, hitsByChannel, isSearching: searchQuery.trim().length > 0 };
}

interface ShortcutOptions {
  shortcutIds: string[];
  currentSessionId: string | null;
  isMobile: boolean;
  setCurrentSessionId: (id: string, opts?: { skipFocus?: boolean }) => void;
  openMobileDetail: () => void;
}

/**
 * Keyboard shortcuts:
 *   1-9  → open the Nth visible thread (mirrors monitor mode's 1-6)
 *   any printable char → focus the chat input of the current thread
 */
export function useThreadShortcuts({ shortcutIds, currentSessionId, isMobile, setCurrentSessionId, openMobileDetail }: ShortcutOptions) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't hijack typing in any input/textarea, and skip when modifier
      // keys are held (so Cmd+1 / Ctrl+R / etc. still reach the browser).
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-browser-controls]')) return;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target?.isContentEditable) return;

      // 1-9 → open thread by index. Pass skipFocus so the chat input doesn't
      // steal focus — the user is navigating and presses a letter to type.
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9) {
        const sessionId = shortcutIds[num - 1];
        if (sessionId) {
          e.preventDefault();
          setCurrentSessionId(sessionId, { skipFocus: true });
          if (isMobile) openMobileDetail();
        }
        return;
      }

      // Any single printable character → focus the chat input and let the
      // keystroke through so the character lands in the textarea.
      if (e.key.length === 1 && currentSessionId) {
        const el = document.querySelector<HTMLTextAreaElement>('textarea[data-chat-input]');
        if (el) el.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcutIds, currentSessionId, isMobile, setCurrentSessionId, openMobileDetail]);
}

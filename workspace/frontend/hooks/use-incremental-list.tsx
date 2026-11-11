'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Render a long list a page at a time: the first `page` items now, the next
 * page whenever the sentinel after them scrolls into view.
 *
 * A workspace with a few thousand files would otherwise mount every tile —
 * menus, tooltips, avatars, thumbnails — in the click that opens Files, and
 * the window stops responding until it's done. `resetKey` puts the window
 * back to one page when what's listed changes (folder, filter, search,
 * sort), but not when the same listing merely refreshes.
 */
export function useIncrementalList<T>(items: T[], resetKey: string, page = 120) {
  const [limit, setLimit] = useState(page);
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    setKey(resetKey);
    setLimit(page);
  }
  const shown = items.length > limit ? items.slice(0, limit) : items;
  const more = items.length > limit;
  return { shown, more, showMore: () => setLimit(value => value + page) };
}

/** Invisible marker after the rendered items; asks for more as it nears view.
 *  `count` re-arms the observer after each page, so a sentinel that is still
 *  in view once the new items render asks again. */
export function LoadMoreSentinel({ onVisible, count }: { onVisible: () => void; count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) callback.current();
    }, { rootMargin: '600px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [count]);
  return <div ref={ref} aria-hidden className="col-span-full h-px w-full" />;
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type LoadStatus = 'loading' | 'ready' | 'error';

/** Waits before the 2nd and 3rd attempts; after the last one the load reports an error. */
export const RETRY_DELAYS_MS = [1000, 3000];

/**
 * Load something once on mount, retrying a failed attempt a couple of times
 * before giving up, with a `retry` for the user to try again after that.
 *
 * The Connect Agent view used to load its agent catalog in one Promise.all with
 * two unrelated requests and swallow any failure. One slow or failing request —
 * the backend was shedding load at the time — left the catalog empty for as
 * long as the view stayed open, under a "Nothing matches" that blamed a search
 * nobody had typed. Waiting never fixed it; only reopening the view did.
 */
export function useRetryingLoad<T>(load: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [failures, setFailures] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setStatus('loading');
    setFailures(0);

    const run = async (tryIndex: number) => {
      try {
        const value = await loadRef.current();
        if (cancelled) return;
        setData(value);
        setStatus('ready');
      } catch {
        if (cancelled) return;
        setFailures(tryIndex + 1);
        if (tryIndex < RETRY_DELAYS_MS.length) {
          timer = setTimeout(() => { void run(tryIndex + 1); }, RETRY_DELAYS_MS[tryIndex]);
        } else {
          setStatus('error');
        }
      }
    };
    void run(0);

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  /** `failures` counts failed attempts in the current round — 0 while the first is in flight. */
  return { data, status, failures, retry };
}

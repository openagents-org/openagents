import { useEffect, type RefObject } from 'react';

/** Defer unread summaries until startup finishes, then keep discovery current. */
export function useDiscoveryPolling(
  refresh: () => Promise<void>,
  enabled: boolean,
  active: RefObject<boolean>,
) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (delay: number) => {
      timer = setTimeout(async () => {
        try {
          await refresh();
        } catch {
          // A failed background refresh must not stop subsequent attempts.
        } finally {
          if (!cancelled) schedule(active.current ? 5_000 : 15_000);
        }
      }, delay);
    };
    // Give the selected thread's initial message request a head start. The
    // first refresh includes exact unread summaries, even in an idle workspace.
    schedule(5_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh, enabled, active]);
}

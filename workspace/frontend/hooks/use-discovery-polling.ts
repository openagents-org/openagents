import { useEffect, type RefObject } from 'react';

/** While the live stream is connected, a slow safety refresh: discover every
 *  30 s and the side panels with every 4th tick (2 min). Wake-ups from the
 *  stream refresh them as things change. */
export const LIVE_SAFETY_MS = 30_000;
export const LIVE_FULL_EVERY = 4;

/** Defer unread summaries until startup finishes, then keep discovery current. */
export function useDiscoveryPolling(
  refresh: (opts?: { panels?: boolean }) => Promise<void>,
  enabled: boolean,
  active: RefObject<boolean>,
  live?: RefObject<boolean>,
) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let liveTicks = 0;
    const schedule = (delay: number) => {
      timer = setTimeout(async () => {
        try {
          if (live?.current) {
            liveTicks += 1;
            await refresh({ panels: liveTicks % LIVE_FULL_EVERY === 0 });
          } else {
            liveTicks = 0;
            await refresh();
          }
        } catch {
          // A failed background refresh must not stop subsequent attempts.
        } finally {
          if (!cancelled) schedule(live?.current ? LIVE_SAFETY_MS : active.current ? 5_000 : 15_000);
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
  }, [refresh, enabled, active, live]);
}

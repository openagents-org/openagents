import { useEffect, type RefObject } from 'react';

/** While the live stream is connected, a slow safety refresh: discover every
 *  30 s and the side panels with every 4th tick (2 min). Wake-ups from the
 *  stream refresh them as things change. */
export const LIVE_SAFETY_MS = 30_000;
export const LIVE_FULL_EVERY = 4;
/** In a hidden tab (or a minimised desktop window) only unread state is kept
 *  current, so notifications still arrive; the side panels wait until the tab
 *  is visible again. Background tabs used to refresh every panel every 5-15 s,
 *  about a third of all API traffic. */
export const HIDDEN_MS = 30_000;

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

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
    let running = false;
    let started = false;
    let timer: ReturnType<typeof setTimeout>;
    let liveTicks = 0;
    const nextDelay = () => (isHidden() ? HIDDEN_MS : live?.current ? LIVE_SAFETY_MS : active.current ? 5_000 : 15_000);
    const schedule = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        started = true;
        running = true;
        try {
          if (isHidden()) {
            await refresh({ panels: false });
          } else if (live?.current) {
            liveTicks += 1;
            await refresh({ panels: liveTicks % LIVE_FULL_EVERY === 0 });
          } else {
            liveTicks = 0;
            await refresh();
          }
        } catch {
          // A failed background refresh must not stop subsequent attempts.
        } finally {
          running = false;
          if (!cancelled) schedule(nextDelay());
        }
      }, delay);
    };
    // Back from the background: catch up on everything at once, then resume
    // the normal schedule. (A refresh already in flight reschedules itself.)
    const onVisibility = () => {
      if (cancelled || isHidden() || running || !started) return;
      liveTicks = 0;
      schedule(0);
    };
    document.addEventListener('visibilitychange', onVisibility);
    // Give the selected thread's initial message request a head start. The
    // first refresh includes exact unread summaries, even in an idle workspace.
    schedule(5_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh, enabled, active, live]);
}

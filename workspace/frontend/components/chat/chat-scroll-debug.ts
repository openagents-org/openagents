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

export function scrollDebug(source: string, el: HTMLElement | null, extra?: Record<string, unknown>) {
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

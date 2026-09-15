/**
 * Keeping the window alive: noticing when the main thread was held up, and
 * bringing back a renderer that died.
 *
 * Both failures look the same to a user — a window that turns white or stops
 * answering — and neither leaves a trace of its own: a blocked main thread
 * throws nothing, and a dead renderer just stops painting. Electron-free, so it
 * can be tested without a window.
 */

export interface StallWatchdogOptions {
  /** How often the timer is due. */
  intervalMs?: number
  /** Lateness worth a log line. */
  thresholdMs?: number
  now?: () => number
}

/**
 * A late timer beyond this is the machine having slept, not the thread having
 * been busy — logging it as a stall would send whoever reads the log after a
 * hang that never happened.
 */
const SUSPEND_LAG_MS = 5 * 60 * 1000

/**
 * Log whenever a timer due every `intervalMs` fires `thresholdMs` or more late.
 * That lateness is exactly how long the main thread was unable to run anything
 * — paint the window, answer IPC, take a click. Returns a stop function.
 */
export function startStallWatchdog(
  log: (message: string) => void,
  {
    intervalMs = 1000,
    thresholdMs = 2000,
    now = Date.now,
  }: StallWatchdogOptions = {},
): () => void {
  let last = now()
  const timer = setInterval(() => {
    const at = now()
    const lag = at - last - intervalMs
    last = at
    if (lag >= thresholdMs && lag < SUSPEND_LAG_MS) {
      log(`[main-stall] main thread was blocked for ~${lag}ms`)
    }
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

/**
 * Decides whether a renderer that just died should be reloaded: yes, unless it
 * has already died more than `limit` times within `windowMs`. A page that
 * crashes on load would otherwise reload in a tight loop, burning CPU while
 * showing nothing — left down, at least the log says why.
 */
export function crashLoopGuard(
  limit = 3,
  windowMs = 60_000,
  now: () => number = Date.now,
): () => boolean {
  let crashes: number[] = []
  return () => {
    const at = now()
    crashes = crashes.filter((t) => at - t < windowMs)
    crashes.push(at)
    return crashes.length <= limit
  }
}

'use strict';

/**
 * Logging policy for background calls that fail repeatedly — the message poll
 * and the workspace heartbeat.
 *
 * Both retry forever, so an unreachable or slow workspace used to produce one
 * entry per attempt: the poll wrote a full stack every ~20s (15s deadline + 5s
 * back-off) at INFO, and the Logs page — inferring severity from "failed" plus
 * the stack — showed a wall of red ERRORs for what was a network outage.
 *
 * A streak logs its 1st, 3rd, 10th, 30th and then every 100th failure, and one
 * line when it ends. Network-level failures are expected in the field and are
 * WARN without a stack; anything else is an ERROR, with its stack once.
 *
 * Pure and dependency-light, so it is unit-testable without an adapter.
 */

const { httpStatusOf } = require('./health-status');

const TRANSIENT_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * True for failures of the network or of an overloaded server — the kind a
 * retry is expected to fix, not a bug or a rejected credential.
 */
function isTransientNetworkError(err) {
  if (!err) return false;
  if (err.code && TRANSIENT_CODES.has(err.code)) return true;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  const status = httpStatusOf(err);
  if (typeof status === 'number') return status === 429 || status >= 500;
  return /\b(timed out|socket hang up|network)\b/i.test(err.message || '');
}

/** Which failure counts in a streak get a log line. */
function isLogPoint(count) {
  return count === 1 || count === 3 || count === 10 || count === 30 || count % 100 === 0;
}

class FailureStreak {
  constructor() {
    this.count = 0;
    this.since = 0;
  }

  /** Record one failure. True when this one should be logged. */
  fail(now = Date.now()) {
    this.count++;
    if (this.count === 1) this.since = now;
    return isLogPoint(this.count);
  }

  /**
   * Record a success. Returns the streak it ended — `{ count, ms }` — or null
   * when there was none.
   */
  succeed(now = Date.now()) {
    if (this.count === 0) return null;
    const ended = { count: this.count, ms: now - this.since };
    this.count = 0;
    this.since = 0;
    return ended;
  }
}

/** "45s" / "12m" / "3h" — for the line that closes a streak. */
function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 120) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 120) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

module.exports = { FailureStreak, isTransientNetworkError, isLogPoint, formatDuration };

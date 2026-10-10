'use strict';

/**
 * The daemon's writer for daemon.log — one sink shared by the daemon and every
 * adapter running inside it.
 *
 * The line format is unchanged (`<ISO time> <LEVEL> <scope>: <message>`, extra
 * message lines following as continuation lines): Launchers already in the
 * field parse this file, and they may run a newer core than they shipped with.
 * What changes is how lines get there:
 *
 *  - Batched, asynchronous writes. The old writer did an appendFileSync — an
 *    open/write/close on the event loop — plus a statSync for every line. Lines
 *    now collect in memory and go out in one append per `flushMs`, or sooner
 *    once `flushBytes` are waiting. The size check runs once per batch.
 *
 *  - Repeat suppression. A failure that repeats every few seconds used to fill
 *    the file with identical entries and rotate out everything useful. Within
 *    each `rateWindowMs`, lines with the same level, scope and message shape
 *    (digits and ids masked) pass `rateBurst` times; the rest are counted and
 *    reported in one line when the window ends. ERROR lines always pass.
 *
 *  - Copy-truncate rotation with gzip generations. The old rename-based
 *    rotation moved the file out from under every process that inherited a
 *    handle to it — the daemon's own stdout/stderr, and with them every
 *    adapter line — so those kept writing into the renamed backup, which the
 *    next rotation deleted while still open. Copying the file aside and then
 *    truncating it keeps every holder writing to daemon.log (they all opened
 *    it in append mode). The copy is gzipped into daemon.log.1.gz, and the
 *    older generations shift up to `keep`.
 *
 * Writes are best-effort, as they always were: a log that cannot be written
 * must never take the daemon down.
 */

const fs = require('fs');
const zlib = require('zlib');
const { pipeline } = require('stream');

const LEVEL_TOKENS = { debug: 'DEBUG', info: 'INFO', warn: 'WARN', error: 'ERROR' };

const DEFAULTS = {
  flushMs: 250,
  flushBytes: 64 * 1024,
  // Backlog bound for a log that cannot keep up (a stalled disk). Past this the
  // oldest waiting lines are dropped and the drop is reported in the log.
  maxPendingBytes: 4 * 1024 * 1024,
  maxBytes: 10 * 1024 * 1024,
  keep: 5,
  rateWindowMs: 60 * 1000,
  rateBurst: 20,
  // Distinct message shapes tracked per window. A shape seen after the table
  // is full is let through rather than tracked.
  maxRateKeys: 1024,
};

/** Every writer with lines that may still be in memory; flushed on exit. */
const live = new Set();
let exitHookInstalled = false;

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const w of live) w.flushSync();
  });
}

function normalizeLevel(level) {
  return Object.prototype.hasOwnProperty.call(LEVEL_TOKENS, level) ? level : 'info';
}

/**
 * The shape of a message: its first line with ids and numbers masked, so
 * `Poll #257 failed` and `Poll #258 failed` count as the same line.
 */
function messageShape(message) {
  const first = String(message).split('\n', 1)[0];
  return first
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+/g, '#')
    .slice(0, 200);
}

class LogWriter {
  /**
   * @param {string} file - daemon.log
   * @param {object} [opts] - overrides for DEFAULTS
   */
  constructor(file, opts = {}) {
    this.file = file;
    this.opts = { ...DEFAULTS, ...opts };

    this._pending = [];
    this._pendingBytes = 0;
    this._timer = null;
    this._writing = false;
    this._rotating = false;
    this._waiters = [];

    this._rate = new Map();
    this._windowStart = Date.now();
    this._windowTimer = null;

    this.stats = { written: 0, suppressed: 0, dropped: 0, writeErrors: 0, rotations: 0 };
    this._droppedSinceNote = 0;

    live.add(this);
    installExitHook();
  }

  /** Queue one entry. Returns false when it was suppressed as a repeat. */
  write(level, scope, message) {
    const lvl = normalizeLevel(level);
    const now = Date.now();
    if (!this._admit(lvl, scope, message, now)) return false;
    this._enqueue(lvl, scope, message, now);
    return true;
  }

  /** Resolves once everything queued so far is on disk (or failed to be). */
  flush() {
    return new Promise((resolve) => {
      this._rollWindow(Date.now());
      if (!this._writing && this._pending.length === 0) return resolve();
      this._waiters.push(resolve);
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      this._flush();
    });
  }

  /**
   * Write whatever is still queued, synchronously. For process exit, where an
   * asynchronous write would never complete.
   */
  flushSync() {
    this._rollWindow(Date.now());
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const data = this._takePending();
    if (!data) return;
    try {
      fs.appendFileSync(this.file, data, 'utf-8');
      this.stats.written += data.length;
    } catch {
      this.stats.writeErrors++;
    }
  }

  /** Flush synchronously and stop tracking this writer. */
  close() {
    this.flushSync();
    if (this._windowTimer) { clearTimeout(this._windowTimer); this._windowTimer = null; }
    live.delete(this);
  }

  // ------------------------------------------------------------------
  // Repeat suppression
  // ------------------------------------------------------------------

  _admit(level, scope, message, now) {
    if (level === 'error') return true;
    if (now - this._windowStart >= this.opts.rateWindowMs) this._rollWindow(now);

    const key = `${level}\u0000${scope}\u0000${messageShape(message)}`;
    let slot = this._rate.get(key);
    if (!slot) {
      if (this._rate.size >= this.opts.maxRateKeys) return true;
      slot = { level, scope, sample: String(message).split('\n', 1)[0], seen: 0, suppressed: 0 };
      this._rate.set(key, slot);
    }
    slot.seen++;
    if (slot.seen <= this.opts.rateBurst) return true;

    slot.suppressed++;
    this.stats.suppressed++;
    // Report at the end of this window even if nothing else is ever logged.
    if (!this._windowTimer) {
      const wait = Math.max(0, this._windowStart + this.opts.rateWindowMs - now);
      this._windowTimer = setTimeout(() => {
        this._windowTimer = null;
        this._rollWindow(Date.now());
      }, wait);
      if (this._windowTimer.unref) this._windowTimer.unref();
    }
    return false;
  }

  /** Close the current window: one summary line per suppressed shape. */
  _rollWindow(now) {
    const secs = Math.max(1, Math.round((now - this._windowStart) / 1000));
    for (const slot of this._rate.values()) {
      if (slot.suppressed > 0) {
        this._enqueue(
          slot.level,
          slot.scope,
          `Suppressed ${slot.suppressed} more like this in the last ${secs}s: ${slot.sample}`,
          now,
        );
      }
    }
    this._rate.clear();
    this._windowStart = now;
    if (this._windowTimer) { clearTimeout(this._windowTimer); this._windowTimer = null; }
  }

  // ------------------------------------------------------------------
  // Batching
  // ------------------------------------------------------------------

  _format(level, scope, message, now) {
    return `${new Date(now).toISOString()} ${LEVEL_TOKENS[level]} ${scope}: ${message}\n`;
  }

  _enqueue(level, scope, message, now) {
    const line = this._format(level, scope, message, now);
    this._pending.push(line);
    this._pendingBytes += line.length;

    while (this._pendingBytes > this.opts.maxPendingBytes && this._pending.length > 1) {
      this._pendingBytes -= this._pending.shift().length;
      this.stats.dropped++;
      this._droppedSinceNote++;
    }

    this._schedule(this._pendingBytes >= this.opts.flushBytes ? 0 : this.opts.flushMs);
  }

  _schedule(delay) {
    // A write in progress picks up the backlog when it completes.
    if (this._writing) return;
    if (this._timer) {
      if (delay > 0) return;
      clearTimeout(this._timer);
    }
    this._timer = setTimeout(() => {
      this._timer = null;
      this._flush();
    }, delay);
    if (this._timer.unref) this._timer.unref();
  }

  _takePending() {
    if (this._droppedSinceNote > 0) {
      this._pending.unshift(this._format(
        'warn', 'daemon',
        `Log writer fell behind — dropped ${this._droppedSinceNote} line(s)`,
        Date.now(),
      ));
      this._droppedSinceNote = 0;
    }
    if (this._pending.length === 0) return '';
    const data = this._pending.join('');
    this._pending = [];
    this._pendingBytes = 0;
    return data;
  }

  _flush() {
    if (this._writing) return;
    const data = this._takePending();
    if (!data) return this._settle();

    this._writing = true;
    fs.appendFile(this.file, data, 'utf-8', (err) => {
      if (err) this.stats.writeErrors++;
      else this.stats.written += data.length;
      this._maybeRotate(() => {
        this._writing = false;
        if (this._pending.length > 0) this._flush();
        else this._settle();
      });
    });
  }

  _settle() {
    if (this._writing || this._pending.length > 0) return;
    const waiters = this._waiters;
    this._waiters = [];
    for (const resolve of waiters) resolve();
  }

  // ------------------------------------------------------------------
  // Rotation
  // ------------------------------------------------------------------

  _gen(n) {
    return `${this.file}.${n}.gz`;
  }

  _maybeRotate(done) {
    if (this._rotating) return done();
    fs.stat(this.file, (err, st) => {
      if (err || st.size < this.opts.maxBytes) return done();
      this._rotate(done);
    });
  }

  /**
   * Copy the full log aside, truncate it in place, then compress the copy in
   * the background. `done` runs as soon as the truncate lands, so writing
   * continues into the emptied file while the copy is compressed.
   *
   * A line another process appends between the copy and the truncate is lost.
   * That window is the duration of one file copy, once per `maxBytes` of log.
   */
  _rotate(done) {
    this._rotating = true;
    const copy = `${this.file}.rotating`;
    try {
      fs.copyFileSync(this.file, copy);
      fs.truncateSync(this.file, 0);
    } catch {
      try { fs.unlinkSync(copy); } catch { /* not created */ }
      this._rotating = false;
      return done();
    }
    this.stats.rotations++;
    done();

    this._shiftGenerations();
    const target = this._gen(1);
    const partial = `${target}.tmp`;
    pipeline(
      fs.createReadStream(copy),
      zlib.createGzip(),
      fs.createWriteStream(partial),
      (err) => {
        try { fs.unlinkSync(copy); } catch { /* already gone */ }
        if (err) {
          try { fs.unlinkSync(partial); } catch { /* not created */ }
        } else {
          try { fs.renameSync(partial, target); } catch { /* best effort */ }
        }
        this._rotating = false;
      },
    );
  }

  _shiftGenerations() {
    const { keep } = this.opts;
    try { fs.unlinkSync(this._gen(keep)); } catch { /* none yet */ }
    for (let n = keep - 1; n >= 1; n--) {
      try { fs.renameSync(this._gen(n), this._gen(n + 1)); } catch { /* none yet */ }
    }
    // The uncompressed backup the previous writer kept. It was always deleted
    // at the next rotation; this is that rotation.
    try { fs.unlinkSync(`${this.file}.1`); } catch { /* none */ }
  }
}

module.exports = { LogWriter, messageShape, DEFAULTS };

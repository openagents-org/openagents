'use strict';

/**
 * Durable record of what this agent has consumed.
 *
 * The default loop keeps its cursor and its dedup set in memory, and advances
 * the cursor the moment a poll returns — before the messages are handled. That
 * is fine while the process lives, and loses work whenever it doesn't:
 *
 *   - restart skips straight to the head, so anything that arrived while the
 *     agent was down is never seen;
 *   - a crash mid-task loses that message, because the cursor already moved
 *     past it;
 *   - the dedup set is capped at 2000 ids and does not survive a restart.
 *
 * This file makes all three survivable. The invariant that does the work is
 * simple: **the cursor never advances past unfinished work.** Anything claimed
 * but not finished is replayed on the next start, which is why the backend
 * absorbs a repeated reply via `in_reply_to` — replaying is the recovery, and
 * the duplicate it can produce is the price.
 *
 * State lives in one small JSON file per (workspace, agent), written
 * atomically. No database, no daemon — an agent host is someone's laptop as
 * often as it is a server.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** How many completed ids to keep. Only guards against a duplicate delivery
 *  arriving long after the fact; the cursor does the real work. */
const DONE_HISTORY = 500;

function stateDir() {
  return process.env.OPENAGENTS_HOME
    || path.join(os.homedir(), '.openagents');
}

function safeName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

class ConsumptionStore {
  constructor(workspaceId, agentName, { dir } = {}) {
    this.workspaceId = workspaceId;
    this.agentName = agentName;
    this.dir = dir || path.join(stateDir(), 'consumption');
    this.file = path.join(this.dir, `${safeName(workspaceId)}-${safeName(agentName)}.json`);
    this._state = { cursor: null, inflight: {}, done: [] };
    this._loaded = false;
  }

  load() {
    if (this._loaded) return this._state;
    try {
      const raw = fs.readFileSync(this.file, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        this._state = {
          cursor: parsed.cursor || null,
          inflight: (parsed.inflight && typeof parsed.inflight === 'object') ? parsed.inflight : {},
          done: Array.isArray(parsed.done) ? parsed.done : [],
        };
      }
    } catch {
      // No file yet, or it was corrupted by a half-finished write on a machine
      // that lost power. Either way the safe reading is "we know nothing" —
      // the caller then skips to the head, exactly like a first run.
    }
    this._loaded = true;
    return this._state;
  }

  _save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      // Write-then-rename: a crash mid-write leaves the previous good file
      // rather than a truncated one.
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this._state));
      fs.renameSync(tmp, this.file);
    } catch {
      // Losing a write degrades us to the old behaviour for that message, which
      // is worth strictly less than crashing the agent over it.
    }
  }

  /** The cursor to resume from, or null on a first run. */
  cursor() {
    return this.load().cursor;
  }

  /**
   * Advance the cursor — but only once nothing is outstanding.
   *
   * This is the whole safety property. If work is still in flight, the cursor
   * stays where it is, so a crash re-fetches that work instead of stepping
   * over it. A busy agent therefore runs with a cursor that lags reality, and
   * that is the intended shape.
   */
  advanceCursor(eventId) {
    if (!eventId) return false;
    const state = this.load();
    if (Object.keys(state.inflight).length > 0) return false;
    if (state.cursor === eventId) return false;
    state.cursor = eventId;
    this._save();
    return true;
  }

  /** Set the cursor unconditionally. Only for the first-run skip-to-head. */
  resetCursor(eventId) {
    const state = this.load();
    state.cursor = eventId || null;
    state.inflight = {};
    this._save();
  }

  /** True when this message has already been handled, or is being handled. */
  isSettled(messageId) {
    const state = this.load();
    return !!state.inflight[messageId] || state.done.includes(messageId);
  }

  /**
   * Take ownership of a message. Returns false when it is already claimed or
   * already done, which is what makes a replayed batch safe.
   */
  claim(messageId) {
    if (!messageId) return true;      // nothing to track; let it through
    const state = this.load();
    if (this.isSettled(messageId)) return false;
    state.inflight[messageId] = Date.now();
    this._save();
    return true;
  }

  markDone(messageId) {
    if (!messageId) return;
    const state = this.load();
    delete state.inflight[messageId];
    if (!state.done.includes(messageId)) state.done.push(messageId);
    if (state.done.length > DONE_HISTORY) {
      state.done = state.done.slice(-Math.floor(DONE_HISTORY / 2));
    }
    this._save();
  }

  /**
   * Ids claimed by a previous run that never finished.
   *
   * Read once at startup, where every entry by definition belongs to a process
   * that is already gone — one store file serves one agent, and a running
   * agent is the only writer. So there is no age test to make: all of them are
   * abandoned.
   *
   * Returned still-claimed, so a crash *during* replay leaves them replayable
   * again on the next start.
   */
  pending() {
    return Object.keys(this.load().inflight);
  }

  /** Drop an in-flight claim without marking it done — used when a replayed
   *  message can no longer be fetched (its channel was deleted, say). */
  release(messageId) {
    const state = this.load();
    if (state.inflight[messageId]) {
      delete state.inflight[messageId];
      this._save();
    }
  }

  hasInflight() {
    return Object.keys(this.load().inflight).length > 0;
  }
}

module.exports = { ConsumptionStore, DONE_HISTORY };

'use strict';

/**
 * A minimal Agent Client Protocol (ACP) client: JSON-RPC 2.0, one message per
 * line, over a child process's stdio. Nothing in here is specific to one CLI —
 * Kiro (`kiro-cli acp`) is the first adapter on it, and any other CLI that
 * serves ACP on stdio can reuse it unchanged.
 *
 * Responsibilities:
 *   - frame stdout into lines and parse each as JSON (non-JSON lines are
 *     reported through onUnparsed and otherwise ignored — a CLI may log);
 *   - match responses to requests by id, with an optional per-request timeout;
 *   - hand agent → client REQUESTS (session/request_permission, fs/…) to
 *     onRequest and send back its result, or a JSON-RPC error if it throws or
 *     is missing (method not found, so the agent never waits forever);
 *   - hand NOTIFICATIONS (session/update, vendor extensions) to onNotification;
 *   - fail every pending request once the process is gone.
 *
 * Spec: https://agentclientprotocol.com
 */

const JSONRPC = '2.0';
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

/** A JSON-RPC error answer from the agent. Keeps code and data for callers. */
class AcpRpcError extends Error {
  constructor(method, error) {
    const data = error && error.data !== undefined
      ? (typeof error.data === 'string' ? error.data : JSON.stringify(error.data))
      : '';
    super(`${method} failed: ${(error && error.message) || 'error'}${data ? ` (${data})` : ''}`);
    this.name = 'AcpRpcError';
    this.method = method;
    this.code = error && error.code;
    this.data = error && error.data;
    this.rpcError = error || null;
  }
}

/** The agent process went away (or was closed) with requests still open. */
class AcpClosedError extends Error {
  constructor(method, reason) {
    super(`${method} interrupted: ${reason || 'the agent process exited'}`);
    this.name = 'AcpClosedError';
    this.method = method;
  }
}

class AcpTimeoutError extends Error {
  constructor(method, ms) {
    super(`${method} timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'AcpTimeoutError';
    this.method = method;
  }
}

class AcpClient {
  /**
   * @param {import('child_process').ChildProcess} proc - spawned with piped stdio
   * @param {object} [handlers]
   * @param {(method: string, params: object) => void} [handlers.onNotification]
   * @param {(method: string, params: object) => (object|Promise<object>)} [handlers.onRequest]
   * @param {(line: string) => void} [handlers.onUnparsed]
   * @param {() => void} [handlers.onActivity] - any frame arrived (watchdogs)
   */
  constructor(proc, { onNotification, onRequest, onUnparsed, onActivity } = {}) {
    this.proc = proc;
    this._onNotification = onNotification || (() => {});
    this._onRequest = onRequest || null;
    this._onUnparsed = onUnparsed || (() => {});
    this._onActivity = onActivity || (() => {});
    this._nextId = 1;
    this._pending = new Map(); // id → { method, resolve, reject, timer }
    this._buf = '';
    this._closed = false;
    this._closeReason = null;

    // A killed child's pipes can emit EPIPE/ECONNRESET a tick later; with no
    // 'error' listener that is an uncaughtException that takes the daemon down.
    if (proc.stdout) {
      proc.stdout.on('error', () => {});
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => this._feed(chunk));
    }
    if (proc.stdin) proc.stdin.on('error', () => {});
    proc.on('exit', (code, signal) => {
      this._fail(signal ? `the agent process was killed (${signal})` : `the agent process exited (code ${code})`);
    });
    proc.on('error', (e) => this._fail(e && e.message ? e.message : 'the agent process failed'));
  }

  get closed() {
    return this._closed;
  }

  /** Send a request; resolves with `result`, rejects with AcpRpcError/AcpClosedError/AcpTimeoutError. */
  request(method, params, { timeoutMs = 0 } = {}) {
    if (this._closed) return Promise.reject(new AcpClosedError(method, this._closeReason));
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const entry = { method, resolve, reject, timer: null };
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          this._pending.delete(id);
          reject(new AcpTimeoutError(method, timeoutMs));
        }, timeoutMs);
      }
      this._pending.set(id, entry);
      if (!this._write({ jsonrpc: JSONRPC, id, method, params })) {
        this._pending.delete(id);
        if (entry.timer) clearTimeout(entry.timer);
        reject(new AcpClosedError(method, 'could not write to the agent process'));
      }
    });
  }

  /** Fire-and-forget notification (e.g. session/cancel). Returns false if it could not be written. */
  notify(method, params) {
    if (this._closed) return false;
    return this._write({ jsonrpc: JSONRPC, method, params });
  }

  /** Stop accepting traffic and fail anything still pending. */
  close(reason = 'closed by the client') {
    this._fail(reason);
  }

  // ------------------------------------------------------------------

  _write(msg) {
    try {
      if (!this.proc.stdin || this.proc.stdin.destroyed || !this.proc.stdin.writable) return false;
      this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  _feed(chunk) {
    this._buf += chunk;
    let nl;
    while ((nl = this._buf.indexOf('\n')) !== -1) {
      const line = this._buf.slice(0, nl).replace(/\r$/, '');
      this._buf = this._buf.slice(nl + 1);
      if (line.trim()) this._handleLine(line);
    }
  }

  _handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this._onUnparsed(line);
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    this._onActivity();

    const hasId = msg.id !== undefined && msg.id !== null;
    if (hasId && typeof msg.method === 'string') {
      this._answerRequest(msg);
      return;
    }
    if (hasId) {
      const entry = this._pending.get(msg.id);
      if (!entry) return;
      this._pending.delete(msg.id);
      if (entry.timer) clearTimeout(entry.timer);
      if (msg.error) entry.reject(new AcpRpcError(entry.method, msg.error));
      else entry.resolve(msg.result === undefined ? null : msg.result);
      return;
    }
    if (typeof msg.method === 'string') {
      try { this._onNotification(msg.method, msg.params || {}); } catch {}
    }
  }

  async _answerRequest(msg) {
    if (!this._onRequest) {
      this._write({ jsonrpc: JSONRPC, id: msg.id, error: { code: METHOD_NOT_FOUND, message: `Method not supported: ${msg.method}` } });
      return;
    }
    try {
      const result = await this._onRequest(msg.method, msg.params || {});
      if (result === undefined) {
        this._write({ jsonrpc: JSONRPC, id: msg.id, error: { code: METHOD_NOT_FOUND, message: `Method not supported: ${msg.method}` } });
      } else {
        this._write({ jsonrpc: JSONRPC, id: msg.id, result });
      }
    } catch (e) {
      this._write({ jsonrpc: JSONRPC, id: msg.id, error: { code: INTERNAL_ERROR, message: (e && e.message) || 'client error' } });
    }
  }

  _fail(reason) {
    if (this._closed) return;
    this._closed = true;
    this._closeReason = reason;
    for (const [id, entry] of this._pending) {
      this._pending.delete(id);
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new AcpClosedError(entry.method, reason));
    }
  }
}

module.exports = {
  AcpClient,
  AcpRpcError,
  AcpClosedError,
  AcpTimeoutError,
  METHOD_NOT_FOUND,
  INTERNAL_ERROR,
};

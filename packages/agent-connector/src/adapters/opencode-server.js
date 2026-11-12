/**
 * A warm `opencode serve` for one adapter, so a message is sent to a running
 * OpenCode over its HTTP API instead of booting `opencode run` for it. Booting
 * is most of a message's latency: about 5 s before the model is even called,
 * against about 1–2 s on a warm server.
 *
 * (`opencode run --attach` would be simpler, but its client exits after the
 * reasoning and drops the reply — the turn completes on the server, the text
 * never reaches the client. So the adapter talks to the API itself.)
 *
 * A server costs memory (about 220 MB idle, 450 MB once it has run), so:
 * - at most one per adapter, started on demand and stopped after `idleMs`
 *   without a run;
 * - it serves one setup (environment, working directory and its config file)
 *   and one turn at a time: a message with a different setup restarts it when
 *   idle, and a message arriving while it's busy runs the ordinary way;
 * - it listens on 127.0.0.1 only, behind a random password;
 * - anything unusual (it doesn't come up, it dies) means "no server" for that
 *   message, and after repeated start failures it stays off for a while.
 *
 * Opt-in: the OpenCode adapter uses it only when OPENAGENTS_OPENCODE_SERVER=1.
 */
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const IDLE_MS = 5 * 60 * 1000;
const START_TIMEOUT_MS = 15 * 1000;
const BACKOFF_MS = 10 * 60 * 1000;
const MAX_START_FAILURES = 2;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function reachable(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

class OpenCodeServer {
  constructor({ binary, log = () => {}, idleMs = IDLE_MS, startTimeoutMs = START_TIMEOUT_MS } = {}) {
    this.binary = binary;
    this.log = log;
    this.idleMs = idleMs;
    this.startTimeoutMs = startTimeoutMs;
    this._proc = null;
    this._key = null;
    this._url = null;
    this._auth = null;
    this._active = 0;
    this._idleTimer = null;
    this._starting = null;
    this._failures = 0;
    this._offUntil = 0;
    this._listeners = new Set();
    this._events = null;  // AbortController of the live event subscription
  }

  /** What a server is good for: same environment, directory and config file. */
  static keyFor(env, cwd) {
    let config = '';
    try { config = fs.readFileSync(path.join(cwd, '.opencode', 'opencode.json'), 'utf-8'); } catch {}
    return crypto.createHash('sha256').update(JSON.stringify([env, cwd, config])).digest('hex');
  }

  get running() { return Boolean(this._proc && this._proc.exitCode === null && this._url); }

  /**
   * True when this server is up for the setup and now held for one run, which
   * must be paired with release(). False: run the ordinary way.
   */
  async acquire({ env, cwd }) {
    if (Date.now() < this._offUntil) return false;
    const key = OpenCodeServer.keyFor(env, cwd);
    if (this._starting) { try { await this._starting; } catch {} }
    // One turn at a time: the turn's context (channel, requester) is the server's.
    if (this._active > 0) return false;  // busy: run this message the ordinary way
    if (this.running && this._key === key && await reachable(this._port)) {
      this._take();
      return true;
    }
    this.stop();
    this._starting = this._start({ env, cwd, key });
    try {
      if (!(await this._starting)) return false;
      this._take();
      return true;
    } finally {
      this._starting = null;
    }
  }

  release() {
    this._active = Math.max(0, this._active - 1);
    if (this._active === 0) this._armIdle();
  }

  /** JSON request to the server; throws with `status` on HTTP errors. */
  async request(method, urlPath, body, { signal } = {}) {
    if (!this.running) throw Object.assign(new Error('OpenCode server is not running'), { status: 0 });
    const res = await fetch(this._url + urlPath, {
      method, signal,
      headers: { Authorization: this._auth, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`OpenCode server ${method} ${urlPath} → ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
    return text ? JSON.parse(text) : null;
  }

  /** Receive the server's live events (`{type, properties}`); returns an unsubscribe function. */
  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Stop a session's turn (a stop, a timeout). */
  async abort(sessionId) {
    if (!sessionId || !this.running) return false;
    try { await this.request('POST', `/session/${encodeURIComponent(sessionId)}/abort`, undefined, { signal: AbortSignal.timeout(5000) }); return true; }
    catch { return false; }
  }

  /** Answer a permission request (newer servers, then the older per-session route). */
  async replyPermission(sessionId, requestId, reply = 'once') {
    try { await this.request('POST', `/permission/${encodeURIComponent(requestId)}/reply`, { reply }); return true; } catch {}
    try { await this.request('POST', `/session/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}`, { response: reply }); return true; }
    catch { return false; }
  }

  stop() {
    clearTimeout(this._idleTimer);
    this._idleTimer = null;
    if (this._events) { this._events.abort(); this._events = null; }
    const proc = this._proc;
    this._proc = null;
    this._url = null;
    this._key = null;
    if (!proc || proc.exitCode !== null) return;
    const kill = (sig) => { try { process.kill(-proc.pid, sig); } catch { try { proc.kill(sig); } catch {} } };
    kill('SIGTERM');
    const t = setTimeout(() => kill('SIGKILL'), 3000);
    t.unref();
    proc.once('exit', () => clearTimeout(t));
  }

  _take() {
    this._active += 1;
    clearTimeout(this._idleTimer);
    this._idleTimer = null;
  }

  _armIdle() {
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => {
      if (this._active === 0 && this._proc) {
        this.log(`OpenCode server idle for ${Math.round(this.idleMs / 1000)}s; stopping it`);
        this.stop();
      }
    }, this.idleMs);
    this._idleTimer.unref();
  }

  async _start({ env, cwd, key }) {
    const port = await freePort();
    const password = crypto.randomBytes(24).toString('base64url');
    const started = Date.now();
    let proc;
    try {
      proc = spawn(this.binary, ['serve', '--port', String(port), '--hostname', '127.0.0.1'],
        { env: { ...env, OPENCODE_SERVER_PASSWORD: password }, cwd, stdio: 'ignore', detached: true });
    } catch (e) {
      return this._failed(`could not start (${e.message})`);
    }
    proc.on('error', () => {});
    proc.on('exit', () => {
      if (this._proc !== proc) return;
      this._proc = null; this._url = null; this._key = null;
      if (this._events) { this._events.abort(); this._events = null; }
    });
    while (Date.now() - started < this.startTimeoutMs) {
      if (proc.exitCode !== null) return this._failed(`exited with code ${proc.exitCode}`);
      if (await reachable(port)) {
        this._proc = proc;
        this._port = port;
        this._key = key;
        this._url = `http://127.0.0.1:${port}`;
        this._auth = 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64');
        this._failures = 0;
        this._listen();
        this.log(`OpenCode server ready on port ${port} in ${Date.now() - started}ms`);
        return true;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch {} }
    return this._failed(`not reachable after ${this.startTimeoutMs}ms`);
  }

  /** One live event stream per server, fanned out to the runs' listeners. */
  _listen() {
    const ctrl = new AbortController();
    this._events = ctrl;
    (async () => {
      try {
        const res = await fetch(this._url + '/event', { headers: { Authorization: this._auth }, signal: ctrl.signal });
        let buf = '';
        const decoder = new TextDecoder();
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith('data:')) continue;
            let event;
            try { event = JSON.parse(line.slice(5)); } catch { continue; }
            for (const fn of this._listeners) { try { fn(event); } catch {} }
          }
        }
      } catch { /* stopped, or the server went away: runs fall back on the final reply */ }
    })();
  }

  _failed(why) {
    this._failures += 1;
    if (this._failures >= MAX_START_FAILURES) {
      this._offUntil = Date.now() + BACKOFF_MS;
      this._failures = 0;
      this.log(`OpenCode server ${why}; running without it for ${BACKOFF_MS / 60000} minutes`, 'error');
    } else {
      this.log(`OpenCode server ${why}; running this message without it`, 'error');
    }
    return false;
  }
}

module.exports = { OpenCodeServer };

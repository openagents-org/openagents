/**
 * NanoclawBridge — client side of the local IPC to the native NanoClaw
 * `openagents` channel.
 *
 * The channel (running inside the NanoClaw host) owns a Unix-socket SERVER at
 * `<home>/data/openagents.sock`; this bridge is the CLIENT. We send `inbound`
 * frames (a workspace message addressed to an OpenAgents channel) and receive
 * `outbound` / `status` / `error` frames (the agent container's replies and
 * liveness, correlated by `platformId`). The channel does the native
 * router→session→container routing; we never touch NanoClaw's database.
 *
 * Connection is resilient: a dropped socket triggers exponential-backoff
 * reconnect (the NanoClaw host may restart, or the channel may load late).
 * The workspace token is never sent over this socket.
 */

'use strict';

const net = require('net');
const { EventEmitter } = require('events');

const proto = require('./nanoclaw-protocol');
const { isPathSafe } = require('./nanoclaw-control');

const noop = () => {};

// Upper bound on the inbound line buffer. The bridge speaks newline-delimited
// JSON control frames (small); a peer that streams data without a newline would
// otherwise grow the buffer unbounded. The trust boundary is the same OS user,
// so this guards against a malfunctioning/compromised local peer, not a remote
// attacker. 8 MiB is far above any legitimate frame.
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

class NanoclawBridge extends EventEmitter {
  /**
   * @param {string} socketPath
   * @param {object} opts
   * @param {string} opts.workspace
   * @param {string} opts.agent
   * @param {()=>(string|null)} [opts.secretProvider]  read the current handshake secret (fresh per connect)
   * @param {(m:string)=>void} [opts.log]
   * @param {number} [opts.minBackoffMs]
   * @param {number} [opts.maxBackoffMs]
   */
  constructor(socketPath, opts = {}) {
    super();
    this.socketPath = socketPath;
    this.workspace = opts.workspace || '';
    this.agent = opts.agent || '';
    this._secretProvider = typeof opts.secretProvider === 'function' ? opts.secretProvider : () => null;
    this._log = opts.log || noop;
    this._minBackoff = opts.minBackoffMs || 500;
    this._maxBackoff = opts.maxBackoffMs || 8000;

    this._sock = null;
    this._buffer = '';
    this._connected = false;
    this._ready = false;
    this._closed = false;
    this._attempt = 0;
    this._reconnectTimer = null;
  }

  isConnected() {
    return this._connected && !this._closed;
  }
  isReady() {
    return this._ready && !this._closed;
  }

  /** Begin connecting (idempotent). Resolves on first successful TCP connect. */
  connect() {
    this._closed = false;
    if (this._sock) return;
    this._openOnce();
  }

  _openOnce() {
    if (this._closed) return;
    this._buffer = '';

    // Refuse a symlinked socket path (path-escape / redirection guard).
    const safe = isPathSafe(this.socketPath);
    if (!safe.ok) {
      this._log(`bridge refusing unsafe socket path: ${safe.reason}`);
      this.emit('socket-error', Object.assign(new Error(safe.reason), { code: 'UNSAFE_PATH' }));
      this._scheduleReconnect();
      return;
    }

    // Read the handshake secret fresh every connect (handles host restart /
    // secret rotation, and re-auth on reconnect).
    const secret = this._secretProvider();
    if (!secret) {
      this._log('bridge: handshake secret not available yet — will retry');
      this.emit('auth-pending');
      this._scheduleReconnect();
      return;
    }

    const sock = net.createConnection(this.socketPath);
    this._sock = sock;

    sock.on('connect', () => {
      this._connected = true;
      this._attempt = 0;
      this._log(`bridge connected: ${this.socketPath}`);
      // Handshake — identify ourselves + present the local secret. The channel
      // replies 'ready' only on a valid secret + matching protocol.
      try {
        sock.write(proto.buildHello(this.workspace, this.agent, secret));
      } catch (e) {
        this._log(`bridge hello write failed: ${e.message}`);
      }
      this.emit('connect');
    });

    sock.on('data', (chunk) => {
      this._buffer += chunk.toString('utf8');
      const { frames, rest } = proto.parseFrames(this._buffer);
      this._buffer = rest;
      // Guard against an unbounded line with no frame delimiter — drop the
      // buffer and reset the connection rather than growing memory without limit.
      if (this._buffer.length > MAX_BUFFER_BYTES) {
        this._log(`bridge buffer exceeded ${MAX_BUFFER_BYTES} bytes without a complete frame — resetting connection`);
        this._buffer = '';
        try { sock.destroy(); } catch { /* best-effort */ }
        return;
      }
      for (const frame of frames) this._onFrame(frame);
    });

    // Always attach an error listener: a SIGKILL'd/closed peer can emit
    // 'error' (EPIPE/ECONNRESET) which, unhandled, crashes the process.
    sock.on('error', (err) => {
      this._log(`bridge socket error: ${err.code || err.message}`);
      this.emit('socket-error', err);
    });

    sock.on('close', () => {
      const wasReady = this._ready;
      this._connected = false;
      this._ready = false;
      this._sock = null;
      if (wasReady || this._attempt === 0) this.emit('disconnect');
      this._scheduleReconnect();
    });
  }

  _onFrame(frame) {
    switch (frame.op) {
      case 'ready':
        this._ready = true;
        this._log(`bridge ready (channel=${frame.channelType || 'openagents'}, proto=${frame.protocol})`);
        this.emit('ready', frame);
        break;
      case 'outbound':
        this.emit('outbound', frame);
        break;
      case 'status':
        this.emit('status', frame);
        break;
      case 'error':
        if (frame.code === 'auth_failed' || frame.code === 'incompatible_version' || frame.code === 'single_connection') {
          this._log(`bridge handshake rejected: ${frame.code}`);
          this.emit('auth-failed', frame.code);
        }
        this.emit('error-frame', frame);
        break;
      case 'dropped':
        // A queued outbound the channel could not retain (overflow / expiry).
        this.emit('dropped', frame);
        break;
      case 'pong':
        this.emit('pong', frame);
        break;
      default:
        // Forward-compat: ignore unknown ops.
        break;
    }
  }

  _scheduleReconnect() {
    if (this._closed) return;
    if (this._reconnectTimer) return;
    this._attempt += 1;
    const delay = Math.min(this._maxBackoff, this._minBackoff * 2 ** Math.min(this._attempt - 1, 6));
    this.emit('reconnecting', this._attempt, delay);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._openOnce();
    }, delay);
    if (this._reconnectTimer.unref) this._reconnectTimer.unref();
  }

  /**
   * Write an already-encoded frame string. Returns true if written.
   * Throws if not connected (caller decides whether to surface or wait).
   */
  _write(frameStr) {
    if (!this._sock || !this._connected) {
      const e = new Error('NanoClaw bridge not connected');
      e.code = 'NOT_CONNECTED';
      throw e;
    }
    return this._sock.write(frameStr);
  }

  /** Inject a workspace message into NanoClaw. `fields` per proto.buildInbound. */
  sendInbound(fields) {
    return this._write(proto.buildInbound(fields));
  }

  sendCancel(platformId, msgId) {
    try {
      return this._write(proto.buildCancel(platformId, msgId));
    } catch {
      return false; // cancel is best-effort
    }
  }

  /** Acknowledge a delivered outbound so the channel stops holding/replaying it. */
  sendAck(outId, platformId) {
    if (!outId) return false;
    try {
      return this._write(proto.buildAck(outId, platformId));
    } catch {
      return false; // will be re-driven by the channel's replay on reconnect
    }
  }

  ping() {
    try {
      return this._write(proto.buildPing());
    } catch {
      return false;
    }
  }

  /** Stop reconnecting and tear down the socket. */
  close() {
    this._closed = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    const sock = this._sock;
    this._sock = null;
    this._connected = false;
    this._ready = false;
    if (sock) {
      try {
        sock.removeAllListeners('close');
        sock.on('error', noop); // swallow teardown EPIPE
        sock.end();
        sock.destroy();
      } catch {
        /* best-effort */
      }
    }
  }
}

module.exports = { NanoclawBridge };

/**
 * OPENAGENTS-CHANNEL v1 — native NanoClaw channel that bridges a NanoClaw Agent
 * Group to an OpenAgents Workspace. (Marker line above is used by the OpenAgents
 * installer to recognise a file it owns; do not remove.)
 *
 * This is a NATIVE NanoClaw channel (the official extension point). It plumbs
 * into the normal router/delivery path exactly like the built-in `cli` channel
 * — no database access, no host special-casing. The OpenAgents agent-connector
 * (`@openagents-org/agent-launcher`, adapter `nanoclaw`) is the CLIENT and does
 * all OpenAgents Workspace IO. The Workspace token is never sent over this
 * socket, so no OpenAgents credential is duplicated into NanoClaw.
 *
 * Local trust boundary
 * --------------------
 * The socket + secret + outbox live in a dedicated `data/openagents/` dir locked
 * to 0700 (socket 0600, secret 0600, outbox files 0600). A connecting client
 * MUST present the random per-host secret (`data/openagents/secret`) in `hello`
 * with `protocol === 1`; until that handshake succeeds no `inbound`/`cancel`/
 * `ack` is accepted and no `outbound` is sent, and the server re-authenticates
 * on every (re)connect. Stale-socket cleanup only removes an actual socket file
 * (never a regular file or symlink); symlinked paths are refused. The trust
 * boundary is the **current OS user** — 0600 perms + the secret defend against
 * OTHER local users, not a malicious process running as the same user.
 *
 * Only ONE authenticated connector is allowed at a time: while one is connected,
 * a second handshake is rejected (`single_connection`); the old connection must
 * drop before a new one can take over.
 *
 * Delivery (at-least-once + dedup, persistent outbox)
 * ---------------------------------------------------
 * Each outbound reply is PERSISTED to `data/openagents/outbox/<sha256(outId)>.json`
 * BEFORE sending, and held until the client `ack`s it; on ack the file is
 * deleted. The outbox is loaded on startup and replayed on every (re)connect, so
 * un-ACKed replies survive a Channel OR NanoClaw-host restart (in-memory-only
 * state would not). The client dedups by persisted `outId`, so a replay is
 * re-ACKed but not re-displayed. This is at-least-once with dedup ONLY while the
 * outbox is available and within its capacity/TTL; the outbox is bounded
 * (`MAX_OUTBOX`) and TTL'd (`OUTBOX_TTL_MS`) and on overflow/expiry a record is
 * dropped (emit `{op:'dropped',reason}` + log) and may be UNRECOVERABLE. NOT
 * unconditional exactly-once.
 *
 * The outbox stores reply BODIES — it is local sensitive cache. It never stores
 * the handshake secret, Workspace tokens, or provider credentials.
 *
 * Stop = detach: a `cancel` frame only tells the channel the connector has
 * detached the current turn; the container task may keep running.
 *
 * Verified against NanoClaw v2.1.19 (commit 625264ba4b9de0a466d10debb267ca9ad688f4c0).
 */
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';

import { DATA_DIR } from '../config.js';
import { log } from '../log.js';
import type { ChannelAdapter, ChannelSetup, OutboundMessage } from './adapter.js';
import { registerChannelAdapter } from './channel-registry.js';

const PROTOCOL_VERSION = 1;
const CHANNEL_TYPE = 'openagents';
const MAX_OUTBOX = 1000; // bound on persisted un-ACKed replies
const OUTBOX_TTL_MS = 24 * 60 * 60 * 1000; // drop un-ACKed older than this

const IS_WINDOWS = process.platform === 'win32';

function ipcDir(): string {
  return path.join(DATA_DIR, 'openagents');
}
function socketPath(): string {
  return path.join(ipcDir(), 'bridge.sock');
}
function secretPath(): string {
  return path.join(ipcDir(), 'secret');
}
function outboxDir(): string {
  return path.join(ipcDir(), 'outbox');
}
function corruptDir(): string {
  return path.join(outboxDir(), 'corrupt');
}
function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function lstatSafe(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function ensureSecureDir(dir: string): { ok: boolean; reason?: string } {
  const st = lstatSafe(dir);
  if (st && st.isSymbolicLink()) return { ok: false, reason: 'dir is a symlink' };
  if (st && !st.isDirectory()) return { ok: false, reason: 'dir path is not a directory' };
  if (!st) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (e) {
      return { ok: false, reason: `mkdir failed: ${(e as Error).message}` };
    }
  }
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* best-effort on Windows */
  }
  if (!IS_WINDOWS) {
    const after = lstatSafe(dir);
    if (after) {
      if (typeof process.getuid === 'function' && after.uid !== process.getuid()) {
        return { ok: false, reason: 'dir owned by another user' };
      }
      if (after.mode & 0o077) return { ok: false, reason: 'dir is group/other-accessible' };
    }
  }
  return { ok: true };
}

function safeUnlinkSocket(p: string): void {
  const st = lstatSafe(p);
  if (!st) return;
  if (st.isSymbolicLink()) {
    log.warn('openagents: refusing to unlink a symlink at the socket path', { p });
    return;
  }
  if (!st.isSocket()) {
    log.warn('openagents: refusing to unlink a non-socket file at the socket path', { p });
    return;
  }
  try {
    fs.unlinkSync(p);
  } catch (err) {
    log.warn('openagents: failed to unlink stale socket', { p, err });
  }
}

interface OutboxRecord {
  outId: string;
  platformId: string;
  threadId: string | null;
  turnId: string | null;
  sessionKey: string; // platformId (NanoClaw's internal sessionId is not exposed to deliver())
  kind: string;
  text: string;
  ts: number;
}

function outboundLine(r: OutboxRecord): string {
  return (
    JSON.stringify({
      op: 'outbound',
      platformId: r.platformId,
      threadId: r.threadId,
      outId: r.outId,
      inReplyTo: null,
      turnId: r.turnId,
      kind: r.kind,
      text: r.text,
      ts: new Date(r.ts).toISOString(),
    }) + '\n'
  );
}

function createAdapter(): ChannelAdapter {
  let server: net.Server | null = null;
  let client: net.Socket | null = null; // the single AUTHENTICATED delivery socket
  let secret = '';
  let outSeq = 0;
  // Persistent un-ACKed outbox: outId → record. Mirror of files on disk.
  const outbox = new Map<string, OutboxRecord>();
  // Count of corrupt records quarantined at load; surfaced to the connector on
  // the next successful handshake as a `delivery_corrupt` signal.
  let corruptCount = 0;
  // Last inbound turn seen per platform (best-effort tag for outbound — NanoClaw
  // does not expose per-message reply correlation to channels).
  const lastTurn = new Map<string, string>();

  function emitDropped(rec: OutboxRecord, reason: 'overflow' | 'expired'): void {
    log.warn('openagents: outbox dropped a queued reply', { reason }); // never the body
    if (client) {
      try {
        client.write(JSON.stringify({ op: 'dropped', outId: rec.outId, platformId: rec.platformId, reason }) + '\n');
      } catch {
        /* best-effort */
      }
    }
  }

  function deleteRecord(outId: string): void {
    outbox.delete(outId);
    try {
      fs.unlinkSync(path.join(outboxDir(), sha256hex(outId) + '.json'));
    } catch {
      /* already gone */
    }
  }

  function persistRecord(rec: OutboxRecord): void {
    const f = path.join(outboxDir(), sha256hex(rec.outId) + '.json');
    const tmp = `${f}.tmp`;
    try {
      // Write + fsync the temp file, then atomically rename it into place. A
      // crash mid-write leaves only a `.tmp` (ignored on load), never a partial
      // `.json`. fsync the dir so the rename itself is durable.
      const fd = fs.openSync(tmp, 'w', 0o600);
      try {
        fs.writeSync(fd, JSON.stringify(rec));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, f);
      try {
        fs.chmodSync(f, 0o600);
      } catch {
        /* best-effort */
      }
      try {
        const dfd = fs.openSync(outboxDir(), 'r');
        try {
          fs.fsyncSync(dfd);
        } finally {
          fs.closeSync(dfd);
        }
      } catch {
        /* directory fsync is best-effort (not supported on every platform) */
      }
    } catch (err) {
      log.warn('openagents: failed to persist outbox record', { err });
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* best-effort */
      }
    }
  }

  /** Move a corrupt/invalid record file aside instead of deleting it. */
  function quarantine(name: string): void {
    try {
      fs.mkdirSync(corruptDir(), { recursive: true, mode: 0o700 });
      fs.renameSync(path.join(outboxDir(), name), path.join(corruptDir(), `${Date.now()}-${name}`));
      log.warn('openagents: quarantined a corrupt outbox record', { name });
    } catch (err) {
      log.warn('openagents: failed to quarantine corrupt outbox record', { name, err });
    }
    corruptCount += 1;
  }

  function pruneExpired(): void {
    const cutoff = Date.now() - OUTBOX_TTL_MS;
    for (const [outId, rec] of outbox) {
      if (rec.ts < cutoff) {
        deleteRecord(outId);
        emitDropped(rec, 'expired');
      }
    }
  }

  function enforceCapacity(): void {
    while (outbox.size >= MAX_OUTBOX) {
      // Evict the oldest (insertion order ≈ age, since we set in ts order).
      const oldestId = outbox.keys().next().value;
      if (oldestId === undefined) break;
      const rec = outbox.get(oldestId);
      deleteRecord(oldestId);
      if (rec) emitDropped(rec, 'overflow');
    }
  }

  function loadOutbox(): void {
    let files: string[] = [];
    try {
      files = fs.readdirSync(outboxDir());
    } catch {
      return;
    }
    const recs: OutboxRecord[] = [];
    for (const name of files) {
      if (name === 'corrupt') continue; // the quarantine dir
      if (name.endsWith('.tmp')) continue; // partial write from an interrupted persist — ignore
      if (!name.endsWith('.json')) continue;
      let rec: OutboxRecord | null = null;
      try {
        rec = JSON.parse(fs.readFileSync(path.join(outboxDir(), name), 'utf-8')) as OutboxRecord;
      } catch {
        quarantine(name); // corrupt JSON — quarantine + report, never silently drop
        continue;
      }
      if (rec && typeof rec.outId === 'string' && typeof rec.platformId === 'string' && typeof rec.ts === 'number') {
        recs.push(rec);
      } else {
        quarantine(name); // structurally invalid
      }
    }
    recs.sort((a, b) => a.ts - b.ts);
    for (const rec of recs) outbox.set(rec.outId, rec);
    pruneExpired();
  }

  const adapter: ChannelAdapter = {
    name: 'openagents',
    channelType: CHANNEL_TYPE,
    // Keep the threadId end-to-end (the router strips it for non-threaded
    // adapters). The OpenAgents connector uses a per-channel thread "epoch": on
    // Stop it bumps the epoch so the next message lands on a fresh NanoClaw
    // session (per-thread routing), and NanoClaw stamps outbound with the
    // triggering inbound's thread_id, letting the connector reliably drop the old
    // session's late replies.
    supportsThreads: true,

    async setup(config: ChannelSetup): Promise<void> {
      const dir = ipcDir();
      const dirCheck = ensureSecureDir(dir);
      if (!dirCheck.ok) throw new Error(`openagents channel: insecure IPC dir — ${dirCheck.reason}`);
      const obCheck = ensureSecureDir(outboxDir());
      if (!obCheck.ok) throw new Error(`openagents channel: insecure outbox dir — ${obCheck.reason}`);

      // Load any un-ACKed replies left over from a previous Channel/host run.
      loadOutbox();

      // Fresh random per-host secret each startup (rotation). 0600, never logged.
      secret = crypto.randomBytes(32).toString('hex');
      const sp = secretPath();
      if (lstatSafe(sp)?.isSymbolicLink()) throw new Error('openagents channel: secret path is a symlink');
      fs.writeFileSync(sp, secret, { mode: 0o600 });
      try {
        fs.chmodSync(sp, 0o600);
      } catch {
        /* best-effort */
      }

      const sock = socketPath();
      if (lstatSafe(sock)?.isSymbolicLink()) throw new Error('openagents channel: socket path is a symlink');
      safeUnlinkSocket(sock);

      server = net.createServer((socket) => handleConnection(socket, config));
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(sock, () => {
          try {
            fs.chmodSync(sock, 0o600);
          } catch (err) {
            log.warn('openagents: failed to chmod socket (continuing)', { sock, err });
          }
          log.info('openagents channel listening', { sock });
          resolve();
        });
      });
    },

    async teardown(): Promise<void> {
      if (client) {
        try {
          client.end();
        } catch {
          /* best-effort */
        }
        client = null;
      }
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
        server = null;
      }
      safeUnlinkSocket(socketPath());
      try {
        const sp = secretPath();
        if (lstatSafe(sp)?.isFile()) fs.unlinkSync(sp);
      } catch {
        /* best-effort */
      }
      secret = '';
      // NOTE: the outbox is intentionally LEFT on disk so un-ACKed replies
      // survive a restart; it is reloaded on the next setup().
    },

    isConnected(): boolean {
      return server !== null;
    },

    async deliver(platformId, threadId, message: OutboundMessage): Promise<string | undefined> {
      const text = extractText(message);
      if (text === null) return undefined;
      pruneExpired();
      enforceCapacity();
      outSeq += 1;
      const outId = `${platformId}#${Date.now()}#${outSeq}`;
      const rec: OutboxRecord = {
        outId,
        platformId,
        threadId: threadId ?? null,
        turnId: lastTurn.get(platformId) ?? null,
        sessionKey: platformId,
        kind: message.kind,
        text,
        ts: Date.now(),
      };
      // Persist BEFORE sending so a crash/restart can replay it.
      outbox.set(outId, rec);
      persistRecord(rec);
      if (client) {
        try {
          client.write(outboundLine(rec));
        } catch (err) {
          log.warn('openagents: write to client failed', { err });
        }
      }
      return undefined; // no platform-native message id on this transport
    },

    async setTyping(platformId, _threadId): Promise<void> {
      if (!client) return;
      try {
        client.write(JSON.stringify({ op: 'status', platformId, state: 'working', ts: new Date().toISOString() }) + '\n');
      } catch {
        /* best-effort */
      }
    },

    // The router may call subscribe() for threaded adapters; we have no platform
    // subscription concept (the OpenAgents connector drives threads), so it is a
    // no-op. Defined explicitly so the router never calls an undefined method.
    async subscribe(_platformId, _threadId): Promise<void> {
      /* no-op */
    },
  };

  function handleConnection(socket: net.Socket, config: ChannelSetup): void {
    let authed = false;
    let buf = '';

    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        void handleLine(line);
      }
      // Bound the buffer: a peer streaming without a newline would otherwise
      // grow memory unbounded. Frames are small newline-delimited JSON.
      if (buf.length > 8 * 1024 * 1024) {
        log.warn("openagents: inbound buffer exceeded size limit without a newline — closing connection");
        buf = "";
        socket.destroy();
      }
    });
    socket.on('close', () => {
      if (client === socket) client = null;
      if (authed) log.info('openagents: connector disconnected');
    });
    socket.on('error', (err) => {
      log.warn('openagents: connector socket error', { err });
    });

    function reject(code: string): void {
      try {
        socket.write(JSON.stringify({ op: 'error', code, message: 'handshake rejected' }) + '\n');
        socket.destroy();
      } catch {
        /* best-effort */
      }
    }

    async function handleLine(line: string): Promise<void> {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(line);
      } catch {
        return;
      }
      const op = typeof payload.op === 'string' ? payload.op : '';

      if (op === 'ping') {
        try {
          socket.write(JSON.stringify({ op: 'pong' }) + '\n');
        } catch {
          /* best-effort */
        }
        return;
      }

      if (op === 'hello') {
        if (payload.protocol !== PROTOCOL_VERSION) {
          log.warn('openagents: handshake protocol mismatch', { got: payload.protocol });
          reject('incompatible_version');
          return;
        }
        // Single-connection: a live authenticated connector already holds the
        // channel — reject (do NOT supersede). The old must drop first.
        if (client && client !== socket && !client.destroyed) {
          log.warn('openagents: rejecting a second connector (single-connection)');
          reject('single_connection');
          return;
        }
        const provided = typeof payload.secret === 'string' ? payload.secret : '';
        const ok =
          provided.length === secret.length &&
          crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
        if (!ok) {
          log.warn('openagents: handshake authentication failed');
          reject('auth_failed');
          return;
        }
        authed = true;
        client = socket;
        log.info('openagents: connector authenticated');
        try {
          socket.write(JSON.stringify({ op: 'ready', channelType: CHANNEL_TYPE, protocol: PROTOCOL_VERSION }) + '\n');
        } catch {
          /* best-effort */
        }
        // Replay un-ACKed outbox to the (re)connected client.
        pruneExpired();
        for (const rec of outbox.values()) {
          try {
            socket.write(outboundLine(rec));
          } catch {
            /* best-effort */
          }
        }
        // Surface any corrupt records quarantined at load.
        if (corruptCount > 0) {
          try {
            socket.write(JSON.stringify({ op: 'dropped', reason: 'corrupt', platformId: null, count: corruptCount }) + '\n');
          } catch {
            /* best-effort */
          }
          corruptCount = 0;
        }
        return;
      }

      if (!authed) {
        log.warn('openagents: dropping pre-handshake frame', { op });
        return;
      }

      if (op === 'ack') {
        const outId = typeof payload.outId === 'string' ? payload.outId : '';
        const platformId = typeof payload.platformId === 'string' ? payload.platformId : '';
        const rec = outId ? outbox.get(outId) : undefined;
        // ACK must carry matching platform context — never trust a bare outId.
        if (rec && (!platformId || rec.platformId === platformId)) deleteRecord(outId);
        return;
      }

      if (op === 'inbound') {
        const platformId = typeof payload.platformId === 'string' ? payload.platformId : '';
        const text = typeof payload.text === 'string' ? payload.text : '';
        if (!platformId || !text) return;
        const threadId = typeof payload.threadId === 'string' ? payload.threadId : null;
        const msgId =
          typeof payload.msgId === 'string' && payload.msgId
            ? payload.msgId
            : `oa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const turnId = typeof payload.turnId === 'string' && payload.turnId ? payload.turnId : msgId;
        lastTurn.set(platformId, turnId);
        const sender = typeof payload.sender === 'string' ? payload.sender : 'user';
        const senderId = typeof payload.senderId === 'string' ? payload.senderId : `oa:${platformId}`;

        try {
          config.onMetadata(platformId, undefined, false);
        } catch {
          /* optional callback */
        }
        try {
          await config.onInbound(platformId, threadId, {
            id: msgId,
            kind: 'chat',
            content: { text, sender, senderId, attachments: [], isFromMe: false },
            timestamp: typeof payload.ts === 'string' ? payload.ts : new Date().toISOString(),
          });
        } catch (err) {
          log.error('openagents: onInbound threw', { err });
          try {
            socket.write(JSON.stringify({ op: 'error', platformId, message: 'NanoClaw failed to accept the message.' }) + '\n');
          } catch {
            /* best-effort */
          }
        }
        return;
      }

      if (op === 'cancel') {
        log.info('openagents: detach/cancel acknowledged (turn completes in NanoClaw)', {
          platformId: payload.platformId,
        });
        return;
      }
    }
  }

  return adapter;
}

function extractText(message: OutboundMessage): string | null {
  const content = message.content as Record<string, unknown> | string | undefined;
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.markdown === 'string') return content.markdown;
    if (typeof content.fallbackText === 'string') return content.fallbackText;
  }
  return null;
}

registerChannelAdapter('openagents', { factory: createAdapter });

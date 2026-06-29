/**
 * NanoClaw bridge protocol — pure, dependency-free helpers.
 *
 * NanoClaw is a CONTAINERIZED agent runtime, not an stdin/stdout CLI and not a
 * direct LLM API. The OpenAgents bridge talks to a thin native NanoClaw
 * `openagents` *channel* (the official extension point) over a local Unix
 * socket (`<nanoclaw>/data/openagents.sock`). This module holds the wire
 * format, id/addressing rules, secret redaction, and error classification —
 * everything that can be unit-tested without any IO.
 *
 * Wire format: one JSON object per line ("\n"-delimited), both directions.
 *
 *   OpenAgents adapter (client) → channel (server):
 *     { op: "hello",   workspace, agent, protocol, secret }   // secret REQUIRED
 *     { op: "inbound", platformId, threadId, msgId, text, sender, senderId, ts }
 *     { op: "ack",     outId, platformId }    // confirms an outbound was delivered
 *     { op: "cancel",  platformId, msgId }
 *     { op: "ping" }
 *
 *   channel (server) → OpenAgents adapter (client):
 *     { op: "ready",    channelType, protocol }   // ONLY after a valid hello
 *     { op: "outbound", platformId, threadId, outId, inReplyTo, kind, text, ts }
 *     { op: "status",   platformId, state: "working"|"idle", ts }
 *     { op: "error",    platformId?, code?, message }   // sanitized by the channel
 *     { op: "pong" }
 *
 * Local trust boundary: `data/openagents/bridge.sock` (0600) lives in a 0700
 * dir; the client must present a random per-host `secret` (read from the 0600
 * `data/openagents/secret` file written by the channel) in `hello`. No frame
 * other than `hello`/`ping` is honored before the handshake succeeds, and the
 * server re-authenticates on every (re)connect. The secret never enters the
 * Workspace, the container, or logs.
 *
 * Delivery is AT-LEAST-ONCE with dedup: the channel holds each outbound until
 * the bridge ACKs it; the bridge ACKs only after the message is handed to the
 * Workspace, and persists processed `outId`s so a replay is re-ACKed but not
 * re-displayed. This is NOT unconditional exactly-once (see docs).
 *
 * The workspace TOKEN is deliberately NOT part of the protocol — the adapter
 * does all workspace IO, so no OpenAgents credential is ever duplicated into
 * the NanoClaw process. See [[nanoclaw-facts-and-arch]].
 */

'use strict';

const crypto = require('crypto');

const PROTOCOL_VERSION = 1;

// Channel identity on the NanoClaw side. Each OpenAgents channel maps to a
// distinct messaging group (channel_type='openagents', platform_id=<below>),
// which — with session_mode 'shared' — yields one isolated NanoClaw session
// per OpenAgents channel.
const CHANNEL_TYPE = 'openagents';

/**
 * Stable, collision-resistant platform id for an OpenAgents channel.
 * Distinct OpenAgents channels → distinct platform ids → distinct NanoClaw
 * sessions (isolation). Distinct workspaces never collide on one NanoClaw host.
 * @param {string} workspaceId
 * @param {string} channel  OpenAgents channel/session name
 * @returns {string}
 */
function platformIdFor(workspaceId, channel) {
  const ws = String(workspaceId || 'ws').trim();
  const ch = String(channel || 'general').trim() || 'general';
  return `oa:${ws}:${ch}`;
}

/**
 * Recover the OpenAgents channel from a platform id produced by platformIdFor.
 * Returns null if the platform id isn't ours (defensive — ignore foreign
 * platforms so we never cross-deliver another channel's traffic).
 * @param {string} platformId
 * @param {string} workspaceId
 * @returns {string|null}
 */
function channelFromPlatformId(platformId, workspaceId) {
  const prefix = `oa:${String(workspaceId || 'ws').trim()}:`;
  if (typeof platformId !== 'string' || !platformId.startsWith(prefix)) return null;
  const ch = platformId.slice(prefix.length);
  return ch || null;
}

/**
 * Deterministic, unique message id for an inbound workspace message. Stable for
 * the same source message (so a reconnect/redelivery does NOT create a second
 * NanoClaw message — idempotency), and unique across messages (dedup). Prefer
 * the workspace-issued id; fall back to a content+timestamp hash.
 * @param {object} msg     workspace message ({id, content, sessionId, ...})
 * @param {string} workspaceId
 * @returns {string}
 */
function makeMessageId(msg, workspaceId) {
  const ws = String(workspaceId || 'ws').trim();
  const raw = msg && (msg.id || msg.messageId || msg.eventId);
  if (raw) return `oa:${ws}:${raw}`;
  const basis = JSON.stringify({
    c: (msg && msg.content) || '',
    s: (msg && (msg.sessionId || msg.channel)) || '',
    t: (msg && (msg.timestamp || msg.ts)) || '',
  });
  const h = crypto.createHash('sha1').update(basis).digest('hex').slice(0, 20);
  return `oa:${ws}:h:${h}`;
}

/**
 * Should this inbound workspace message be forwarded to NanoClaw at all?
 * Loop/echo guard: never forward the agent's OWN output back into NanoClaw
 * (which would create an infinite agent→channel→agent loop), and never forward
 * non-user control/status chatter.
 * @param {object} msg
 * @param {string} agentName  this adapter's agent name
 * @returns {boolean}
 */
function shouldForwardInbound(msg, agentName) {
  if (!msg) return false;
  const type = msg.messageType || msg.type;
  if (type && type !== 'chat' && type !== 'message' && type !== 'text') return false;
  const senderType = msg.senderType || msg.sender_type;
  if (senderType === 'agent') return false; // our own / another agent's output
  const sender = msg.senderName || msg.sender_name || msg.sender;
  if (sender && agentName && String(sender) === String(agentName)) return false;
  const content = (msg.content || msg.text || '').trim();
  return content.length > 0;
}

// ---------------------------------------------------------------------------
// Frame build / parse
// ---------------------------------------------------------------------------

function encodeFrame(obj) {
  return JSON.stringify(obj) + '\n';
}

function buildHello(workspace, agent, secret) {
  return encodeFrame({ op: 'hello', workspace, agent, protocol: PROTOCOL_VERSION, secret: secret || '' });
}

function buildAck(outId, platformId) {
  return encodeFrame({ op: 'ack', outId, platformId: platformId || null });
}

function buildInbound({ platformId, threadId = null, msgId, turnId, text, sender = 'user', senderId, ts }) {
  return encodeFrame({
    op: 'inbound',
    platformId,
    threadId: threadId == null ? null : threadId,
    msgId,
    // turnId identifies the OpenAgents delivery turn; the channel echoes it on
    // outbound (best-effort: the last inbound turn on that platform, since
    // NanoClaw does not expose per-message reply correlation to channels).
    turnId: turnId || msgId,
    text,
    sender,
    senderId: senderId || `oa:${sender}`,
    ts: ts || new Date().toISOString(),
  });
}

function buildCancel(platformId, msgId) {
  return encodeFrame({ op: 'cancel', platformId, msgId: msgId || null });
}

function buildPing() {
  return encodeFrame({ op: 'ping' });
}

/**
 * Incremental line-delimited JSON parser. Feed it raw chunks; it returns the
 * parsed frames found so far plus the unconsumed remainder to carry forward.
 * Malformed lines are skipped (forward-compatibility), never thrown.
 * @param {string} buffer  accumulated text (prev remainder + new chunk)
 * @returns {{frames: object[], rest: string}}
 */
function parseFrames(buffer) {
  const frames = [];
  let rest = buffer;
  let idx;
  while ((idx = rest.indexOf('\n')) >= 0) {
    const line = rest.slice(0, idx).trim();
    rest = rest.slice(idx + 1);
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === 'object' && typeof obj.op === 'string') frames.push(obj);
    } catch {
      // ignore non-JSON / partial garbage
    }
  }
  return { frames, rest };
}

// ---------------------------------------------------------------------------
// Secret redaction — never let tokens / keys / cookies / message bodies leak
// into logs.
// ---------------------------------------------------------------------------

const _SECRET_PATTERNS = [
  [/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[REDACTED]'],
  [/(Authorization"?\s*[:=]\s*"?)[^"\s,&]+/gi, '$1[REDACTED]'],
  [/(Cookie"?\s*[:=]\s*"?)[^"\n]+/gi, '$1[REDACTED]'],
  [/([?&](?:token|api[_-]?key|apikey|key|secret|password|auth[_-]?token)=)[^&\s"]+/gi, '$1[REDACTED]'],
  [/((?:api[_-]?key|apikey|secret|password|token|auth[_-]?token)"?\s*[:=]\s*"?)[^"\s,}]+/gi, '$1[REDACTED]'],
  [/\bsk-[A-Za-z0-9_\-]{12,}\b/g, 'sk-[REDACTED]'],
  [/\bsk-ant-[A-Za-z0-9_\-]{12,}\b/g, 'sk-ant-[REDACTED]'],
  [/\bgh[oprsu]_[A-Za-z0-9]{20,}\b/g, 'gh_[REDACTED]'],
];

/**
 * Redact secrets from an arbitrary string. Optionally scrub a list of exact
 * secret values (e.g. the live workspace token) before pattern-based passes.
 * @param {string} str
 * @param {string[]} [extraSecrets]
 * @returns {string}
 */
function redactSecrets(str, extraSecrets = []) {
  if (str == null) return '';
  let s = String(str);
  for (const secret of extraSecrets) {
    if (secret && String(secret).length >= 6) {
      s = s.split(String(secret)).join('[REDACTED]');
    }
  }
  for (const [re, repl] of _SECRET_PATTERNS) s = s.replace(re, repl);
  return s;
}

// ---------------------------------------------------------------------------
// Error classification — distinct, user-facing categories. Detailed cause is
// returned separately (already redactable) for logs; userMessage is safe to
// show a non-technical user.
// ---------------------------------------------------------------------------

const ERR = {
  NOT_INSTALLED: 'not_installed',
  DOCKER_UNAVAILABLE: 'docker_unavailable',
  HOST_NOT_RUNNING: 'host_not_running',
  AGENT_GROUP_MISSING: 'agent_group_missing',
  CHANNEL_NOT_LOADED: 'channel_not_loaded',
  WIRING_MISSING: 'wiring_missing',
  CREDS_MISSING: 'creds_missing',
  AUTH_FAILED: 'auth_failed',
  INCOMPATIBLE_VERSION: 'incompatible_version',
  SINGLE_CONNECTION: 'single_connection',
  DELIVERY_OVERFLOW: 'delivery_overflow',
  DELIVERY_EXPIRED: 'delivery_expired',
  DELIVERY_CORRUPT: 'delivery_corrupt',
  CONTAINER_START_FAILED: 'container_start_failed',
  SEND_FAILED: 'send_failed',
  TIMEOUT: 'timeout',
  DISCONNECTED: 'disconnected',
  RECONNECT_FAILED: 'reconnect_failed',
  DUPLICATE: 'duplicate',
  RUNTIME_CRASHED: 'runtime_crashed',
  UNKNOWN: 'unknown',
};

const _ERR_MESSAGES = {
  [ERR.NOT_INSTALLED]:
    'NanoClaw is not installed or could not be found. Set NANOCLAW_HOME to your NanoClaw checkout (or put `ncl` on your PATH).',
  [ERR.DOCKER_UNAVAILABLE]:
    'Docker is not available. NanoClaw runs each agent group in a container — start Docker Desktop / the Docker daemon (on Windows use WSL2).',
  [ERR.HOST_NOT_RUNNING]:
    'The NanoClaw host service is not running. Start it (e.g. `./nanoclaw.sh start`, launchd, or systemd) and try again.',
  [ERR.AGENT_GROUP_MISSING]:
    'The configured NanoClaw Agent Group was not found. Pick an existing group (NANOCLAW_AGENT_GROUP) or create one in NanoClaw.',
  [ERR.CHANNEL_NOT_LOADED]:
    'The NanoClaw `openagents` channel is not loaded. Install it (/add-openagents) and restart the NanoClaw host.',
  [ERR.WIRING_MISSING]:
    'This OpenAgents channel is not wired to the Agent Group yet. Approve the wiring in NanoClaw (creating wirings requires approval).',
  [ERR.CREDS_MISSING]:
    'NanoClaw is missing its provider credentials. Configure the agent group provider (e.g. Anthropic) in NanoClaw.',
  [ERR.AUTH_FAILED]:
    'Could not authenticate to the NanoClaw openagents channel (local secret missing or mismatched). Restart the NanoClaw host so a fresh secret is issued.',
  [ERR.INCOMPATIBLE_VERSION]:
    'This NanoClaw version is not compatible with the OpenAgents channel. Use a verified NanoClaw version, or upgrade the OpenAgents integration.',
  [ERR.SINGLE_CONNECTION]:
    'Another OpenAgents connector is already attached to this NanoClaw host. Only one connector per host is allowed; disconnect the other first.',
  [ERR.DELIVERY_OVERFLOW]:
    'A queued NanoClaw reply was dropped because the local outbox is full — it may not be recoverable.',
  [ERR.DELIVERY_EXPIRED]:
    'A queued NanoClaw reply expired before it could be delivered — it may not be recoverable.',
  [ERR.DELIVERY_CORRUPT]:
    'A corrupt NanoClaw outbox record was found and quarantined — a queued reply may not be recoverable.',
  [ERR.CONTAINER_START_FAILED]:
    'NanoClaw could not start the agent container. Check Docker and the NanoClaw host logs.',
  [ERR.SEND_FAILED]: 'Could not deliver the message to NanoClaw. Retrying / check the host.',
  [ERR.TIMEOUT]: 'NanoClaw did not reply in time. The agent may still be working — try again shortly.',
  [ERR.DISCONNECTED]: 'Lost the connection to NanoClaw. Reconnecting…',
  [ERR.RECONNECT_FAILED]: 'Could not reconnect to NanoClaw after several attempts.',
  [ERR.DUPLICATE]: 'Duplicate message ignored.',
  [ERR.RUNTIME_CRASHED]: 'The NanoClaw runtime exited unexpectedly.',
  [ERR.UNKNOWN]: 'An unexpected error occurred talking to NanoClaw.',
};

/**
 * Classify a raw error/condition into a stable code + a safe user message.
 * @param {Error|string|{code?:string}} err
 * @param {{hint?:string}} [ctx]
 * @returns {{code:string, userMessage:string, detail:string}}
 */
function classifyError(err, ctx = {}) {
  const rawMsg = err == null ? '' : (err.message || String(err));
  const lower = rawMsg.toLowerCase();
  let code = (err && err.code && _ERR_MESSAGES[err.code]) ? err.code : null;

  if (!code) {
    if (/enoent|not found|no such file|cannot find|nanoclaw_home/.test(lower) && /ncl|nanoclaw|sock|home/.test(lower)) {
      code = ERR.NOT_INSTALLED;
    } else if (/docker/.test(lower) && /(not|cannot|unavailable|refused|daemon)/.test(lower)) {
      code = ERR.DOCKER_UNAVAILABLE;
    } else if (/econnrefused|host closed|ncl\.sock|control socket|not running/.test(lower)) {
      code = ERR.HOST_NOT_RUNNING;
    } else if (/agent group|agent_group/.test(lower) && /(missing|not found|unknown)/.test(lower)) {
      code = ERR.AGENT_GROUP_MISSING;
    } else if (/epipe|econnreset|socket hang up|disconnect|closed/.test(lower)) {
      code = ERR.DISCONNECTED;
    } else if (/timed out|timeout|etimedout/.test(lower)) {
      code = ERR.TIMEOUT;
    } else {
      code = ERR.UNKNOWN;
    }
  }
  return {
    code,
    userMessage: _ERR_MESSAGES[code] || _ERR_MESSAGES[ERR.UNKNOWN],
    detail: redactSecrets(rawMsg, ctx.secrets || []),
  };
}

module.exports = {
  PROTOCOL_VERSION,
  CHANNEL_TYPE,
  ERR,
  platformIdFor,
  channelFromPlatformId,
  makeMessageId,
  shouldForwardInbound,
  encodeFrame,
  buildHello,
  buildAck,
  buildInbound,
  buildCancel,
  buildPing,
  parseFrames,
  redactSecrets,
  classifyError,
};

/**
 * Pi CLI — RPC (JSONL) framing, event classification and helpers (pure, no I/O).
 *
 * This module turns the raw byte stream produced by
 *   `pi --mode rpc [...]`
 * into normalized events the PiAdapter maps onto OpenAgents workspace
 * messages. Like copilot-stream-parser.js it is split into layers so a Pi
 * upgrade only ever touches one table:
 *
 *   1. FRAMING (schema-agnostic) — `PiJsonlFramer`
 *      Reassembles complete records from arbitrary chunk boundaries. Pi's RPC
 *      protocol is *strict* JSONL: LF (`\n`) is the ONLY record delimiter, a
 *      trailing `\r` may be stripped, and U+2028/U+2029 MUST NOT be treated as
 *      newlines (they are legal inside JSON strings). Node's `readline` splits
 *      on those separators and is therefore not protocol-compliant — hence the
 *      hand-rolled framer here. A `StringDecoder` does the byte→string step so
 *      a multi-byte UTF-8 sequence (CJK, emoji) split across two chunks is
 *      reassembled instead of being decoded into replacement characters.
 *
 *   2. CLASSIFICATION (schema-aware) — `classifyPiEvent()` + EVENT_KIND_BY_TYPE
 *      Maps one parsed JSON object onto `{ kind, ... }`. All Pi type strings
 *      live in ONE table so a schema drift is a single-point edit. Anything
 *      unrecognized degrades to a redacted `unknown` event — never a throw.
 *
 *   3. TURN ACCUMULATION — `PiAssistantAccumulator`
 *      Pi emits each assistant content block TWICE: incrementally through
 *      `message_update` (`text_delta` … `text_end`) and again in full on
 *      `message_end`. The accumulator hands each block to the caller exactly
 *      once, keyed by its `contentIndex`, so streaming output and the final
 *      message can never be posted twice.
 *
 * ── Verification status ──────────────────────────────────────────────────
 * Verified against @earendil-works/pi-coding-agent v0.83.0 (bin `pi`,
 * engines.node >= 22.19.0) using the RPC protocol spec shipped in the package
 * (docs/rpc.md) plus live `pi --mode rpc` captures. Confirmed by capture:
 *   • command responses: {"id","type":"response","command","success",[data|error]}
 *   • event order for a turn: agent_start → turn_start → message_start/…_end
 *     (user) → message_start/…_end (assistant) → turn_end → agent_end →
 *     agent_settled
 *   • a provider/auth failure is NOT a failed `response`: the prompt is
 *     accepted (success:true) and the failure arrives as an assistant message
 *     with stopReason "error" + `errorMessage`
 *   • `--session-id <uuid>` creates the session when missing and resumes it on
 *     the next process, so no session-id correlation heuristics are needed
 * Never infer an event's meaning from a field name alone.
 *
 * Normalized event kinds (the adapter's stable contract):
 *   { kind:'response',        id, command, success, data, error }
 *   { kind:'agent_start' }
 *   { kind:'agent_end',       willRetry }
 *   { kind:'agent_settled' }
 *   { kind:'message_start',   role }
 *   { kind:'message_update',  delta }        raw assistantMessageEvent
 *   { kind:'message_end',     message }      full AgentMessage
 *   { kind:'tool_start',      toolCallId, toolName, preview }
 *   { kind:'tool_update',     toolCallId, toolName }
 *   { kind:'tool_end',        toolCallId, toolName, isError, preview }
 *   { kind:'bash_output',     id, delta }
 *   { kind:'queue_update',    steering, followUp }
 *   { kind:'compaction_start',reason }
 *   { kind:'compaction_end',  reason, aborted, willRetry, error }
 *   { kind:'retry_start',     attempt, maxAttempts, delayMs, message }
 *   { kind:'retry_end',       success, attempt, finalError }
 *   { kind:'extension_error', message }
 *   { kind:'ui_request',      id, method, needsResponse, title }
 *   { kind:'oversize',        bytes }        a single record blew the line cap
 *   { kind:'unknown',         raw }          unrecognized / unparseable (redacted)
 */

'use strict';

const path = require('path');
const { StringDecoder } = require('string_decoder');

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

/**
 * FALLBACK floor only. The authoritative minimum lives in the registry
 * (`install.min_version` in pi.yaml / registry.json) so the catalog and the
 * runtime gate cannot drift; the adapter reads it from there and passes it to
 * `classifyPiVersion`. This constant is used only when the registry entry
 * cannot be read at all.
 */
const MIN_PI_VERSION = '0.83.0';

/** Pi's own hard engine floor (package.json engines.node). */
const MIN_NODE_VERSION = '22.19.0';

/**
 * Hard cap on a single un-terminated record we will buffer. Pi can emit very
 * large single lines (an `agent_end` carries every message of the run), so this
 * is generous — but unbounded buffering on a wedged stream is how a daemon
 * OOMs. Mirrors goose-stream.js's MAX_LINE_BYTES rationale.
 */
const MAX_LINE_BYTES = 16 * 1024 * 1024;

/** How much of a tool argument we surface as a workspace status line. */
const TOOL_PREVIEW_LIMIT = 160;

/**
 * Extension UI methods that BLOCK the Pi process until the client answers.
 * A headless run has no one to answer them, so the adapter must reply
 * `{cancelled:true}` immediately or the turn hangs forever.
 */
const BLOCKING_UI_METHODS = new Set(['select', 'confirm', 'input', 'editor']);

// ────────────────────────────────────────────────────────────────────────
// Redaction
// ────────────────────────────────────────────────────────────────────────

/**
 * Mask credentials in arbitrary text before it reaches a log, a status file or
 * the workspace. `secrets` are exact values (e.g. the configured API key) that
 * must be masked even when they don't match any known shape. Never throws.
 *
 * @param {string} text
 * @param {string[]} [secrets]
 * @returns {string}
 */
function redactSecrets(text, secrets) {
  if (text == null) return '';
  let out = typeof text === 'string' ? text : String(text);
  for (const secret of secrets || []) {
    if (secret && typeof secret === 'string' && secret.length >= 8) {
      out = out.split(secret).join('***');
    }
  }
  out = out.replace(
    /\b(api[_-]?key|secret|token|authorization|auth|bearer|password)\b\s*[:=]?\s*['"]?([A-Za-z0-9._-]{8,})['"]?/gi,
    (_m, label) => `${label}=***`,
  );
  out = out.replace(/\b(?:sk|pk|rk)-[A-Za-z0-9._-]{6,}\b/g, '***');
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, '***');
  out = out.replace(/\bAKIA[0-9A-Z]{12,}\b/g, '***');
  // scheme://user:pass@host
  out = out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/@\s:]+:[^/@\s]+@/gi, '$1***@');
  return out;
}

/**
 * Short, redacted, single-line diagnostic for an unrecognized record so a
 * schema drift is observable in logs without dumping a transcript or a secret.
 */
function diagnosticFor(value, maxLen = 300) {
  let s;
  if (typeof value === 'string') s = value;
  else {
    try { s = JSON.stringify(value); } catch { s = String(value); }
  }
  s = redactSecrets(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

// ────────────────────────────────────────────────────────────────────────
// Framing — strict JSONL, LF only, UTF-8 safe across chunk boundaries
// ────────────────────────────────────────────────────────────────────────

/**
 * Incremental JSONL framer for Pi's RPC stdout.
 *
 * Contract (from the Pi RPC spec):
 *   - split on `\n` and ONLY on `\n`
 *   - tolerate (strip) a single trailing `\r`
 *   - never treat U+2028 / U+2029 as a record separator
 *   - a record may span many chunks; a chunk may carry many records
 */
class PiJsonlFramer {
  constructor({ maxLineBytes = MAX_LINE_BYTES } = {}) {
    this._decoder = new StringDecoder('utf8');
    this._buf = '';
    this._maxLineBytes = maxLineBytes;
    /** Records dropped because they exceeded the cap (diagnostics only). */
    this.dropped = 0;
    /** Byte length of the last dropped record, for a redacted log line. */
    this.lastDroppedBytes = 0;
    this._skippingOversize = false;
  }

  /**
   * Feed a stdout chunk. Returns the complete records it completed, in order.
   * A record that exceeds the cap is dropped (and counted) rather than
   * buffered forever; the framer then resynchronizes on the next `\n`.
   *
   * @param {Buffer|string} chunk
   * @returns {string[]}
   */
  push(chunk) {
    if (chunk == null) return [];
    this._buf += typeof chunk === 'string' ? chunk : this._decoder.write(chunk);
    return this._drain();
  }

  /**
   * Flush at EOF: decodes any dangling multi-byte remainder and emits the
   * trailing record when the stream ended without a final `\n`. Idempotent.
   * @returns {string[]}
   */
  flush() {
    this._buf += this._decoder.end();
    const lines = this._drain();
    const tail = this._buf;
    this._buf = '';
    if (this._skippingOversize) {
      // The stream ended mid-oversize record — it was already counted.
      this._skippingOversize = false;
      return lines;
    }
    if (tail) lines.push(PiJsonlFramer._strip(tail));
    return lines;
  }

  _drain() {
    const lines = [];
    while (true) {
      const idx = this._buf.indexOf('\n');
      if (idx === -1) break;
      const raw = this._buf.slice(0, idx);
      this._buf = this._buf.slice(idx + 1);
      if (this._skippingOversize) {
        // Tail of a record we already gave up on — resynchronized now.
        this._skippingOversize = false;
        continue;
      }
      lines.push(PiJsonlFramer._strip(raw));
    }
    if (this._buf.length > this._maxLineBytes) {
      this.dropped++;
      this.lastDroppedBytes = this._buf.length;
      this._buf = '';
      this._skippingOversize = true;
    }
    return lines;
  }

  /** Strip a single trailing CR, per the RPC spec's `\r\n` tolerance. */
  static _strip(line) {
    return line.endsWith('\r') ? line.slice(0, -1) : line;
  }
}

/**
 * Parse one JSONL record. Returns null for a blank line or anything that isn't
 * a JSON object — a corrupt record must degrade, never abort the turn.
 * @param {string} line
 * @returns {object|null}
 */
function parseLine(line) {
  if (line == null) return null;
  const trimmed = String(line).trim();
  if (!trimmed) return null;
  if (trimmed[0] !== '{') return null; // Pi only ever emits objects
  try {
    const v = JSON.parse(trimmed);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Classification — the SINGLE place that knows Pi's type strings
// ────────────────────────────────────────────────────────────────────────

/**
 * Pi RPC record `type` → normalized kind. Verified against v0.83.0 docs/rpc.md.
 * Extend ONLY this table when Pi adds events; unlisted types become `unknown`.
 */
const EVENT_KIND_BY_TYPE = {
  // command responses
  response: 'response',
  // agent lifecycle
  agent_start: 'agent_start',
  agent_end: 'agent_end',
  agent_settled: 'agent_settled',
  turn_start: 'turn_start',
  turn_end: 'turn_end',
  // messages
  message_start: 'message_start',
  message_update: 'message_update',
  message_end: 'message_end',
  // tools
  tool_execution_start: 'tool_start',
  tool_execution_update: 'tool_update',
  tool_execution_end: 'tool_end',
  bash_execution_update: 'bash_output',
  // queue / context management
  queue_update: 'queue_update',
  compaction_start: 'compaction_start',
  compaction_end: 'compaction_end',
  // retries
  auto_retry_start: 'retry_start',
  auto_retry_end: 'retry_end',
  summarization_retry_scheduled: 'retry_start',
  summarization_retry_attempt_start: 'turn_start',
  summarization_retry_finished: 'retry_end',
  // diagnostics + extension UI
  extension_error: 'extension_error',
  extension_ui_request: 'ui_request',
};

function _str(v) {
  return typeof v === 'string' && v.length ? v : undefined;
}

/**
 * Condense a tool's arguments into one short, redacted status preview.
 * @param {string} toolName
 * @param {*} args
 * @returns {string}
 */
function summarizeToolArgs(toolName, args) {
  if (!args || typeof args !== 'object') return '';
  const PREFERRED = [
    'command', 'file_path', 'path', 'filePath', 'file',
    'pattern', 'query', 'url', 'glob', 'old_string',
  ];
  let preview = '';
  for (const key of PREFERRED) {
    const val = args[key];
    if (typeof val === 'string' && val) { preview = val; break; }
  }
  if (!preview) {
    const keys = Object.keys(args).filter((k) => typeof k === 'string');
    if (!keys.length) return '';
    preview = keys.slice(0, 6).join(', ');
  }
  preview = redactSecrets(preview).replace(/\s+/g, ' ').trim();
  if (preview.length > TOOL_PREVIEW_LIMIT) preview = preview.slice(0, TOOL_PREVIEW_LIMIT) + '…';
  return preview;
}

/** Condense a tool result's content blocks into a short redacted preview. */
function summarizeToolResult(result) {
  if (!result || typeof result !== 'object') return '';
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((b) => (b && typeof b === 'object' && typeof b.text === 'string' ? b.text : ''))
    .join(' ')
    .trim();
  if (!text) return '';
  const preview = redactSecrets(text).replace(/\s+/g, ' ').trim();
  return preview.length > TOOL_PREVIEW_LIMIT ? preview.slice(0, TOOL_PREVIEW_LIMIT) + '…' : preview;
}

/**
 * Classify one parsed Pi RPC record. Never throws; an unrecognized shape
 * becomes `{ kind:'unknown', raw }` carrying a redacted diagnostic.
 * @param {object} obj
 * @returns {{kind: string} & object}
 */
function classifyPiEvent(obj) {
  if (!obj || typeof obj !== 'object') return { kind: 'unknown', raw: diagnosticFor(obj) };
  const type = _str(obj.type);
  const kind = type ? EVENT_KIND_BY_TYPE[type] : undefined;

  switch (kind) {
    case 'response':
      return {
        kind: 'response',
        id: obj.id == null ? null : String(obj.id),
        command: _str(obj.command) || null,
        success: obj.success === true,
        data: obj.data == null ? null : obj.data,
        error: _str(obj.error) || null,
      };
    case 'agent_start':
      return { kind: 'agent_start' };
    case 'agent_end':
      return { kind: 'agent_end', willRetry: obj.willRetry === true };
    case 'agent_settled':
      return { kind: 'agent_settled' };
    case 'turn_start':
      return { kind: 'turn_start' };
    case 'turn_end':
      return { kind: 'turn_end' };
    case 'message_start':
      return {
        kind: 'message_start',
        role: (obj.message && _str(obj.message.role)) || null,
      };
    case 'message_update':
      return {
        kind: 'message_update',
        delta: (obj.assistantMessageEvent && typeof obj.assistantMessageEvent === 'object')
          ? obj.assistantMessageEvent
          : null,
      };
    case 'message_end':
      return {
        kind: 'message_end',
        message: (obj.message && typeof obj.message === 'object') ? obj.message : null,
      };
    case 'tool_start': {
      const toolName = _str(obj.toolName) || 'tool';
      return {
        kind: 'tool_start',
        toolCallId: _str(obj.toolCallId) || null,
        toolName,
        preview: summarizeToolArgs(toolName, obj.args),
      };
    }
    case 'tool_update':
      return {
        kind: 'tool_update',
        toolCallId: _str(obj.toolCallId) || null,
        toolName: _str(obj.toolName) || 'tool',
      };
    case 'tool_end': {
      const toolName = _str(obj.toolName) || 'tool';
      return {
        kind: 'tool_end',
        toolCallId: _str(obj.toolCallId) || null,
        toolName,
        isError: obj.isError === true,
        preview: summarizeToolResult(obj.result),
      };
    }
    case 'bash_output':
      return {
        kind: 'bash_output',
        id: obj.id == null ? null : String(obj.id),
        delta: typeof obj.delta === 'string' ? obj.delta : '',
      };
    case 'queue_update':
      return {
        kind: 'queue_update',
        steering: Array.isArray(obj.steering) ? obj.steering.length : 0,
        followUp: Array.isArray(obj.followUp) ? obj.followUp.length : 0,
      };
    case 'compaction_start':
      return { kind: 'compaction_start', reason: _str(obj.reason) || 'manual' };
    case 'compaction_end':
      return {
        kind: 'compaction_end',
        reason: _str(obj.reason) || 'manual',
        aborted: obj.aborted === true,
        willRetry: obj.willRetry === true,
        error: _str(obj.errorMessage) ? redactSecrets(obj.errorMessage) : null,
      };
    case 'retry_start':
      return {
        kind: 'retry_start',
        attempt: Number.isFinite(obj.attempt) ? obj.attempt : null,
        maxAttempts: Number.isFinite(obj.maxAttempts) ? obj.maxAttempts : null,
        delayMs: Number.isFinite(obj.delayMs) ? obj.delayMs : null,
        message: _str(obj.errorMessage) ? redactSecrets(obj.errorMessage) : null,
      };
    case 'retry_end':
      return {
        kind: 'retry_end',
        // `summarization_retry_finished` carries no outcome — treat as success.
        success: obj.success !== false,
        attempt: Number.isFinite(obj.attempt) ? obj.attempt : null,
        finalError: _str(obj.finalError) ? redactSecrets(obj.finalError) : null,
      };
    case 'extension_error':
      return {
        kind: 'extension_error',
        message: redactSecrets(_str(obj.error) || 'Pi extension reported an error'),
      };
    case 'ui_request': {
      const method = _str(obj.method) || '';
      return {
        kind: 'ui_request',
        id: obj.id == null ? null : String(obj.id),
        method,
        needsResponse: BLOCKING_UI_METHODS.has(method),
        title: redactSecrets(_str(obj.title) || _str(obj.message) || ''),
      };
    }
    default:
      return { kind: 'unknown', raw: diagnosticFor(obj) };
  }
}

/**
 * Stateful parser: bytes in, normalized events out. Thin wrapper over the
 * framer + classifier so the adapter never touches either directly.
 */
class PiStreamParser {
  constructor(opts) {
    this._framer = new PiJsonlFramer(opts);
  }

  /** @param {Buffer|string} chunk @returns {Array<object>} */
  push(chunk) {
    return this._classify(this._framer.push(chunk));
  }

  /** Flush at EOF. @returns {Array<object>} */
  flush() {
    return this._classify(this._framer.flush());
  }

  _classify(lines) {
    const before = this._reportedDrops || 0;
    const events = [];
    for (const line of lines) {
      const obj = parseLine(line);
      if (obj === null) {
        // Blank lines are silent; anything else is a corrupt/foreign record we
        // surface as `unknown` so a schema drift shows up in the logs.
        if (String(line).trim()) events.push({ kind: 'unknown', raw: diagnosticFor(line) });
        continue;
      }
      events.push(classifyPiEvent(obj));
    }
    if (this._framer.dropped > before) {
      this._reportedDrops = this._framer.dropped;
      events.push({ kind: 'oversize', bytes: this._framer.lastDroppedBytes });
    }
    return events;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Turn accumulation — deduplicates message_update against message_end
// ────────────────────────────────────────────────────────────────────────

/**
 * Pi delivers each assistant content block twice: incrementally via
 * `message_update` (…`text_end` / `thinking_end` carry the COMPLETE block) and
 * again inside the `message_end` payload. This accumulator releases each block
 * exactly once, keyed by its `contentIndex`, so the adapter can stream blocks
 * as they finish AND still finalize from `message_end` without duplicating a
 * single character.
 *
 * Usage per assistant message:
 *   acc.startMessage()                    // on message_start (role 'assistant')
 *   acc.pushDelta(ev.delta) -> blocks[]   // on message_update
 *   acc.endMessage(ev.message) -> {...}   // on message_end
 */
class PiAssistantAccumulator {
  constructor() {
    this.reset();
  }

  reset() {
    this._released = new Set();   // contentIndex values already handed out
    this._texts = [];             // released text blocks, in order
    this._thinking = [];          // released thinking blocks, in order
    this._active = false;
    this._closed = false;
  }

  /**
   * Begin a new assistant message. Block indices AND the released-block lists
   * are per-message: in a tool loop Pi emits several assistant messages per
   * turn, and only the LAST one's text is the user-facing answer (the earlier
   * ones are narration around tool calls). Keeping the lists per-message is
   * what lets the adapter take "the final message's text" as the reply.
   */
  startMessage() {
    this._released = new Set();
    this._texts = [];
    this._thinking = [];
    this._active = true;
    this._closed = false;
  }

  /**
   * Begin a new message implicitly when the previous one already ended.
   * Pi always emits `message_start` first, but relying on that alone means a
   * dropped or reordered start event would make the NEXT message's block look
   * like a duplicate of the previous message's same-index block and silently
   * swallow it — losing an answer. Reopening here removes that failure mode.
   */
  _ensureOpen() {
    if (this._closed) this.startMessage();
  }

  /**
   * Feed one `assistantMessageEvent`. Returns the blocks it completed —
   * `[{ type:'text'|'thinking', text }]` — or [] for a partial delta.
   * @param {object|null} delta
   */
  pushDelta(delta) {
    if (!delta || typeof delta !== 'object') return [];
    this._ensureOpen();
    const out = [];
    const idx = Number.isFinite(delta.contentIndex) ? delta.contentIndex : null;
    if (delta.type === 'text_end') {
      const text = typeof delta.content === 'string' ? delta.content : '';
      if (this._release(idx, 'text', text)) out.push({ type: 'text', text });
    } else if (delta.type === 'thinking_end') {
      const text = typeof delta.content === 'string'
        ? delta.content
        : (typeof delta.thinking === 'string' ? delta.thinking : '');
      if (this._release(idx, 'thinking', text)) out.push({ type: 'thinking', text });
    }
    return out;
  }

  /**
   * Finalize from the `message_end` payload. Emits any block the streaming
   * path never released (a non-streaming provider, or a block whose `*_end`
   * delta was lost), and reports the message-level error.
   *
   * @param {object|null} message  the AgentMessage from message_end
   * @returns {{blocks: Array<{type:string,text:string}>, texts: string[],
   *           thinking: string[], errorMessage: string|null, stopReason: string|null}}
   */
  endMessage(message) {
    this._ensureOpen();
    const blocks = [];
    const content = message && Array.isArray(message.content) ? message.content : [];
    for (let i = 0; i < content.length; i++) {
      const block = content[i];
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text') {
        const text = typeof block.text === 'string' ? block.text : '';
        if (this._release(i, 'text', text)) blocks.push({ type: 'text', text });
      } else if (block.type === 'thinking') {
        const text = typeof block.thinking === 'string' ? block.thinking : '';
        if (this._release(i, 'thinking', text)) blocks.push({ type: 'thinking', text });
      }
      // toolCall blocks are surfaced through tool_execution_* events instead.
    }
    this._active = false;
    this._closed = true;
    const stopReason = message && _str(message.stopReason) ? message.stopReason : null;
    const rawError = message && _str(message.errorMessage) ? message.errorMessage : null;
    return {
      blocks,
      texts: this._texts.slice(),
      thinking: this._thinking.slice(),
      errorMessage: rawError ? redactSecrets(rawError) : null,
      stopReason,
    };
  }

  /** Text of the whole message, in block order, once it has ended. */
  get text() {
    return this._texts.join('\n').trim();
  }

  _release(idx, type, text) {
    // A block with no usable index can't be deduped by index; fall back to
    // value-identity so a repeated payload still can't be posted twice.
    const key = idx == null ? `${type}:${text}` : `${idx}`;
    if (this._released.has(key)) return false;
    this._released.add(key);
    if (!text || !text.trim()) return false;
    if (type === 'text') this._texts.push(text);
    else this._thinking.push(text);
    return true;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Error classification → the SHARED health-status vocabulary
// ────────────────────────────────────────────────────────────────────────

/**
 * Map a raw Pi failure string (an assistant `errorMessage`, a failed RPC
 * `error`, or stderr) to `{ kind, userMessage }`. `kind` is one of
 * 'auth' | 'rate_limit' | 'model' | 'provider' | 'network' | 'context' |
 * 'filesystem' | null, and the caller decides which REASON (if any) it maps
 * to. Always pass the result through redactSecrets before display.
 *
 * @param {string} text
 * @returns {{kind: string|null, userMessage: string}}
 */
function classifyPiError(text) {
  const raw = redactSecrets(String(text == null ? '' : text)).trim();
  if (!raw) return { kind: null, userMessage: 'Pi reported an error.' };
  const low = raw.toLowerCase();
  const has = (...needles) => needles.some((n) => low.includes(n));

  if (has('401', '403', 'unauthorized', 'authentication_error', 'authentication failed',
    'invalid api key', 'invalid x-api-key', 'invalid_api_key', 'no api key',
    'missing api key', 'no credentials', 'not authenticated')) {
    return {
      kind: 'auth',
      userMessage:
        `Pi authentication failed: ${raw}\n\n` +
        "Check this agent's PI_API_KEY in the launcher (OpenAgents maps it to the provider's " +
        'native env var, including DEEPSEEK_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY / ' +
        'GEMINI_API_KEY), or sign in once ' +
        'with `pi` → `/login` so the credential lands in ~/.pi/agent/auth.json.',
    };
  }
  if (has('429', 'rate limit', 'rate_limit', 'too many requests', 'quota', 'overloaded',
    'insufficient_quota')) {
    return {
      kind: 'rate_limit',
      userMessage: `Pi hit the provider's rate limit or quota: ${raw}\n\nWait and retry, or switch provider/model.`,
    };
  }
  if (has('context', 'too long', 'maximum context', 'context_length_exceeded')) {
    return {
      kind: 'context',
      userMessage: `Pi exceeded the model's context window: ${raw}\n\nUse /restart in this channel to start a fresh Pi session.`,
    };
  }
  if (has('model not found', 'unknown model', 'no such model', 'no model matching',
    'model_not_found', 'does not support')) {
    return {
      kind: 'model',
      userMessage: `Pi could not use the configured model: ${raw}\n\nCheck PI_MODEL (and PI_PROVIDER) for this agent.`,
    };
  }
  if (has('unknown provider', 'no provider', 'provider not found', 'unsupported provider')) {
    return {
      kind: 'provider',
      userMessage: `Pi could not use the configured provider: ${raw}\n\nCheck PI_PROVIDER for this agent (run \`pi --list-models\` to see what is configured).`,
    };
  }
  if (has('econnrefused', 'enotfound', 'etimedout', 'network', 'socket hang up',
    'fetch failed', 'timed out', 'getaddrinfo', 'certificate')) {
    return {
      kind: 'network',
      userMessage: `Pi could not reach the provider: ${raw}\n\nCheck network access and any HTTP_PROXY/HTTPS_PROXY setting.`,
    };
  }
  if (has('enoent', 'eacces', 'eperm', 'no such file', 'permission denied', 'not a directory')) {
    return {
      kind: 'filesystem',
      userMessage: `Pi hit a filesystem error: ${raw}\n\nCheck that the agent's working directory exists and is writable.`,
    };
  }
  return { kind: null, userMessage: `Pi error: ${raw}` };
}

// ────────────────────────────────────────────────────────────────────────
// Version helpers + argv construction
// ────────────────────────────────────────────────────────────────────────

/** Extract a dotted version from arbitrary CLI output, or null. */
function parseVersion(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** -1 / 0 / 1 for semver-ish triples. Missing components count as 0. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Classify a `pi --version` output against the minimum supported version.
 * @param {string} raw
 * @param {string} [minVersion] the registry's `install.min_version`; falls back
 *   to MIN_PI_VERSION only when the registry entry is unreadable.
 * @returns {{version: string|null, supported: boolean|null}}
 *   supported true → >= min; false → CONFIRMED older; null → undetermined.
 */
function classifyPiVersion(raw, minVersion = MIN_PI_VERSION) {
  const version = parseVersion(raw);
  if (!version) return { version: null, supported: null };
  const floor = parseVersion(minVersion) || MIN_PI_VERSION;
  return { version, supported: compareVersions(version, floor) >= 0 };
}

/**
 * Classify a Node runtime version against Pi's engine floor (>= 22.19.0).
 * @returns {{version: string|null, supported: boolean|null}}
 */
function classifyNodeVersion(raw) {
  const version = parseVersion(raw);
  if (!version) return { version: null, supported: null };
  return { version, supported: compareVersions(version, MIN_NODE_VERSION) >= 0 };
}

/**
 * Extract the real target out of a Windows `.cmd` shim's text.
 *
 * npm has shipped two shim dialects and both are in the wild:
 *   - modern cmd-shim: `SET dp0=%~dp0` … `"%dp0%\..\pkg\dist\cli.js"`
 *   - older / hand-written: `node "%~dp0\cli.js" %*` (or `"%~dp0cli.js"`,
 *     since `%~dp0` already ends in a backslash)
 * Matching only `%dp0%` — as the older sibling adapters do — silently fails on
 * the second dialect and falls back to `cmd.exe /c`, where the ~14 KB
 * `--append-system-prompt` argument blows past cmd.exe's 8191-character command
 * line and the agent hangs. So both dialects are accepted here.
 *
 * A `.js`/`.mjs` target wins over a `.exe` target: the modern shim names
 * `node.exe` on the same line as the script, and the script is what we want to
 * run under a Node WE choose.
 *
 * Pure (string + path math only) and resolved with win32 path semantics —
 * `.cmd` shims are a Windows-only construct — so it is unit-testable on any OS.
 *
 * @param {string} content  the .cmd file's text
 * @param {string} cmdDir   the directory the .cmd lives in
 * @returns {{kind:'script'|'exe', target:string}|null}
 */
function parseWindowsCmdShim(content, cmdDir) {
  if (!content) return null;
  // `%dp0%` | `%~dp0` | `%~dp0%`, then an OPTIONAL separator, then the path.
  const jsMatch = String(content).match(/%~?dp0%?[\\/]?([^\s"*?]+\.m?js)/i);
  if (jsMatch) return { kind: 'script', target: path.win32.resolve(cmdDir, jsMatch[1]) };
  const exeMatch = String(content).match(/%~?dp0%?[\\/]?([^\s"*?]+\.exe)/i);
  if (exeMatch) return { kind: 'exe', target: path.win32.resolve(cmdDir, exeMatch[1]) };
  return null;
}

/** A canonical v4/v7 UUID, the only shape we accept for a stored session id. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidSessionId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * Build the argv (WITHOUT the executable) for one `pi --mode rpc` process.
 *
 * Secrets never appear here: Pi reads provider credentials from the
 * environment (or ~/.pi/agent/auth.json), and `--api-key` is deliberately
 * never emitted so a key cannot leak into `ps`, a crash dump or a log line.
 *
 * @param {object} o
 * @param {string} o.sessionDir        OpenAgents-managed session storage
 * @param {string} o.sessionId         stable per-channel session UUID
 * @param {string} [o.appendSystemPrompt]
 * @param {string} [o.provider]
 * @param {string} [o.model]
 * @param {string} [o.thinking]        off|minimal|low|medium|high|xhigh|max
 * @param {string} [o.sessionName]
 * @param {string[]} [o.extensions]     explicit OpenAgents-managed extensions
 * @param {boolean} [o.trustProject=false]  true → --approve, false → --no-approve
 * @returns {string[]}
 */
/**
 * Infer the Launcher-provider settings for a bare relay configuration.
 *
 * The workspace's Add-agent flow collects only key + base URL + model, which
 * lands as PI_API_KEY / PI_BASE_URL / PI_MODEL — no PI_PROVIDER, no
 * PI_API_FORMAT. The adapter used to refuse that outright ("PI_PROVIDER and
 * PI_MODEL are required when PI_BASE_URL is set"), a dead end for every agent
 * created remotely. When the provider is not set explicitly, derive it from
 * the base URL: anthropic-looking hosts speak anthropic-messages; every other
 * relay/gateway convention is /chat/completions — NOT OpenAI's /responses, so
 * the `openai` provider default of openai-responses would be wrong here.
 * Returns null when PI_PROVIDER is set (explicit config wins) or when there
 * is no base URL to infer from.
 */
function inferLauncherProvider(env = {}) {
  const val = (k) => String(env[k] == null ? '' : env[k]).trim();
  if (val('PI_PROVIDER')) return null;
  const base = val('PI_BASE_URL');
  if (!base) return null;
  let host = '';
  try { host = new URL(base).hostname.toLowerCase(); } catch { host = base.toLowerCase(); }
  if (host.includes('anthropic')) {
    return { provider: 'anthropic', apiFormat: 'anthropic-messages' };
  }
  return { provider: 'openai', apiFormat: 'openai-completions' };
}

function buildPiArgs({
  sessionDir,
  sessionId,
  appendSystemPrompt,
  provider,
  model,
  thinking,
  sessionName,
  extensions = [],
  trustProject = false,
} = {}) {
  const args = ['--mode', 'rpc'];
  if (sessionDir) args.push('--session-dir', sessionDir);
  if (sessionId) args.push('--session-id', sessionId);
  if (sessionName) args.push('--name', sessionName);
  // Project trust: default DENY. `workingDir` is an arbitrary user repo, and a
  // trusted project may load .pi/settings.json and project-local extensions —
  // executable surface we must not opt into implicitly. See docs/agents/pi.md.
  args.push(trustProject ? '--approve' : '--no-approve');
  if (provider) args.push('--provider', provider);
  if (model) args.push('--model', model);
  if (thinking) args.push('--thinking', thinking);
  for (const extension of extensions || []) {
    if (extension) args.push('--extension', extension);
  }
  if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);
  return args;
}

/** Valid `--thinking` levels (Pi v0.83.0). Anything else is dropped. */
const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

/** Normalize a user-supplied thinking level, or null when unusable. */
function normalizeThinking(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return THINKING_LEVELS.has(v) ? v : null;
}

/**
 * Interpret the PI_TRUST_PROJECT env value. Default (unset/anything else) is
 * FALSE — the safe, non-executing choice.
 */
function parseTrustProject(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Redact an argv for logging (no secret is ever passed as an arg, but the
 *  system prompt embeds the workspace token, so the value is elided). */
function redactArgs(argv) {
  const out = [];
  const ELIDE = new Set(['--append-system-prompt', '--system-prompt']);
  for (let i = 0; i < argv.length; i++) {
    out.push(argv[i]);
    if (ELIDE.has(argv[i]) && i + 1 < argv.length) {
      out.push(`<${argv[i + 1].length} chars>`);
      i++;
    }
  }
  return out.map((a) => redactSecrets(a));
}

module.exports = {
  MIN_PI_VERSION,
  MIN_NODE_VERSION,
  MAX_LINE_BYTES,
  BLOCKING_UI_METHODS,
  EVENT_KIND_BY_TYPE,
  PiJsonlFramer,
  PiStreamParser,
  PiAssistantAccumulator,
  parseLine,
  classifyPiEvent,
  summarizeToolArgs,
  summarizeToolResult,
  redactSecrets,
  diagnosticFor,
  classifyPiError,
  parseVersion,
  compareVersions,
  classifyPiVersion,
  classifyNodeVersion,
  parseWindowsCmdShim,
  isValidSessionId,
  buildPiArgs,
  inferLauncherProvider,
  normalizeThinking,
  parseTrustProject,
  redactArgs,
  THINKING_LEVELS,
};

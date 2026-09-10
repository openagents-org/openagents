/**
 * GitHub Copilot CLI — JSONL stream parser (pure, no I/O).
 *
 * This module turns the raw byte stream produced by
 *   `copilot -p "<prompt>" --output-format=json`
 * into a sequence of *normalized* events the CopilotAdapter can map onto
 * OpenAgents workspace messages. It is deliberately split into two layers:
 *
 *   1. FRAMING (schema-agnostic) — `frameChunk()` / `CopilotStreamParser`
 *      Reassembles complete text lines from arbitrary chunk boundaries. This
 *      is the part that is fully specified regardless of the CLI version:
 *      one JSON object per line (JSONL), lines may be split across chunks,
 *      a single chunk may carry many lines, line endings may be `\n` or
 *      `\r\n`, blank lines and non-JSON noise must be tolerated. This layer
 *      is exhaustively unit-tested and does not depend on any field names.
 *
 *   2. CLASSIFICATION (schema-aware) — `classifyEvent()`
 *      Maps one parsed JSON object onto a normalized event `{ kind, ... }`.
 *      The concrete field/type names live in ONE table (`EVENT_KIND_BY_TYPE`
 *      + the field extractors) so that, once the JSONL schema of the locally
 *      installed `@github/copilot` build is captured, only this table needs
 *      to change — the adapter and the framing layer stay untouched.
 *
 * ── Schema status ────────────────────────────────────────────────────────
 * The GitHub Copilot CLI (`@github/copilot`, executable `copilot`) ships its
 * structured output as JSONL via `--output-format=json`. The exact `type`
 * strings and payload shapes evolve between releases and MUST be confirmed
 * against the actually-installed build (see docs/agents/github-copilot-cli.md
 * and the delivery report). Until then the mapping below recognizes the
 * documented/observed families and ALWAYS degrades unknown objects to a
 * redacted `unknown` event instead of throwing — so a schema drift downgrades
 * fidelity, never crashes a task. Never infer an event's meaning from a field
 * name alone; verify against real output or the official source.
 *
 * Normalized event kinds (the adapter's stable contract):
 *   { kind: 'session',     sessionId }                  real CLI session id/name
 *   { kind: 'text_delta',  text }                       streaming assistant text
 *   { kind: 'text',        text }                       final/complete assistant text
 *   { kind: 'reasoning',   text }                       thinking / status narration
 *   { kind: 'tool_start',  tool, input }               a tool/command is starting
 *   { kind: 'tool_result', tool, result, isError }     a tool/command finished
 *   { kind: 'file_change', path, action }              a file was read/written
 *   { kind: 'shell',       command, exitCode, output } a shell command ran
 *   { kind: 'permission',  detail, granted }           a permission decision
 *   { kind: 'ask_user',    question }                   CLI wants interactive input
 *   { kind: 'usage',       model, usage }              model / token accounting
 *   { kind: 'done',        status }                     turn completed (terminal)
 *   { kind: 'error',       message, code }              failure (terminal)
 *   { kind: 'unknown',     raw }                        unrecognized (redacted)
 */

'use strict';

// ────────────────────────────────────────────────────────────────────────
// Redaction (shared by the adapter for logs + unknown-event diagnostics)
// ────────────────────────────────────────────────────────────────────────

// GitHub tokens: ghp_/gho_/ghu_/ghs_/ghr_ (classic + fine-grained github_pat_),
// plus generic bearer/secret shapes. Kept conservative to avoid mangling code.
const TOKEN_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi,
  /\b[A-Fa-f0-9]{40,}\b/g, // long hex blobs (OAuth/refresh tokens)
];

// Env-style assignments of well-known secret-bearing variables — redact the
// value, keep the key so logs still say *which* var was involved.
const SECRET_ENV_KEYS = [
  'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_COPILOT_TOKEN',
  'GITHUB_COPILOT_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'AZURE_API_KEY', 'GOOGLE_API_KEY', 'OA_WORKSPACE_TOKEN',
];
const SECRET_ENV_RE = new RegExp(
  `\\b(${SECRET_ENV_KEYS.join('|')})(\\s*[=:]\\s*)("?)([^\\s"']+)`,
  'gi',
);
const AUTH_HEADER_RE = /\b(authorization|x-api-key|x-github-token)(\s*:\s*)(\S+)/gi;

/**
 * Redact secrets from an arbitrary string for safe logging / diagnostics.
 * Never throws; non-strings are coerced. Pure.
 */
function redactSensitive(value) {
  let s;
  if (typeof value === 'string') s = value;
  else { try { s = JSON.stringify(value); } catch { s = String(value); } }
  if (!s) return s;
  s = s.replace(SECRET_ENV_RE, (_m, k, sep, q) => `${k}${sep}${q}***`);
  s = s.replace(AUTH_HEADER_RE, (_m, k, sep) => `${k}${sep}***`);
  for (const re of TOKEN_PATTERNS) s = s.replace(re, '***');
  return s;
}

/**
 * Produce a short, redacted, single-line diagnostic for an unknown event so a
 * schema drift is observable in logs without dumping a full transcript or any
 * secret. Pure.
 */
function diagnosticForUnknown(obj, maxLen = 300) {
  let s;
  try { s = JSON.stringify(obj); } catch { s = String(obj); }
  s = redactSensitive(s).replace(/\s+/g, ' ').trim();
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

// ────────────────────────────────────────────────────────────────────────
// Framing (schema-agnostic) — pure
// ────────────────────────────────────────────────────────────────────────

/**
 * Append `chunk` to `buffer` and split off every complete line.
 * Returns `{ lines, rest }` where `lines` are complete lines (no trailing
 * newline, `\r` stripped) and `rest` is the leftover partial line to carry
 * into the next call. Handles `\n` and `\r\n`. Pure — no state retained.
 *
 * @param {string} buffer  carry-over from the previous call
 * @param {string|Buffer} chunk  new bytes
 * @returns {{ lines: string[], rest: string }}
 */
function frameChunk(buffer, chunk) {
  const text = (buffer || '') + (chunk == null ? '' : chunk.toString('utf-8'));
  const parts = text.split('\n');
  const rest = parts.pop(); // last element is the incomplete tail (maybe '')
  const lines = parts.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  return { lines, rest };
}

/**
 * Parse one JSONL line into an object, or null when the line is blank or not
 * valid JSON (CLIs occasionally interleave human-readable banners/noise). A
 * single corrupt line must never abort the surrounding task. Pure.
 *
 * @param {string} line
 * @returns {object|null}
 */
function parseLine(line) {
  if (line == null) return null;
  const trimmed = String(line).trim();
  if (!trimmed) return null;
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return null; // fast reject noise
  try {
    const v = JSON.parse(trimmed);
    return (v && typeof v === 'object') ? v : null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Classification (schema-aware) — pure. SINGLE source of field/type mapping.
// ────────────────────────────────────────────────────────────────────────

/**
 * Maps a Copilot CLI event `type` (lowercased) to a normalized kind.
 *
 * ── Verification status (IMPORTANT) ──────────────────────────────────────
 * VERIFIED against real CLI v1.0.63: `--output-format json` is "JSONL, one JSON
 * object per line"; auth/session/network failures print to STDERR with EMPTY
 * stdout (no JSONL error event) — so those are NOT parsed here, the adapter
 * classifies them from stderr. The success-path stdout event names below
 * (text/tool/file/done/etc.) could NOT be captured (no Copilot subscription in
 * CI), so they are BEST-EFFORT, intentionally focused rather than broad, and
 * must be confirmed against a real authenticated run. The deliberately small
 * alias set avoids misclassifying unrelated objects; anything unrecognized
 * degrades to a redacted `unknown` event (never a crash, never a false `done`).
 * When real samples are available, extend THIS table only.
 */
const EVENT_KIND_BY_TYPE = {
  // ── CAPTURED from a real authenticated run (CLI v1.0.83) ────────────────
  // Every name in this block was read off a live JSONL stream, not inferred.
  // The payload of each sits under `data` (see the `data` unwrap in
  // classifyEvent) — except `result`, which is flat.
  //
  // The full type list observed in one turn: assistant.turn_start,
  // assistant.reasoning_delta, assistant.reasoning, assistant.message_start,
  // assistant.message_delta, assistant.turn_end, assistant.idle,
  // model.call_start, model.call_finished, session.auto_mode_resolved,
  // session.usage_checkpoint, session.tools_updated, session.skills_loaded,
  // session.mcp_servers_loaded, session.mcp_server_status_changed,
  // session.custom_agents_updated, user.message, result.
  //
  // The ones with no entry here are deliberate: they carry no content the
  // workspace shows (lifecycle bookkeeping, or `user.message`, which is our
  // own prompt echoed back). They degrade to `unknown`, which is logged and
  // ignored — mapping them would put noise in the chat.
  'assistant.message_delta': 'text_delta',   // data.deltaContent — THE answer
  'assistant.reasoning': 'reasoning',        // data.content — ONE whole block
  result: 'done',                            // flat: sessionId, exitCode, usage
  // NOT mapped on purpose: `assistant.reasoning_delta`. Copilot streams at
  // TOKEN granularity — 81 deltas for one short thought in the captured turn —
  // and every adapter here narrates progress in whole blocks (claude sends
  // `block.text`, codex `item.text`). Mapping the deltas posted one chat
  // message per token: a column of "How" / "can" / "I" / "help" / "?" in the
  // workspace. `assistant.reasoning` carries the same content as a single
  // block afterwards, so that is what gets narrated.
  'session.usage_checkpoint': 'usage',
  'session.auto_mode_resolved': 'usage',     // data.chosenModel under Auto
  'model.call_finished': 'usage',

  // ── INFERRED — no live sample yet ───────────────────────────────────────
  // The captured turn was a plain greeting, so no tool/file/shell/permission
  // event appeared in it. The names below predate that capture and are kept
  // as a net: they cost nothing (the real names above are matched first) and
  // an unrecognized event is logged, never rendered. Replace them the moment
  // a tool-using turn is captured — do not add more guesses.
  session: 'session', 'session.created': 'session', 'session.started': 'session',
  session_started: 'session', thread: 'session', 'thread.started': 'session',
  'text.delta': 'text_delta', text_delta: 'text_delta',
  'message.delta': 'text_delta', 'assistant.delta': 'text_delta',
  content_block_delta: 'text_delta',
  text: 'text', 'message.completed': 'text', 'assistant.message': 'text',
  assistant: 'text', completion: 'text', agent_message: 'text',
  reasoning: 'reasoning', thinking: 'reasoning', thought: 'reasoning',
  status: 'reasoning', progress: 'reasoning',
  // tool calls
  tool_call: 'tool_start', 'tool.call': 'tool_start', tool_use: 'tool_start',
  'tool.started': 'tool_start', tool_start: 'tool_start', function_call: 'tool_start',
  tool_result: 'tool_result', 'tool.result': 'tool_result',
  'tool.completed': 'tool_result', tool_output: 'tool_result',
  function_result: 'tool_result',
  // file + shell specializations (may also arrive as generic tool events)
  file_change: 'file_change', file_edit: 'file_change', 'file.changed': 'file_change',
  file_write: 'file_change', file_read: 'file_change',
  shell: 'shell', command_execution: 'shell', 'shell.exec': 'shell',
  // permissions + interactive prompts
  permission: 'permission', 'permission.request': 'permission',
  permission_request: 'permission', permission_denied: 'permission',
  approval: 'permission',
  ask_user: 'ask_user', 'user.prompt': 'ask_user', input_request: 'ask_user',
  // accounting (explicit only — bare 'model'/'tokens' are too generic)
  usage: 'usage',
  // terminal (no bare 'end'/'result' — 'result' collides with tool results)
  done: 'done', completed: 'done', 'turn.completed': 'done', finish: 'done',
  error: 'error', failure: 'error', 'turn.failed': 'error', failed: 'error',
  fatal: 'error', aborted: 'error',
};

function _firstString(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length) return v;
  }
  return undefined;
}

function _coerceText(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    if (typeof v.text === 'string') return v.text;
    if (Array.isArray(v.content)) {
      return v.content
        .map((b) => (typeof b === 'string' ? b : (b && typeof b.text === 'string' ? b.text : '')))
        .join('');
    }
    if (typeof v.content === 'string') return v.content;
  }
  return undefined;
}

/**
 * Classify a parsed JSON object into a normalized event. Never throws; an
 * unrecognized shape becomes `{ kind: 'unknown', raw }` with a redacted
 * diagnostic. Pure — the single place that knows Copilot field names.
 *
 * @param {object} obj
 * @returns {{kind: string} & object}
 */
function classifyEvent(obj) {
  if (!obj || typeof obj !== 'object') {
    return { kind: 'unknown', raw: diagnosticForUnknown(obj) };
  }

  const rawType = _firstString(obj, ['type', 'event', 'event_type', 'kind', 'name']);
  let kind = rawType ? EVENT_KIND_BY_TYPE[rawType.toLowerCase()] : undefined;

  // Nested item types: some CLIs wrap the real type in `item.type`
  // (e.g. { type: 'item.completed', item: { type: 'command_execution' } }).
  const item = (obj.item && typeof obj.item === 'object') ? obj.item : null;
  if (item) {
    const itemType = _firstString(item, ['type', 'kind']);
    const itemKind = itemType ? EVENT_KIND_BY_TYPE[itemType.toLowerCase()] : undefined;
    if (itemKind) kind = itemKind;
  }
  // Copilot puts every event's payload under `data`, with the envelope
  // (type/id/timestamp/parentId) on the outside — so reading fields off the
  // top level found nothing and the answer came back empty. `result` is the
  // one exception: it is flat, and falls through to `obj` here.
  const data = (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data))
    ? obj.data
    : null;
  const src = item || data || obj;

  switch (kind) {
    case 'session': {
      const sessionId = _firstString(src, [
        'session_id', 'sessionId', 'session', 'thread_id', 'threadId', 'id', 'name',
      ]);
      if (!sessionId) break; // not actually a session event → fall to unknown
      return { kind: 'session', sessionId };
    }
    case 'text_delta': {
      // `deltaContent` is Copilot's own field name, verified on v1.0.83.
      const text = _coerceText(src.deltaContent) ?? _coerceText(src.delta)
        ?? _coerceText(src.text) ?? _coerceText(src.content) ?? _coerceText(src);
      return { kind: 'text_delta', text: text || '' };
    }
    case 'text': {
      const text = _coerceText(src.text) ?? _coerceText(src.message) ?? _coerceText(src.content) ?? _coerceText(src);
      return { kind: 'text', text: text || '' };
    }
    case 'reasoning': {
      const text = _coerceText(src.deltaContent) ?? _coerceText(src.text)
        ?? _coerceText(src.reasoning) ?? _coerceText(src.message)
        ?? _coerceText(src.content) ?? _firstString(src, ['status', 'label', 'title']) ?? '';
      return { kind: 'reasoning', text };
    }
    case 'tool_start': {
      const tool = _firstString(src, ['tool', 'tool_name', 'name', 'function']) || 'tool';
      const input = src.input ?? src.arguments ?? src.args ?? src.parameters ?? src.params;
      return { kind: 'tool_start', tool, input };
    }
    case 'tool_result': {
      const tool = _firstString(src, ['tool', 'tool_name', 'name', 'function']) || 'tool';
      const result = src.result ?? src.output ?? src.content ?? src.stdout;
      const isError = !!(src.is_error ?? src.isError ?? src.error ?? (src.exit_code != null && src.exit_code !== 0));
      return { kind: 'tool_result', tool, result, isError };
    }
    case 'file_change': {
      const filePath = _firstString(src, ['path', 'file', 'file_path', 'filename', 'filePath']);
      const action = _firstString(src, ['action', 'operation', 'change', 'mode'])
        || (rawType && /read/i.test(rawType) ? 'read' : 'edit');
      return { kind: 'file_change', path: filePath || '', action };
    }
    case 'shell': {
      const command = _firstString(src, ['command', 'cmd', 'shell', 'script']) || '';
      const exitCode = src.exit_code ?? src.exitCode ?? src.code ?? null;
      const output = _coerceText(src.output) ?? _coerceText(src.stdout) ?? '';
      return { kind: 'shell', command, exitCode, output };
    }
    case 'permission': {
      const detail = _firstString(src, ['detail', 'message', 'tool', 'resource', 'reason'])
        || diagnosticForUnknown(src, 120);
      const granted = !!(src.granted ?? src.allowed ?? src.approved);
      return { kind: 'permission', detail, granted };
    }
    case 'ask_user': {
      const question = _firstString(src, ['question', 'prompt', 'message', 'text']) || '';
      return { kind: 'ask_user', question };
    }
    case 'usage': {
      const model = _firstString(src, ['model', 'model_id', 'modelName']);
      const usage = src.usage ?? src.tokens ?? src.cost ?? null;
      return { kind: 'usage', model, usage };
    }
    case 'done': {
      const status = _firstString(src, ['status', 'reason', 'result']) || 'completed';
      // The `result` frame is also where the real session id finally shows up
      // — there is no session event earlier in the stream. Carrying it here is
      // what lets the next turn resume instead of starting over. Read from the
      // top level too: `result` is flat, so `src` is already `obj`, but an
      // `item`-wrapped variant would not be.
      const sessionId = _firstString(src, ['sessionId', 'session_id'])
        ?? _firstString(obj, ['sessionId', 'session_id']);
      return sessionId ? { kind: 'done', status, sessionId } : { kind: 'done', status };
    }
    case 'error': {
      const err = (src.error && typeof src.error === 'object') ? src.error : src;
      const message = _firstString(err, ['message', 'error', 'detail', 'reason'])
        || (typeof src.error === 'string' ? src.error : '')
        || 'Copilot CLI reported an error';
      const code = _firstString(err, ['code', 'type', 'status']) || null;
      return { kind: 'error', message: redactSensitive(message), code };
    }
    default:
      break;
  }
  return { kind: 'unknown', raw: diagnosticForUnknown(obj) };
}

// ────────────────────────────────────────────────────────────────────────
// Stateful incremental parser — thin wrapper over the pure functions
// ────────────────────────────────────────────────────────────────────────

class CopilotStreamParser {
  constructor() {
    this._buffer = '';
  }

  /**
   * Feed a stdout chunk; returns the normalized events newly completed by it.
   * Partial trailing data is retained until the next push()/flush().
   * @param {string|Buffer} chunk
   * @returns {Array<object>}
   */
  push(chunk) {
    const { lines, rest } = frameChunk(this._buffer, chunk);
    this._buffer = rest;
    const events = [];
    for (const line of lines) {
      const obj = parseLine(line);
      if (obj === null) continue; // blank or non-JSON noise — skip, never throw
      events.push(classifyEvent(obj));
    }
    return events;
  }

  /**
   * Flush any buffered trailing line (e.g. last line without a newline at
   * process exit). Returns the normalized events it yields. Idempotent.
   * @returns {Array<object>}
   */
  flush() {
    const tail = this._buffer;
    this._buffer = '';
    const obj = parseLine(tail);
    return obj === null ? [] : [classifyEvent(obj)];
  }
}

module.exports = {
  CopilotStreamParser,
  frameChunk,
  parseLine,
  classifyEvent,
  redactSensitive,
  diagnosticForUnknown,
  EVENT_KIND_BY_TYPE,
};

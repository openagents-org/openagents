/**
 * Pure helpers for the Command Code adapter — argv construction, NDJSON frame
 * interpretation, exit-code classification, and the version gate.
 *
 * Split out from commandcode.js so the parts with real decision logic are unit
 * testable without spawning a CLI, a network, or a workspace.
 *
 * Two design choices drive everything here, and both come from Command Code's
 * own headless contract (`cmd -p --output-format json`):
 *
 *   1. THE RESULT LINE IS AUTHORITATIVE. The stream ends with exactly one
 *      `{"type":"result",...}` object carrying `finalText`, `subtype` and
 *      `usage`. The assistant's answer is read from THERE, never reassembled
 *      from `text_delta` events. Event frames are progress decoration only, so
 *      an upstream schema change degrades the live tool/thinking ticker rather
 *      than losing the reply — the failure mode that keeps biting adapters
 *      which rebuild the answer from a delta stream.
 *   2. EXIT CODES ARE A PUBLISHED CONTRACT. Command Code documents eleven of
 *      them (3 = not authenticated, 5 = rate limited, 10 = out of credits, …).
 *      Classification reads that number instead of regex-matching stderr, so
 *      the user-facing message is right even when the wording upstream changes.
 */

'use strict';

// Pinned CLI version. Do NOT float this to @latest anywhere (registry entries,
// install hints below): this module parses a documented JSON contract, and an
// unbounded version drifts that contract per machine.
const COMMANDCODE_PINNED_VERSION = '1.36.0';
// Supported floor. 1.0.0 is the release that introduced
// `-p --output-format json` (CHANGELOG: "feat: `-p --output-format json` for
// cmd headless mode and scripting"). Below it there is no JSON stream to read
// at all, so the run is blocked rather than left to fail obscurely.
const COMMANDCODE_MIN_VERSION = '1.0.0';
// Highest version whose behavior we have verified. Newer is allowed — it just
// isn't claimed as tested.
const COMMANDCODE_TESTED_MAX_VERSION = '1.36.0';

// ---------------------------------------------------------------------------
// Version gate
// ---------------------------------------------------------------------------

/** Extract a dotted version from `--version` output. Returns null if absent. */
function parseCommandCodeVersion(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)(?:[-.][0-9A-Za-z.]+)?/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** Numeric compare of two dotted versions. Returns -1 / 0 / 1. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Classify a raw `--version` string.
 *
 * `supported: null` means "could not tell" — an unreadable version proceeds
 * leniently rather than blocking a CLI that is probably fine. Only a version we
 * positively read AND that is below the floor returns `false`.
 */
function classifyCommandCodeVersion(rawVersion) {
  const version = parseCommandCodeVersion(rawVersion);
  if (!version) return { version: null, supported: null, tested: null };
  return {
    version,
    supported: compareVersions(version, COMMANDCODE_MIN_VERSION) >= 0,
    tested: compareVersions(version, COMMANDCODE_TESTED_MAX_VERSION) <= 0,
  };
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  // Provider API keys: sk-..., sk-ant-..., sk-or-..., and friends.
  /\bsk-[A-Za-z0-9._-]{8,}\b/g,
  // Bearer tokens in copied headers.
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi,
  // Long opaque blobs assigned to a secret-looking key.
  /\b(api[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}["']?/gi,
];

/** Redact obvious secret material from free text before it is logged. */
function redactSecrets(text) {
  if (text == null) return text;
  let out = String(text);
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m) => {
    const eq = m.match(/\s*[:=]\s*/);
    if (eq) return m.slice(0, m.indexOf(eq[0])) + eq[0] + '[redacted]';
    return m.startsWith('Bearer') || m.startsWith('bearer') ? 'Bearer [redacted]' : '[redacted]';
  });
  return out;
}

/** Truncate with an ellipsis, for previews and diagnostics. */
function truncate(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Redact an argv for logging. The prompt never rides in argv (it is piped over
 * stdin), so the only sensitive-ish value here is a resumed session id.
 */
function redactArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    out.push(a);
    if ((a === '--resume' || a === '-r') && args[i + 1]) {
      out.push('<session-id>');
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

/**
 * Build the argv for one headless run.
 *
 * The PROMPT IS NOT HERE. `-p` is passed with no value and the prompt is piped
 * over stdin, which Command Code auto-detects. That keeps arbitrarily long
 * prompts (a workspace skill header plus channel recap plus the user's turn)
 * away from the OS argv limit, and sidesteps quoting entirely on Windows,
 * where an embedded quote in a user message is otherwise a command-line
 * injection waiting to happen.
 *
 * @param {object} o
 * @param {string} [o.model]            `-m` model id (empty = the CLI's default)
 * @param {string} [o.effort]           `--effort` low | medium | high
 * @param {string} [o.resumeSessionId]  `--resume <id>` to continue a channel
 * @param {boolean} [o.planMode]        read-only exploration instead of `--yolo`
 * @param {number} [o.maxTurns]         `--max-turns` (CLI default is 100)
 * @returns {string[]}
 */
function buildCommandCodeArgs(o = {}) {
  const args = [
    '-p',
    '--output-format', 'json',
    // Taste onboarding is an interactive first-run flow; without this an
    // automated run can sit waiting for a human that will never arrive.
    '--skip-onboarding',
    // Auto-trust the project. The trust prompt is interactive too, and the
    // working directory here was configured by the user in the launcher.
    '--trust',
    // The version is pinned deliberately (see COMMANDCODE_PINNED_VERSION); a
    // background self-update would move the JSON contract under a running
    // daemon.
    '--no-auto-update',
    // Session id to stderr. The result line carries `sessionId` too, but the
    // docs mark that field OPTIONAL — it is absent exactly when a run fails
    // early. This is the fallback that keeps a channel resumable.
    '--verbose',
  ];

  if (o.planMode) {
    // Read-only exploration. Deliberately NOT combined with --yolo.
    args.push('--plan');
  } else {
    // Headless blocks writes and shell by default, which would leave the agent
    // able to talk but not to act.
    args.push('--yolo');
  }

  const model = (o.model || '').trim();
  if (model) args.push('--model', model);

  const effort = (o.effort || '').trim();
  if (effort) args.push('--effort', effort);

  if (Number.isFinite(o.maxTurns) && o.maxTurns > 0) {
    args.push('--max-turns', String(Math.floor(o.maxTurns)));
  }

  const resume = (o.resumeSessionId || '').trim();
  if (resume) args.push('--resume', resume);

  return args;
}

// ---------------------------------------------------------------------------
// NDJSON frames
// ---------------------------------------------------------------------------

/** Parse one NDJSON line. Returns null for blank lines and malformed JSON. */
function parseFrame(line) {
  const s = String(line == null ? '' : line).trim();
  if (!s || s[0] !== '{') return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// Human-readable verbs for Command Code's documented tool names, so the
// workspace ticker reads like activity rather than an API log.
const TOOL_LABELS = {
  read_file: 'reading',
  read_directory: 'listing',
  write_file: 'writing',
  edit_file: 'editing',
  glob: 'searching',
  grep: 'searching',
  shell_command: 'running',
  powershell: 'running',
  shell_output: 'reading output',
  monitor_command: 'monitoring',
  shell_tasks: 'checking tasks',
  kill_shell: 'stopping',
  todo_write: 'planning',
  web_search: 'searching the web',
  web_fetch: 'fetching',
  agent: 'delegating',
  activate_skill: 'loading a skill',
  taste: 'learning taste',
};

/** Friendly verb for a tool name; unknown names pass through unchanged. */
function friendlyToolLabel(toolName) {
  const name = String(toolName || '').trim();
  return TOOL_LABELS[name] || name || 'working';
}

// Frames that carry no user-visible progress. Listing them explicitly keeps
// them out of the `unknown` diagnostic channel, so a genuinely new event type
// still shows up in the log.
const IGNORED_EVENTS = new Set([
  'run_start', 'turn_start', 'turn_end',
  'model_request_start', 'model_request_end',
  'tool_queued', 'tool_update', 'tool_hooks',
  'text_delta', 'message_start', 'message_update', 'message_end',
  'session_start', 'session_info', 'skill_loaded',
  'compaction_start', 'compaction_done',
  'subagent_start', 'subagent_stop', 'subagent_progress',
]);

const TOOL_STATES = {
  tool_running: 'running',
  tool_completed: 'completed',
  tool_errored: 'errored',
  tool_denied: 'denied',
  tool_hook_blocked: 'blocked',
};

/**
 * Normalize one parsed frame into something the adapter can act on.
 *
 * Only two shapes matter: the single `result` line (authoritative — it carries
 * the reply) and `event` frames (progress only). Anything unrecognized becomes
 * `{ kind: 'unknown' }` with a short redacted preview rather than an
 * exception, because the docs explicitly ask consumers to treat unknown event
 * types as forward-compatible.
 *
 * @returns {{kind: string, [k: string]: any}}
 */
function interpretCommandCodeFrame(frame) {
  if (!frame || typeof frame !== 'object') return { kind: 'ignored' };

  if (frame.type === 'result') {
    const usage = frame.usage && typeof frame.usage === 'object' ? frame.usage : null;
    return {
      kind: 'result',
      subtype: typeof frame.subtype === 'string' ? frame.subtype : 'error',
      // Always a string: the docs guarantee the field, empty on an error result.
      finalText: typeof frame.finalText === 'string' ? frame.finalText : '',
      // Both optional — absent when the run died before a session existed.
      sessionId: typeof frame.sessionId === 'string' ? frame.sessionId : null,
      stopReason: typeof frame.stopReason === 'string' ? frame.stopReason : null,
      error: frame.error == null ? null : redactSecrets(String(frame.error)),
      usage,
      durationMs: Number.isFinite(frame.durationMs) ? frame.durationMs : null,
    };
  }

  if (frame.type !== 'event') return { kind: 'unknown', raw: truncate(redactSecrets(JSON.stringify(frame)), 200) };

  const ev = frame.event;
  if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') return { kind: 'ignored' };

  if (TOOL_STATES[ev.type]) {
    return {
      kind: 'tool',
      state: TOOL_STATES[ev.type],
      toolCallId: typeof ev.toolCallId === 'string' ? ev.toolCallId : null,
      toolName: typeof ev.toolName === 'string' ? ev.toolName : '',
      label: friendlyToolLabel(ev.toolName),
      description: ev.description ? truncate(redactSecrets(String(ev.description)), 160) : '',
    };
  }

  if (ev.type === 'thinking_start') return { kind: 'thinking' };

  if (ev.type === 'run_error' || ev.type === 'mod_error') {
    const message = ev.error || ev.message || '';
    return { kind: 'error', message: truncate(redactSecrets(String(message)), 400) };
  }

  if (ev.type === 'run_end') {
    const stopReason = ev.result && typeof ev.result === 'object' ? ev.result.stopReason : null;
    return { kind: 'run_end', stopReason: typeof stopReason === 'string' ? stopReason : null };
  }

  if (IGNORED_EVENTS.has(ev.type)) return { kind: 'ignored' };

  return { kind: 'unknown', raw: truncate(redactSecrets(ev.type), 80) };
}

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------

/**
 * Command Code's published exit-code contract.
 *
 * `partial` marks the codes that still produced usable output: a max-turns run
 * returns the partial answer, so the adapter delivers it with a note instead of
 * replacing it with an error.
 */
const EXIT_CODES = {
  0: { kind: 'success', message: null },
  1: { kind: 'cli_error', message: 'Command Code failed to complete the run. Check the daemon log for details, then retry.' },
  3: { kind: 'auth_required', message: 'Command Code is not signed in. Run `command-code login`, or configure an API key, then retry.' },
  4: { kind: 'permission_denied', message: 'Command Code was denied permission for an action it needed. Check the permission settings for this agent and retry.' },
  5: { kind: 'rate_limited', message: 'Command Code hit a rate limit. Wait a moment, then retry.' },
  6: { kind: 'network_error', message: 'Command Code could not reach its provider (network failure). Check connectivity, then retry.' },
  7: { kind: 'server_error', message: 'The model provider returned a server error. This is usually temporary — retry shortly.' },
  8: { kind: 'max_turns', message: 'The run hit its turn limit before finishing. The partial answer is above.', partial: true },
  9: { kind: 'no_response', message: 'The model produced no response. Try rephrasing the request.' },
  10: { kind: 'insufficient_credits', message: 'The Command Code account is out of credits. Top it up, or switch to a BYOK provider, then retry.' },
  130: { kind: 'interrupted', message: 'The run was interrupted.' },
};

/**
 * Classify how a run ended.
 *
 * The exit code is the primary signal (a documented contract); the result
 * line's `error` field only ever refines the MESSAGE, never the verdict. An
 * undocumented code degrades to a generic failure rather than being reported
 * as success.
 *
 * @param {object} o
 * @param {number|null} o.code    process exit code
 * @param {string|null} [o.signal] terminating signal, if any
 * @param {object|null} [o.result] the interpreted result frame, when one arrived
 * @returns {{kind: string, ok: boolean, partial: boolean, userMessage: string|null}}
 */
function classifyCommandCodeExit({ code, signal = null, result = null } = {}) {
  // A signal kill never reaches the exit-code table (code is null). Report it
  // as an interruption: this is the stop-requested and watchdog-kill path.
  if (signal) {
    return { kind: 'interrupted', ok: false, partial: false, userMessage: EXIT_CODES[130].message };
  }

  const entry = EXIT_CODES[code];
  if (!entry) {
    return {
      kind: 'cli_error',
      ok: false,
      partial: false,
      userMessage: `Command Code exited unexpectedly (code ${code}). Check the daemon log, then retry.`,
    };
  }

  if (entry.kind === 'success') {
    return { kind: 'success', ok: true, partial: false, userMessage: null };
  }

  // Prefer the CLI's own error text when it gave one — it is more specific than
  // the generic per-code line, and it is already redacted by the interpreter.
  const specific = result && result.error ? truncate(result.error, 400) : null;
  return {
    kind: entry.kind,
    ok: false,
    partial: !!entry.partial,
    userMessage: specific || entry.message,
  };
}

module.exports = {
  COMMANDCODE_PINNED_VERSION,
  COMMANDCODE_MIN_VERSION,
  COMMANDCODE_TESTED_MAX_VERSION,
  parseCommandCodeVersion,
  compareVersions,
  classifyCommandCodeVersion,
  redactSecrets,
  redactArgs,
  truncate,
  buildCommandCodeArgs,
  parseFrame,
  interpretCommandCodeFrame,
  friendlyToolLabel,
  classifyCommandCodeExit,
  EXIT_CODES,
};

/**
 * Pure helpers for the Muse Code adapter — argv construction, JSONL record
 * interpretation, run classification, the version gate, and the MCP entry the
 * adapter keeps in Muse's settings file.
 *
 * Split out from muse.js so the parts with real decision logic are unit
 * testable without spawning a CLI, a network, or a workspace.
 *
 * What the headless contract (`muse exec --json`) looks like, as observed
 * against Muse Code 1.3.0:
 *
 *   - Every stdout line is an envelope `{schema_version, stream, sequence,
 *     record_type, payload_type, payload}`. `stream` is `{kind: 'session', id}`
 *     on every record, which is where the session id comes from.
 *   - The run ends with exactly one `run.terminal.<state>` record whose payload
 *     carries `terminal` and the full reply in `text`. THAT is the answer; the
 *     `run.output.delta` records before it are progress only, so a change to
 *     the delta shape costs the live ticker rather than the reply.
 *   - `task.lifecycle.failed` is NOT a run failure. A clean run emits one for
 *     an internal reminder task ("provider does not support base
 *     instructions"); treating it as an error would post a failure over a
 *     good answer.
 */

'use strict';

const { redactSecrets } = require('./utils');

// Supported floor: the first public release with `exec --json`.
const MUSE_MIN_VERSION = '1.3.0';
// Highest version whose behavior we have verified. Newer is allowed — it just
// isn't claimed as tested.
const MUSE_TESTED_MAX_VERSION = '1.3.0';

// Name of the entry this adapter owns inside Muse's `mcp_servers` block.
const MUSE_MCP_SERVER_NAME = 'openagents-workspace';

// ---------------------------------------------------------------------------
// Version gate
// ---------------------------------------------------------------------------

/** Extract a dotted version from `muse --version` ("Muse Code 1.3.0 (1.3.0-R3401.1)"). */
function parseMuseVersion(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)/);
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
 * Classify a raw `--version` string. `supported: null` means "could not tell"
 * and proceeds leniently; only a version positively read below the floor
 * returns `false`.
 */
function classifyMuseVersion(rawVersion) {
  const version = parseMuseVersion(rawVersion);
  if (!version) return { version: null, supported: null, tested: null };
  return {
    version,
    supported: compareVersions(version, MUSE_MIN_VERSION) >= 0,
    tested: compareVersions(version, MUSE_TESTED_MAX_VERSION) <= 0,
  };
}

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

/** Truncate with an ellipsis, for previews and diagnostics. */
function truncate(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Redact an argv for logging: the session id and prompt path are hidden. */
function redactArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    out.push(a);
    if (a === '--session-id' && args[i + 1]) { out.push('<session-id>'); i++; }
    else if (a === '--prompt-file' && args[i + 1]) { out.push('<prompt-file>'); i++; }
  }
  return out;
}

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

/**
 * Build the argv for one headless run.
 *
 * The PROMPT IS NOT HERE. It is written to a file and passed with
 * `--prompt-file`, which keeps a long briefing + recap away from the OS argv
 * limit and makes a quote in a user message harmless. (`--prompt-file` must be
 * a regular file — `/dev/stdin` is refused.)
 *
 * The OS sandbox is deliberately LEFT ON. `--approval-mode never` removes the
 * interactive approval gate a headless run cannot answer; containment is the
 * sandbox's job, and nothing here passes `--disable-sandbox` or `--yolo`.
 *
 * @param {object} o
 * @param {string} o.promptFile         path of the prompt file (required)
 * @param {string} o.sessionId          UUID of the channel's session
 * @param {string} [o.model]            `--model` (empty = the CLI's default)
 * @param {string} [o.effort]           `--reasoning-effort`
 * @param {number} [o.maxSteps]         `--max-model-steps`
 * @param {boolean} [o.planMode]        read-only: no writes, no shell
 * @returns {string[]}
 */
function buildMuseArgs(o = {}) {
  const args = [
    'exec',
    '--json',
    '--prompt-file', o.promptFile,
    '--session-id', o.sessionId,
    '--approval-mode', 'never',
  ];

  if (o.planMode) args.push('--disable-write', '--disable-shell');

  const model = (o.model || '').trim();
  if (model) args.push('--model', model);

  const effort = (o.effort || '').trim();
  if (effort) args.push('--reasoning-effort', effort);

  if (Number.isFinite(o.maxSteps) && o.maxSteps > 0) {
    args.push('--max-model-steps', String(Math.floor(o.maxSteps)));
  }

  return args;
}

// ---------------------------------------------------------------------------
// JSONL records
// ---------------------------------------------------------------------------

/** Parse one JSONL line. Returns null for blank lines and malformed JSON. */
function parseRecord(line) {
  const s = String(line == null ? '' : line).trim();
  if (!s || s[0] !== '{') return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// Human-readable verbs for Muse's tool names, so the workspace ticker reads
// like activity rather than an API log.
const TOOL_LABELS = {
  read_file: 'reading',
  edit_file: 'editing',
  write_file: 'writing',
  apply_patch: 'editing',
  search: 'searching',
  bash: 'running',
  bash_input: 'running',
  web_search: 'searching the web',
  web_fetch: 'fetching',
  update_plan: 'planning',
  write_todos: 'planning',
  subagent_spawn: 'delegating',
  read_skill: 'loading a skill',
};

/** Friendly verb for a tool name; unknown names pass through unchanged. */
function friendlyToolLabel(toolName) {
  const name = String(toolName || '').trim();
  return TOOL_LABELS[name] || name || 'working';
}

/**
 * Pull a tool name out of a task kind. Model and reminder tasks
 * (`model.unknown.response`, `reminder.agent.skill-reminder`) are not tools.
 * UNVERIFIED against a live model run — the shape is inferred, and a miss only
 * costs the ticker line.
 */
function toolNameFromTaskKind(taskKind) {
  const kind = String(taskKind || '');
  const m = kind.match(/^tool\.(?:[a-z_]+\.)?([a-z_]+)$/);
  return m ? m[1] : null;
}

// Record types that carry no user-visible progress. Listing them keeps them
// out of the `unknown` diagnostic channel, so a genuinely new type still shows
// up in the log.
const IGNORED_TYPES = new Set([
  'runtime.command.accepted',
  'session.run.linked',
  'session.workspace_branch.observed',
  'turn.input.user',
  'run.lifecycle.started',
  'task.stream.linked',
  'task.lifecycle.accepted',
  'task.lifecycle.scheduled',
  'task.lifecycle.side_effect_intent',
  'task.lifecycle.started',
  'task.lifecycle.completed',
]);

/**
 * Normalize one parsed record into something the adapter can act on.
 *
 * @returns {{kind: string, sessionId: string|null, [k: string]: any}}
 */
function interpretMuseRecord(record) {
  if (!record || typeof record !== 'object') return { kind: 'ignored', sessionId: null };
  const stream = record.stream && typeof record.stream === 'object' ? record.stream : null;
  const sessionId = stream && stream.kind === 'session' && typeof stream.id === 'string' ? stream.id : null;
  const type = typeof record.payload_type === 'string' ? record.payload_type : '';
  const p = record.payload && typeof record.payload === 'object' ? record.payload : {};

  if (type.startsWith('run.terminal.')) {
    return {
      kind: 'terminal',
      sessionId,
      terminal: typeof p.terminal === 'string' ? p.terminal : type.slice('run.terminal.'.length),
      text: typeof p.text === 'string' ? p.text : '',
      reason: p.reason == null ? null : truncate(redactSecrets(String(p.reason)), 400),
    };
  }

  if (type === 'run.output.delta') {
    return { kind: 'delta', sessionId, text: typeof p.text === 'string' ? p.text : '' };
  }

  if (type === 'task.lifecycle.proposed') {
    const toolName = toolNameFromTaskKind(p.event && p.event.task_kind);
    if (toolName) return { kind: 'tool', sessionId, toolName, label: friendlyToolLabel(toolName) };
    return { kind: 'ignored', sessionId };
  }

  if (type === 'task.lifecycle.failed') {
    const reason = p.event && p.event.reason;
    return { kind: 'task_failed', sessionId, reason: truncate(redactSecrets(String(reason || '')), 400) };
  }

  if (IGNORED_TYPES.has(type)) return { kind: 'ignored', sessionId };

  return { kind: 'unknown', sessionId, raw: truncate(redactSecrets(type || JSON.stringify(record)), 120) };
}

// ---------------------------------------------------------------------------
// Run classification
// ---------------------------------------------------------------------------

// stderr lines Muse prints for credentials it cannot use. Matched only when
// the run never produced a terminal record, i.e. it died before the model.
const AUTH_PATTERNS = [
  /META_API_KEY was rejected/i,
  /login is no longer saved/i,
  /\bnot (?:logged|signed) in\b/i,
  /\bunauthori[sz]ed\b|\b401\b/i,
];

const AUTH_MESSAGE =
  'Muse Code is not signed in. Set META_API_KEY for this agent (press e), ' +
  'or run `muse login` on this machine, then retry.';

/**
 * Classify how a run ended.
 *
 * The terminal record is authoritative. Without one, the process died before
 * finishing a turn and stderr is all there is to go on.
 *
 * @param {object} o
 * @param {number|null} o.code
 * @param {string|null} [o.signal]
 * @param {object|null} [o.terminal]  interpreted terminal record
 * @param {string} [o.stderr]
 * @returns {{kind: string, ok: boolean, userMessage: string|null}}
 */
function classifyMuseRun({ code, signal = null, terminal = null, stderr = '' } = {}) {
  if (terminal) {
    if (terminal.terminal === 'completed') return { kind: 'success', ok: true, userMessage: null };
    if (terminal.terminal === 'cancelled' || terminal.terminal === 'interrupted') {
      return { kind: 'interrupted', ok: false, userMessage: 'The run was interrupted.' };
    }
    const reason = terminal.reason ? `: ${terminal.reason}` : '.';
    return { kind: 'run_failed', ok: false, userMessage: `Muse Code could not finish the run${reason}` };
  }

  if (signal) return { kind: 'interrupted', ok: false, userMessage: 'The run was interrupted.' };

  const err = String(stderr || '');
  if (AUTH_PATTERNS.some((re) => re.test(err))) {
    return { kind: 'auth_required', ok: false, userMessage: AUTH_MESSAGE };
  }

  const tail = lastMeaningfulLine(err);
  return {
    kind: 'cli_error',
    ok: false,
    userMessage: tail
      ? `Muse Code exited without finishing (code ${code}): ${truncate(redactSecrets(tail), 300)}`
      : `Muse Code exited without finishing (code ${code}). Check the daemon log, then retry.`,
  };
}

/** The last stderr line that is not one of Muse's routine startup notes. */
function lastMeaningfulLine(stderr) {
  const lines = String(stderr || '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (/^muse: (workspace root|Agent delegation)/.test(l)) continue;
    return l.replace(/^muse:\s*/, '');
  }
  return '';
}

// ---------------------------------------------------------------------------
// MCP settings entry
// ---------------------------------------------------------------------------

/**
 * The `mcp_servers` entry that gives a run the workspace tools.
 *
 * It holds NO secret and nothing per-channel: every value that varies comes
 * from `${VAR}` interpolation of the run's own environment (Muse interpolates
 * `env` values, not `args`). A `muse` the user starts by hand has none of those
 * variables, and Muse then skips an `optional` server rather than failing —
 * so keeping this entry in the user's settings file never breaks their own
 * sessions.
 *
 * @param {{command: string, args: string[]}} server  how to start `mcp-server`
 */
function buildMuseMcpEntry(server) {
  return {
    transport: 'stdio',
    command: server.command,
    args: server.args,
    env: {
      OA_WORKSPACE_TOKEN: '${OA_WORKSPACE_TOKEN}',
      OPENAGENTS_WORKSPACE_ID: '${OPENAGENTS_WORKSPACE_ID}',
      OPENAGENTS_CHANNEL_NAME: '${OPENAGENTS_CHANNEL_NAME}',
      OPENAGENTS_AGENT_NAME: '${OPENAGENTS_AGENT_NAME}',
      OPENAGENTS_ENDPOINT: '${OPENAGENTS_ENDPOINT}',
      OPENAGENTS_DISABLED_MODULES: '${OPENAGENTS_DISABLED_MODULES}',
    },
    framing: 'line_delimited_json',
    enabled: true,
    mode: 'optional',
  };
}

/**
 * Why a parsed settings file cannot take our entry, or null when it can.
 * Checked before merging so a malformed file is reported, never "repaired" by
 * silently replacing the part we did not understand.
 *
 * `museRejects` says whether Muse itself refuses the file (verified against
 * 1.3.0: a non-object top level and a missing `schema_version` both stop it;
 * a non-object `mcp_servers` does not, but there is no way to add our entry
 * to one without overwriting it).
 *
 * @returns {{problem: string, museRejects: boolean}|null}
 */
function museSettingsProblem(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { problem: 'the top level is not a JSON object', museRejects: true };
  }
  if (settings.schema_version == null) return { problem: '`schema_version` is missing', museRejects: true };
  if (settings.mcp_servers != null && (typeof settings.mcp_servers !== 'object' || Array.isArray(settings.mcp_servers))) {
    return { problem: '`mcp_servers` is not an object', museRejects: false };
  }
  return null;
}

/**
 * Merge our entry into a parsed settings object. Returns the new object, or
 * null when nothing needs to change. Everything else in the file is kept.
 */
function mergeMuseSettings(existing, entry) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const servers = base.mcp_servers && typeof base.mcp_servers === 'object' && !Array.isArray(base.mcp_servers)
    ? base.mcp_servers : {};
  if (JSON.stringify(servers[MUSE_MCP_SERVER_NAME]) === JSON.stringify(entry) && base.schema_version != null) {
    return null;
  }
  return {
    ...base,
    // Required by the settings loader; a file without it is rejected outright.
    schema_version: base.schema_version != null ? base.schema_version : 1,
    mcp_servers: { ...servers, [MUSE_MCP_SERVER_NAME]: entry },
  };
}

module.exports = {
  MUSE_MIN_VERSION,
  MUSE_TESTED_MAX_VERSION,
  MUSE_MCP_SERVER_NAME,
  parseMuseVersion,
  compareVersions,
  classifyMuseVersion,
  truncate,
  redactArgs,
  buildMuseArgs,
  parseRecord,
  friendlyToolLabel,
  toolNameFromTaskKind,
  interpretMuseRecord,
  classifyMuseRun,
  buildMuseMcpEntry,
  mergeMuseSettings,
  museSettingsProblem,
};

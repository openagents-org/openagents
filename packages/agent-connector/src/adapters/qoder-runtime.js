/**
 * Pure helpers for the Qoder adapters — the two editions, argv, the child
 * environment, stream-json frames, run classification, and the process-tree
 * walk Stop needs.
 *
 * Split out from qoder.js so everything with decision logic is unit-testable
 * without a CLI, an account or a workspace. Facts below were verified against
 * the real CLI (1.1.72, flags also on 1.0.45 and 1.1.62), not read off the docs
 * — where the two disagree it is noted.
 *
 *   TWO EDITIONS, TWO BINARIES. The China edition is not a region switch: its
 *   brand is compiled into a separate binary (`qoderclicn`) with its own
 *   install script, config root (~/.qoder-cn) and env prefix (QODERCN_). Every
 *   name that differs lives in EDITIONS, and nothing else in the adapter knows
 *   which edition it is.
 *
 *   THE STREAM IS CLAUDE CODE'S. `-p -o stream-json` emits the Claude Agent SDK
 *   frames (system/init, assistant, user, result; protocol_version 1.5.0). The
 *   difference that matters: a run that never reached a model — signed out —
 *   still ends on `result` with subtype "success", flagged only by
 *   `is_error: true`. The subtype is not a verdict; `is_error` is.
 *
 *   A REJECTED TOKEN HAS NO FRAMES. A personal access token the service turns
 *   down kills the CLI before the init frame: stdout is empty, stderr carries
 *   "QoderAuthError: The QODER_PERSONAL_ACCESS_TOKEN environment variable
 *   contains a token that was rejected…", exit 1. That is the only place the
 *   failure is visible, so stderr is read for it.
 */

'use strict';

// Oldest release still published (it is in the install manifest's rollback
// list) — and it accepts every flag buildQoderArgs passes.
const QODER_MIN_VERSION = '1.0.45';
// Highest version verified end to end. Newer is allowed, just not claimed.
const QODER_TESTED_MAX_VERSION = '1.1.72';

// ---------------------------------------------------------------------------
// Editions
// ---------------------------------------------------------------------------

/**
 * Everything that differs between the international and China editions.
 * `bin` is the CLI itself — never the `qoder` / `qodercn` dispatcher the
 * installer also puts on PATH, which hands any argument naming an existing
 * path to the Qoder IDE instead of the CLI.
 */
const EDITIONS = {
  global: {
    type: 'qoder',
    label: 'Qoder CLI',
    bin: 'qodercli',
    envPrefix: 'QODER_',
    configDirName: '.qoder',
    npmPackage: ['@qoder-ai', 'qodercli'],
    patUrl: 'https://qoder.com/account/integrations',
    installUnix: 'curl -fsSL https://qoder.com/install | bash',
    installWindows: 'irm https://qoder.com/install.ps1 | iex',
  },
  cn: {
    type: 'qoder-cn',
    label: 'Qoder CLI CN',
    bin: 'qoderclicn',
    envPrefix: 'QODERCN_',
    configDirName: '.qoder-cn',
    npmPackage: ['@qodercn-ai', 'qoderclicn'],
    patUrl: 'https://qoder.cn/account/integrations',
    installUnix: 'curl -fsSL https://qoder.com.cn/install | bash',
    installWindows: 'irm https://qoder.com.cn/install.ps1 | iex',
  },
};

/** The CLI reads every one of its variables under the edition's prefix. */
function editionVar(edition, name) {
  return `${edition.envPrefix}${name}`;
}

function installHint(edition, platform = process.platform) {
  return platform === 'win32' ? edition.installWindows : edition.installUnix;
}

// ---------------------------------------------------------------------------
// Version gate
// ---------------------------------------------------------------------------

/** Extract a dotted version from `--version` output. Returns null if absent. */
function parseQoderVersion(raw) {
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
 * `supported: null` means "could not tell" — an unreadable version proceeds
 * rather than blocking a CLI that is probably fine.
 */
function classifyQoderVersion(rawVersion) {
  const version = parseQoderVersion(rawVersion);
  if (!version) return { version: null, supported: null, tested: null };
  return {
    version,
    supported: compareVersions(version, QODER_MIN_VERSION) >= 0,
    tested: compareVersions(version, QODER_TESTED_MAX_VERSION) <= 0,
  };
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9._-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi,
  /\beyJ[A-Za-z0-9._-]{16,}\b/g,
  /\b(api[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}["']?/gi,
];

/**
 * Redact secret material from free text before it is logged or posted.
 * `values` are the exact secrets this run holds (the token): the format of a
 * Qoder token is not documented, so pattern matching alone cannot be trusted
 * to catch one.
 */
function redactSecrets(text, values = []) {
  if (text == null) return text;
  let out = redactValues(String(text), values);
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m) => {
      const eq = m.match(/\s*[:=]\s*/);
      if (eq) return m.slice(0, m.indexOf(eq[0])) + eq[0] + '[redacted]';
      return /^bearer/i.test(m) ? 'Bearer [redacted]' : '[redacted]';
    });
  }
  return out;
}

/** Only the exact-value half of redactSecrets: safe on model output. */
function redactValues(text, values = []) {
  let out = text;
  for (const v of values) {
    const s = String(v || '');
    if (s.length >= 8) out = out.split(s).join('[redacted]');
  }
  return out;
}

/** redactValues over every string in a parsed frame. */
function redactFrame(value, values) {
  if (typeof value === 'string') return redactValues(value, values);
  if (Array.isArray(value)) return value.map((v) => redactFrame(v, values));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactFrame(v, values)]));
  }
  return value;
}

function truncate(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** An argv safe to log: the session id and the kilobytes of briefing hidden. */
function redactArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    out.push(a);
    if (['-r', '--resume', '--session-id', '--append-system-prompt'].includes(a) && args[i + 1] != null) {
      out.push(a === '--append-system-prompt' ? '<system-prompt>' : '<session-id>');
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Credentials and the child environment
// ---------------------------------------------------------------------------

/**
 * The token and model this agent runs on.
 *
 * The token is the edition's own variable or the workspace's generic
 * LLM_API_KEY (the registry maps one onto the other; both are read so an env
 * that skipped the mapping still works). No token means the CLI's own browser
 * sign-in. The model is the workspace pick, then the agent's form.
 */
function resolveQoderAuth(agentEnv = {}, edition = EDITIONS.global, workspaceModel = null) {
  const env = agentEnv || {};
  const pat = String(env[editionVar(edition, 'PERSONAL_ACCESS_TOKEN')] || env.LLM_API_KEY || '').trim();
  const model = String(workspaceModel || env[editionVar(edition, 'MODEL')] || env.LLM_MODEL || '').trim();
  return { pat, model };
}

/**
 * Environment for one run, built from the daemon's enhanced env.
 *
 *   - The token goes in the edition's variable, which the CLI reads BEFORE any
 *     saved sign-in and does not fall back from: a token set here always wins
 *     over whatever `/login` left in the config root.
 *   - `<prefix>NO_RC=1`: on a machine where the CLI has never run, its first
 *     start rewrites the shell's rc files (.zshrc, .bashrc, …) to put its
 *     dispatcher on PATH. A daemon run must not edit the user's shell.
 *   - The generic LLM_* names are dropped: the CLI does not read them, and
 *     leaving the key under a second name only widens what the commands the
 *     agent runs can see.
 */
function buildQoderChildEnv(baseEnv = {}, { edition = EDITIONS.global, pat = '' } = {}) {
  const env = { ...baseEnv };
  delete env.LLM_API_KEY;
  delete env.LLM_BASE_URL;
  delete env.LLM_MODEL;
  env[editionVar(edition, 'NO_RC')] = '1';
  if (pat) env[editionVar(edition, 'PERSONAL_ACCESS_TOKEN')] = pat;
  return env;
}

/**
 * The flag settings layer: the highest-precedence settings the CLI loads,
 * above ~/.qoder/settings.json. Headless runs already skip the auto-updater
 * (the CLI checks for non-interactive mode first); this keeps it off should
 * that ever change, so a background upgrade never swaps the binary mid-run.
 */
function buildQoderFlagSettings() {
  return { general: { enableAutoUpdate: false } };
}

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

/**
 * Tools an agent answering a workspace channel must not have. Scheduling goes
 * through the workspace's own timers (MCP), as in the Claude adapter; the
 * worktree tools would create directories and branches in the user's
 * repository that nothing ever cleans up.
 */
const QODER_DISALLOWED_TOOLS = [
  'CronCreate',
  'CronDelete',
  'CronList',
  'ScheduleWakeup',
  'EnterWorktree',
  'ExitWorktree',
];

/**
 * argv for one headless run. The prompt is NOT here: it goes in over stdin
 * (read to EOF when stdin is not a TTY), which keeps a long turn off the OS
 * argv limit and a quote in a message from ever being a command-line issue.
 *
 *   - `--disallowed-tools` takes ONE comma-separated value: the space-separated
 *     variadic form drops everything after the first name (verified).
 *   - `--strict-mcp-config`: only the workspace server, none of the user's
 *     ~/.qoder/settings.json or project .mcp.json servers. Passed even with no
 *     config to inject, where it means no MCP servers at all (verified on
 *     1.0.45 and 1.1.73).
 *   - plan mode is `--agent Plan` (no Edit/Write) without `--yolo`, so
 *     anything else that needs approval is denied. `--permission-mode plan`
 *     is documented but 1.1.72 does not accept it (falls back to default).
 *   - a new session gets an id chosen here (`--session-id`, a UUID), so the
 *     channel knows it even if the run dies before the init frame.
 */
function buildQoderArgs(o = {}) {
  const args = ['-p', '-o', 'stream-json'];

  const systemPrompt = (o.appendSystemPrompt || '').trim();
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt);

  if (o.planMode) args.push('--agent', 'Plan');
  else args.push('--yolo');

  const disallowed = [...QODER_DISALLOWED_TOOLS, ...(o.extraDisallowedTools || [])];
  args.push('--disallowed-tools', disallowed.join(','));

  const model = (o.model || '').trim();
  if (model) args.push('-m', model);

  args.push('--settings', JSON.stringify(o.flagSettings || buildQoderFlagSettings()));

  if (o.mcpConfigPath) args.push('--mcp-config', o.mcpConfigPath);
  args.push('--strict-mcp-config');

  const resume = (o.resumeSessionId || '').trim();
  const fresh = (o.newSessionId || '').trim();
  if (resume) args.push('-r', resume);
  else if (fresh) args.push('--session-id', fresh);

  return args;
}

// ---------------------------------------------------------------------------
// stream-json frames
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

/** A short preview of a tool call's input, for the channel's activity line. */
function toolInputPreview(input) {
  if (input == null) return '';
  if (typeof input !== 'object') return truncate(redactSecrets(String(input)), 150);
  const first = input.command || input.file_path || input.path || input.pattern
    || input.query || input.url || input.prompt || input.description;
  if (typeof first === 'string' && first) return truncate(redactSecrets(first), 150);
  try {
    return truncate(redactSecrets(JSON.stringify(input)), 150);
  } catch {
    return '';
  }
}

// Frames with nothing for the channel. Listed so a genuinely new frame type
// still reaches the log as "unrecognized".
const IGNORED_FRAMES = new Set(['user', 'stream_event', 'rate_limit_event', 'control_request', 'control_response']);

/**
 * Normalize one parsed frame. `apiError` on an assistant frame is the SDK's
 * error category (authentication_failed, billing_error, rate_limit,
 * invalid_request, server_error, max_output_tokens, unknown) — the CLI's text
 * for it is often a synthetic assistant message, not a model answer.
 *
 * `secrets` are the exact values this run holds (the token). The CLI hands its
 * environment to the shell commands it runs, so the token can come back in any
 * string of any frame — a command, a reply, an error — and every one of them
 * may end up in the channel.
 */
function interpretQoderFrame(frame, secrets = []) {
  if (!frame || typeof frame !== 'object') return { kind: 'ignored' };
  if (secrets.length) frame = redactFrame(frame, secrets);

  if (frame.type === 'result') {
    const errors = Array.isArray(frame.errors)
      ? frame.errors.map((e) => redactSecrets(String(e))).filter(Boolean)
      : [];
    return {
      kind: 'result',
      subtype: typeof frame.subtype === 'string' ? frame.subtype : '',
      isError: frame.is_error === true,
      text: typeof frame.result === 'string' ? frame.result : '',
      sessionId: typeof frame.session_id === 'string' ? frame.session_id : null,
      errors,
      errorCode: frame.error_code != null ? frame.error_code : null,
      terminalReason: typeof frame.terminal_reason === 'string' ? frame.terminal_reason : '',
      numTurns: Number.isFinite(frame.num_turns) ? frame.num_turns : null,
    };
  }

  if (frame.type === 'system') {
    if (frame.subtype === 'init') {
      return {
        kind: 'init',
        sessionId: typeof frame.session_id === 'string' ? frame.session_id : null,
        model: typeof frame.model === 'string' ? frame.model : '',
        version: typeof frame.qodercli_version === 'string' ? frame.qodercli_version : '',
        permissionMode: typeof frame.permissionMode === 'string' ? frame.permissionMode : '',
        mcpServers: Array.isArray(frame.mcp_servers) ? frame.mcp_servers : [],
      };
    }
    const subtype = typeof frame.subtype === 'string' ? frame.subtype : '';
    const message = typeof frame.message === 'string' ? frame.message : '';
    if (/compact/i.test(subtype) || /compact/i.test(message)) {
      return { kind: 'status', text: message || 'Compacting the conversation...' };
    }
    return { kind: 'ignored' };
  }

  if (frame.type === 'assistant') {
    const blocks = (frame.message && Array.isArray(frame.message.content)) ? frame.message.content : [];
    const apiError = typeof frame.error === 'string' && frame.error ? frame.error : null;
    const texts = [];
    const tools = [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        texts.push(block.text.trim());
      } else if (block.type === 'tool_use') {
        tools.push({
          id: typeof block.id === 'string' ? block.id : null,
          name: typeof block.name === 'string' ? block.name : '',
          preview: toolInputPreview(block.input),
          todos: block.input && Array.isArray(block.input.todos) ? block.input.todos : null,
        });
      }
    }
    // A synthetic error message is not progress and not an answer.
    if (apiError) return { kind: 'assistant', texts: [], tools, apiError, errorText: texts.join('\n') };
    if (!texts.length && !tools.length) return { kind: 'ignored' };
    return { kind: 'assistant', texts, tools, apiError: null, errorText: '' };
  }

  // A user frame carries the results of the tool calls the run is waiting on.
  // `ids` holds null for a result that names no call.
  if (frame.type === 'user') {
    const blocks = (frame.message && Array.isArray(frame.message.content)) ? frame.message.content : [];
    const ids = blocks.filter((b) => b && b.type === 'tool_result')
      .map((b) => (typeof b.tool_use_id === 'string' ? b.tool_use_id : null));
    if (ids.length) return { kind: 'tool_results', ids };
  }

  if (IGNORED_FRAMES.has(frame.type)) return { kind: 'ignored' };
  return { kind: 'unknown', raw: truncate(redactSecrets(String(frame.type || '')), 80) };
}

// ---------------------------------------------------------------------------
// Run classification
// ---------------------------------------------------------------------------

// Result `error_code`s the CLI documents in its own table.
const QUOTA_CODES = new Set([110, 113, 114, 115, 116, 117, 118, 119, 122]);
const LOGIN_EXPIRED_CODE = 105;

/** The line of the CLI's stderr worth showing; stack frames are dropped. */
function qoderErrorLine(stderr) {
  const lines = String(stderr || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^at\s/.test(l));
  if (!lines.length) return '';
  const critical = lines.find((l) => /unexpected critical error/i.test(l));
  const line = critical || lines[0];
  return line.replace(/^.*?unexpected critical error occurred:\s*/i, '').replace(/^Qoder\w*Error:\s*/, '').trim();
}

function messages(edition) {
  const pat = editionVar(edition, 'PERSONAL_ACCESS_TOKEN');
  return {
    signedOut: `${edition.label} is not signed in. Run \`${edition.bin} login\` on this machine, or set a personal access token for this agent (${edition.patUrl}).`,
    patRejected: `${edition.label} rejected the personal access token (${pat}). Create a new one at ${edition.patUrl}, or clear it to use the CLI's own sign-in.`,
    loginExpired: `The ${edition.label} sign-in has expired. Run \`${edition.bin} login\` again, or set a personal access token for this agent.`,
    quota: `The ${edition.label} account is out of credits or rate limited. Wait for the quota to reset or upgrade the plan, then retry.`,
    model: `${edition.label} cannot run the selected model. Pick one from \`${edition.bin} --list-models\`, or clear the model to use the account default.`,
    server: `The ${edition.label} model service returned an error. This is usually temporary — retry shortly.`,
    staleSession: `The ${edition.label} session for this channel could not be resumed.`,
  };
}

/**
 * How a run ended. The result frame outranks the exit code (exit 1 is both
 * "signed out" and a real failure); stderr is read only when no frame came.
 * `secrets` are the exact values to mask in any CLI text quoted back.
 *
 * @returns {{kind: string, ok: boolean, userMessage: string|null}}
 */
function classifyQoderRun({ result = null, apiErrors = [], code = null, signal = null, stderr = '' } = {}, edition = EDITIONS.global, secrets = []) {
  const msg = messages(edition);

  if (result && !result.isError) return { kind: 'success', ok: true, userMessage: null };

  if (result && result.isError) {
    const text = [result.text, ...result.errors].join('\n');
    const codeNum = Number(result.errorCode);
    if (codeNum === LOGIN_EXPIRED_CODE) return { kind: 'auth', ok: false, userMessage: msg.loginExpired };
    if (/not logged in|please run \/login/i.test(text) || apiErrors.includes('authentication_failed')) {
      return { kind: 'auth', ok: false, userMessage: msg.signedOut };
    }
    if (QUOTA_CODES.has(codeNum) || apiErrors.includes('billing_error') || apiErrors.includes('rate_limit')) {
      return { kind: 'quota', ok: false, userMessage: msg.quota };
    }
    if (/model.{0,40}(not available|not found|unsupported|invalid)/i.test(text)) {
      return { kind: 'model', ok: false, userMessage: msg.model };
    }
    if (apiErrors.includes('server_error')) return { kind: 'server', ok: false, userMessage: msg.server };
    if (result.terminalReason === 'aborted_streaming') {
      return { kind: 'interrupted', ok: false, userMessage: 'The run was interrupted.' };
    }
    const detail = result.errors[0] || result.text || '';
    return {
      kind: 'run_error',
      ok: false,
      userMessage: detail
        ? `${edition.label} could not finish the run: ${truncate(redactSecrets(detail, secrets), 400)}`
        : `${edition.label} could not finish the run. Check the daemon log for details, then retry.`,
    };
  }

  // No result frame from here down. A token the service turns down is a
  // QoderAuthError on stderr: 1.1.x names the variable, 1.0.x only says
  // "auth.exchangeJobToken failed: Bad request".
  const line = qoderErrorLine(stderr);
  if (/QoderAuthError|token that was rejected|exchangeJobToken/i.test(String(stderr))) {
    const tokenRefused = /PERSONAL_ACCESS_TOKEN|exchangeJobToken|token that was rejected/i.test(String(stderr));
    return { kind: 'auth', ok: false, userMessage: tokenRefused ? msg.patRejected : msg.signedOut };
  }
  if (/error resuming session|invalid session identifier/i.test(String(stderr))) {
    return { kind: 'stale_session', ok: false, userMessage: msg.staleSession };
  }
  if (signal) return { kind: 'interrupted', ok: false, userMessage: 'The run was interrupted.' };
  if (line) {
    return {
      kind: 'startup_error',
      ok: false,
      userMessage: `${edition.label} stopped before answering: ${truncate(redactSecrets(line, secrets), 400)}`,
    };
  }
  return {
    kind: 'no_result',
    ok: false,
    userMessage: `${edition.label} exited without answering (code ${code}). Check the daemon log, then retry.`,
  };
}

// ---------------------------------------------------------------------------
// Model fallback
// ---------------------------------------------------------------------------

/**
 * A `-m` the account cannot run is not an error: the CLI warns on stderr —
 * `Model "performance" is not available right now; using "qfmodel" instead.` —
 * and runs on the account default (verified, 1.1.73). Returns the model asked
 * for and the key it fell back to, or null when there was no fallback.
 */
function parseModelFallback(stderr) {
  const m = String(stderr || '').match(/Model "([^"]+)" is not available right now; using "([^"]+)" instead/);
  return m ? { requested: m[1], used: m[2] } : null;
}

function modelFallbackNotice(edition, requested, used) {
  return `${edition.label} cannot run the model "${requested}" on this account and used "${used}" instead. ` +
    `Pick one from \`${edition.bin} --list-models\`, or clear the model to use the account default.`;
}

// ---------------------------------------------------------------------------
// Process tree
// ---------------------------------------------------------------------------

/**
 * Every descendant of `rootPid` in a { pid, ppid, pgid } table, nearest first.
 * The CLI starts its shell commands detached (a session of their own), so
 * signalling its process group misses them, and once it exits they are
 * reparented — the table has to be read while it is still alive. Its MCP
 * servers it leaves running on SIGTERM as well (verified), so they are here too.
 */
function descendantsOf(rows, rootPid) {
  const children = new Map();
  for (const r of rows || []) {
    if (!r || !Number.isInteger(r.pid) || r.pid === r.ppid) continue;
    if (!children.has(r.ppid)) children.set(r.ppid, []);
    children.get(r.ppid).push(r);
  }
  const out = [];
  const seen = new Set([rootPid]);
  const queue = [rootPid];
  while (queue.length) {
    const pid = queue.shift();
    for (const c of children.get(pid) || []) {
      if (seen.has(c.pid)) continue;
      seen.add(c.pid);
      out.push(c);
      queue.push(c.pid);
    }
  }
  return out;
}

/** Parse `ps -A -o pid=,ppid=,pgid=` output. */
function parseProcessTable(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]) });
  }
  return rows;
}

module.exports = {
  QODER_MIN_VERSION,
  QODER_TESTED_MAX_VERSION,
  QODER_DISALLOWED_TOOLS,
  EDITIONS,
  editionVar,
  installHint,
  parseQoderVersion,
  compareVersions,
  classifyQoderVersion,
  redactSecrets,
  redactArgs,
  truncate,
  resolveQoderAuth,
  buildQoderChildEnv,
  buildQoderFlagSettings,
  buildQoderArgs,
  parseFrame,
  toolInputPreview,
  interpretQoderFrame,
  qoderErrorLine,
  classifyQoderRun,
  parseModelFallback,
  modelFallbackNotice,
  descendantsOf,
  parseProcessTable,
};

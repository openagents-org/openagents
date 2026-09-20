/**
 * Pure helpers for the Qoder adapter — argv construction, stream-json frame
 * interpretation, run classification, region/binary resolution, and the
 * version gate.
 *
 * Split out from qoder.js so the parts with real decision logic are unit
 * testable without spawning a CLI, an account, or a workspace.
 *
 * Qoder CLI is a Claude Code-compatible coding agent (Alibaba's Qoder), and its
 * headless contract is the same stream-json protocol Claude Code and CodeBuddy
 * speak. Four things about it shape everything here, all verified against the
 * real CLI (1.1.52) rather than read off a docs page:
 *
 *   1. THE EXIT CODE IS NOT A CONTRACT. A model failure can surface only inside
 *      the result frame (`is_error: true`, `subtype: "error_during_execution"`).
 *      The RESULT FRAME is authoritative; the exit code is a tiebreaker for the
 *      case where no result frame arrived at all.
 *
 *   2. `-p/--print` IS A BOOLEAN. It takes no value; the turn is either a
 *      positional argument or, better, piped over stdin. This module pipes it,
 *      which keeps a long workspace briefing away from the OS argv limit and
 *      removes Windows quoting from the picture entirely.
 *
 *   3. THERE IS NO `--verbose`. Unlike Claude Code, stream-json does not need a
 *      verbosity flag to stream — passing one is a hard "unknown option" error.
 *      Tool flags are kebab-case (`--disallowed-tools`), not camelCase.
 *
 *   4. THE CHINA AND INTERNATIONAL BUILDS ARE DIFFERENT BINARIES. `qoderclicn`
 *      (`~/.qoder-cn`) and `qodercli` (`~/.qoder`) are separate installs with
 *      separate sign-ins; there is no single switch that moves one to the other
 *      site. Region selection is therefore binary selection, not an env var.
 */

'use strict';

// Supported floor. The 1.x line is what ships the `-p --output-format
// stream-json` headless contract this module parses.
const QODER_MIN_VERSION = '1.0.0';
// Highest version whose behavior was verified end to end. Newer is allowed —
// it just isn't claimed as tested.
const QODER_TESTED_MAX_VERSION = '1.1.52';

// ---------------------------------------------------------------------------
// Version gate
// ---------------------------------------------------------------------------

/** Extract a dotted version from `--version` output. Returns null if absent. */
function parseQoderVersion(raw) {
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
  // Provider API keys: sk-..., and OpenAI/Anthropic-shaped keys.
  /\bsk-[A-Za-z0-9._-]{8,}\b/g,
  // Bearer tokens in copied headers.
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi,
  // JWTs, which is what the workspace token and most Qoder session tokens are.
  /\beyJ[A-Za-z0-9._-]{16,}\b/g,
  // Long opaque blobs assigned to a secret-looking key.
  /\b(api[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}["']?/gi,
];

/** Redact obvious secret material from free text before it is logged or posted. */
function redactSecrets(text) {
  if (text == null) return text;
  let out = String(text);
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m) => {
      const eq = m.match(/\s*[:=]\s*/);
      if (eq) return m.slice(0, m.indexOf(eq[0])) + eq[0] + '[redacted]';
      return /^bearer/i.test(m) ? 'Bearer [redacted]' : '[redacted]';
    });
  }
  return out;
}

/** Truncate with an ellipsis, for previews and diagnostics. */
function truncate(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Redact an argv for logging.
 *
 * The prompt is piped over stdin, so it never appears here. The two values
 * worth hiding are the resumed session id and the system prompt, which carries
 * the agent's workspace identity and can run to kilobytes.
 */
function redactArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    out.push(a);
    if ((a === '--resume' || a === '-r') && args[i + 1]) {
      out.push('<session-id>');
      i++;
    } else if (a === '--append-system-prompt' && args[i + 1]) {
      out.push('<system-prompt>');
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Region → binary
// ---------------------------------------------------------------------------

/**
 * The two published Qoder builds.
 *
 * `home` is the CLI's own config root under $HOME, which is also where its
 * sign-in lives (`<home>/.auth/user`). They are independent accounts: a user
 * signed in on one is not signed in on the other.
 */
const REGIONS = {
  international: {
    label: 'International',
    binary: 'qodercli',
    // The npm package also exposes a `qoder` dispatcher shim.
    aliases: ['qoder'],
    home: '.qoder',
    installHint: 'curl -fsSL https://qoder.com/install | bash',
  },
  china: {
    label: 'China (中国版)',
    binary: 'qoderclicn',
    // The npm package also exposes a `qodercn` dispatcher shim.
    aliases: ['qodercn'],
    home: '.qoder-cn',
    installHint: 'curl -fsSL https://static.qoder.com.cn/qoder-cli-cn/install.sh | bash',
  },
};

/** Accept the spellings a user is likely to type for each region. */
function normalizeQoderRegion(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  if (!s) return null;
  if (['china', 'cn', 'mainland', 'qoder-cn', 'qodercn'].includes(s)) return 'china';
  if (['international', 'intl', 'global', 'qoder'].includes(s)) return 'international';
  return null;
}

/**
 * The order in which regions are probed.
 *
 * An explicit `QODER_REGION` always wins and is probed first. Without one, the
 * build the user is actually signed in to is probed first, so the common case
 * (one account, the other build not installed at all) needs no configuration.
 * `signedIn` is `{ international: boolean, china: boolean }`.
 */
function rankQoderRegions(configured, signedIn = {}) {
  const explicit = normalizeQoderRegion(configured);
  if (explicit) return [explicit, explicit === 'china' ? 'international' : 'china'];
  const order = ['international', 'china'];
  order.sort((a, b) => Number(!!signedIn[b]) - Number(!!signedIn[a]));
  return order;
}

/** Every binary name an edition publishes, primary first. */
function qoderBinaryNames(region) {
  const spec = REGIONS[region];
  if (!spec) return [];
  return [spec.binary, ...(spec.aliases || [])];
}

/** Every region that declares a given binary name (alias included). */
function regionForBinary(name) {
  const n = String(name == null ? '' : name).trim();
  for (const [key, spec] of Object.entries(REGIONS)) {
    if (spec.binary === n || (spec.aliases || []).includes(n)) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Child environment
// ---------------------------------------------------------------------------

/**
 * Qoder needs no environment overlay — this comment exists so the absence is
 * not mistaken for an oversight.
 *
 * It authenticates with a browser/device sign-in stored under its own config
 * root, and a custom gateway lives in settings.json rather than the
 * environment, so there is no API-key variable to inject. The settings the
 * adapter does control (model, permission mode, appended system prompt) are
 * passed as argv, where they are explicit and visible in the redacted log line.
 *
 * There is deliberately no `QODER_CONFIG_DIR` override either: that directory is
 * where the sign-in lives, so pointing it elsewhere would sign the agent out.
 */

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

/**
 * Tools that have no meaning for an agent answering messages in a workspace,
 * and would either stall a headless run or schedule work the workspace cannot
 * see.
 *
 * The asking tools are the stalling half: there is nobody at a terminal to
 * answer them. Cron and wakeups are banned for the same reason as in the Claude
 * adapter — scheduling belongs to the workspace's own timers, which the agent
 * reaches through MCP.
 */
const DISALLOWED_TOOLS = [
  'AskUserQuestion',
  'CronCreate',
  'CronDelete',
  'CronList',
  'ScheduleWakeup',
];

/**
 * Build the argv for one headless run.
 *
 * THE PROMPT IS NOT HERE. `-p` is a boolean, and the prompt is piped over stdin
 * (verified: the CLI starts a real turn from piped input). That keeps an
 * arbitrarily long turn — workspace briefing plus channel recap plus the user's
 * message — away from the OS argv limit, and sidesteps quoting on Windows.
 *
 * @param {object} o
 * @param {string} [o.appendSystemPrompt] workspace briefing appended to the CLI's own prompt
 * @param {string} [o.model]              model id (empty = the account default)
 * @param {string} [o.effort]             reasoning effort (none…max)
 * @param {number} [o.maxTurns]           cap on agentic turns
 * @param {string} [o.resumeSessionId]    continue this channel's CLI session
 * @param {string} [o.mcpConfigPath]      path to the workspace MCP server config
 * @param {boolean} [o.planMode]          read-only investigation instead of full access
 * @returns {string[]}
 */
function buildQoderArgs(o = {}) {
  const args = ['-p', '--output-format', 'stream-json'];

  const systemPrompt = (o.appendSystemPrompt || '').trim();
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt);

  // `plan` is a real choice (it is missing from --help's truncated list):
  // investigate and propose, no writes, no shell.
  args.push('--permission-mode', o.planMode ? 'plan' : 'bypass_permissions');

  // Repeatable flag; the CLI collects one tool per occurrence.
  for (const tool of DISALLOWED_TOOLS) args.push('--disallowed-tools', tool);

  const model = (o.model || '').trim();
  if (model) args.push('--model', model);

  const effort = (o.effort || '').trim();
  if (effort) args.push('--reasoning-effort', effort);

  if (Number.isFinite(o.maxTurns) && o.maxTurns > 0) {
    args.push('--max-turns', String(Math.floor(o.maxTurns)));
  }

  if (o.mcpConfigPath) args.push('--mcp-config', o.mcpConfigPath);

  const resume = (o.resumeSessionId || '').trim();
  if (resume) args.push('--resume', resume);

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

/**
 * A short, human-readable preview of a tool call's input, for the channel's
 * activity ticker. Mirrors the field order the Claude adapter uses, because
 * Qoder's tool inputs are shaped the same way.
 */
function toolInputPreview(input) {
  if (input == null) return '';
  if (typeof input !== 'object') return truncate(redactSecrets(String(input)), 150);
  const first = input.command || input.file_path || input.path || input.pattern
    || input.query || input.url || input.prompt;
  if (typeof first === 'string' && first) return truncate(redactSecrets(first), 150);
  if (typeof input.content === 'string') return truncate(redactSecrets(input.content), 100);
  try {
    return truncate(redactSecrets(JSON.stringify(input)), 150);
  } catch {
    return '';
  }
}

// Frames that carry no user-visible progress. Listing them keeps them out of
// the `unknown` diagnostic channel, so a genuinely new frame type still shows
// up in the log instead of being lost in the noise. Qoder emits lifecycle
// frames for its plugin hooks that no other CLI has.
const IGNORED_FRAMES = new Set([
  'file-history-snapshot',
  'user',
  'stream_event',
  'rate_limit_event',
  'artifacts_update',
]);

/**
 * Normalize one parsed frame into something the adapter can act on.
 *
 * @returns {{kind: string, [k: string]: any}}
 */
function interpretQoderFrame(frame) {
  if (!frame || typeof frame !== 'object') return { kind: 'ignored' };

  if (frame.type === 'result') {
    const errorsInfo = Array.isArray(frame.errors_info)
      ? frame.errors_info.filter((e) => e && typeof e === 'object')
      : [];
    const errors = Array.isArray(frame.errors)
      ? frame.errors.map((e) => redactSecrets(String(e))).filter(Boolean)
      : [];
    return {
      kind: 'result',
      subtype: typeof frame.subtype === 'string' ? frame.subtype : '',
      isError: frame.is_error === true,
      // `result` is present on success and absent on failure; always a string
      // here so callers never have to guard it.
      text: typeof frame.result === 'string' ? frame.result : '',
      sessionId: typeof frame.session_id === 'string' ? frame.session_id : null,
      errors,
      errorsInfo,
      errorCode: Number.isFinite(frame.error_code) ? frame.error_code : null,
      numTurns: Number.isFinite(frame.num_turns) ? frame.num_turns : null,
      durationMs: Number.isFinite(frame.duration_ms) ? frame.duration_ms : null,
    };
  }

  if (frame.type === 'system') {
    if (frame.subtype === 'init') {
      return {
        kind: 'init',
        sessionId: typeof frame.session_id === 'string' ? frame.session_id : null,
        model: typeof frame.model === 'string' ? frame.model : '',
        permissionMode: typeof frame.permissionMode === 'string' ? frame.permissionMode : '',
        mcpServers: Array.isArray(frame.mcp_servers) ? frame.mcp_servers : [],
      };
    }
    // Plugin-hook lifecycle frames (hook_started / hook_progress /
    // hook_response) are noise for the channel.
    const subtype = typeof frame.subtype === 'string' ? frame.subtype : '';
    if (subtype.startsWith('hook_')) return { kind: 'ignored' };
    // Compaction is the one system message worth showing: it is slow, and a
    // silent channel during it reads as a hang.
    const message = typeof frame.message === 'string' ? frame.message : '';
    if (subtype.includes('compact') || /compact/i.test(message)) {
      return { kind: 'status', text: message || 'Compacting the conversation...' };
    }
    return { kind: 'ignored' };
  }

  if (frame.type === 'assistant') {
    const blocks = (frame.message && Array.isArray(frame.message.content))
      ? frame.message.content : [];
    const texts = [];
    const tools = [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        texts.push(block.text.trim());
      } else if (block.type === 'tool_use') {
        tools.push({
          name: typeof block.name === 'string' ? block.name : '',
          preview: toolInputPreview(block.input),
          todos: block.input && Array.isArray(block.input.todos) ? block.input.todos : null,
        });
      }
    }
    if (!texts.length && !tools.length) return { kind: 'ignored' };
    return { kind: 'assistant', texts, tools };
  }

  if (IGNORED_FRAMES.has(frame.type)) return { kind: 'ignored' };

  return { kind: 'unknown', raw: truncate(redactSecrets(String(frame.type || '')), 80) };
}

// ---------------------------------------------------------------------------
// Run classification
// ---------------------------------------------------------------------------

/**
 * What each structured error category means for the user, keyed by the values
 * the CLI emits in `errors_info[].category` when it can classify the failure.
 *
 * Auth is the one that has to be right: Qoder signs in through the browser and
 * stores the session under its own config root, so the recovery is always "run
 * the matching binary and sign in again", which the message names explicitly.
 */
const ERROR_CATEGORIES = {
  auth: 'Qoder rejected the credentials (401/403). The CLI is signed out or the session expired — run `qodercli` (or `qoderclicn` for the China build) in a terminal and sign in again.',
  quota: 'The Qoder account is rate limited or out of credits. Wait for the quota to reset, or top the account up, then retry.',
  network: 'Qoder could not reach its service (network failure or a blocked proxy). Check connectivity and any proxy settings, then retry.',
  model_service: 'The Qoder model service returned a server error. This is usually temporary — retry shortly.',
};

// Qoder does not always attach a structured category, so a plain-text pass over
// the result frame's own errors covers the common 401/429/timeout cases.
const TEXT_CATEGORY_PATTERNS = [
  ['auth', /\b(401|403|unauthor|forbidden|invalid[_\s-]?api[_\s-]?key|not logged in|signed out|login|credential)/i],
  ['quota', /\b(429|rate[_\s-]?limit|quota|credit|insufficient|balance)/i],
  ['network', /\b(econnrefused|enotfound|etimedout|econnreset|socket hang up|network|dns|proxy|tls|ssl|502|503|504)/i],
  ['model_service', /\b(500|server error|internal error|service unavailable|try again)/i],
];

/**
 * Classify how a run ended.
 *
 * Order matters, and it is NOT the usual one: the result frame outranks the
 * exit code, because a failed model call can exit cleanly. The exit code is
 * consulted only when no result frame arrived at all, which is the crash /
 * killed / "died before it started" case.
 *
 * @param {object} o
 * @param {object|null} [o.result]  the interpreted result frame, when one arrived
 * @param {number|null} [o.code]    process exit code
 * @param {string|null} [o.signal]  terminating signal, if any
 * @param {string} [o.stderr]       captured stderr, used only as a last resort
 * @returns {{kind: string, ok: boolean, userMessage: string|null}}
 */
function classifyQoderRun({ result = null, code = null, signal = null, stderr = '' } = {}) {
  if (result && !result.isError) {
    return { kind: 'success', ok: true, userMessage: null };
  }

  if (result && result.isError) {
    const category = result.errorsInfo
      .map((e) => String(e.category || ''))
      .find((c) => ERROR_CATEGORIES[c]);
    if (category) {
      return { kind: category, ok: false, userMessage: ERROR_CATEGORIES[category] };
    }

    const detail = result.errors.join(' ')
      || result.errorsInfo.map((e) => e.details).find(Boolean)
      || '';
    for (const [name, re] of TEXT_CATEGORY_PATTERNS) {
      if (re.test(detail)) {
        return { kind: name, ok: false, userMessage: ERROR_CATEGORIES[name] };
      }
    }

    const suffix = result.errorCode ? ` (code ${result.errorCode})` : '';
    return {
      kind: 'run_error',
      ok: false,
      userMessage: detail
        ? `Qoder could not finish the run${suffix}: ${truncate(redactSecrets(String(detail)), 400)}`
        : `Qoder could not finish the run${suffix}. Check the daemon log for details, then retry.`,
    };
  }

  // No result frame at all from here down.
  if (signal) {
    return { kind: 'interrupted', ok: false, userMessage: 'The run was interrupted.' };
  }

  const err = String(stderr || '').trim();
  if (err) {
    return {
      kind: 'startup_error',
      ok: false,
      userMessage: `Qoder stopped before answering: ${truncate(redactSecrets(err.split('\n')[0]), 400)}`,
    };
  }

  return {
    kind: 'no_result',
    ok: false,
    userMessage: `Qoder exited without answering (code ${code}). Check the daemon log, then retry.`,
  };
}

module.exports = {
  QODER_MIN_VERSION,
  QODER_TESTED_MAX_VERSION,
  DISALLOWED_TOOLS,
  ERROR_CATEGORIES,
  REGIONS,
  parseQoderVersion,
  compareVersions,
  classifyQoderVersion,
  redactSecrets,
  redactArgs,
  truncate,
  normalizeQoderRegion,
  rankQoderRegions,
  qoderBinaryNames,
  regionForBinary,
  buildQoderArgs,
  parseFrame,
  toolInputPreview,
  interpretQoderFrame,
  classifyQoderRun,
};

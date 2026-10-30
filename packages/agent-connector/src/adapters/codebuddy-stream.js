/**
 * Pure helpers for the CodeBuddy adapter — argv construction, stream-json frame
 * interpretation, run classification, region/auth env resolution, and the
 * version gate.
 *
 * Split out from codebuddy.js so the parts with real decision logic are unit
 * testable without spawning a CLI, an account, or a workspace.
 *
 * Three facts about CodeBuddy Code's headless contract shape everything here,
 * and all three were verified against the real CLI (2.142.0) rather than read
 * off a docs page:
 *
 *   1. THE EXIT CODE IS NOT A CONTRACT. A run whose model call failed outright
 *      still exits **0** and reports the failure only inside the result frame
 *      (`is_error: true`, `subtype: "error_during_execution"`). Classifying on
 *      the exit code — the habit every other CLI adapter here can afford —
 *      would report a 504 from the provider as a successful empty answer. The
 *      RESULT FRAME is authoritative; the exit code is a tiebreaker for the
 *      case where no result frame arrived at all.
 *   2. ERRORS ARE STRUCTURED. The result frame carries `errors_info`, an array
 *      of `{status, code, category, details}` where category is one of
 *      `auth` / `quota` / `network` / `model_service`. Classification reads
 *      that, so the user-facing message stays right even though the CLI's own
 *      error text is localized — a China-site account gets Chinese prose that
 *      no English regex would ever match.
 *   3. THE ANSWER LIVES ON THE RESULT FRAME. `result.result` holds the final
 *      text. Assistant frames are progress decoration only, so a change to the
 *      streaming shape costs the live ticker rather than the reply.
 */

'use strict';

// Supported floor. The 2.x line is what ships the `-p --output-format
// stream-json` headless contract this module parses; anything older has a
// different (or no) machine-readable stream.
const CODEBUDDY_MIN_VERSION = '2.0.0';
// Highest version whose behavior was verified end to end. Newer is allowed —
// it just isn't claimed as tested.
const CODEBUDDY_TESTED_MAX_VERSION = '2.142.0';

// ---------------------------------------------------------------------------
// Version gate
// ---------------------------------------------------------------------------

/** Extract a dotted version from `--version` output. Returns null if absent. */
function parseCodeBuddyVersion(raw) {
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
function classifyCodeBuddyVersion(rawVersion) {
  const version = parseCodeBuddyVersion(rawVersion);
  if (!version) return { version: null, supported: null, tested: null };
  return {
    version,
    supported: compareVersions(version, CODEBUDDY_MIN_VERSION) >= 0,
    tested: compareVersions(version, CODEBUDDY_TESTED_MAX_VERSION) <= 0,
  };
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  // Provider API keys: sk-..., and the CodeBuddy console's own key format.
  /\bsk-[A-Za-z0-9._-]{8,}\b/g,
  // Bearer tokens in copied headers.
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi,
  // JWTs, which is what CODEBUDDY_AUTH_TOKEN and the workspace token both are.
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
// Child environment
// ---------------------------------------------------------------------------

/** Region ids accepted by CODEBUDDY_REGION, and what each one means. */
const REGIONS = {
  // Default. The CLI's own endpoint (https://www.codebuddy.ai), which is the
  // account you get from codebuddy.ai / workbuddy.ai.
  international: {},
  // The China site (codebuddy.cn / workbuddy.cn). `internal` is the value the
  // CLI documents for it; the endpoint that selects is Tencent's own.
  china: { CODEBUDDY_INTERNET_ENVIRONMENT: 'internal' },
};

/**
 * Environment overlay for one headless run — pure, so the whole auth/region
 * story is testable without spawning anything.
 *
 * Everything it sets is either a region switch or a self-update/telemetry
 * silencer. It deliberately does NOT invent credentials: a user who signed in
 * with `/login` has a session on disk and no key at all, and an API key that
 * the launcher collected is already in `agentEnv` under its own name.
 *
 * @param {object} agentEnv - the agent's configured environment
 * @returns {object} variables to overlay on the child's env
 */
function resolveCodeBuddyEnv(agentEnv = {}) {
  const overlay = {
    // A background self-update would swap the CLI — and with it the stream
    // contract this module parses — under a daemon that is mid-run. Upgrades
    // happen through the launcher's install path instead.
    DISABLE_AUTOUPDATER: '1',
    // The agent is not a person; nothing here should phone home about it.
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
  };

  const region = String(agentEnv.CODEBUDDY_REGION || '').trim().toLowerCase();
  if (region && REGIONS[region]) Object.assign(overlay, REGIONS[region]);

  // A bearer token pasted with its scheme still attached is the single most
  // common way this fails; the CLI strips "Bearer " itself, but normalizing
  // here keeps the value the same in logs and in the child.
  const token = String(agentEnv.CODEBUDDY_AUTH_TOKEN || '').trim();
  if (token) overlay.CODEBUDDY_AUTH_TOKEN = token.replace(/^Bearer\s+/i, '');

  return overlay;
}

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

/**
 * Tools that have no meaning for an agent answering messages in a workspace,
 * and would either stall a headless run or reach a real person.
 *
 * The asking tools are the stalling half: there is nobody at a terminal to
 * answer them. The messaging half (WeChat / WeCom / push) would deliver to the
 * user's own IM accounts from an agent they pointed at a workspace channel —
 * a surprise no prompt should be able to trigger. Cron is banned for the same
 * reason as in the Claude adapter: scheduling belongs to the workspace's own
 * timers, which the agent reaches through MCP.
 */
const DISALLOWED_TOOLS = [
  'AskUserQuestion',
  'AskUserForStructuredInput',
  'WeChatReply',
  'WeComReply',
  'PushNotification',
  'CronCreate',
  'CronDelete',
  'CronList',
];

/**
 * Build the argv for one headless run.
 *
 * THE PROMPT IS NOT HERE. `-p` is passed with no value and the prompt is piped
 * over stdin (verified: the CLI starts a real turn from piped input). That
 * keeps an arbitrarily long turn — workspace briefing plus channel recap plus
 * the user's message — away from the OS argv limit, and sidesteps quoting on
 * Windows entirely.
 *
 * @param {object} o
 * @param {string} [o.appendSystemPrompt] workspace briefing appended to the CLI's own prompt
 * @param {string} [o.model]              model id (empty = the account default)
 * @param {string} [o.effort]             reasoning effort (minimal…max)
 * @param {number} [o.maxTurns]           cap on agentic turns
 * @param {string} [o.resumeSessionId]    continue this channel's CLI session
 * @param {string} [o.mcpConfigPath]      path to the workspace MCP server config
 * @param {boolean} [o.planMode]          read-only investigation instead of full access
 * @returns {string[]}
 */
function buildCodeBuddyArgs(o = {}) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    // stream-json only streams with --verbose; without it the run still works
    // but arrives as one lump at the end, and the channel shows no progress.
    '--verbose',
  ];

  const systemPrompt = (o.appendSystemPrompt || '').trim();
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt);

  if (o.planMode) {
    // Investigate and propose; no writes, no shell.
    args.push('--permission-mode', 'plan');
  } else {
    // Headless has no one to answer a permission prompt. `-y` resolves to
    // permissionMode=bypassPermissions (confirmed in the init frame).
    args.push('-y');
  }

  args.push('--disallowedTools', ...DISALLOWED_TOOLS);

  const model = (o.model || '').trim();
  if (model) args.push('--model', model);

  const effort = (o.effort || '').trim();
  if (effort) args.push('--effort', effort);

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
 * CodeBuddy's tool inputs are shaped the same way.
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
// up in the log instead of being lost in the noise.
const IGNORED_FRAMES = new Set([
  'file-history-snapshot',
  'user',
  'stream_event',
  'rate_limit_event',
]);

/**
 * Normalize one parsed frame into something the adapter can act on.
 *
 * @returns {{kind: string, [k: string]: any}}
 */
function interpretCodeBuddyFrame(frame) {
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
    // Compaction is the one system message worth showing: it is slow, and a
    // silent channel during it reads as a hang.
    const message = typeof frame.message === 'string' ? frame.message : '';
    const subtype = typeof frame.subtype === 'string' ? frame.subtype : '';
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
 * the CLI actually emits in `errors_info[].category`.
 *
 * Auth is the one that has to be right: the two ways in (an API key in the
 * agent's environment, or a `/login` session on disk) fail identically from
 * out here, so the message names both rather than guessing which one the user
 * meant to be using.
 */
const ERROR_CATEGORIES = {
  auth: 'CodeBuddy rejected the credentials (401/403). Either the API key is wrong or expired, or the CLI is signed out — set CODEBUDDY_API_KEY for this agent, or run `codebuddy` in a terminal and sign in with /login.',
  quota: 'The CodeBuddy account is rate limited or out of credits. Wait for the quota to reset, or top the account up, then retry.',
  network: 'CodeBuddy could not reach its service (network failure or a blocked proxy). Check connectivity and any proxy settings, then retry.',
  model_service: 'The CodeBuddy model service returned a server error. This is usually temporary — retry shortly.',
};

/**
 * Classify how a run ended.
 *
 * Order matters, and it is NOT the usual one: the result frame outranks the
 * exit code, because CodeBuddy exits 0 on a failed run (see the file header).
 * The exit code is consulted only when no result frame arrived at all, which
 * is the crash / killed / "died before it started" case.
 *
 * @param {object} o
 * @param {object|null} [o.result]  the interpreted result frame, when one arrived
 * @param {number|null} [o.code]    process exit code
 * @param {string|null} [o.signal]  terminating signal, if any
 * @param {string} [o.stderr]       captured stderr, used only as a last resort
 * @returns {{kind: string, ok: boolean, userMessage: string|null}}
 */
function classifyCodeBuddyRun({ result = null, code = null, signal = null, stderr = '' } = {}) {
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
    // No category the CLI could classify: fall back to its own text, which is
    // localized but at least specific.
    const detail = result.errors[0]
      || result.errorsInfo.map((e) => e.details).find(Boolean)
      || '';
    return {
      kind: 'run_error',
      ok: false,
      userMessage: detail
        ? `CodeBuddy could not finish the run: ${truncate(redactSecrets(String(detail)), 400)}`
        : 'CodeBuddy could not finish the run. Check the daemon log for details, then retry.',
    };
  }

  // No result frame at all from here down.
  if (signal) {
    return { kind: 'interrupted', ok: false, userMessage: 'The run was interrupted.' };
  }

  // A hard startup failure prints to stderr and still exits 0 — the failure
  // mode that has no frame to read, so this is where stderr earns its keep.
  const err = String(stderr || '').trim();
  if (err) {
    return {
      kind: 'startup_error',
      ok: false,
      userMessage: `CodeBuddy stopped before answering: ${truncate(redactSecrets(err.split('\n')[0]), 400)}`,
    };
  }

  return {
    kind: 'no_result',
    ok: false,
    userMessage: `CodeBuddy exited without answering (code ${code}). Check the daemon log, then retry.`,
  };
}

module.exports = {
  CODEBUDDY_MIN_VERSION,
  CODEBUDDY_TESTED_MAX_VERSION,
  DISALLOWED_TOOLS,
  ERROR_CATEGORIES,
  REGIONS,
  parseCodeBuddyVersion,
  compareVersions,
  classifyCodeBuddyVersion,
  redactSecrets,
  redactArgs,
  truncate,
  resolveCodeBuddyEnv,
  buildCodeBuddyArgs,
  parseFrame,
  toolInputPreview,
  interpretCodeBuddyFrame,
  classifyCodeBuddyRun,
};

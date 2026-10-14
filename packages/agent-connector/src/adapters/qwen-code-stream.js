/**
 * Pure helpers for the Qwen Code adapter — argv construction, stream-json frame
 * interpretation, run classification, credential and child-env resolution, the
 * settings layer that turns auto-memory off, and the version gate.
 *
 * Split out from qwen-code.js so the parts with real decision logic are unit
 * testable without spawning a CLI, an account, or a workspace.
 *
 * Four facts about Qwen Code's headless contract shape everything here, all
 * verified against the real CLI (@qwen-code/qwen-code 0.25.1) rather than read
 * off a docs page:
 *
 *   1. THE FRAMES ARE CLAUDE CODE'S. `-o stream-json` emits system/init, then
 *      one `assistant` frame per content block (thinking, text or tool_use),
 *      `user` frames carrying tool results, and one closing `result` frame.
 *      The answer is `result.result`; assistant frames only drive the ticker.
 *   2. A FAILED RUN STILL WRITES A RESULT FRAME. Model and auth errors arrive
 *      as `result` with `is_error: true` and `error.message`, exit code 1, and
 *      nothing on stderr. The same error is ALSO streamed first as assistant
 *      text ("[API Error: 401 …]"), which must not be mistaken for an answer.
 *      Exit 130 is a SIGINT/SIGTERM stop (no result frame), 53 a turn cap and
 *      55 a budget abort.
 *   3. CREDENTIALS NEED AN EXPLICIT AUTH TYPE. The CLI only infers its OpenAI
 *      provider when OPENAI_API_KEY AND a model are both in the environment; a
 *      key and base URL without a model fails with "No auth type is selected".
 *      Passing `--auth-type openai` removes the guess.
 *   4. AUTO-MEMORY HOLDS THE RESULT FRAME HOSTAGE. With the default
 *      `memory.enableManagedAutoMemory`, every turn ends with a memory-
 *      extractor subagent the run waits for: the answer was on stdout after 7s
 *      and the result frame after 194s, with 100k+ extra tokens spent. A
 *      system-defaults settings layer (QWEN_CODE_SYSTEM_DEFAULTS_PATH) turns it
 *      off without touching the user's own ~/.qwen/settings.json.
 */

'use strict';

// Supported floor: the first release that accepts every flag buildQwenArgs()
// passes. 0.15.0 rejects `--mcp-config` as an unknown argument; 0.16.0 takes
// the whole argv (verified by running each release with it).
const QWEN_MIN_VERSION = '0.16.0';
// Highest version whose behavior was verified end to end. Newer is allowed —
// it just isn't claimed as tested.
const QWEN_TESTED_MAX_VERSION = '0.25.1';

// Where a blank base URL points. Every Qwen Code user this agent is for holds
// a Model Studio (DashScope) key, and the launcher's model picker lists from
// the same endpoint — a blank URL reaching api.openai.com instead would fail
// as an "incorrect API key" that names neither.
const QWEN_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

// ---------------------------------------------------------------------------
// Version gate
// ---------------------------------------------------------------------------

/** Extract a dotted version from `--version` output. Returns null if absent. */
function parseQwenVersion(raw) {
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
function classifyQwenVersion(rawVersion) {
  const version = parseQwenVersion(rawVersion);
  if (!version) return { version: null, supported: null, tested: null };
  return {
    version,
    supported: compareVersions(version, QWEN_MIN_VERSION) >= 0,
    tested: compareVersions(version, QWEN_TESTED_MAX_VERSION) <= 0,
  };
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  // Provider API keys: sk-..., which covers Model Studio and Coding Plan keys.
  /\bsk-[A-Za-z0-9._-]{8,}\b/g,
  // Bearer tokens in copied headers.
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi,
  // JWTs, which is what the workspace token is.
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
 * The prompt is piped over stdin and the key travels in the environment, so
 * neither appears here. The values worth hiding are the resumed session id and
 * the system prompt, which carries the agent's workspace identity and runs to
 * kilobytes.
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
    } else if (a === '--openai-api-key' && args[i + 1]) {
      out.push('[redacted]');
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Credentials and the child environment
// ---------------------------------------------------------------------------

function firstSet(env, names) {
  for (const name of names) {
    const v = String((env && env[name]) || '').trim();
    if (v) return v;
  }
  return '';
}

/**
 * The key, base URL and model this agent runs with.
 *
 * The three values come as a SET from one source, never mixed: the agent's own
 * form fields (LLM_*) when it has a key there, otherwise OPENAI_* from the
 * environment. Mixing them is how a run ends up sending this agent's DashScope
 * key to the OpenAI base URL the user exported for another tool.
 *
 * The workspace's model picker outranks either source's model.
 *
 * @returns {{apiKey: string, baseUrl: string, model: string, source: 'agent'|'env'|'none'}}
 */
function resolveQwenCredentials(agentEnv = {}, workspaceModel = '') {
  const picked = String(workspaceModel || '').trim();
  if (firstSet(agentEnv, ['LLM_API_KEY'])) {
    return {
      apiKey: firstSet(agentEnv, ['LLM_API_KEY']),
      baseUrl: firstSet(agentEnv, ['LLM_BASE_URL']),
      model: picked || firstSet(agentEnv, ['LLM_MODEL']),
      source: 'agent',
    };
  }
  if (firstSet(agentEnv, ['OPENAI_API_KEY'])) {
    return {
      apiKey: firstSet(agentEnv, ['OPENAI_API_KEY']),
      baseUrl: firstSet(agentEnv, ['OPENAI_BASE_URL']),
      model: picked || firstSet(agentEnv, ['OPENAI_MODEL', 'QWEN_MODEL']),
      source: 'env',
    };
  }
  // No key of ours: the CLI falls back to whatever its own settings.json
  // configures (a provider set up with /auth in an interactive session).
  return { apiKey: '', baseUrl: '', model: picked, source: 'none' };
}

/**
 * The environment for one headless run — pure, so the whole auth story is
 * testable without spawning anything.
 *
 * With a key, the OPENAI_* trio is written explicitly, so nothing exported for
 * another tool can leak in. A blank base URL becomes Model Studio only for the
 * agent's own key: a key that came from OPENAI_* in the environment was
 * exported for some other tool, most likely for api.openai.com, and must never
 * be sent to a different provider by default — it keeps the CLI's own default.
 * Without a key, the environment is left alone for the CLI's own settings.
 *
 * @param {object} baseEnv  the agent's full environment (process env included)
 * @param {object} o
 * @param {object} o.creds          resolveQwenCredentials() output
 * @param {string} [o.defaultsPath] system-defaults settings file to load
 * @returns {object} a new environment object
 */
function buildQwenChildEnv(baseEnv = {}, { creds = {}, defaultsPath = '' } = {}) {
  const env = { ...baseEnv };
  if (creds.apiKey) {
    env.OPENAI_API_KEY = creds.apiKey;
    const baseUrl = creds.baseUrl || (creds.source === 'agent' ? QWEN_DEFAULT_BASE_URL : '');
    if (baseUrl) env.OPENAI_BASE_URL = baseUrl;
    else delete env.OPENAI_BASE_URL;
    if (creds.model) env.OPENAI_MODEL = creds.model;
    else delete env.OPENAI_MODEL;
  }
  if (defaultsPath) env.QWEN_CODE_SYSTEM_DEFAULTS_PATH = defaultsPath;
  // Approval mode is yolo by design (nobody is at a terminal to approve), and
  // the CLI otherwise repeats a warning about it on stderr every run, where it
  // would bury a real startup error.
  env.QWEN_CODE_SUPPRESS_YOLO_WARNING = '1';
  return env;
}

// ---------------------------------------------------------------------------
// The system-defaults settings layer
// ---------------------------------------------------------------------------

/**
 * Settings this adapter needs that have no command-line flag.
 *
 * Loaded as Qwen Code's lowest-precedence "system defaults" scope, so the
 * user's own settings.json (and a project's .qwen/settings.json) still win:
 * someone who wants auto-memory back turns it on there.
 */
const QWEN_SETTINGS_DEFAULTS = {
  memory: {
    // The post-turn memory extractor delays every result frame by seconds to
    // minutes (see the file header); "dream" is its background consolidation.
    enableManagedAutoMemory: false,
    enableManagedAutoDream: false,
  },
  general: {
    // A self-update would swap the CLI — and the stream contract parsed here —
    // under a daemon that is mid-run. Upgrades go through the launcher.
    enableAutoUpdate: false,
    disableAutoUpdate: true,
  },
  privacy: {
    // The agent is not a person; nothing here should phone home about it.
    usageStatisticsEnabled: false,
  },
};

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

/**
 * The defaults layer to hand the CLI: this adapter's settings under whatever a
 * machine-wide system-defaults file already sets, which wins key by key.
 */
function buildQwenSystemDefaults(existing = null) {
  return deepMerge(QWEN_SETTINGS_DEFAULTS, isPlainObject(existing) ? existing : {});
}

/**
 * Where the CLI would read its system-defaults file from, so a machine-wide
 * one is merged rather than replaced. Mirrors the CLI's own lookup: an
 * explicit QWEN_CODE_SYSTEM_DEFAULTS_PATH, otherwise `system-defaults.json`
 * next to the system settings file.
 */
function qwenSystemDefaultsSource(env = {}, platform = process.platform) {
  const explicit = String(env.QWEN_CODE_SYSTEM_DEFAULTS_PATH || '').trim();
  if (explicit) return explicit;
  const settings = String(env.QWEN_CODE_SYSTEM_SETTINGS_PATH || '').trim()
    || (platform === 'darwin' ? '/Library/Application Support/QwenCode/settings.json'
      : platform === 'win32' ? 'C:\\ProgramData\\qwen-code\\settings.json'
        : '/etc/qwen-code/settings.json');
  const sep = platform === 'win32' ? '\\' : '/';
  const cut = Math.max(settings.lastIndexOf('/'), settings.lastIndexOf('\\'));
  return (cut >= 0 ? settings.slice(0, cut) : '.') + sep + 'system-defaults.json';
}

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

/**
 * Built-in tools a workspace agent must not use.
 *
 * They schedule work inside the CLI's own process — which, in a one-shot
 * headless run, exits as soon as the turn ends, so a reminder set this way
 * never fires (or keeps the run alive waiting for it). Workspace timers and
 * routines, reached over MCP, are the scheduling that outlives the turn.
 */
const EXCLUDED_TOOLS = [
  'cron_create',
  'cron_list',
  'cron_delete',
  'loop_wakeup',
];

/**
 * Build the argv for one headless run.
 *
 * THE PROMPT IS NOT HERE. With no positional query the CLI reads the turn from
 * stdin and runs it once (verified), so an arbitrarily long turn — channel
 * recap plus the user's message — stays away from the OS argv limit, and a
 * quote in a user message cannot become a command-line injection. The key is
 * not here either: it travels in the environment, out of the process list.
 *
 * @param {object} o
 * @param {string} [o.appendSystemPrompt] workspace briefing appended to the CLI's own prompt
 * @param {string} [o.authType]           'openai' when this agent supplies the key
 * @param {string} [o.model]              model id (empty = provider default)
 * @param {string} [o.resumeSessionId]    continue this channel's CLI session
 * @param {string} [o.mcpConfigPath]      path to the workspace MCP server config
 * @param {boolean} [o.planMode]          read-only investigation instead of full access
 * @returns {string[]}
 */
function buildQwenArgs(o = {}) {
  const args = ['--output-format', 'stream-json'];

  // Headless has no one to answer a permission prompt; without yolo the CLI
  // silently drops every write and shell tool from the run. Plan mode keeps
  // read-only tools only (verified against the init frame's tool list).
  args.push('--approval-mode', o.planMode ? 'plan' : 'yolo');

  // An array option: yargs reads values until the next flag, so another flag
  // must always follow it.
  args.push('--exclude-tools', ...EXCLUDED_TOOLS);

  const authType = (o.authType || '').trim();
  if (authType) args.push('--auth-type', authType);

  const model = (o.model || '').trim();
  if (model) args.push('--model', model);

  if (o.mcpConfigPath) args.push('--mcp-config', o.mcpConfigPath);

  const resume = (o.resumeSessionId || '').trim();
  if (resume) args.push('--resume', resume);

  const systemPrompt = (o.appendSystemPrompt || '').trim();
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt);

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
 * activity ticker.
 */
function toolInputPreview(input) {
  if (input == null) return '';
  if (typeof input !== 'object') return truncate(redactSecrets(String(input)), 150);
  const first = input.command || input.file_path || input.absolute_path || input.path
    || input.pattern || input.query || input.url || input.prompt || input.description;
  if (typeof first === 'string' && first) return truncate(redactSecrets(first), 150);
  if (typeof input.content === 'string') return truncate(redactSecrets(input.content), 100);
  try {
    const json = JSON.stringify(input);
    return json === '{}' ? '' : truncate(redactSecrets(json), 150);
  } catch {
    return '';
  }
}

/** `mcp__openagents-workspace__workspace_get_history` → `workspace_get_history`. */
function shortToolName(name) {
  const m = String(name || '').match(/^mcp__.+?__(.+)$/);
  return m ? m[1] : String(name || '');
}

/**
 * Describe one tool_use block for the ticker, or null for plumbing.
 *
 * MCP tools are deferred: the model looks one up with `tool_search` and then
 * calls it through the generic `tool_call` wrapper (verified). The lookup is
 * not activity worth announcing, and the wrapper is announced as the tool it
 * actually ran.
 */
function describeToolUse(block) {
  const name = typeof block.name === 'string' ? block.name : '';
  const input = block.input && typeof block.input === 'object' ? block.input : {};
  if (name === 'tool_search') return null;
  if (name === 'tool_call' && typeof input.name === 'string' && input.name) {
    return { name: shortToolName(input.name), preview: toolInputPreview(input.arguments) };
  }
  return { name: shortToolName(name), preview: toolInputPreview(input) };
}

// An API failure is streamed as assistant text before the result frame
// reports it. It is the error, not an answer.
const API_ERROR_TEXT_RE = /^\[API Error:/;

// Frames that carry no user-visible progress. Listing them keeps them out of
// the `unknown` diagnostic channel, so a genuinely new frame type still shows
// up in the log instead of being lost in the noise. `stream_event` carries the
// per-run goal_state ping (and partial deltas, which are not requested).
const IGNORED_FRAMES = new Set(['user', 'stream_event']);

/**
 * Normalize one parsed frame into something the adapter can act on.
 *
 * @returns {{kind: string, [k: string]: any}}
 */
function interpretQwenFrame(frame) {
  if (!frame || typeof frame !== 'object') return { kind: 'ignored' };

  if (frame.type === 'result') {
    const err = frame.error && typeof frame.error === 'object' ? frame.error : null;
    return {
      kind: 'result',
      subtype: typeof frame.subtype === 'string' ? frame.subtype : '',
      isError: frame.is_error === true,
      // `result` is present on success and absent on failure; always a string
      // here so callers never have to guard it.
      text: typeof frame.result === 'string' ? frame.result : '',
      errorMessage: err && typeof err.message === 'string' ? redactSecrets(err.message) : '',
      sessionId: typeof frame.session_id === 'string' ? frame.session_id : null,
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
        permissionMode: typeof frame.permission_mode === 'string' ? frame.permission_mode : '',
        mcpServers: Array.isArray(frame.mcp_servers)
          ? frame.mcp_servers.filter((s) => s && typeof s === 'object')
          : [],
        version: typeof frame.qwen_code_version === 'string' ? frame.qwen_code_version : '',
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
    const apiErrors = [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        const text = block.text.trim();
        if (API_ERROR_TEXT_RE.test(text)) apiErrors.push(redactSecrets(text));
        else texts.push(text);
      } else if (block.type === 'tool_use') {
        const tool = describeToolUse(block);
        if (tool) tools.push(tool);
      }
      // `thinking` blocks are the model's private reasoning; the Claude
      // adapter does not post them either.
    }
    if (!texts.length && !tools.length && !apiErrors.length) return { kind: 'ignored' };
    return { kind: 'assistant', texts, tools, apiErrors };
  }

  if (IGNORED_FRAMES.has(frame.type)) return { kind: 'ignored' };

  return { kind: 'unknown', raw: truncate(redactSecrets(String(frame.type || '')), 80) };
}

// ---------------------------------------------------------------------------
// Run classification
// ---------------------------------------------------------------------------

const CODING_PLAN_HINT = 'Model Studio (DashScope) keys and Coding Plan keys are not interchangeable: ' +
  'a Coding Plan key needs https://coding.dashscope.aliyuncs.com/v1 (international: ' +
  'https://coding-intl.dashscope.aliyuncs.com/v1).';

/**
 * What a run's error message means for the user, first match wins. Matched on
 * the CLI's own `error.message`, which carries the provider's status code and
 * text verbatim ("[API Error: 401 Incorrect API key provided…]").
 */
const ERROR_RULES = [
  {
    kind: 'not_configured',
    re: /No auth type is selected/i,
    message: 'Qwen Code has no model credentials. Set an API key for this agent (and a base URL and ' +
      'model if you are not using Model Studio) — the default base URL is ' +
      `${QWEN_DEFAULT_BASE_URL}. ${CODING_PLAN_HINT}`,
    detail: false,
  },
  {
    kind: 'auth',
    re: /\b(401|403)\b|incorrect api key|invalid (access )?token|invalid api[ _-]?key|unauthori[sz]ed|token expired/i,
    message: `The model endpoint rejected the API key. Check the key, and that it belongs to the base URL's service. ${CODING_PLAN_HINT}`,
    detail: true,
  },
  {
    kind: 'model',
    re: /\b404\b|model\b[^.]*\b(does not exist|not found|not exist|unsupported)|model_not_found/i,
    message: 'The endpoint does not serve the configured model. Pick a model the base URL offers.',
    detail: true,
  },
  {
    kind: 'quota',
    re: /\b429\b|rate.?limit|quota|insufficient|arrearage|exceeded your/i,
    message: 'The model endpoint is rate limiting this key or the account is out of quota. Wait, or top the account up, then retry.',
    detail: true,
  },
  {
    kind: 'network',
    re: /connection error|fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|certificate|timed? ?out/i,
    message: 'Qwen Code could not reach the model endpoint. Check the base URL, the network, and any proxy settings.',
    detail: true,
  },
  {
    kind: 'model_service',
    re: /\b5\d\d\b/,
    message: 'The model service returned a server error. This is usually temporary — retry shortly.',
    detail: true,
  },
];

function messageFor(text) {
  const raw = String(text || '').trim();
  const detail = truncate(redactSecrets(raw.replace(/^\[API Error:\s*/i, '').replace(/\]$/, '')), 300);
  for (const rule of ERROR_RULES) {
    if (rule.re.test(raw)) {
      return {
        kind: rule.kind,
        userMessage: rule.detail && detail ? `${rule.message} (${detail})` : rule.message,
      };
    }
  }
  return null;
}

// What the CLI prints, on stderr only, when `--resume` names a session it does
// not have — pruned, or recorded under a different working directory.
const STALE_SESSION_RE = /No saved session found/i;

/**
 * Classify how a run ended.
 *
 * The result frame outranks the exit code: it is present on every model and
 * auth failure and says what went wrong. The exit code and stderr are read only
 * when no result frame arrived, which is the stopped / crashed / refused-to-
 * start case.
 *
 * @param {object} o
 * @param {object|null} [o.result]  the interpreted result frame, when one arrived
 * @param {number|null} [o.code]    process exit code
 * @param {string|null} [o.signal]  terminating signal, if any
 * @param {string} [o.stderr]       captured stderr
 * @param {string[]} [o.apiErrors]  API error texts streamed before the result
 * @returns {{kind: string, ok: boolean, userMessage: string|null}}
 */
function classifyQwenRun({ result = null, code = null, signal = null, stderr = '', apiErrors = [] } = {}) {
  if (result && !result.isError) {
    return { kind: 'success', ok: true, userMessage: null };
  }

  if (result && result.isError) {
    const text = result.errorMessage || (apiErrors && apiErrors[0]) || '';
    const known = messageFor(text);
    if (known) return { ...known, ok: false };
    return {
      kind: 'run_error',
      ok: false,
      userMessage: text
        ? `Qwen Code could not finish the run: ${truncate(redactSecrets(text), 400)}`
        : 'Qwen Code could not finish the run. Check the daemon log for details, then retry.',
    };
  }

  // No result frame from here down.
  if (code === 53) {
    return { kind: 'turn_limit', ok: false, userMessage: 'Qwen Code stopped at its turn limit before finishing.' };
  }
  if (code === 55) {
    return { kind: 'budget', ok: false, userMessage: 'Qwen Code stopped at its time or tool-call budget before finishing.' };
  }
  if (signal || code === 130) {
    return { kind: 'interrupted', ok: false, userMessage: 'The run was interrupted.' };
  }

  const err = String(stderr || '').trim();
  if (STALE_SESSION_RE.test(err)) {
    return { kind: 'stale_session', ok: false, userMessage: 'The saved Qwen Code session could not be resumed.' };
  }
  const streamed = apiErrors && apiErrors[0];
  if (streamed) {
    const known = messageFor(streamed);
    if (known) return { ...known, ok: false };
  }
  if (err) {
    const firstLine = err.split('\n').map((l) => l.trim()).find(Boolean) || err;
    return {
      kind: 'startup_error',
      ok: false,
      userMessage: `Qwen Code stopped before answering: ${truncate(redactSecrets(firstLine), 400)}`,
    };
  }

  return {
    kind: 'no_result',
    ok: false,
    userMessage: `Qwen Code exited without answering (code ${code}). Check the daemon log, then retry.`,
  };
}

module.exports = {
  QWEN_MIN_VERSION,
  QWEN_TESTED_MAX_VERSION,
  QWEN_DEFAULT_BASE_URL,
  QWEN_SETTINGS_DEFAULTS,
  EXCLUDED_TOOLS,
  ERROR_RULES,
  parseQwenVersion,
  compareVersions,
  classifyQwenVersion,
  redactSecrets,
  redactArgs,
  truncate,
  resolveQwenCredentials,
  buildQwenChildEnv,
  buildQwenSystemDefaults,
  qwenSystemDefaultsSource,
  buildQwenArgs,
  parseFrame,
  toolInputPreview,
  shortToolName,
  describeToolUse,
  interpretQwenFrame,
  classifyQwenRun,
};

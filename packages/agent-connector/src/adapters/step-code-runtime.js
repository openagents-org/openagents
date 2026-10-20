/**
 * Pure helpers for the Step Code adapter — credentials and regions, the
 * isolated per-run configuration, argv, the child environment, JSON-mode
 * frames, run classification, and the process-tree walk Stop needs.
 *
 * Split out from step-code.js so everything with decision logic is
 * unit-testable without a CLI, an account or a workspace. The facts below were
 * verified against the real CLI (0.1.5 throughout; the flags also on 0.1.4),
 * not read off the docs — where the two disagree it is noted.
 *
 *   IT IS PI. Step Code is StepFun's build of the Pi coding-agent runtime, and
 *   `step -p --mode json` emits Pi's JSON event stream: the same agent_*,
 *   message_*, tool_execution_* records pi-stream.js already classifies, plus a
 *   `session` header and `entry_appended` records (custom session entries —
 *   one of them, `step-plan`, carries the plan-mode state).
 *
 *   THE BUILT-IN PROVIDER IS OPENAI-COMPATIBLE. 0.1.5 lists models from
 *   `<base>/v1/models` and posts to `<base>/v1/chat/completions` with a Bearer
 *   key (newer source moves to Anthropic messages; the shipped binary does
 *   not). The base comes from STEP_BASE_URL, with a trailing /v1 stripped and
 *   re-added. A Step Platform key belongs to one region:
 *   api.stepfun.com (mainland) or api.stepfun.ai (international). The browser
 *   sign-in (Step Plan) runs on <region>/step_plan instead, chosen by the
 *   profile `step login` stored next to the credential.
 *
 *   A SAVED CREDENTIAL BEATS THE ENVIRONMENT. With ~/.stepcode/auth.json
 *   holding a sign-in, STEP_API_KEY is ignored (verified: requests carried the
 *   saved key). Pointing the agent directory elsewhere moves auth.json,
 *   models.json and config.toml with it (they live in its parent), which is
 *   how the key in the form wins.
 *
 *   A MISSING MODEL LIST STOPS THE RUN. When `/v1/models` fails — key rejected
 *   or endpoint unreachable — the CLI has no model to pick and exits 1 with
 *   "No API key found for the selected model" (or, given --model, "No models
 *   available"). The text is the same for both causes; the adapter asks the
 *   endpoint itself to tell them apart.
 */

'use strict';

const path = require('path');
const { classifyPiEvent } = require('./pi-stream');
const { versionOutputMatches } = require('../binary-identity');

// 0.1.4 is the first release with the Full Access tier (0.1.3 still has the
// retired ask/autopilot/bypass/read-only tiers, which newer releases reset to
// Ask, so one config cannot serve both). 0.1.3 is also the first to honour
// STEP_CODING_AGENT_PLAN_DIR; earlier ones write plan files into the
// project's .stepcode/plans (verified on 0.1.0–0.1.2).
const STEP_MIN_VERSION = '0.1.4';
// Highest version verified end to end. Newer is allowed, just not claimed.
const STEP_TESTED_MAX_VERSION = '0.1.5';

/**
 * The two regions a Step Platform API key can belong to. `searchUrl` is the
 * pay-as-you-go web-search MCP endpoint for that region — the CLI's own
 * search_web tool, which never follows STEP_BASE_URL.
 */
const STEP_REGIONS = {
  cn: {
    host: 'api.stepfun.com',
    baseUrl: 'https://api.stepfun.com/v1',
    searchUrl: 'https://api.stepfun.com/v1/mcp/web_search/mcp',
    keyPage: 'https://platform.stepfun.com/interface-key',
  },
  global: {
    host: 'api.stepfun.ai',
    baseUrl: 'https://api.stepfun.ai/v1',
    searchUrl: 'https://api.stepfun.ai/v1/mcp/web_search/mcp',
    keyPage: 'https://platform.stepfun.ai/interface-key',
  },
};

/** A key with no base URL is a mainland Step Platform key. */
const STEP_DEFAULT_BASE_URL = STEP_REGIONS.cn.baseUrl;

/**
 * The workspace MCP server's name in config.toml. Step names an MCP tool
 * `<server>__<tool>`, so this name makes the tools come out exactly as Claude
 * Code names them (`mcp__openagents-workspace__workspace_get_history`), and
 * the Claude briefing — which refers to them by those names — applies as is.
 */
const STEP_MCP_SERVER_NAME = 'mcp__openagents-workspace';

/**
 * MCP servers that ship with the CLI and are preinstalled into its storage on
 * first run: StepPage, a site-deploy service on StepFun's hosting (13 tools).
 * Not ours and not the user's to vouch for, so each is switched off by name —
 * a plugin server is skipped when the global config disables `<plugin>__<server>`.
 */
const STEP_BUILTIN_PLUGIN_SERVERS = ['steppage__steppage'];

/**
 * Tools a workspace run must not have. clarify_user only answers "requires an
 * interactive UI" headless; the plan-mode pair would let the model enter or
 * leave plan mode on its own, and leaving it headless is automatic — a
 * plan-mode run could approve its own plan and start editing.
 */
const STEP_EXCLUDED_TOOLS = ['clarify_user', 'enter_plan_mode', 'exit_plan_mode'];

/**
 * Variables in the daemon's environment that would route this run somewhere
 * the form did not say. The first five outrank STEP_BASE_URL in the CLI's
 * base-URL lookup; the rest are defaults, permission tiers, or file locations
 * the run sets itself.
 */
const STEP_ROUTING_VARS = [
  'STEP_PROVIDER_API_URL',
  'STEP_API_URL',
  'STEPFUN_MESSAGES_ENDPOINT',
  'STEP_LOGIN_PROFILE_API_URL',
  'STEPCODE_STEP_PLAN_API_URL',
  'STEP_PROVIDER',
  'STEP_MODEL',
  'STEPCODE_DEFAULT_PROVIDER',
  'STEPCODE_DEFAULT_MODEL',
  'STEPCODE_CONFIG_PATH',
  'STEPCODE_AUTH_PATH',
  'STEPCODE_LEGACY_AUTH_PATH',
  'STEPCODE_STORAGE_ROOT_DIR',
  'STEP_CODING_AGENT_DIR',
  'STEP_CODING_AGENT_SESSION_DIR',
  'STEP_CODING_AGENT_PLAN_DIR',
  'STEP_PERMISSION_PRESET',
  'STEP_APPROVAL_MODE',
  'STEP_NON_INTERACTIVE_APPROVAL',
  'STEP_AUTOPILOT',
  'STEP_MCP_IMPORT_ALWAYS',
  'STEPCODE_SEARCH_API_KEY',
  'STEPCODE_SEARCH_WEB_MCP_URL',
];

function installHint(platform = process.platform) {
  return platform === 'win32'
    ? 'irm https://static-openapi.stepfun.com/stepcode/install.ps1 | iex'
    : 'curl -fsSL https://static-openapi.stepfun.com/stepcode/install.sh | bash';
}

// ---------------------------------------------------------------------------
// Version gate (and identity: another CLI called `step` is common)
// ---------------------------------------------------------------------------

/** The version from `step --version` (Step Code prints it bare: `0.1.5`), or null. */
function parseStepVersion(raw) {
  if (raw == null) return null;
  const m = String(raw).trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
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
 * rather than blocking a CLI that is probably fine. `foreign` means the binary
 * answered as a different program: its output fails the registry entry's
 * `install.identify.version_pattern`, the same check installer detection
 * makes (Smallstep's `step` prints `Smallstep CLI/0.28.7 (linux/amd64)`).
 */
function classifyStepVersion(rawVersion, identify = null) {
  if (versionOutputMatches(identify, rawVersion) === false) {
    return { version: null, supported: false, tested: null, foreign: true };
  }
  const version = parseStepVersion(rawVersion);
  if (!version) return { version: null, supported: null, tested: null, foreign: false };
  return {
    version,
    supported: compareVersions(version, STEP_MIN_VERSION) >= 0,
    tested: compareVersions(version, STEP_TESTED_MAX_VERSION) <= 0,
    foreign: false,
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

/** Secret-looking variable names whose values a run's output must not carry. */
const SECRET_ENV_NAME = /(_API_KEY|_AUTH_TOKEN|_ACCESS_TOKEN|_OAUTH_TOKEN|_SECRET|_SECRET_KEY|_ACCESS_KEY|_PERSONAL_ACCESS_TOKEN)$/;

/**
 * Redact secret material from free text before it is logged or posted.
 * `values` are the exact secrets this run holds: the format of a StepFun key
 * is not documented, so pattern matching alone cannot be trusted to catch one.
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

/**
 * redactValues over every string in a parsed frame, keys included. The CLI
 * hands its whole environment to the shell commands it runs (STEP_API_KEY
 * among it — verified with `env`), so a key can come back in a command, its
 * output, the model's reply or an error, and any of them may reach the channel.
 */
function redactFrame(value, values) {
  if (typeof value === 'string') return redactValues(value, values);
  if (Array.isArray(value)) return value.map((v) => redactFrame(v, values));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[redactValues(k, values)] = redactFrame(v, values);
    return out;
  }
  return value;
}

/**
 * The secret values in an environment: the variables named like credentials,
 * at least 8 characters long. Used to extend a run's redaction list with
 * whatever the daemon's own environment carries into the shell tool.
 */
function secretValuesIn(env = {}) {
  const out = [];
  for (const [k, v] of Object.entries(env || {})) {
    if (typeof v === 'string' && v.length >= 8 && SECRET_ENV_NAME.test(k)) out.push(v);
  }
  return out;
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
    if (['--session-id', '--append-system-prompt', '--session-dir'].includes(a) && args[i + 1] != null) {
      out.push(a === '--append-system-prompt' ? '<system-prompt>' : a === '--session-id' ? '<session-id>' : '<dir>');
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Credentials, regions and the user's own Step files
// ---------------------------------------------------------------------------

function _val(env, k) {
  return String((env && env[k]) == null ? '' : env[k]).trim();
}

/**
 * The credential, endpoint and model this agent runs on.
 *
 * The key is Step's own STEP_API_KEY or the workspace's generic LLM_API_KEY
 * (the registry maps one onto the other; both are read so an env that skipped
 * the mapping still works). No key means the CLI's own `step login` sign-in,
 * whose endpoint comes from the profile stored with it — a base URL is then
 * ignored, because the form's default (the Platform API) is the wrong host for
 * a Step Plan token. The model is the workspace pick, then the form's.
 */
function resolveStepAuth(agentEnv = {}, workspaceModel = null) {
  const env = agentEnv || {};
  const key = _val(env, 'STEP_API_KEY') || _val(env, 'LLM_API_KEY');
  const model = String(workspaceModel || '').trim() || _val(env, 'STEP_MODEL') || _val(env, 'LLM_MODEL');
  if (!key) return { mode: 'login', key: '', baseUrl: '', model };
  const baseUrl = _val(env, 'STEP_BASE_URL') || _val(env, 'LLM_BASE_URL') || STEP_DEFAULT_BASE_URL;
  return { mode: 'key', key, baseUrl, model };
}

/** 'cn' / 'global' for a StepFun API host, null for anything else (a relay). */
function stepRegionOf(baseUrl) {
  let host = '';
  try { host = new URL(String(baseUrl || '')).hostname.toLowerCase(); } catch { return null; }
  for (const [id, region] of Object.entries(STEP_REGIONS)) {
    if (host === region.host) return id;
  }
  return null;
}

/**
 * The `/v1/models` URL the CLI will list from, mirroring its own
 * normalization: trailing `/v1`, `/messages` and `/v1/messages` are stripped
 * and `/v1` added back.
 */
function stepModelsUrl(baseUrl) {
  let url;
  try { url = new URL(String(baseUrl || '')); } catch { return null; }
  let p = url.pathname.replace(/\/+$/, '');
  for (;;) {
    const low = p.toLowerCase();
    const suffix = ['/v1/messages', '/messages', '/v1'].find((s) => low.endsWith(s));
    if (!suffix) break;
    p = p.slice(0, -suffix.length).replace(/\/+$/, '');
  }
  url.pathname = `${p}/v1/models`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

/**
 * Where the user's own Step installation keeps its files, resolved the way the
 * CLI resolves them (STEP_CODING_AGENT_DIR's parent, else ~/<config dir>):
 * the sign-in a login-mode run reuses, the config whose telemetry opt-out it
 * honours, and the fd/rg the installer put in <agent dir>/bin.
 */
function userStepPaths(env = {}, home = '') {
  const homeDir = _val(env, 'HOME') || _val(env, 'USERPROFILE') || home;
  const configDirName = _val(env, 'STEPCODE_CONFIG_DIR') || '.stepcode';
  const agentOverride = _val(env, 'STEP_CODING_AGENT_DIR');
  let root;
  let agentDir;
  if (agentOverride) {
    agentDir = path.resolve(agentOverride);
    const parent = path.dirname(agentDir);
    root = parent === agentDir ? agentDir : parent;
  } else {
    root = path.join(homeDir, configDirName);
    agentDir = path.join(root, 'agent');
  }
  return {
    root,
    agentDir,
    authPath: _val(env, 'STEPCODE_AUTH_PATH') || path.join(root, 'auth.json'),
    configPath: path.join(root, 'config.toml'),
    toolsDir: path.join(agentDir, 'bin'),
  };
}

/**
 * The two things a run carries over from the user's own config.toml, which it
 * otherwise never reads: a telemetry opt-out (dropping it would switch back on
 * reporting the user turned off) and `shellPath` (on Windows, where Git Bash
 * lives when the CLI cannot find it). A minimal scan, not a TOML parser.
 */
function readUserStepConfig(text) {
  const out = { telemetryDisabled: false, shellPath: null };
  if (!text) return out;
  let table = '';
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[\s*([^\]]+?)\s*\]$/);
    if (header) { table = header[1].replace(/["']/g, ''); continue; }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = table ? `${table}.${kv[1]}` : kv[1];
    const value = kv[2].trim();
    if (key === 'telemetry.enabled' && value === 'false') out.telemetryDisabled = true;
    if (key === 'shellPath') {
      const s = value.match(/^"((?:[^"\\]|\\.)*)"$/) || value.match(/^'([^']*)'$/);
      if (s) {
        try { out.shellPath = value.startsWith('"') ? JSON.parse(`"${s[1]}"`) : s[1]; } catch {}
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The run's own config.toml
// ---------------------------------------------------------------------------

/** A TOML basic string. JSON's escapes are a subset of TOML's. */
function tomlString(s) {
  return JSON.stringify(String(s));
}

function tomlKey(k) {
  return /^[A-Za-z0-9_-]+$/.test(k) ? k : tomlString(k);
}

/**
 * The global config.toml for one run's private config root. It is the only
 * config the CLI reads (the agent directory points here, and --no-approve
 * keeps the project's .stepcode/config.toml out), so it alone decides:
 *
 *   - the permission tier. Execute mode is Full Access, as the other CLI
 *     agents run (`--yolo`, `--dangerously-skip-permissions`): its dangerous
 *     commands run too. Full Access needs a one-time risk acknowledgment, which
 *     a headless run cannot give — without it the CLI drops to Approve for Me
 *     — so the acknowledgment is written here, in this private file. The
 *     user's own ~/.stepcode/config.toml is never written. Plan mode is
 *     Approve for Me (like the others, which drop their skip-permissions flag
 *     for plan mode): no file edits besides the plan, and the dangerous-command
 *     rules apply to the shell. STEP_NON_INTERACTIVE_DENIAL=continue turns a
 *     refusal into a failed tool result instead of ending the run.
 *   - the MCP servers: the workspace server, and nothing else — the user's
 *     servers (including ones imported from Claude Code / Codex) live in their
 *     own config.toml, and the built-in plugin servers are disabled by name.
 *
 * `mcp` may be null (no workspace server could be located).
 */
function buildStepConfigToml({ mcp = null, shellPath = null, telemetryDisabled = false, planMode = false } = {}) {
  const lines = [
    '# Written by OpenAgents for one Step Code run; removed when the run ends.',
  ];
  if (shellPath) lines.push(`shellPath = ${tomlString(shellPath)}`);
  lines.push('', '[tools.approval]');
  if (planMode) lines.push('preset = "approve-for-me"');
  else lines.push('preset = "full-access"', 'fullAccessAcknowledged = true');
  if (telemetryDisabled) lines.push('', '[telemetry]', 'enabled = false');
  if (mcp && mcp.command) {
    lines.push('', `[mcp_servers.${tomlKey(STEP_MCP_SERVER_NAME)}]`);
    lines.push(`command = ${tomlString(mcp.command)}`);
    lines.push(`args = [${(mcp.args || []).map(tomlString).join(', ')}]`);
    const env = Object.entries(mcp.env || {}).filter(([, v]) => v != null && v !== '');
    if (env.length) lines.push(`env = { ${env.map(([k, v]) => `${tomlKey(k)} = ${tomlString(v)}`).join(', ')} }`);
  }
  for (const name of STEP_BUILTIN_PLUGIN_SERVERS) {
    lines.push('', `[mcp_servers.${tomlKey(name)}]`, 'enabled = false');
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// The child environment
// ---------------------------------------------------------------------------

/** The PATH key of an env object (Windows spells it Path). */
function _pathKey(env) {
  return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
}

/**
 * Environment for one run, built from the daemon's enhanced env.
 *
 *   - STEP_CODING_AGENT_DIR points at this channel's private agent directory,
 *     whose parent holds the run's config.toml, auth.json and models.json: the
 *     user's ~/.stepcode config, saved models and saved credential are never
 *     read. STEPCODE_STORAGE_ROOT_DIR moves the plugin store with it (user
 *     plugins bring MCP servers and skills of their own).
 *   - Key: STEP_API_KEY + STEP_BASE_URL. The private auth.json is empty, so the
 *     key is what the CLI runs on. A StepFun host also gets the search key and
 *     the region's search endpoint, which the CLI never derives from the base.
 *   - Sign-in: STEPCODE_AUTH_PATH points back at the user's own auth.json, so
 *     the `step login` credential — and its token refreshes — stay in one file.
 *     No key and no base URL: the stored profile picks the endpoint.
 *   - STEP_CODING_AGENT_PLAN_DIR: plan files land outside the project.
 *   - Scheduling and multi-agent features off (cron, goals, workflows): a
 *     workspace run has the workspace's timers, and these outlive the run.
 *   - The installer's fd/rg dir goes first on PATH. The run's agent directory
 *     has no bin/ of its own, and without them the CLI downloads both from
 *     GitHub on first use (verified) — into a directory per channel.
 *   - The generic LLM_* names and every routing override are dropped.
 */
function buildStepChildEnv(baseEnv = {}, {
  auth = { mode: 'login', key: '', baseUrl: '' },
  agentDir,
  storageDir,
  planDir,
  userPaths = null,
  toolsDirExists = false,
  telemetryDisabled = false,
  pathDelimiter = path.delimiter,
} = {}) {
  const env = { ...baseEnv };
  delete env.LLM_API_KEY;
  delete env.LLM_BASE_URL;
  delete env.LLM_MODEL;
  for (const k of STEP_ROUTING_VARS) delete env[k];
  delete env.STEP_API_KEY;
  delete env.STEP_BASE_URL;

  env.STEP_CODING_AGENT_DIR = agentDir;
  if (storageDir) env.STEPCODE_STORAGE_ROOT_DIR = storageDir;
  if (planDir) env.STEP_CODING_AGENT_PLAN_DIR = planDir;
  env.STEP_NON_INTERACTIVE_DENIAL = 'continue';
  env.STEP_DISABLE_CRON = '1';
  env.STEP_DISABLE_GOAL = '1';
  env.STEP_DISABLE_SCHEDULE = '1';
  env.STEP_DISABLE_WORKFLOW = '1';
  env.STEP_NO_MODIFY_PATH = '1';
  if (telemetryDisabled) env.STEPCODE_DISABLE_TELEMETRY = '1';

  if (auth.mode === 'key') {
    env.STEP_API_KEY = auth.key;
    env.STEP_BASE_URL = auth.baseUrl;
    // Nothing to import into the private auth.json, even should a later
    // release stop skipping that migration when a key is set.
    env.STEPCODE_LEGACY_AUTH_PATH = path.join(path.dirname(agentDir), 'no-legacy-auth.json');
    const region = stepRegionOf(auth.baseUrl);
    if (region) {
      env.STEPCODE_SEARCH_API_KEY = auth.key;
      env.STEPCODE_SEARCH_WEB_MCP_URL = STEP_REGIONS[region].searchUrl;
    }
  } else if (userPaths && userPaths.authPath) {
    env.STEPCODE_AUTH_PATH = userPaths.authPath;
  }

  if (toolsDirExists && userPaths && userPaths.toolsDir) {
    const key = _pathKey(env);
    const current = env[key] || '';
    const parts = current.split(pathDelimiter).filter(Boolean);
    if (!parts.includes(userPaths.toolsDir)) env[key] = [userPaths.toolsDir, ...parts].join(pathDelimiter);
  }
  return env;
}

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

/**
 * argv for one headless run. The prompt is NOT here: it goes in over stdin,
 * which the CLI reads to EOF when stdin is not a TTY. That keeps a long turn
 * off the OS argv limit — and away from a parser that lets an extension flag
 * (`--plan`) swallow the next bare word as its value: `--plan "say hi"` runs
 * nothing at all (verified). `--plan` is therefore never followed by a value.
 *
 *   --session-dir + --session-id: one flat directory of transcripts per agent;
 *     the id is chosen here and is created when missing, resumed when present.
 *   --no-approve: project-local .stepcode resources (config, extensions,
 *     plugins, MCP servers) stay untrusted.
 *   --non-interactive-approval allow: the one approval setting every release
 *     from 0.1.0 honours, so MCP calls run unattended even where the
 *     config's tier is not understood.
 *
 * Project instructions (AGENTS.md, else CLAUDE.md, per directory) and skills
 * (~/.stepcode/skills, ~/.agents/skills, ~/.claude/skills) are left on.
 */
function buildStepArgs(o = {}) {
  const args = ['-p'];
  if (o.planMode) args.push('--plan');
  args.push('--mode', 'json');
  if (o.sessionDir) args.push('--session-dir', o.sessionDir);
  if (o.sessionId) args.push('--session-id', o.sessionId);
  args.push(
    '--no-approve',
    '--no-update-check',
    '--non-interactive-approval', 'allow',
  );
  const excluded = [...STEP_EXCLUDED_TOOLS, ...(o.extraExcludedTools || [])];
  args.push('--exclude-tools', [...new Set(excluded)].join(','));
  const model = String(o.model || '').trim();
  if (model) args.push('--model', model);
  const systemPrompt = String(o.appendSystemPrompt || '').trim();
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
  return args;
}

// ---------------------------------------------------------------------------
// JSON-mode frames
// ---------------------------------------------------------------------------

/** Parse one NDJSON line. Returns null for blank lines and malformed JSON. */
function parseFrame(line) {
  const s = String(line == null ? '' : line).trim();
  if (!s || s[0] !== '{') return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Normalize one parsed frame. Step-only records are handled here; everything
 * else is Pi's and goes through classifyPiEvent unchanged.
 *
 *   { kind:'session', id }                 the header, first line of every run
 *   { kind:'plan_state', enabled, planFile } a `step-plan` session entry
 *   { kind:'entry' }                       any other custom session entry
 *   …classifyPiEvent kinds (message_update, tool_start, retry_end, …)
 *
 * `secrets` are redacted by value from the whole frame first.
 */
function interpretStepFrame(frame, secrets = []) {
  if (!frame || typeof frame !== 'object') return { kind: 'ignored' };
  if (secrets.length) frame = redactFrame(frame, secrets);
  if (frame.type === 'session') {
    return { kind: 'session', id: typeof frame.id === 'string' ? frame.id : null };
  }
  if (frame.type === 'entry_appended') {
    const entry = frame.entry && typeof frame.entry === 'object' ? frame.entry : {};
    if (entry.customType === 'step-plan' && entry.data && typeof entry.data === 'object') {
      return {
        kind: 'plan_state',
        enabled: entry.data.enabled === true,
        planFile: typeof entry.data.planFilePath === 'string' ? entry.data.planFilePath : null,
      };
    }
    return { kind: 'entry' };
  }
  return classifyPiEvent(frame);
}

// ---------------------------------------------------------------------------
// Run classification
// ---------------------------------------------------------------------------

/** The lines of stderr worth reading: no warnings, no doc pointers. */
function stepErrorLines(stderr) {
  return String(stderr || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^warning:/i.test(l))
    .filter((l) => !/^use \/login to log into|^\/.*\/docs\/.*\.md$|^[A-Za-z]:\\.*\\docs\\.*\.md$|^hint:/i.test(l));
}

/** HTTP status at the head of a provider error ("401: {...}"), or null. */
function httpStatusOf(text) {
  const m = String(text || '').match(/^\s*(\d{3})\b/);
  return m ? Number(m[1]) : null;
}

/** The message inside a provider error body, for showing to the user. */
function providerMessage(text) {
  const s = String(text || '');
  const brace = s.indexOf('{');
  if (brace >= 0) {
    try {
      const body = JSON.parse(s.slice(brace));
      const msg = (body && body.error && body.error.message) || (body && body.message);
      if (typeof msg === 'string' && msg) return msg;
    } catch {}
  }
  return s.replace(/^\s*\d{3}:\s*/, '');
}

function messages(auth = {}) {
  const region = stepRegionOf(auth.baseUrl);
  const keyPage = region ? STEP_REGIONS[region].keyPage : STEP_REGIONS.cn.keyPage;
  return {
    signedOut: 'Step Code is not signed in. Run `step login` in a terminal on this machine, or set a Step Platform API key for this agent (https://platform.stepfun.com/interface-key, or platform.stepfun.ai outside mainland China).',
    loginRejected: 'The Step Code sign-in was rejected or has expired. Run `step login` again in a terminal, or set a Step Platform API key for this agent.',
    keyRejected: region
      ? `The Step Platform API key was rejected by ${STEP_REGIONS[region].host}. Check it at ${keyPage} — a key works only in the region it was created in (api.stepfun.com for mainland China, api.stepfun.ai for international accounts), so the base URL must match.`
      : `The API key was rejected by ${auth.baseUrl || 'the endpoint'}. Check the key and the base URL for this agent.`,
    unreachable: `Step Code could not reach ${auth.mode === 'key' ? (auth.baseUrl || 'the endpoint') : 'the Step service'}. Check the network and any HTTP_PROXY / HTTPS_PROXY setting, and that the base URL is right.`,
    noModels: `${auth.baseUrl || 'The endpoint'} returned no chat models for this key. Check the base URL, or pick a model explicitly.`,
    quota: 'The Step account is out of credit or rate limited. Wait and retry, or top up the account.',
    model: `Step Code cannot use the model "${auth.model || ''}". Pick one from \`step --list-models\`, or clear the model to use the default.`,
    server: 'The Step model service returned an error. This is usually temporary — retry shortly.',
    badBaseUrl: `The base URL "${auth.baseUrl || ''}" is not a valid URL. Use https://api.stepfun.com/v1 (mainland China) or https://api.stepfun.ai/v1 (international).`,
  };
}

/**
 * How a run ended. A provider error on the last assistant message outranks
 * the exit code (exit 1 is every failure alike); stderr is read when the run
 * stopped before it reached the model.
 *
 * `probe` is the adapter's own check of the model list, run only after the
 * "no model" failure the CLI reports identically for a rejected key and an
 * unreachable endpoint: { status } or { networkError } or { emptyList }.
 * `hasLoginCredential` says whether the user's auth.json holds a Step
 * credential, which is what separates "never signed in" from "sign-in no
 * longer accepted" on the same failure without a key.
 *
 * @returns {{kind: string, ok: boolean, userMessage: string|null}}
 */
function classifyStepRun({
  turnError = null,
  code = null,
  signal = null,
  stderr = '',
  anyFrame = false,
  probe = null,
  hasLoginCredential = false,
} = {}, auth = {}) {
  const msg = messages(auth);
  const lines = stepErrorLines(stderr);
  const errText = String(turnError || '');

  if (!turnError && (code === 0 || code === null) && !signal) {
    return { kind: 'success', ok: true, userMessage: null };
  }

  if (turnError) {
    const status = httpStatusOf(errText);
    const detail = truncate(providerMessage(errText), 300);
    if (status === 401 || status === 403 || /invalid[_ ]api[_ ]key|unauthorized|authentication/i.test(errText)) {
      return { kind: 'auth', ok: false, userMessage: auth.mode === 'key' ? msg.keyRejected : msg.loginRejected };
    }
    if (status === 429 || status === 402 || /rate limit|quota|insufficient|balance|credit/i.test(errText)) {
      return { kind: 'quota', ok: false, userMessage: `${msg.quota}\n\n${detail}` };
    }
    if (status === 404 || /model.{0,40}(not found|not exist|does not exist|unsupported|invalid)/i.test(errText)) {
      return { kind: 'model', ok: false, userMessage: `${msg.model}\n\n${detail}` };
    }
    if (status && status >= 500) return { kind: 'server', ok: false, userMessage: `${msg.server}\n\n${detail}` };
    if (/econnrefused|enotfound|etimedout|fetch failed|network|socket hang up|getaddrinfo|certificate|timed out/i.test(errText)) {
      return { kind: 'network', ok: false, userMessage: msg.unreachable };
    }
    if (/context|too long|maximum.{0,20}tokens/i.test(errText)) {
      return { kind: 'context', ok: false, userMessage: `Step Code exceeded the model's context window: ${detail}\n\nUse /restart in this channel to start a fresh session.` };
    }
    return { kind: 'run_error', ok: false, userMessage: `Step Code could not finish the run: ${detail}` };
  }

  const all = lines.join('\n');
  if (/no api key found|no models available/i.test(all)) {
    if (auth.mode !== 'key') {
      // No credential at all, or a stored sign-in whose model list came back
      // empty (an expired token answers the list with 401).
      return { kind: 'auth', ok: false, userMessage: hasLoginCredential ? msg.loginRejected : msg.signedOut };
    }
    if (probe && (probe.status === 401 || probe.status === 403)) return { kind: 'auth', ok: false, userMessage: msg.keyRejected };
    if (probe && probe.networkError) return { kind: 'network', ok: false, userMessage: msg.unreachable };
    if (probe && probe.emptyList) return { kind: 'no_models', ok: false, userMessage: msg.noModels };
    if (probe && probe.status) {
      return { kind: 'endpoint', ok: false, userMessage: `${auth.baseUrl} answered the model list with HTTP ${probe.status}. Check the base URL for this agent.` };
    }
    return { kind: 'endpoint', ok: false, userMessage: `${msg.keyRejected}\n\n(If the key is right, the endpoint may be unreachable: ${msg.unreachable})` };
  }
  if (/base url must be a valid url/i.test(all)) return { kind: 'config', ok: false, userMessage: msg.badBaseUrl };
  if (signal) return { kind: 'interrupted', ok: false, userMessage: 'The run was interrupted.' };
  const first = lines.find((l) => !/^at\s/.test(l)) || '';
  if (first) {
    return {
      kind: 'startup_error',
      ok: false,
      userMessage: `Step Code stopped${anyFrame ? '' : ' before answering'}: ${truncate(redactSecrets(first.replace(/^error:\s*/i, '')), 400)}`,
    };
  }
  return {
    kind: 'no_result',
    ok: false,
    userMessage: `Step Code exited without answering (code ${code}). Check the daemon log, then retry.`,
  };
}

/**
 * Summarize a GET /v1/models answer into the `probe` classifyStepRun takes.
 * The CLI keeps only entries typed as chat (大语言模型) or routing (路由模型)
 * models when the endpoint types them at all.
 */
function summarizeModelsProbe({ status = null, body = null, networkError = false } = {}) {
  if (networkError) return { networkError: true };
  if (status !== 200) return { status };
  const data = body && Array.isArray(body.data) ? body.data : [];
  const typed = data.some((m) => m && typeof m.model_type === 'string');
  const usable = data.filter((m) => m && typeof m.id === 'string' && m.id
    && (!typed || m.model_type === '大语言模型' || m.model_type === '路由模型'));
  return usable.length ? { status: 200, count: usable.length } : { status: 200, emptyList: true };
}

// ---------------------------------------------------------------------------
// Process tree
// ---------------------------------------------------------------------------

/**
 * Every descendant of `rootPid` in a { pid, ppid, pgid } table, nearest first.
 * The CLI starts its shell commands in sessions of their own, and an MCP
 * server that ignores the end of its stdin outlives a signalled CLI (verified:
 * one stuck in its handshake was left behind, reparented to init) — so the
 * table has to be read while the CLI is still alive.
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
  STEP_MIN_VERSION,
  STEP_TESTED_MAX_VERSION,
  STEP_REGIONS,
  STEP_DEFAULT_BASE_URL,
  STEP_MCP_SERVER_NAME,
  STEP_BUILTIN_PLUGIN_SERVERS,
  STEP_EXCLUDED_TOOLS,
  STEP_ROUTING_VARS,
  installHint,
  parseStepVersion,
  compareVersions,
  classifyStepVersion,
  redactSecrets,
  redactValues,
  redactFrame,
  secretValuesIn,
  truncate,
  redactArgs,
  resolveStepAuth,
  stepRegionOf,
  stepModelsUrl,
  userStepPaths,
  readUserStepConfig,
  buildStepConfigToml,
  buildStepChildEnv,
  buildStepArgs,
  parseFrame,
  interpretStepFrame,
  stepErrorLines,
  httpStatusOf,
  providerMessage,
  classifyStepRun,
  summarizeModelsProbe,
  descendantsOf,
  parseProcessTable,
};

/**
 * Pure helpers for the DeepSeek Harness (dsh) adapter.
 *
 * Everything here is side-effect free and unit-tested (test/deepseek-runtime.test.js)
 * so the adapter itself stays a thin subprocess driver. The split mirrors
 * cline-stream.js / pi-stream.js.
 *
 * Verified against @deepseek-ai/dsh 0.1.0-rc.6 (bin `dsh` -> lib/bin.js, ESM).
 *
 * Three things here exist because dsh is unlike every other CLI in this repo:
 *
 *  1. It is a PREVIEW release (`0.1.0-rc.6`) and upstream says compatibility may
 *     break between previews, so the gate is exact equality — not a floor. The
 *     two version comparators already in this repo (installer.js's
 *     `compareVersions`, pi-stream.js's `parseVersion`) both DROP the `-rc.N`
 *     suffix, which would make rc.5 and rc.6 indistinguishable. Hence the
 *     prerelease-aware parser below.
 *
 *  2. `dsh --profile headless "<task>"` takes the task as a POSITIONAL ARGUMENT
 *     and has no stdin task channel. Putting the workspace prompt there would
 *     publish the workspace token to /proc/<pid>/cmdline and `ps`. The adapter
 *     therefore writes the prompt to a private task file and passes a constant
 *     sentence in argv — see HEADLESS_TASK_INSTRUCTION.
 *
 *  3. dsh's own composition mounts an approval row whose policy is `ask`
 *     everywhere except `danger-full-access`. A headless run has no client that
 *     could answer, so the adapter ships a private patch that sets `approval:
 *     never` while KEEPING `sandbox: workspace-write` — non-interactive
 *     execution without widening the filesystem boundary. Reaching the same
 *     place via DSH_PERMISSION_MODE=danger-full-access would also unsandbox the
 *     agent, which is why that value is never used to solve this.
 */

'use strict';

const crypto = require('crypto');

/**
 * The dsh release this adapter is written against.
 *
 * FALLBACK ONLY. The authoritative version lives in the registry
 * (`install.supported_version` in deepseek.yaml / registry.json) so the catalog,
 * the installer gate and the runtime gate cannot drift; the adapter reads it
 * from there and only falls back here when the registry entry cannot be read at
 * all. Mirrors pi-stream.js's MIN_PI_VERSION rationale.
 */
const SUPPORTED_DSH_VERSION = '0.1.0-rc.6';

/**
 * dsh's Node requirement, from the upstream repository's root package.json:
 *
 *     "engines": { "node": "^22.19.0 || >=24.0.0" }
 *
 * None of the PUBLISHED packages (@deepseek-ai/dsh, dsh-base, dsh-headless,
 * cordis) carry an `engines` field, so npm will happily install dsh onto Node 20
 * and it then fails at runtime with an unrelated-looking error. The gate has to
 * live here.
 *
 * Note the caret: `^22.19.0` does NOT include 23.x. Pi's gate is effectively
 * ">= 22.19.0" and would wrongly accept Node 23, so this cannot reuse it.
 */
const NODE_MIN_22 = [22, 19, 0];

/** Row ids in dsh's own composition that the private patch addresses. */
const ROW = {
  AGENT_DEFAULT_MODEL: 'agent-default-model',
  APPROVAL: 'approval',
  PERMISSION: 'permission',
  USER_QUESTIONS: 'user-questions',
};

/** Permission modes dsh's `permission-presets` row declares. */
const PERMISSION_MODES = ['read-only', 'workspace-write', 'danger-full-access'];

/**
 * The ONLY thing that ever reaches argv as the headless task.
 *
 * The real prompt (workspace rules, bounded recap, the user's request) lives in
 * the task file. Keeping this a constant is what makes "no user content and no
 * secret is ever visible in the process list" an assertable property rather
 * than a length-dependent hope.
 */
const HEADLESS_TASK_INSTRUCTION =
  'Read the task file at %s and complete the task described in it. ' +
  'Do not ask the user any questions.';

// ---------------------------------------------------------------------------
// Version parsing (prerelease-aware)
// ---------------------------------------------------------------------------

/**
 * Extract a semver-ish version, PRESERVING any prerelease suffix, from raw CLI
 * output such as `dsh 0.1.0-rc.6` or a bare `0.1.0-rc.6`.
 *
 * Returns null when nothing version-shaped is present. Build metadata (`+sha`)
 * is dropped: semver says it does not participate in precedence.
 */
function parseDshVersion(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  const core = `${m[1]}.${m[2]}.${m[3]}`;
  return m[4] ? `${core}-${m[4]}` : core;
}

/** Split a parsed version into { core: number[], pre: string[]|null }. */
function splitVersion(v) {
  const parsed = parseDshVersion(v);
  if (!parsed) return null;
  const [core, pre] = parsed.split('-');
  return {
    core: core.split('.').map((n) => parseInt(n, 10)),
    pre: pre ? pre.split('.') : null,
  };
}

/** Compare two prerelease identifiers per semver rules. */
function comparePreIdentifier(a, b) {
  const na = /^\d+$/.test(a);
  const nb = /^\d+$/.test(b);
  if (na && nb) {
    const d = parseInt(a, 10) - parseInt(b, 10);
    return d === 0 ? 0 : d > 0 ? 1 : -1;
  }
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (na) return -1;
  if (nb) return 1;
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

/**
 * -1 / 0 / 1 with FULL semver precedence, including prerelease ordering:
 *
 *     0.1.0-rc.5  <  0.1.0-rc.6  <  0.1.0
 *
 * Returns null when either side cannot be parsed — callers must treat that as
 * "unknown" rather than silently passing a gate.
 *
 * Deliberately NOT shared with installer.js's `compareVersions` or
 * pi-stream.js's `parseVersion`: both of those match only `\d+(\.\d+)*` and so
 * collapse every 0.1.0-rc.N to 0.1.0. Those two are load-bearing for other
 * agents and are left alone; this is the dsh-specific replacement.
 */
function compareDshVersions(a, b) {
  const pa = splitVersion(a);
  const pb = splitVersion(b);
  if (!pa || !pb) return null;

  for (let i = 0; i < 3; i++) {
    const x = pa.core[i] || 0;
    const y = pb.core[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }

  // A version WITH a prerelease has lower precedence than one without.
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;

  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1; // shorter prerelease sorts first
    if (y === undefined) return 1;
    const c = comparePreIdentifier(x, y);
    if (c !== 0) return c;
  }
  return 0;
}

/**
 * Preview-era compatibility gate: the installed dsh must be EXACTLY the version
 * this adapter was written against.
 *
 * Returns { compatible: true|false|null, detected, supported, message }.
 * `compatible: null` means the version could not be read — reported as unknown,
 * never as a pass.
 *
 * `installCommand` is echoed into the failure message because the recovery is
 * not obvious: the Launcher's update path would otherwise move the user to a
 * newer preview that this adapter refuses to run.
 */
function classifyDshVersion(rawVersion, supported, installCommand) {
  const want = parseDshVersion(supported || SUPPORTED_DSH_VERSION);
  const detected = parseDshVersion(rawVersion);
  if (!detected) {
    return {
      compatible: null,
      detected: null,
      supported: want,
      message:
        `Could not read the DeepSeek Harness version (expected ${want}). ` +
        'Reinstall with: ' + (installCommand || defaultInstallCommand(want)),
    };
  }
  if (compareDshVersions(detected, want) === 0) {
    return { compatible: true, detected, supported: want, message: null };
  }
  return {
    compatible: false,
    detected,
    supported: want,
    message:
      `DeepSeek Harness ${detected} is not supported — this agent is built ` +
      `against ${want} exactly. DeepSeek ships the harness as a developer ` +
      'preview and its configuration can change between previews, so the ' +
      'version is pinned. Reinstall with: ' +
      (installCommand || defaultInstallCommand(want)),
  };
}

/** The npm command that restores the pinned preview. */
function defaultInstallCommand(version) {
  return `npm install -g @deepseek-ai/dsh@${version || SUPPORTED_DSH_VERSION}`;
}

// ---------------------------------------------------------------------------
// Node version gate
// ---------------------------------------------------------------------------

/**
 * Classify a `node --version` string against dsh's `^22.19.0 || >=24.0.0`.
 *
 * Returns { version, supported }. `version` is null when unparseable, in which
 * case `supported` is null ("unknown") rather than false.
 *
 * The 23.x rejection is the whole reason this is not shared with Pi: Pi's gate
 * is a plain floor and would accept 23.x, which dsh's caret range excludes.
 */
function classifyNodeVersion(raw) {
  const parsed = parseDshVersion(raw);
  if (!parsed) return { version: null, supported: null };
  const [major, minor, patch] = parsed.split('-')[0].split('.').map((n) => parseInt(n, 10));

  if (major >= 24) return { version: parsed, supported: true };
  if (major === 23) return { version: parsed, supported: false };
  if (major === 22) {
    const ok =
      minor > NODE_MIN_22[1] ||
      (minor === NODE_MIN_22[1] && patch >= NODE_MIN_22[2]);
    return { version: parsed, supported: ok };
  }
  return { version: parsed, supported: false };
}

/** Human-readable requirement, used in the incompatibility message. */
function nodeRequirementText() {
  return `Node ${NODE_MIN_22.join('.')}+ (22.x) or Node 24+; Node 23.x is not supported`;
}

// ---------------------------------------------------------------------------
// Private DSH_HOME naming
// ---------------------------------------------------------------------------

/**
 * A filesystem-safe, COLLISION-FREE directory name for one agent's private
 * DSH_HOME.
 *
 * Slugging alone is not enough: `my/agent` and `my:agent` both slug to
 * `my-agent`, and two agents sharing a DSH_HOME would share sessions, settings
 * and credentials. The 8-hex digest of the raw pair keeps the name readable
 * while making a collision require an actual SHA-256 prefix collision.
 */
function safeDshHomeName(workspaceId, agentName) {
  const raw = `${workspaceId == null ? '' : workspaceId} ${agentName == null ? '' : agentName}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8);
  const slug = (s) =>
    String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'agent';
  return `${slug(workspaceId)}_${slug(agentName)}-${hash}`;
}

// ---------------------------------------------------------------------------
// argv construction
// ---------------------------------------------------------------------------

/**
 * Build the argument vector that follows the Node binary.
 *
 * Order is load-bearing: dsh's launcher parses only its own flags and hands
 * everything after the first token it does not recognise to the booted profile.
 * Launcher flags therefore MUST precede the positional task.
 *
 * The task argument is a constant sentence naming the task file — never the
 * prompt itself. See HEADLESS_TASK_INSTRUCTION.
 */
function buildHeadlessArgs({ jsEntry, taskFile, patchFile }) {
  if (!jsEntry) throw new Error('buildHeadlessArgs: jsEntry is required');
  if (!taskFile) throw new Error('buildHeadlessArgs: taskFile is required');
  const args = [jsEntry, '--profile', 'headless'];
  if (patchFile) args.push('--patch', patchFile);
  args.push(HEADLESS_TASK_INSTRUCTION.replace('%s', taskFile));
  return args;
}

/** The bootstrap probe: composes the profile without booting or calling a model. */
function buildDumpConfigArgs({ jsEntry, patchFile }) {
  if (!jsEntry) throw new Error('buildDumpConfigArgs: jsEntry is required');
  const args = [jsEntry, '--profile', 'headless'];
  if (patchFile) args.push('--patch', patchFile);
  args.push('--dump-config');
  return args;
}

// ---------------------------------------------------------------------------
// Private patch file
// ---------------------------------------------------------------------------

/**
 * Emit a YAML scalar safely.
 *
 * Always quotes and always escapes. The model id is user-supplied through the
 * Launcher, and an unquoted `foo: bar` or a stray newline there would rewrite
 * the patch's structure — a config-injection hole. This is stricter than
 * config.js's serializeYamlValue (which quotes only when it detects a special
 * character) precisely because the input is untrusted.
 */
function yamlScalar(value) {
  const s = String(value == null ? '' : value);
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/**
 * The private `--patch` overlay this adapter ships with every dsh run.
 *
 * It carries three things, all of which are configuration dsh has no
 * environment variable for:
 *
 *  1. `user-questions` disabled — a headless run has no surface on which the
 *     agent could ask, so leaving it mounted only creates a way to hang.
 *  2. `approval` forced to `never`, and the presets rewritten to match, WITHOUT
 *     touching `sandbox`. dsh's own preset table pairs `approval: never` only
 *     with `sandbox: danger-full-access`; keeping `workspace-write` alongside
 *     `never` is what gives non-interactive execution that is still confined to
 *     the workspace for writes. (Reads are not confined in any mode.)
 *  3. The model/provider override, since `agent-default-model` is a composition
 *     row rather than an environment variable.
 *
 * A patch REPLACES the targeted row's whole `config`, so each row below is
 * written out complete rather than as a partial merge.
 */
function buildPrivatePatch({ model, provider, permissionMode } = {}) {
  const mode = normalizePermissionMode(permissionMode) || 'workspace-write';
  const sandboxFor = (m) => (m === 'read-only' ? 'read-only' : m === 'danger-full-access' ? 'danger-full-access' : 'workspace-write');

  const lines = [
    '# Generated by OpenAgents for the DeepSeek Harness adapter.',
    `# Pinned to dsh ${SUPPORTED_DSH_VERSION}. Do not edit by hand: this file is`,
    '# rewritten on every run and lives inside a per-agent private DSH_HOME.',
    '',
    `- id: ${ROW.USER_QUESTIONS}`,
    '  disabled: true',
    '',
    `- id: ${ROW.APPROVAL}`,
    '  config:',
    '    policy: never',
    '',
    `- id: ${ROW.PERMISSION}`,
    '  config:',
    '    presets:',
  ];

  for (const m of PERMISSION_MODES) {
    lines.push(`      ${m}:`);
    lines.push(`        sandbox: ${sandboxFor(m)}`);
    lines.push('        approval: never');
  }

  if (model || provider) {
    lines.push('');
    lines.push(`- id: ${ROW.AGENT_DEFAULT_MODEL}`);
    lines.push('  config:');
    lines.push(`    provider: ${yamlScalar(provider || 'deepseek-official')}`);
    if (model) lines.push(`    model: ${yamlScalar(model)}`);
  }

  lines.push('');
  return { text: lines.join('\n'), mode };
}

// ---------------------------------------------------------------------------
// Permission mode
// ---------------------------------------------------------------------------

/**
 * Validate DSH_PERMISSION_MODE strictly. Returns the mode, or null when the
 * value is not one dsh declares.
 *
 * A silent fallback is the wrong behaviour here: a typo'd `workspace_write`
 * would quietly run under whatever dsh defaults to, which is the opposite of
 * what the user asked for on a permission setting.
 */
function normalizePermissionMode(value) {
  if (value == null || value === '') return null;
  const v = String(value).trim();
  return PERMISSION_MODES.includes(v) ? v : null;
}

/** The mode to run under, given the workspace mode and the user's setting. */
function resolvePermissionMode({ workspaceMode, configured }) {
  // Plan mode is read-only regardless of what the agent is configured with:
  // OpenAgents promises plan mode makes no changes.
  if (workspaceMode === 'plan') return 'read-only';
  return normalizePermissionMode(configured) || 'workspace-write';
}

// ---------------------------------------------------------------------------
// Output handling
// ---------------------------------------------------------------------------

/**
 * Hard cap on buffered stdout. dsh emits nothing until the run ends and then
 * writes one assistant message, so this is not a streaming budget — it is the
 * "a wedged process must not OOM the daemon" backstop. Mirrors pi-stream.js's
 * MAX_LINE_BYTES rationale.
 */
const MAX_STDOUT_BYTES = 16 * 1024 * 1024;

/** Cap on the reply actually posted to the workspace. */
const MAX_REPLY_CHARS = 64 * 1024;

/** Cap on retained stderr. The TAIL is kept: the error is at the end. */
const MAX_STDERR_CHARS = 8 * 1024;

/**
 * Turn raw stdout into the reply to post.
 *
 * dsh writes the last non-empty assistant text and nothing else on success, so
 * this is deliberately minimal: trim, then bound. Returns { text, truncated }.
 */
function cleanStdout(raw, { maxChars = MAX_REPLY_CHARS } = {}) {
  const s = String(raw == null ? '' : raw).replace(/\s+$/, '');
  if (s.length <= maxChars) return { text: s, truncated: false };
  return {
    text: s.slice(0, maxChars) + '\n\n[output truncated by OpenAgents]',
    truncated: true,
  };
}

/**
 * Keep the TAIL of stderr, not the head.
 *
 * dsh writes a terminal `error` reason's code and message at the end of the
 * stream; truncating from the front would throw away the only line that
 * explains the failure.
 */
function tailStderr(raw, { maxChars = MAX_STDERR_CHARS } = {}) {
  const s = String(raw == null ? '' : raw).trim();
  return s.length <= maxChars ? s : '…' + s.slice(-maxChars);
}

/** Failure categories surfaced to the workspace. */
const FAILURE = {
  AUTH: 'auth',
  MODEL: 'model',
  NETWORK: 'network',
  CONFIG: 'config',
  PERMISSION: 'permission',
  VERSION: 'version',
  UNKNOWN: 'unknown',
};

const FAILURE_PATTERNS = [
  [FAILURE.AUTH, /\b(401|403|unauthor|forbidden|invalid[_\s-]?api[_\s-]?key|authentication|no api key|missing api key|credential)/i],
  [FAILURE.MODEL, /\b(model[_\s-]?not[_\s-]?found|unknown model|unsupported model|no such model|context[_\s-]?length|token limit|quota|rate[_\s-]?limit|429)/i],
  [FAILURE.NETWORK, /\b(econnrefused|enotfound|etimedout|econnreset|socket hang up|network|dns|proxy|certificate|tls|ssl|502|503|504)/i],
  [FAILURE.PERMISSION, /\b(eacces|eperm|erofs|permission denied|read[_\s-]?only file system|operation not permitted)/i],
  [FAILURE.VERSION, /\b(unsupported node|engine|requires node|syntaxerror.*unexpected token|err_require_esm|cannot use import statement)/i],
  [FAILURE.CONFIG, /\b(profile|cordis|patch|settings\.yaml|plugin|bundle|dsh_home|composition|row)\b/i],
];

/**
 * Classify a non-zero dsh run.
 *
 * The `stdout` of a failed run is deliberately IGNORED by the caller: dsh only
 * guarantees the final assistant text on success, so whatever partial text is
 * sitting in the buffer of a failed run is not an answer.
 *
 * Returns { category, message } with the message already tail-bounded. The
 * caller is responsible for the final redaction pass.
 */
function classifyDshFailure({ code, signal, stderr } = {}) {
  const detail = tailStderr(stderr);
  if (signal) {
    return {
      category: FAILURE.UNKNOWN,
      message: `DeepSeek Harness was terminated by signal ${signal}.` + (detail ? `\n\n${detail}` : ''),
    };
  }
  for (const [category, re] of FAILURE_PATTERNS) {
    if (re.test(detail)) return { category, message: detail };
  }
  return {
    category: FAILURE.UNKNOWN,
    message:
      detail ||
      `DeepSeek Harness exited with code ${code == null ? '?' : code} and wrote no diagnostics.`,
  };
}

// ---------------------------------------------------------------------------
// Session GC
// ---------------------------------------------------------------------------

/** Keep at most this many persisted sessions per agent. */
const SESSION_KEEP_COUNT = 50;

/** Drop persisted sessions older than this. */
const SESSION_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Decide which persisted sessions to delete.
 *
 * Every headless run creates one fresh persisted session (dsh has no resume),
 * so the sessions directory grows once per workspace message and would never
 * shrink on its own.
 *
 * The rule is OR: an entry goes if it is older than SESSION_KEEP_MS **or** it
 * falls outside the newest SESSION_KEEP_COUNT. Both bounds matter — a busy
 * agent can blow past the count inside a day, and an idle one accumulates stale
 * sessions that the count alone would never reach.
 *
 * `entries` is [{ name, mtimeMs }]. Callers must have already excluded anything
 * that is not a regular file/directory (symlinks are rejected upstream) and
 * must only call this when the adapter has no live dsh child: a session
 * belonging to a run still in flight would otherwise look like a stale one.
 */
function selectSessionsForGc(entries, { now, keepCount = SESSION_KEEP_COUNT, keepMs = SESSION_KEEP_MS } = {}) {
  const list = (entries || []).filter((e) => e && e.name);
  if (list.length === 0) return [];
  const cutoff = (typeof now === 'number' ? now : Date.now()) - keepMs;

  const byNewest = [...list].sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
  const keep = new Set(byNewest.slice(0, keepCount).map((e) => e.name));

  return list
    .filter((e) => !keep.has(e.name) || (e.mtimeMs || 0) < cutoff)
    .map((e) => e.name);
}

module.exports = {
  SUPPORTED_DSH_VERSION,
  NODE_MIN_22,
  ROW,
  PERMISSION_MODES,
  HEADLESS_TASK_INSTRUCTION,

  parseDshVersion,
  compareDshVersions,
  classifyDshVersion,
  defaultInstallCommand,

  classifyNodeVersion,
  nodeRequirementText,

  safeDshHomeName,

  buildHeadlessArgs,
  buildDumpConfigArgs,

  yamlScalar,
  buildPrivatePatch,

  normalizePermissionMode,
  resolvePermissionMode,

  MAX_STDOUT_BYTES,
  MAX_REPLY_CHARS,
  MAX_STDERR_CHARS,
  FAILURE,
  cleanStdout,
  tailStderr,
  classifyDshFailure,

  SESSION_KEEP_COUNT,
  SESSION_KEEP_MS,
  selectSessionsForGc,
};

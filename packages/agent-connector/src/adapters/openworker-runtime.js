/**
 * Pure helpers for the OpenWorker adapter — no I/O, no process, no sockets, so
 * every decision below is unit-testable on its own.
 *
 * OpenWorker (https://github.com/andrewyng/openworker) is the odd one out in
 * this directory: it has no headless CLI. `openworker` is a Textual TUI and
 * exits with the terminal; the only programmable surface is `openworker-server`,
 * a FastAPI process that speaks REST for state and a WebSocket per session for
 * turns. So instead of an argv + NDJSON contract, the "protocol" this file
 * encodes is:
 *
 *   1. spawn the server on a private port with a token we minted ourselves
 *      (`buildServerArgs`, plus COWORKER_API_TOKEN in the child env);
 *   2. open `/ws/session/<id>` with the token as the WebSocket SUBPROTOCOL —
 *      the server checks `sec-websocket-protocol`, not a header (`sessionUrl`);
 *   3. send one `user_message` frame and read events until `turn_done`
 *      (`interpretEvent`);
 *   4. answer every prompt frame IN LINE (`promptReply`) — this is the part
 *      that makes an interactive product usable unattended.
 *
 * That fourth point is the one to keep in mind when editing. OpenWorker blocks
 * the turn on a human for approvals, folder grants, questions and plans, and it
 * does so even in `bypass-approvals` mode for its hard floors (settings files,
 * writes outside the workspace root, `.git/hooks`). A prompt we fail to answer
 * is not a degraded turn — it is a turn that never ends. Every branch of
 * `promptReply` therefore returns a frame, and the default for anything we do
 * not recognise is to decline rather than to stay silent.
 */

'use strict';

const crypto = require('crypto');
const path = require('path');

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * The providers OpenWorker can be driven with using a single API key (plus an
 * optional endpoint) — i.e. everything we can configure from one launcher form.
 *
 * `bedrock`, `vertex` and `ark-agent-plan-cn` are deliberately absent: they take
 * a multi-field credential form (role ARNs, service-account JSON, region) that
 * has no honest single-key mapping. A user who needs one points
 * OPENWORKER_STATE_DIR at a state dir where the desktop app already stored it.
 *
 * `envKey` is the environment variable OpenWorker's own provider code reads
 * FIRST, ahead of its secret store (see `providers/openai_provider.resolve_api_key`
 * and its per-provider siblings). Passing the key that way keeps it out of any
 * file we write.
 */
const PROVIDERS = {
  openai: { envKey: 'OPENAI_API_KEY', needsKey: true },
  anthropic: { envKey: 'ANTHROPIC_API_KEY', needsKey: true },
  gemini: { envKey: 'GEMINI_API_KEY', needsKey: true },
  deepseek: { envKey: 'DEEPSEEK_API_KEY', needsKey: true },
  kimi: { envKey: 'MOONSHOT_API_KEY', needsKey: true },
  qwen: { envKey: 'DASHSCOPE_API_KEY', needsKey: true },
  minimax: { envKey: 'MINIMAX_API_KEY', needsKey: true },
  xai: { envKey: 'XAI_API_KEY', needsKey: true },
  mistral: { envKey: 'MISTRAL_API_KEY', needsKey: true },
  together: { envKey: 'TOGETHER_API_KEY', needsKey: true },
  fireworks: { envKey: 'FIREWORKS_API_KEY', needsKey: true },
  openrouter: { envKey: 'OPENROUTER_API_KEY', needsKey: true },
  zai: { envKey: 'ZAI_API_KEY', needsKey: true },
  ark: { envKey: 'ARK_API_KEY', needsKey: true },
  meta: { envKey: 'META_API_KEY', needsKey: true },
  // Local server: no key at all, just a URL.
  ollama: { envKey: null, needsKey: false },
  // A ChatGPT subscription. The OAuth tokens live in OpenWorker's own secret
  // store and are minted by a browser flow we cannot drive, so this only works
  // against a state dir where the desktop app already signed in.
  'openai-codex': { envKey: null, needsKey: false, needsExistingState: true },
};

const DEFAULT_PROVIDER = 'openai';

/** Normalise a user-entered provider to a known id, or '' when unrecognised. */
function normalizeProvider(raw) {
  const name = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!name || name === 'auto') return '';
  return Object.prototype.hasOwnProperty.call(PROVIDERS, name) ? name : '';
}

/** The env var OpenWorker reads this provider's key from, or null. */
function providerKeyEnv(provider) {
  const spec = PROVIDERS[normalizeProvider(provider) || DEFAULT_PROVIDER];
  return (spec && spec.envKey) || null;
}

/**
 * Qualify a model id with its provider prefix.
 *
 * OpenWorker's ProviderRouter dispatches on `prefix:rest` and only when `prefix`
 * is a KNOWN provider — a bare `gpt-5.6-sol` routes to the default (OpenAI), and
 * `qwen3-coder:30b` keeps its colon because `qwen3-coder` is not a provider. So:
 *
 *   - an id the user already qualified is returned untouched (no double prefix);
 *   - anything else gets `<provider>:` so an Anthropic key is never handed a
 *     model the OpenAI client will try to serve.
 */
function qualifyModel(model, provider) {
  const id = String(model == null ? '' : model).trim();
  if (!id) return '';
  const name = normalizeProvider(provider);
  if (!name) return id;
  const head = id.split(':', 1)[0].toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PROVIDERS, head)) return id;
  return `${name}:${id}`;
}

// ---------------------------------------------------------------------------
// Server invocation
// ---------------------------------------------------------------------------

/** Permission modes `openworker-server --mode` accepts. */
const SERVER_MODES = ['plan', 'interactive', 'auto', 'bypass-approvals', 'auto-approve'];

/**
 * The mode the server runs a turn under.
 *
 * `interactive` — OpenWorker's own default — means "ask a human before every
 * consequential tool call", which in a workspace with no human at the socket is
 * a turn that stalls until the watchdog kills it. The workspace's plan mode maps
 * onto OpenWorker's read-only `plan`; everything else runs under the configured
 * mode, defaulting to `bypass-approvals` (its hard floors still hold, and
 * `promptReply` answers whatever gets through them).
 */
function resolveServerMode(workspaceMode, configured) {
  if (workspaceMode === 'plan') return 'plan';
  const want = String(configured == null ? '' : configured).trim().toLowerCase();
  if (SERVER_MODES.includes(want)) return want;
  return 'bypass-approvals';
}

/** argv for `openworker-server`. */
function buildServerArgs({ host = '127.0.0.1', port, cwd, model, mode }) {
  const args = ['--host', String(host), '--port', String(port)];
  if (cwd) args.push('--cwd', String(cwd));
  if (model) args.push('--model', String(model));
  if (mode) args.push('--mode', String(mode));
  return args;
}

/**
 * The `secrets.json` OpenWorker reads provider profiles from.
 *
 * The API key is written as a `${VAR}` REFERENCE, never a literal: OpenWorker's
 * SecretStore resolves those from the server process's environment at read time,
 * so the key reaches the provider without ever landing on disk. `base_url` is
 * the one value with no env path in OpenWorker (its provider builders read it
 * from the profile only), which is the whole reason this file exists.
 *
 * Returns null when there is nothing worth writing, so the caller can leave an
 * existing state dir alone.
 */
function buildSecretsProfiles({ provider, keyRefVar, baseUrl }) {
  const name = normalizeProvider(provider) || DEFAULT_PROVIDER;
  const spec = PROVIDERS[name];
  const profile = {};
  if (spec && spec.needsKey && keyRefVar) profile.api_key = `\${${keyRefVar}}`;
  const url = String(baseUrl == null ? '' : baseUrl).trim();
  if (url) profile.base_url = url;
  if (Object.keys(profile).length === 0) return null;
  return { [`provider:${name}`]: profile };
}

/**
 * A stable 12-hex session id for a workspace channel.
 *
 * OpenWorker mints session ids as `uuid4().hex[:12]` and keys its on-disk
 * conversation store by them, so deriving ours from the channel identity (rather
 * than storing a mapping) is what makes a channel's history survive a daemon
 * restart — the same channel reconnects to the same server-side session.
 */
function sessionIdFor(workspaceId, agentName, channel) {
  return crypto
    .createHash('sha256')
    .update(`${workspaceId} ${agentName} ${channel}`)
    .digest('hex')
    .slice(0, 12);
}

/** The session WebSocket URL, with the workspace folder and agent as query. */
function sessionUrl({ host = '127.0.0.1', port, sessionId, workspace, agent = 'code' }) {
  const url = new URL(`ws://${host}:${port}/ws/session/${encodeURIComponent(sessionId)}`);
  if (workspace) url.searchParams.set('workspace', workspace);
  if (agent) url.searchParams.set('agent', agent);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Event interpretation
// ---------------------------------------------------------------------------

/** The prompt frames that block a turn until they are answered. */
const PROMPT_EVENTS = {
  permission_required: 'approval',
  directory_requested: 'directory',
  tool_requested: 'tool',
  plan_proposed: 'plan',
  question_requested: 'question',
  team_proposed: 'team',
  items_proposed: 'items',
};

/** Frames that carry no information we act on (progress noise, bookkeeping). */
const IGNORED_EVENTS = new Set([
  'assistant_delta',
  'reasoning_delta',
  'turn_start',
  'iteration_end',
  'compacting',
  'compacted',
  'tool_proposed',
]);

/**
 * Normalise one server frame into something the adapter can switch on.
 *
 * Deliberately total: an unrecognised `type` comes back as `unknown` rather than
 * throwing or being silently dropped, so an upstream addition shows up in the
 * log instead of turning into a stalled turn.
 */
function interpretEvent(frame) {
  if (!frame || typeof frame !== 'object') return { kind: 'unknown', raw: String(frame) };
  const type = typeof frame.type === 'string' ? frame.type : '';
  const data = frame.data && typeof frame.data === 'object' ? frame.data : {};

  if (type === 'ready') {
    return {
      kind: 'ready',
      sessionId: str(data.session_id),
      model: str(data.model),
      mode: str(data.mode),
      workspace: str(data.workspace),
      running: !!data.running,
    };
  }
  if (type === 'assistant_message') {
    return { kind: 'text', text: str(data.text), toolCalls: Array.isArray(data.tool_calls) ? data.tool_calls : [] };
  }
  if (type === 'tool_started') return { kind: 'tool', phase: 'started', name: str(data.name) };
  if (type === 'tool_finished') {
    return {
      kind: 'tool',
      phase: 'finished',
      name: str(data.name),
      status: str(data.status),
      reason: str(data.reason),
    };
  }
  if (type === 'turn_end') return { kind: 'turn_end', status: str(data.status) };
  if (type === 'turn_done') return { kind: 'done' };
  if (type === 'interrupted') return { kind: 'interrupted' };
  if (type === 'error') return { kind: 'error', message: str(data.error) || 'the model call failed', errorType: str(data.error_type) };
  if (type === 'input_rejected') return { kind: 'rejected', message: str(data.error) || 'the server rejected the message' };
  if (type === 'mode_notice' || type === 'model_changed') {
    return { kind: 'notice', text: str(data.text) || str(data.title) };
  }
  if (Object.prototype.hasOwnProperty.call(PROMPT_EVENTS, type)) {
    return { kind: 'prompt', prompt: PROMPT_EVENTS[type], data };
  }
  if (IGNORED_EVENTS.has(type)) return { kind: 'ignore', type };
  return { kind: 'unknown', type, raw: truncate(safeJson(frame), 300) };
}

/** A short, human label for the live status ticker. */
function toolLabel(name) {
  const map = {
    run_shell: 'running a command',
    shell_task_output: 'reading command output',
    shell_task_kill: 'stopping a command',
    read_file: 'reading a file',
    write_file: 'writing a file',
    edit_file: 'editing a file',
    list_directory: 'listing files',
    search: 'searching',
    web_fetch: 'fetching a page',
    web_search: 'searching the web',
    git_status: 'checking git status',
    git_diff: 'reading a diff',
    todo_write: 'updating its plan',
  };
  const key = String(name || '').trim();
  return map[key] || (key ? `${key}...` : 'working...');
}

// ---------------------------------------------------------------------------
// Answering the prompts
// ---------------------------------------------------------------------------

/** The canned answer to `ask_user`, since no human is on this socket. */
const QUESTION_ANSWER =
  'No one is available to answer interactively. Choose the most reasonable option, ' +
  'proceed, and state the assumption you made in your final reply.';

/**
 * True when `target` is inside (or equal to) `root`.
 *
 * Compared on resolved paths with a trailing separator so `/repo-backup` is not
 * read as living inside `/repo`. Case is preserved — a case-insensitive match
 * would grant more than the user asked for on Linux.
 */
function isInside(root, target) {
  if (!root || !target) return false;
  const base = path.resolve(root);
  const full = path.resolve(target);
  if (base === full) return true;
  return full.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}

/**
 * The frame that answers a blocking prompt.
 *
 * Every branch returns something. A prompt left unanswered suspends the turn
 * indefinitely (the engine awaits an Inbox resolution), so "we don't know what
 * this is" has to mean "decline", never "ignore".
 */
function promptReply(event, { planMode = false, workingDir = '', allowToolInstall = false } = {}) {
  if (!event || event.kind !== 'prompt') return null;
  const data = event.data || {};

  switch (event.prompt) {
    case 'approval':
      // `once` — never `always_*`. A standing rule minted on the agent's behalf
      // would outlive this turn and widen what a later, unrelated message may do.
      return { type: 'approval', decision: planMode ? 'deny' : 'once' };

    case 'directory': {
      // The agent is asking to reach outside its workspace root. Grant only what
      // is already inside the working directory it was given (a redundant ask,
      // which does happen) and decline the rest: widening an unattended agent's
      // filesystem reach is exactly the decision a human is supposed to make.
      const requested = str(data.path);
      const granted = !planMode && isInside(workingDir, requested);
      return {
        type: 'directory_response',
        granted,
        path: requested,
        writable: granted ? !!data.writable : false,
      };
    }

    case 'tool':
      // `request_tool` installs a pinned third-party binary. Declining is a
      // first-class outcome upstream — the agent is told to fall back and say so
      // — which is a better default than installing software unattended.
      return { type: 'tool_response', approved: !!allowToolInstall && !planMode };

    case 'plan':
      // In plan mode the plan IS the deliverable: approving would flip the live
      // session out of read-only and let it start editing. Decline with the
      // reason so the agent finishes by writing the plan out.
      return planMode
        ? {
            type: 'plan_response',
            approved: false,
            feedback:
              'This workspace channel is in plan mode. Do not execute the plan — ' +
              'reply with it as your final answer.',
          }
        : { type: 'plan_response', approved: true, mode: 'bypass-approvals' };

    case 'question':
      return { type: 'question_response', answer: QUESTION_ANSWER };

    case 'team':
      // `propose_team` pre-spawns worker sessions, each burning its own tokens.
      // That is a spend decision, and nobody is here to make it.
      return {
        type: 'team_response',
        approved: false,
        feedback:
          'Running unattended in an OpenAgents workspace — do the work in this session ' +
          'instead of staffing a team.',
      };

    case 'items':
      // Board bookkeeping only: approving creates work items and unblocks the turn.
      return { type: 'items_response', approved: true, feedback: '' };

    default:
      return null;
  }
}

/** A one-line description of a prompt, for the channel's status ticker. */
function promptSummary(event) {
  if (!event || event.kind !== 'prompt') return '';
  const d = event.data || {};
  switch (event.prompt) {
    case 'approval':
      return `approving \`${str(d.name) || 'a tool call'}\``;
    case 'directory':
      return `asked for access to ${str(d.path) || 'a folder'}`;
    case 'tool':
      return `asked to install ${str(d.tool) || 'a tool'}`;
    case 'plan':
      return 'proposed a plan';
    case 'question':
      return `asked: ${truncate(str(d.question) || str(d.header), 200)}`;
    case 'team':
      return 'proposed a team of sub-agents';
    case 'items':
      return 'proposed work items';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Spawning the server
// ---------------------------------------------------------------------------

/**
 * Shape the command and args for spawning the server binary.
 *
 * `uv tool install` lands an `openworker-server.exe` on Windows, which spawns
 * directly — but a PATH lookup or OPENWORKER_SERVER_BIN can just as easily hand
 * back a `.cmd`/`.bat` wrapper, and Node REFUSES to spawn one of those without a
 * shell (EINVAL, since the CVE-2024-27980 hardening). That throw is synchronous,
 * so it surfaced as a server that "stopped (exit code undefined)" with no
 * output — an unfixable-looking error for what is really a wrapper script.
 *
 * The fix is `cmd.exe /c <bin> <args…>` passed as a real argv array. NOT
 * `shell: true`: that concatenates the args into one command line, so the first
 * state directory containing a space would break the launch.
 *
 * @param {string} bin
 * @param {string[]} [args]
 * @param {string} [platform]
 * @returns {{command: string, args: string[]}}
 */
function serverSpawnCommand(bin, args = [], platform = process.platform) {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(String(bin || ''))) {
    return { command: 'cmd.exe', args: ['/c', bin, ...args] };
  }
  return { command: bin, args: [...args] };
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/**
 * Turn a dead/unusable server into a sentence the user can act on.
 *
 * OpenWorker publishes no exit-code contract, so unlike the CLI adapters this
 * reads the startup output. The three cases below are the ones that actually
 * happen on a fresh machine, and each has a different fix.
 */
function classifyServerFailure({ code, signal, stderr = '', spawnError = '' } = {}) {
  const text = `${spawnError}\n${stderr}`;
  if (/ModuleNotFoundError|No module named/i.test(text)) {
    return {
      kind: 'broken_install',
      message:
        'The OpenWorker install is incomplete (a Python dependency is missing). ' +
        'Reinstall it with: uv tool install --force git+https://github.com/andrewyng/openworker',
    };
  }
  if (/Address already in use|EADDRINUSE/i.test(text)) {
    return { kind: 'port_busy', message: 'The OpenWorker server could not bind a local port. Try again in a moment.' };
  }
  if (/ENOENT|not found|is not recognized/i.test(text)) {
    return {
      kind: 'not_installed',
      message:
        'openworker-server was not found. Install OpenWorker with: ' +
        'uv tool install git+https://github.com/andrewyng/openworker',
    };
  }
  // A spawn that never produced a process has no exit code to report, and
  // saying "exit code undefined" hides the one string that explains it.
  if (spawnError) {
    return {
      kind: 'spawn_failed',
      message: `The OpenWorker server could not be started (${truncate(redactSecrets(String(spawnError)).trim(), 200)}).`,
    };
  }
  const how = signal ? `signal ${signal}` : `exit code ${code}`;
  return {
    kind: 'crashed',
    message: `The OpenWorker server stopped (${how}). ${truncate(redactSecrets(stderr).trim(), 400) || 'No output was captured.'}`,
  };
}

/** A missing/unusable model key, phrased for the provider actually configured. */
function missingKeyMessage(provider) {
  const name = normalizeProvider(provider) || DEFAULT_PROVIDER;
  const envKey = providerKeyEnv(name);
  if (name === 'ollama') {
    return 'Ollama is selected but no server answered. Start `ollama serve`, or set OPENWORKER_BASE_URL to where it is listening.';
  }
  if (name === 'openai-codex') {
    return (
      'The ChatGPT-subscription provider needs a sign-in OpenWorker performs in a browser. ' +
      'Sign in with the OpenWorker desktop app, then point OPENWORKER_STATE_DIR at its state ' +
      'directory (with the app closed).'
    );
  }
  return `No API key for the "${name}" provider — set OPENWORKER_API_KEY (it is passed to OpenWorker as ${envKey}).`;
}

// ---------------------------------------------------------------------------
// Small shared utilities
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9._-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi,
  /\b(api[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}["']?/gi,
];

/** Redact obvious secret material from free text before it is logged or shown. */
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

function str(v) {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

module.exports = {
  PROVIDERS,
  DEFAULT_PROVIDER,
  SERVER_MODES,
  QUESTION_ANSWER,
  normalizeProvider,
  providerKeyEnv,
  qualifyModel,
  resolveServerMode,
  buildServerArgs,
  buildSecretsProfiles,
  sessionIdFor,
  sessionUrl,
  interpretEvent,
  toolLabel,
  promptReply,
  promptSummary,
  isInside,
  serverSpawnCommand,
  classifyServerFailure,
  missingKeyMessage,
  redactSecrets,
  truncate,
};

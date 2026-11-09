'use strict';

/**
 * Pure helpers for KiroAdapter (kiro.js): everything that can be decided
 * without a process, a socket or adapter state, so each rule is unit-tested
 * on its own (test/kiro-runtime.test.js).
 *
 * The adapter drives `kiro-cli acp` — Kiro CLI's Agent Client Protocol server,
 * JSON-RPC 2.0 over stdio — instead of scraping a TUI. The facts below were
 * read off kiro-cli 2.37.0 with a recording client, not taken from docs:
 *
 *   - `initialize` answers protocolVersion 1 with loadSession: true and
 *     mcpCapabilities { http: true, sse: false } (stdio servers are always on).
 *   - `session/new { cwd, mcpServers }` starts the servers it is handed NEXT TO
 *     the ones the selected Kiro agent profile declares (`--agent <name>`), so
 *     the workspace tools and the agent's own tools coexist.
 *   - `session/load` replays the transcript as ordinary session/update frames
 *     tagged `_meta.kiro.replay: true` before it answers. They are history,
 *     not this turn's output, and must not reach the channel.
 *   - A session id the CLI no longer has fails session/load with JSON-RPC
 *     -32603 and data "Failed to start session: Session not found: <id>".
 *   - Without `--trust-all-tools` every tool call that needs approval arrives
 *     as a `session/request_permission` request offering allow_once /
 *     allow_always / reject_once; the tool_call update that precedes it
 *     carries the tool's `kind` and `_meta.kiro.mcpServerName`.
 *   - `session/cancel` ends the prompt with stopReason "cancelled".
 *   - An unknown `--agent` does not fail: the CLI sends
 *     `_kiro.dev/agent/not_found` and silently runs its default agent.
 *   - Narration before a tool call streams as agent_message_chunk exactly like
 *     the answer does; only the text after the LAST tool call is the reply.
 *   - Vendor notifications live under `_kiro.dev/` and carry nothing a
 *     channel needs.
 */

const { redactSecrets } = require('./utils');

/** The CLI binary the official installers put on PATH. */
const KIRO_BINARY = 'kiro-cli';

/** The version every claim above was verified against. */
const KIRO_MIN_VERSION = '2.37.0';

/** ACP protocol version this client speaks. */
const ACP_PROTOCOL_VERSION = 1;

/** Name the workspace MCP server is registered under, same as every adapter. */
const WORKSPACE_MCP_NAME = 'openagents-workspace';

/** ACP tool kinds that never change anything — allowed in plan mode. */
const READ_ONLY_KINDS = new Set(['read', 'search', 'think', 'fetch']);

function installHint(platform = process.platform) {
  return platform === 'win32'
    ? 'irm https://cli.kiro.dev/install.ps1 | iex'
    : 'curl -fsSL https://cli.kiro.dev/install | bash';
}

/** "kiro-cli 2.37.0" → [2, 37, 0]; null when there is no version in it. */
function parseKiroVersion(text) {
  const m = String(text || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * `--version` output → { version, supported }. supported is null when the
 * output names no version (the adapter proceeds leniently rather than block
 * an agent on a probe it cannot read).
 */
function classifyKiroVersion(text, min = KIRO_MIN_VERSION) {
  const parsed = parseKiroVersion(text);
  if (!parsed) return { version: null, supported: null };
  return {
    version: parsed.join('.'),
    supported: compareVersions(parsed, parseKiroVersion(min)) >= 0,
  };
}

/**
 * The Kiro agent profile and model this agent runs, from its env. A model
 * picked in the workspace wins over the one saved for the agent.
 *
 * KIRO_AGENT names a profile in <workingDir>/.kiro/agents or
 * ~/.kiro/agents — that profile carries the agent's own prompt, tools and MCP
 * servers, which is how one machine runs several distinct Kiro agents.
 */
function resolveKiroSettings(env = {}, workspaceModel = null) {
  const clean = (v) => {
    const s = String(v || '').trim();
    return s || null;
  };
  return {
    agent: clean(env.KIRO_AGENT),
    model: clean(workspaceModel) || clean(env.KIRO_MODEL) || clean(env.LLM_MODEL),
  };
}

/**
 * argv for one `kiro-cli acp` server. No `--trust-all-tools`: approvals are
 * answered by the adapter, which is what lets plan mode refuse writes.
 * The agent and model names are passed through as single argv entries and
 * never reach a shell.
 */
function buildKiroArgs({ agent = null, model = null } = {}) {
  const args = ['acp'];
  if (agent) args.push('--agent', agent);
  if (model) args.push('--model', model);
  return args;
}

/**
 * The ACP stdio form of an MCP server: env is a list of {name, value}, not
 * an object. Values travel to Kiro over stdin in the JSON-RPC message; they are
 * never in argv or written to disk by OpenAgents (Kiro may persist them).
 */
function toAcpMcpServer(name, { command, args = [], env = {} }) {
  return {
    name,
    command,
    args: [...args],
    env: Object.entries(env)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => ({ name: k, value: String(v) })),
  };
}

/** Text out of an ACP content block (or a tool_call content entry). */
function contentText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (content.type === 'text') return String(content.text || '');
  if (content.type === 'content' && content.content) return contentText(content.content);
  return '';
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

/**
 * A short label for a tool call. Kiro titles MCP calls "Running: @server/tool"
 * and shell calls "Running: <command>"; the label keeps the tool and what it
 * is doing without saying either twice.
 */
function toolLabel(update, meta) {
  const name = meta.toolName || '';
  const title = String(update.title || '').replace(/^Running:\s*/i, '').trim();
  const mcp = title.match(/^@([^/\s]+)\/(\S+)$/);
  if (mcp) return `${mcp[1]} › ${mcp[2]}`;
  if (!name) return title || 'tool';
  if (!title || title === name) return name;
  return `${name} › ${title}`;
}

/**
 * One `session/update` notification → a small event the adapter can act on.
 *
 *   { kind: 'replay' }                 — history from session/load; ignore
 *   { kind: 'message', text }          — reply/narration chunk
 *   { kind: 'thought', text }          — reasoning chunk
 *   { kind: 'tool_start', id, label, toolKind, server }
 *   { kind: 'tool_end', id, failed, denied }
 *   { kind: 'plan', todos }            — the agent's plan, workspace todo shape
 *   { kind: 'ignore' }
 */
function interpretUpdate(params, secrets = []) {
  const update = (params && params.update) || {};
  const meta = (update._meta && update._meta.kiro) || {};
  if (meta.replay) return { kind: 'replay' };

  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return { kind: 'message', text: contentText(update.content) };
    case 'agent_thought_chunk':
      return { kind: 'thought', text: contentText(update.content) };
    case 'tool_call': {
      const label = redactSecrets(truncate(toolLabel(update, meta), 160), secrets);
      return {
        kind: 'tool_start',
        id: update.toolCallId || null,
        label,
        toolKind: update.kind || 'other',
        server: meta.mcpServerName || null,
      };
    }
    case 'tool_call_update': {
      const status = update.status;
      if (status !== 'completed' && status !== 'failed') return { kind: 'ignore' };
      return {
        kind: 'tool_end',
        id: update.toolCallId || null,
        failed: status === 'failed',
        denied: meta.toolCallFailureReason === 'permission_denied',
      };
    }
    case 'plan': {
      const entries = Array.isArray(update.entries) ? update.entries : [];
      const todos = entries
        .map((e) => ({
          content: redactSecrets(String((e && e.content) || '').trim(), secrets),
          status: ['pending', 'in_progress', 'completed'].includes(e && e.status) ? e.status : 'pending',
        }))
        .filter((t) => t.content);
      return { kind: 'plan', todos };
    }
    default:
      return { kind: 'ignore' };
  }
}

/**
 * Answer a `session/request_permission`. In execute mode the agent runs
 * headless, so every call is allowed once (never "always": that would
 * persist trust into the user's Kiro settings). In plan mode only tools that
 * change nothing, and the workspace's own tools, are allowed.
 *
 * Plan mode can only refuse tools Kiro asks permission for: tools in the
 * profile's `allowedTools`, or that Kiro trusts by default, never reach this
 * gate and bypass it — keep allowedTools empty/read-only for agents you use
 * in plan mode.
 *
 * `known` is what the preceding tool_call said about this call
 * ({ toolKind, server }), since the request itself may not repeat it.
 */
function permissionOutcome(params, { mode = 'execute', known = null } = {}) {
  const options = (params && Array.isArray(params.options)) ? params.options : [];
  const pick = (...kinds) => {
    for (const k of kinds) {
      const o = options.find((opt) => opt && opt.kind === k);
      if (o) return o.optionId;
    }
    return null;
  };
  const allowId = pick('allow_once', 'allow_always');
  const rejectId = pick('reject_once', 'reject_always');

  let allow = true;
  if (mode === 'plan') {
    const toolKind = (params && params.toolCall && params.toolCall.kind) || (known && known.toolKind) || 'other';
    const server = known && known.server;
    allow = READ_ONLY_KINDS.has(toolKind) || server === WORKSPACE_MCP_NAME;
  }

  const optionId = allow ? allowId : rejectId;
  if (!optionId) return { outcome: { outcome: 'cancelled' } };
  return { outcome: { outcome: 'selected', optionId } };
}

/** True when a JSON-RPC error says the session id is unknown to the CLI. */
function isStaleSessionError(error) {
  if (!error) return false;
  const text = `${error.message || ''} ${typeof error.data === 'string' ? error.data : JSON.stringify(error.data || '')}`;
  return /session not found|no session found/i.test(text);
}

/** Flatten a JSON-RPC error into one line of text for classification. */
function rpcErrorText(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  const data = typeof error.data === 'string' ? error.data : (error.data ? JSON.stringify(error.data) : '');
  return [error.message, data].filter(Boolean).join(': ');
}

/** What each failure kind should tell the user to do, in Kiro's terms. */
const KIRO_GUIDANCE = {
  auth: 'Kiro CLI is not signed in on this machine. Run `kiro-cli login` (or `agn login kiro`), or set KIRO_API_KEY for this agent.',
  quota: 'Kiro reported a usage or rate limit for this account. Wait and try again, or check your Kiro plan.',
  model: 'Kiro rejected the requested model. Pick another one (`kiro-cli chat --list-models`) or clear the model for this agent.',
  network: 'Kiro CLI could not reach its service from this device. Check the network or proxy.',
  session: "Kiro could not resume this channel's previous session.",
};

/**
 * A `--agent` profile the CLI could not find. Kiro does NOT fail on it: it
 * announces `_kiro.dev/agent/not_found { requestedAgent, fallbackAgent }` and
 * carries on as its default agent — without the profile's prompt, tools or
 * MCP servers. The adapter refuses the turn instead of letting an agent run
 * as someone else.
 */
function agentNotFoundMessage(params, fallbackAgent) {
  const requested = (params && params.requestedAgent) || fallbackAgent || 'the configured agent';
  return `Kiro agent profile "${requested}" was not found, so this turn was not run `
    + `(Kiro would have fallen back to "${(params && params.fallbackAgent) || 'its default agent'}", `
    + "without that profile's prompt, tools or MCP servers). Create it in "
    + `<working dir>/.kiro/agents/${requested}.json or ~/.kiro/agents, or clear KIRO_AGENT for this agent.`;
}

module.exports = {
  KIRO_BINARY,
  KIRO_MIN_VERSION,
  ACP_PROTOCOL_VERSION,
  WORKSPACE_MCP_NAME,
  READ_ONLY_KINDS,
  KIRO_GUIDANCE,
  installHint,
  parseKiroVersion,
  compareVersions,
  classifyKiroVersion,
  resolveKiroSettings,
  buildKiroArgs,
  toAcpMcpServer,
  contentText,
  toolLabel,
  truncate,
  interpretUpdate,
  permissionOutcome,
  isStaleSessionError,
  rpcErrorText,
  agentNotFoundMessage,
};

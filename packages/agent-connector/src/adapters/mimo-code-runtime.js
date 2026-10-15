/**
 * Pure helpers for MiMoCodeAdapter: which provider and model a run goes to,
 * the per-run config handed to the CLI, the process-tree walk Stop needs, and
 * reading the CLI's own error output. No I/O here — the adapter supplies the
 * environment, the process table and the CLI's output.
 *
 * Verified against MiMo Code 0.1.14 and 0.1.15.
 */

'use strict';

/** MiMo's own OpenAI-compatible API — where a form key goes when no base URL is given. */
const MIMO_DEFAULT_BASE_URL = 'https://api.xiaomimimo.com/v1';

/**
 * The model MiMo Code itself selects after a Xiaomi sign-in, and so what a run
 * on MiMo's API uses when no model is configured.
 */
const MIMO_DEFAULT_MODEL = 'mimo-v2.5-pro';

/**
 * MiMo Code's built-in provider for MiMo's API. Routing a MiMo key through it,
 * rather than through a provider we declare, keeps what the CLI's catalog knows
 * about each model: its context window, and that its reasoning has to be sent
 * back between tool calls.
 */
const XIAOMI_PROVIDER = 'xiaomi';

/** The provider declared for any other OpenAI-compatible endpoint. */
const CUSTOM_PROVIDER = 'openagents';

/** Name of the workspace MCP server; MiMo names its tools `<server>_<tool>`. */
const MCP_SERVER_NAME = 'openagents-workspace';

/** True for MiMo's API and its Token Plan endpoints (token-plan-<region>.xiaomimimo.com). */
function isMimoHost(baseUrl) {
  let host = '';
  try { host = new URL(String(baseUrl || '').trim()).hostname.toLowerCase(); } catch { return false; }
  return host === 'xiaomimimo.com' || host.endsWith('.xiaomimimo.com');
}

/**
 * Where one run goes.
 *
 * With an API key in the agent's configuration (LLM_API_KEY) the run uses that
 * key and nothing else: the base URL defaults to MiMo's API, a MiMo endpoint
 * runs on the built-in `xiaomi` provider and any other on a provider declared
 * for this run. The model id is sent upstream as written — a gateway's
 * `vendor/model` ids included — except that a `xiaomi/` prefix on a MiMo
 * endpoint only repeats the provider and is dropped.
 *
 * Without a key the run uses MiMo Code's own credential: a Xiaomi sign-in
 * (`mimo providers login`) or XIAOMI_API_KEY. A model written `provider/model`
 * then names a provider the user set up in MiMo Code and is taken as given.
 *
 * The workspace's model choice, when there is one, replaces LLM_MODEL.
 */
function resolveMimoRoute(env = {}, workspaceModel = null) {
  const val = (k) => (env[k] == null ? '' : String(env[k])).trim();
  const apiKey = val('LLM_API_KEY');
  const requested = String(workspaceModel || '').trim() || val('LLM_MODEL');

  if (apiKey) {
    const baseURL = val('LLM_BASE_URL') || MIMO_DEFAULT_BASE_URL;
    const providerId = isMimoHost(baseURL) ? XIAOMI_PROVIDER : CUSTOM_PROVIDER;
    let model = requested;
    if (providerId === XIAOMI_PROVIDER && model.toLowerCase().startsWith(`${XIAOMI_PROVIDER}/`)) {
      model = model.slice(XIAOMI_PROVIDER.length + 1);
    }
    if (!model && providerId === XIAOMI_PROVIDER) model = MIMO_DEFAULT_MODEL;
    return {
      mode: 'key',
      providerId,
      model,
      modelRef: model ? `${providerId}/${model}` : '',
      baseURL,
      apiKey,
    };
  }

  let providerId = XIAOMI_PROVIDER;
  let model = requested || MIMO_DEFAULT_MODEL;
  const slash = model.indexOf('/');
  if (slash > 0) {
    providerId = model.slice(0, slash);
    model = model.slice(slash + 1);
  }
  return { mode: 'signin', providerId, model, modelRef: `${providerId}/${model}`, baseURL: '', apiKey: '' };
}

/**
 * The config one run is started with, passed as MIMOCODE_CONFIG_CONTENT. MiMo
 * loads it after the user's global and project config, so what it sets wins;
 * MiMo also keeps that variable out of the environment of the commands its
 * tools run, which is why the key travels here and not as an env var.
 *
 * Routing is pinned to the one provider and model the route names. Without
 * that the user's own MiMo config reroutes parts of the run, under the user's
 * key for another provider: a `small_model` there received every session's
 * first message for titling, and a subagent ran on the user's
 * `agent.general.model`. Providers MiMo picks up from the environment
 * (DASHSCOPE_API_KEY, XIAOMI_API_KEY, …) or its auth.json would likewise stay
 * available to a model the agent names itself — the subagent tool takes a
 * `provider/model` or a model group. Arrays in MiMo's config replace rather
 * than merge, so the provider lists are exactly ours; anything still naming
 * another provider fails instead of leaving.
 *
 * `instructions`, unlike other arrays, MiMo concatenates with the user's own —
 * the workspace briefing is added to them, not swapped in for them.
 */
function buildMimoRunConfig(route, { mcp = null, instructions = [] } = {}) {
  const ref = route.modelRef;
  const config = {
    enabled_providers: [route.providerId],
    disabled_providers: [],
    model: ref,
    small_model: ref,
    model_groups: { lite: ref, standard: ref, ultra: ref },
    agent: { general: { model: ref }, explore: { model: ref } },
  };

  if (route.mode === 'key') {
    // `id` is set explicitly: a model entry of the same name in the user's own
    // provider config could otherwise rename what is sent upstream. `headers`
    // is cleared for the same reason — objects merge, so headers the user set
    // on this provider were sent with every request, and an `Authorization`
    // among them replaced the agent's key.
    const models = { [route.model]: { id: route.model, name: route.model } };
    const options = { baseURL: route.baseURL, apiKey: route.apiKey, headers: null };
    config.provider = {
      [route.providerId]: route.providerId === XIAOMI_PROVIDER
        ? { options, models }
        : { npm: '@ai-sdk/openai-compatible', name: 'OpenAgents', options, models },
    };
  }

  if (mcp && mcp.command) {
    config.mcp = {
      [MCP_SERVER_NAME]: {
        type: 'local',
        command: [mcp.command, ...(mcp.args || [])],
        environment: mcp.env || {},
      },
    };
  }

  const files = (instructions || []).filter(Boolean);
  if (files.length) config.instructions = files;
  return config;
}

/**
 * The CLI's `run` arguments. A new session gets a title of ours: without one
 * MiMo asks the model to write it, which is a second request carrying the
 * user's first message. Plan mode is MiMo's own `plan` agent, whose edit ban
 * the permission bypass does not lift.
 */
function buildMimoRunArgs({ runCwd, model, sessionId = null, title = '', plan = false } = {}) {
  const args = ['run', '--format', 'json', '--dangerously-skip-permissions', '--dir', runCwd, '--model', model];
  if (plan) args.push('--agent', 'plan');
  if (sessionId) args.push('--session', sessionId);
  else if (title) args.push('--title', title);
  return args;
}

/**
 * Every descendant of `rootPid` in a process table of { pid, ppid, pgid } rows,
 * nearest first. MiMo runs each shell command in its own session, so these are
 * not in the CLI's process group, and once the CLI is gone they are reparented
 * — the table has to be read while it is still alive.
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

/**
 * The line that matters in the CLI's stderr. A failure that is not an API
 * error (no credential, an unknown session) prints a chunk of the CLI's bundled
 * source and a stack trace, then exits 0; classifying that source text would
 * find "network" or "timeout" in someone's variable names, so only the error
 * line itself is read: `error: <message>`, or a named error's `message: "…"`.
 */
function mimoErrorLine(stderr) {
  const text = String(stderr || '');
  const plain = text.match(/^\s*error:\s*(.+)$/gm);
  if (plain) return plain[plain.length - 1].replace(/^\s*error:\s*/, '').trim();
  const named = text.match(/^([A-Z][A-Za-z]*Error):[^\n]*\n(?:\s*data:\s*\{\s*\n)?\s*message:\s*"([^"\n]*)"/m);
  if (named) return `${named[1]}: ${named[2]}`;
  return '';
}

/** True when the CLI refused `--session` because it has no such session. */
function isMissingSession(stderr) {
  return /Session not found/i.test(String(stderr || ''));
}

module.exports = {
  MIMO_DEFAULT_BASE_URL,
  MIMO_DEFAULT_MODEL,
  XIAOMI_PROVIDER,
  CUSTOM_PROVIDER,
  MCP_SERVER_NAME,
  isMimoHost,
  resolveMimoRoute,
  buildMimoRunConfig,
  buildMimoRunArgs,
  descendantsOf,
  parseProcessTable,
  mimoErrorLine,
  isMissingSession,
};

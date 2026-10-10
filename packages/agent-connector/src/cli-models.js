'use strict';

/**
 * Ask an agent's own CLI which models the account it is signed in to can run.
 *
 * An agent on a subscription sign-in (`codex login`, `claude login`) has no
 * endpoint to list and no key to list one with, so the workspace's model
 * picker offered it the vendor line-up from the provider catalog: a list kept
 * by hand, which lagged what the account was actually offered. The CLI knows
 * the real list, and that list differs with the CLI's version too (an older
 * Codex is not offered the newest models), which is why it is asked on the
 * device, of the binary the agent runs.
 *
 * Neither CLI documents a stable way to ask, so nothing here throws: a CLI
 * that will not answer leaves the caller on the catalog list.
 */

const os = require('os');
// spawn() here is the WSL bridge from ./wsl: same signature as
// child_process.spawn, and a straight pass-through unless the resolved CLI
// lives on the other side of the Windows/WSL boundary.
const { spawn } = require('./wsl');
const { getEnhancedEnv } = require('./paths');
const { shouldUseShellForBinary } = require('./adapters/health-status');
const { stripForCliLogin, typeEnvFor } = require('./env');

const MAX_MODELS = 100;

/**
 * `codex debug models`: the catalog the CLI was served for this account and
 * this CLI version, internal entries included. Only the ones its own picker
 * lists are kept, in the picker's order.
 */
function parseCodexModels(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return []; }
  const list = parsed && Array.isArray(parsed.models) ? parsed.models : [];
  const priority = (m) => (Number.isFinite(m.priority) ? m.priority : Number.MAX_SAFE_INTEGER);
  const seen = new Map();
  list
    .filter((m) => m && typeof m.slug === 'string' && m.slug.trim() && m.visibility === 'list')
    .map((m, index) => ({ m, index }))
    .sort((a, b) => (priority(a.m) - priority(b.m)) || (a.index - b.index))
    .forEach(({ m }) => {
      const id = m.slug.trim();
      if (seen.has(id)) return;
      const label = typeof m.display_name === 'string' ? m.display_name.trim() : '';
      seen.set(id, { id, label: label || id });
    });
  return [...seen.values()].slice(0, MAX_MODELS);
}

/**
 * "Sonnet 5" rather than "Sonnet": the picker's display name is the alias,
 * and its description leads with the model that alias stands for today
 * ("Sonnet 5 · Efficient for routine tasks").
 */
function claudeLabel(m) {
  const name = typeof m.displayName === 'string' ? m.displayName.trim() : '';
  const description = typeof m.description === 'string' ? m.description : '';
  const lead = description.includes(' · ') ? description.split(' · ')[0].trim() : '';
  return lead && lead.length <= 48 ? lead : name;
}

/**
 * The stream-json output of a Claude Code run that was sent one `initialize`
 * control request: the reply carries the CLI's /model picker, as the values
 * `--model` takes.
 */
function parseClaudeModels(text) {
  let models = null;
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let msg;
    try { msg = JSON.parse(trimmed); } catch { continue; }
    const reply = msg && msg.type === 'control_response' && msg.response;
    if (reply && reply.subtype === 'success' && reply.response && Array.isArray(reply.response.models)) {
      models = reply.response.models;
      break;
    }
  }
  const seen = new Map();
  for (const m of models || []) {
    const id = String((m && m.value) || '').trim();
    // "default" is the picker's "let the CLI decide", which the workspace
    // picker already offers as its own first entry.
    if (!id || id === 'default' || seen.has(id)) continue;
    seen.set(id, { id, label: claudeLabel(m) || id });
  }
  return [...seen.values()].slice(0, MAX_MODELS);
}

/**
 * How each CLI is asked. Claude Code has no command for it; its SDK control
 * protocol does, and a run that is sent the request and then end-of-input
 * answers and exits without a prompt ever reaching a model.
 */
const LISTERS = {
  codex: {
    args: ['debug', 'models'],
    parse: parseCodexModels,
    timeoutMs: 30_000,
  },
  claude: {
    args: ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
    input: `${JSON.stringify({ type: 'control_request', request_id: 'list-models', request: { subtype: 'initialize' } })}\n`,
    parse: parseClaudeModels,
    timeoutMs: 45_000,
  },
};

/** Whether this agent type's CLI can be asked for its account's models. */
function supportsCliModels(agentType) {
  return Object.prototype.hasOwnProperty.call(LISTERS, agentType);
}

/** Run a CLI to completion, optionally feeding it `input`. Never rejects. */
function runCli(binary, args, { env, timeoutMs, input, spawnImpl = spawn }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(binary, args, {
        env,
        cwd: os.homedir(),
        // Node refuses to spawn .cmd/.bat without a shell, the npm shims
        // these CLIs install as on Windows.
        shell: shouldUseShellForBinary(binary),
        windowsHide: true,
        stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ stdout: '', stderr: '', error: e.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch {}
    }, timeoutMs);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, error: error || (timedOut ? 'the CLI did not answer in time' : null) });
    };
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => finish(e.message));
    child.on('close', () => finish());
    if (input != null && child.stdin) {
      // A CLI that exits before reading must not take the caller down with EPIPE.
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}

/**
 * List the models an agent's CLI offers the account it runs on.
 *
 * @param {object} connector AgentConnector (registry/installer/env access)
 * @param {string} type      agent type name (registry entry name)
 * @param {object} [opts]    { agentEnv, timeoutMs, spawnImpl }
 * @returns {Promise<{type: string, ok: boolean, models: {id: string, label: string}[], error?: string}>}
 */
async function listCliModels(connector, type, opts = {}) {
  const fail = (error) => ({ type, ok: false, models: [], error });
  const lister = LISTERS[type];
  if (!lister) return fail(`The ${type} CLI cannot be asked for its models.`);

  let binary = null;
  try { binary = connector.installer.which(type); } catch {}
  if (!binary) return fail('Not installed');

  // The env the daemon runs this agent's CLI on (see probeAgentType): its
  // own env over the type's, and for a signed-in agent no key from either,
  // so the CLI answers for the sign-in and not for a key it is never given.
  let agentEnv = {};
  try {
    const typeEnv = typeEnvFor(type, connector.getAgentEnv(type) || {}, connector.registry, opts.agentEnv);
    const saved = { ...typeEnv, ...(opts.agentEnv || {}) };
    const resolved = connector.resolveAgentEnv(type, saved) || {};
    agentEnv = { ...saved, ...resolved };
  } catch {}
  const env = stripForCliLogin(type, { ...getEnhancedEnv(), ...agentEnv }, connector.registry, opts.agentEnv);

  const res = await runCli(binary, lister.args, {
    env,
    timeoutMs: opts.timeoutMs || lister.timeoutMs,
    input: lister.input,
    spawnImpl: opts.spawnImpl,
  });
  // A run killed for taking too long may still have answered: Claude Code
  // replies before it finishes starting up.
  const models = lister.parse(res.stdout);
  if (models.length) return { type, ok: true, models };
  return fail(res.error || 'The CLI listed no models.');
}

module.exports = { listCliModels, supportsCliModels, parseCodexModels, parseClaudeModels };

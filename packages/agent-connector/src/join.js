'use strict';

/**
 * `agn join <pairing-code>` — connect the agent this command runs inside of.
 *
 * Meant to be pasted into an agent a person already has open (Claude Code,
 * Codex, ...), which runs it with npx. In one step it:
 *   1. puts the launcher somewhere lasting (npx's cache is not),
 *   2. pairs this device with the workspace the code belongs to,
 *   3. creates a workspace agent of the same kind as the host, signed in the
 *      way the host is, and — for Claude Code — starting each new workspace
 *      thread from a copy of the host's conversation,
 *   4. turns on start-at-login and starts the daemon that runs it.
 * What it prints is written for the host agent to relay to its person.
 */

const os = require('os');
const path = require('path');

const nodeCfg = require('./node-config');
const { AUTH_MODE_KEY, CLI_LOGIN } = require('./env');
const { defaultAgentWorkdir } = require('./paths');
const {
  detectHostAgent, sandboxedHost, hostFreeEnv, hostAuthEnv,
  claudeConfigDir, findClaudeTranscript, pickOpencodeSession, opencodeSessionModel,
} = require('./host-agent');

/**
 * The OpenCode chat running this command: `{ session_id, directory, model }`,
 * or null. OpenCode exports no session id, so its session list is asked for
 * the newest session in this directory.
 */
function findOpencodeChat({ env, cwd, run }) {
  const json = (args) => {
    const r = run(args, { env, cwd });
    if (!r || r.status !== 0 || !r.stdout) return null;
    try { return JSON.parse(r.stdout); } catch { return null; }
  };
  const session = pickOpencodeSession(json(['session', 'list', '--format', 'json']), cwd);
  if (!session) return null;
  const exported = json(['export', session.id]);
  return { session_id: session.id, directory: session.directory, model: exported ? opencodeSessionModel(exported) : null };
}

function runOpencodeCli(args, { env, cwd }) {
  const { whichBinary } = require('./paths');
  const bin = whichBinary('opencode') || 'opencode';
  return require('child_process').spawnSync(bin, args, {
    env, cwd, encoding: 'utf-8', timeout: 30000, maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32' && /\.cmd$/i.test(bin), windowsHide: true,
  });
}

/**
 * Browser URL of a workspace, matching the TUI's convention: a localhost/dev
 * endpoint serves its own web app; everything else lives on the hosted
 * dashboard.
 */
function workspaceWebUrl(slug, endpoint) {
  const ep = String(endpoint || '');
  const isLocal = ep.includes('localhost') || ep.includes('127.0.0.1');
  return isLocal
    ? `${ep.replace(/\/+$/, '')}/${slug}`
    : `https://workspace.openagents.org/${slug}`;
}

/**
 * Redeem a pairing code and record the pairing: node.json, plus the workspace
 * as a network in daemon.yaml so agents on this device can use it.
 *
 * @returns {Promise<{ res: object, alreadyPaired: boolean }>}
 */
async function pairDevice(connector, code, info, priorPairings) {
  const res = await connector.redeemNodePairingCode(code, info);
  // A code always redeems against ONE workspace; if that workspace is one
  // this device already belongs to, this is a re-pair, not a new pairing.
  // recordPairing below still runs — it refreshes the (possibly rotated)
  // credential in place.
  const alreadyPaired = priorPairings.some((p) => p.node_id === res.nodeId);
  // recordPairing, not saveNode: this device can be a node in several
  // workspaces at once, and a bare save would drop the others' pairings.
  // Freeze legacy bindings before another owner adds a connection here.
  const prior = priorPairings.filter((p) => p.workspace_id === res.workspaceId);
  if (prior.length === 1) for (const agent of connector.config.getAgents()) {
    if (!agent.node_id && (agent.network === prior[0].workspace_slug || agent.network === prior[0].workspace_id))
      connector.config.updateAgent(agent.name, { node_id: prior[0].node_id });
  }
  nodeCfg.recordPairing(info.nodeKey, {
    node_id: res.nodeId,
    owner_email: res.ownerEmail,
    workspace_id: res.workspaceId,
    workspace_slug: res.workspaceSlug,
    workspace_name: res.workspaceName,
    endpoint: connector.workspace.endpoint,
    token: res.token,
  });
  connector.config.addNetwork({
    id: res.workspaceId,
    slug: res.workspaceSlug,
    name: res.workspaceName,
    endpoint: connector.workspace.endpoint,
    token: res.token,
  });
  return { res, alreadyPaired };
}

/**
 * `<type>-<host>`, lowercased, made unique among `taken`. A long host name
 * keeps its leading words up to 16 characters ("raphaels-macbook-pro" →
 * "raphaels-macbook").
 */
function defaultAgentName(type, hostname, taken) {
  const words = String(hostname || '').split('.')[0].toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let host = '';
  for (const w of words) {
    const next = host ? `${host}-${w}` : w;
    if (next.length > 16) break;
    host = next;
  }
  if (!host && words.length) host = words[0].slice(0, 16);
  const base = host ? `${type}-${host}` : type;
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
  return name;
}

const SERVICE_NAMES = { darwin: 'launchd', linux: 'systemd', win32: 'Task Scheduler' };

/**
 * @param {object} p
 * @param {string} p.code
 * @param {object} p.flags - name, type, path, autostart (false with --no-autostart)
 * @param {object} p.connector - AgentConnector
 * @param {object} [p.env]
 * @param {(line: string) => void} p.print
 * @param {object} [p.deps] - seams for tests: ensureDurableInstall, autostart, sleep, gatherDeviceInfo
 * @returns {Promise<number>} exit code
 */
async function join({ code, flags = {}, connector, env = process.env, print, deps = {} }) {
  const ensureDurable = deps.ensureDurableInstall || require('./durable-install').ensureDurableInstall;
  const autostart = deps.autostart || require('./autostart');
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const gatherInfo = deps.gatherDeviceInfo || nodeCfg.gatherDeviceInfo;

  if (!code) {
    print('Usage: agn join <pairing-code> [--name <agent-name>] [--type <agent-type>]');
    print('Run it from inside the agent you want to connect (Claude Code, Codex, ...).');
    print('Get a pairing code from your workspace: Connect an agent.');
    return 1;
  }

  // 1. Which agent is this? Decided before the code is used, so a refusal
  //    leaves it valid for another try.
  const detected = detectHostAgent(env);
  const type = flags.type || (detected && detected.type);
  if (!type) {
    print("Could not tell which agent this is running in: no Claude Code, Codex, CodeBuddy, Gemini CLI, OpenCode or Cursor session variables are set.");
    print('Run this from inside that agent, or name its type: agn join <code> --type <type>');
    print('To connect this machine without an agent, use: agn device connect <code>');
    return 1;
  }
  if (!connector.registry.getEntry(type)) {
    print(`Unknown agent type '${type}'. Run \`agn search\` to see the supported types.`);
    return 1;
  }
  const host = detected && detected.type === type ? detected : { type, label: type, sessionId: null };
  if (sandboxedHost(env)) {
    print(`This is running inside ${host.label}'s sandbox. A background service started from here would stay`);
    print('inside it, without network access, so nothing was changed and the code is still valid.');
    print('Run the same command again outside the sandbox (approve running it with full access).');
    return 1;
  }

  // 2. A lasting copy of the launcher, for the daemon and the login service.
  let durable = null;
  try {
    durable = ensureDurable({ nodeBin: process.execPath });
  } catch (e) {
    print(`Warning: could not install the launcher under ~/.openagents (${e.message}).`);
    print('The agent will run until this machine restarts; install it for good with: curl -fsSL https://openagents.org/install.sh | bash');
  }

  // 3. Pair this device, under a name for the agent that is free here.
  let info;
  try {
    info = gatherInfo();
  } catch (e) {
    print(`Could not read ${nodeCfg.NODE_FILE}: ${e.message}`);
    return 1;
  }
  const taken = new Set(connector.config.getAgents().map((a) => a.name));
  const name = typeof flags.name === 'string' && flags.name.trim()
    ? flags.name.trim()
    : defaultAgentName(type, info.hostname || os.hostname(), taken);
  if (taken.has(name)) {
    print(`An agent named '${name}' already exists on this device. Run it again with another --name.`);
    return 1;
  }
  const priorPairings = nodeCfg.listPairings().filter((p) => p.node_id);
  let res;
  try {
    ({ res } = await pairDevice(connector, code, info, priorPairings));
  } catch (e) {
    print(`Could not connect: ${e.message}`);
    print('Pairing codes work once and expire after 30 minutes. Get a new one from your workspace.');
    return 1;
  }

  // 4. The agent.
  const auth = hostAuthEnv(type, env);
  const agentEnv = { ...auth.env };
  if (auth.secrets.length === 0) agentEnv[AUTH_MODE_KEY] = CLI_LOGIN;

  let seed = null;
  // Where the agent works. Claude Code writes a workspace skill (holding the
  // workspace token) into its working directory, so it gets its own; an
  // OpenCode agent keeps that in its agent home and can keep working in the
  // chat's project.
  let defaultDir = null;
  if (type === 'claude' && host.sessionId) {
    const transcript = findClaudeTranscript(host.sessionId, claudeConfigDir(env));
    if (transcript) seed = { session_id: host.sessionId, transcript };
  } else if (type === 'opencode') {
    const chat = findOpencodeChat({ env, cwd: deps.cwd || process.cwd(), run: deps.runOpencode || runOpencodeCli });
    if (chat) {
      seed = { session_id: chat.session_id, directory: chat.directory };
      defaultDir = chat.directory;
      // The OpenCode adapter needs a model on the command line; use the chat's.
      if (chat.model && !agentEnv.OPENCODE_MODEL) agentEnv.OPENCODE_MODEL = chat.model;
    }
  }
  const workDir = typeof flags.path === 'string' ? path.resolve(flags.path) : (defaultDir || defaultAgentWorkdir(name));

  connector.addAgent({ name, type, role: 'worker', path: workDir, env: agentEnv });
  connector.connectWorkspace(name, res.workspaceSlug);
  connector.config.updateAgent(name, { node_id: res.nodeId, ...(seed ? { seed_session: seed } : {}) });

  // 5. Start at login, and run now.
  if (connector.getDaemonPid()) {
    connector.stopDaemon();
    for (let i = 0; i < 25 && connector.getDaemonPid(); i++) await sleep(200);
  }
  let autostartNote;
  if (flags.autostart === false) {
    autostartNote = 'off (--no-autostart): after a restart, run `agn up` to bring it back';
  } else if (!durable) {
    autostartNote = 'off: the launcher is not installed for good (see the warning above)';
  } else {
    try {
      const { env: serviceVars, skipped } = autostart.serviceEnv(hostFreeEnv(env));
      autostart.enable(connector._configDir, { cliPath: durable.cliPath, nodeBin: durable.nodeBin, env: serviceVars });
      autostartNote = `on (${SERVICE_NAMES[process.platform] || process.platform})`;
      if (skipped.length) autostartNote += `; ${skipped.join(', ')} left out because it holds a password`;
    } catch (e) {
      autostartNote = `off (${String(e.message || e).split('\n')[0]}): after a restart, run \`agn up\``;
    }
  }
  // A login service may have started the daemon already; start it if not.
  for (let i = 0; i < 15 && !connector.getDaemonPid(); i++) await sleep(200);
  if (!connector.getDaemonPid()) {
    connector.startDaemon(durable ? [durable.cliPath, 'up', '--foreground'] : undefined);
  }

  // 6. What happened, for the host agent to pass on.
  const url = workspaceWebUrl(res.workspaceSlug, connector.workspace.endpoint);
  const runtimeLabel = host === detected ? host.label : (connector.registry.getEntry(type).label || type);
  print('');
  print(`Connected. This agent is now '${name}' in the workspace '${res.workspaceName}': ${url}`);
  print(`- Runs as: ${runtimeLabel} on ${info.hostname || os.hostname()}, working in ${workDir}`);
  if (seed && type === 'opencode') {
    print('- Memory: each new workspace thread starts with a transcript of this conversation. This conversation itself is never changed.');
  } else if (seed) {
    print('- Memory: each new workspace thread starts from a copy of this conversation. This conversation itself is never changed.');
  } else if (type === 'claude') {
    print('- Memory: starts fresh (this conversation\'s transcript was not found).');
  } else {
    print(`- Memory: starts fresh (carrying a ${host.label} conversation over is not supported yet).`);
  }
  print(auth.secrets.length
    ? `- Sign-in: copied ${auth.secrets.join(', ')} from this session into the agent's settings (~/.openagents/daemon.yaml).`
    : `- Sign-in: uses this machine's ${runtimeLabel} login.`);
  if (type === 'opencode') {
    print(agentEnv.OPENCODE_MODEL
      ? `- Model: ${agentEnv.OPENCODE_MODEL} (the one this conversation uses)`
      : '- Model: none found. Set one before messaging it: agn env opencode --set OPENCODE_MODEL=<provider/model>');
  }
  print(`- Start at login: ${autostartNote}`);
  print(`- Undo: agn remove ${name}   (and agn autostart --disable to stop starting at login)`);
  print('');
  print(`Tell the user to open the workspace and message @${name}.`);
  return 0;
}

module.exports = { join, pairDevice, workspaceWebUrl, defaultAgentName };

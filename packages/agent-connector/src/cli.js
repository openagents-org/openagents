'use strict';

// Before ./index so the daemon and every `agn` subprocess inherit the same
// no-stray-console-window default on Windows. See win-console.js.
require('./win-console').installWindowsHideDefault();

const { AgentConnector, Daemon } = require('./index');
const { hasCredentialMetadata, formatAuthGuidance } = require('./auth-guidance');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {};
  const allPositional = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[a.slice(2)] = args[i + 1];
        i++;
      } else {
        flags[a.slice(2)] = true;
      }
    } else {
      allPositional.push(a);
    }
  }

  const cmd = allPositional[0] || 'status';
  const positional = allPositional.slice(1);

  return { cmd, flags, positional };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConnector(flags) {
  const opts = {};
  if (flags.config) opts.configDir = flags.config;
  if (flags.endpoint || process.env.OPENAGENTS_ENDPOINT) {
    opts.workspaceEndpoint = flags.endpoint || process.env.OPENAGENTS_ENDPOINT;
  }
  return new AgentConnector(opts);
}

function print(msg) { process.stdout.write(msg + '\n'); }

function table(rows, headers) {
  if (rows.length === 0) return;
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] || '').length))
  );
  print(headers.map((h, i) => h.padEnd(widths[i])).join('  '));
  print(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    print(row.map((c, i) => String(c || '').padEnd(widths[i])).join('  '));
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdUp(connector, flags) {
  if (flags.foreground) {
    // Run in foreground. daemonize() already guards its own child, but the
    // launcher spawns `up --foreground` DIRECTLY — bypassing that guard — so a
    // stale/empty pid file used to let it pile up dozens of daemons that each
    // join the workspace as the same agents (session wars, duplicate replies).
    // Enforce the singleton here using process-liveness from the pid OR status
    // file, so a clobbered pid file can't defeat it.
    const daemon = connector.createDaemon();
    const other = Daemon.runningDaemonPid(daemon.config.configDir);
    if (other) {
      print(`Daemon already running (PID ${other}); not starting another.`);
      return;
    }
    await daemon.start();
  } else {
    const pid = connector.getDaemonPid();
    if (pid) {
      print(`Daemon already running (PID ${pid})`);
      return;
    }
    // Daemonize
    const foregroundArgs = [process.argv[1], 'up', '--foreground'];
    if (flags.config) foregroundArgs.push('--config', flags.config);
    connector.startDaemon(foregroundArgs);
  }
}

async function cmdDown(connector) {
  const stopped = connector.stopDaemon();
  if (stopped) {
    print('Daemon stopped');
  } else {
    print('Daemon is not running');
  }
}

async function cmdRestart(connector, flags) {
  // Stop then start. stopDaemon() already SIGTERM/SIGKILLs and waits for the
  // process to die, but poll getDaemonPid() (which checks liveness) until the
  // pid clears so the singleton guard in cmdUp can't trip on a not-yet-gone
  // daemon and refuse to start.
  const stopped = connector.stopDaemon();
  print(stopped ? 'Daemon stopped' : 'Daemon was not running');
  for (let i = 0; i < 25 && connector.getDaemonPid(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await cmdUp(connector, flags);
}

async function cmdStatus(connector) {
  const pid = connector.getDaemonPid();
  if (!pid) {
    print('Daemon is not running');
  } else {
    print(`Daemon running (PID ${pid})`);
  }

  const agents = connector.listAgents();
  if (agents.length === 0) {
    print('\nNo agents configured. Run: agn create <name> --type <type>');
    return;
  }

  const status = connector.getDaemonStatus();
  const rows = agents.map((a) => {
    const s = status[a.name] || {};
    const state = s.state || (pid ? 'stopped' : '-');
    const restarts = s.restarts || 0;
    return [a.name, a.type, state, a.network || '(local)', restarts > 0 ? `${restarts}` : ''];
  });
  print('');
  table(rows, ['NAME', 'TYPE', 'STATE', 'NETWORK', 'RESTARTS']);
}

async function cmdCreate(connector, flags, positional) {
  const name = positional[0];
  if (!name) { print('Usage: agn create <name> [--type <type>] [--install]'); return; }
  const type = flags.type || 'openclaw';
  const role = flags.role || 'worker';

  // Validate the runtime type BEFORE creating any local entry. A typo'd or
  // otherwise unknown type (e.g. "calude") must not leave a broken agent in
  // config — an uninstalled-but-valid type is fine and handled further down.
  if (!connector.registry.getEntry(type)) {
    const known = connector.registry.getCatalogSync().map((e) => e.name).sort();
    print(`Error: unknown agent type '${type}'.`);
    print(`Supported types: ${known.join(', ')}`);
    print('Run `agn search` to browse available agent types.');
    process.exitCode = 1;
    return;
  }

  try {
    connector.addAgent({ name, type, role, path: flags.path || process.cwd() });

    // Signal daemon to pick up the new agent
    try { connector.sendDaemonCommand('reload'); } catch {}

    // Newly created agents are local-only until connected to a workspace.
    // Without a workspace connection they will not appear in the Workspace Dashboard.
    const created = connector.config.getAgent(name);
    if (created && !created.network) {
      print(`Created local agent: ${name} (type: ${type})`);
      print('');
      print('This agent is local-only and will not appear in Workspace Dashboard yet.');
      print('');
      print('To connect it to a Workspace, run:');
      print(`  agn connect ${name} <workspace-token>`);
    } else {
      print(`Agent '${name}' created (type: ${type})`);
    }

    if (!connector.isInstalled(type)) {
      if (!flags.install) {
        print(`Runtime '${type}' is not installed. Run: agn install ${type}`);
        return;
      }

      print(`Installing ${type}...`);
      try {
        await connector.install(type);
        print(`${type} installed`);
      } catch (e) {
        print(`Warning: install failed: ${e.message}`);
      }
    }
  } catch (e) {
    print(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}

async function cmdRemove(connector, _flags, positional) {
  const name = positional[0];
  if (!name) { print('Usage: agn remove <name>'); return; }
  connector.removeAgent(name);
  try { connector.sendDaemonCommand('reload'); } catch {}
  print(`Agent '${name}' removed`);
}

async function cmdStart(connector, _flags, positional) {
  const name = positional[0];
  if (!name) { print('Usage: agn start <name>'); return; }
  // `start` must be idempotent — it ensures the agent is running, it does NOT
  // forcibly restart one that already is. Send `start:` (which the daemon
  // guards: relaunch only when not already running) rather than `restart:`.
  // A blind `restart:` tears down the workspace session the daemon already
  // joined on launch and re-joins as the same agent; the server revokes the
  // first session, so the agent stops the moment it next touches the workspace
  // (first user message → "thinking..." then silence). The launcher already
  // sends `start:`; this aligns the CLI with it.
  connector.sendDaemonCommand(`start:${name}`);
  print(`Sent start command for '${name}'`);
}

async function cmdStop(connector, _flags, positional) {
  const name = positional[0];
  if (!name) { print('Usage: agn stop <name>'); return; }
  connector.sendDaemonCommand(`stop:${name}`);
  print(`Sent stop command for '${name}'`);
}

async function cmdInstall(connector, _flags, positional) {
  const type = positional[0];
  if (!type) { print('Usage: agn install <type>'); return; }

  if (connector.isInstalled(type)) {
    print(`${type} is already installed`);
    return;
  }

  print(`Installing ${type}...`);
  try {
    const result = await connector.install(type);
    print(`${type} installed successfully`);
    if (result.output) print(result.output);
  } catch (e) {
    print(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}

async function cmdUninstall(connector, _flags, positional) {
  const type = positional[0];
  if (!type) { print('Usage: agn uninstall <type>'); return; }

  print(`Uninstalling ${type}...`);
  try {
    const result = await connector.uninstall(type);
    print(`${type} uninstalled`);
    if (result.output) print(result.output);
  } catch (e) {
    print(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}

async function cmdSearch(connector, flags, positional) {
  const query = positional[0] || '';
  let catalog;
  try {
    catalog = await connector.getCatalog();
  } catch {
    catalog = connector.registry.getCatalogSync().map((e) => {
      const info = connector.installer.getInstallInfo(e.name);
      return { ...e, installed: info.installed, managed: info.managed, location: info.location };
    });
  }

  if (query) {
    const q = query.toLowerCase();
    catalog = catalog.filter((e) =>
      e.name.includes(q) || (e.label || '').toLowerCase().includes(q) ||
      (e.description || '').toLowerCase().includes(q) ||
      (e.tags || []).some((t) => t.includes(q))
    );
  }

  if (catalog.length === 0) {
    print(query ? `No agents matching '${query}'` : 'No agents in catalog');
    return;
  }

  const rows = catalog.map((e) => [
    e.name,
    e.label || e.name,
    e.installed ? 'installed' : '',
    (e.description || '').slice(0, 50),
  ]);
  table(rows, ['NAME', 'LABEL', 'STATUS', 'DESCRIPTION']);
}

async function cmdList(connector) {
  const agents = connector.listAgents();
  if (agents.length === 0) {
    print('No agents configured');
    return;
  }
  const rows = agents.map((a) => [
    a.name, a.type, a.role, a.network || '(local)',
  ]);
  table(rows, ['NAME', 'TYPE', 'ROLE', 'NETWORK']);
}

async function cmdRuntimes(connector, flags) {
  // Machine-readable detection for every supported type: installed? logged-in?
  // Used by the daemon to report node runtimes to the workspace (Add-agent
  // gallery). Emits ONLY JSON on stdout.
  if (flags && flags.json) {
    const runtimes = connector.registry.getCatalogSync().map((e) => {
      let h;
      try { h = connector.healthCheck(e.name); } catch { h = {}; }
      // Credential contract, upward half: STATUS goes up, the secret stays on
      // this device. `mode` says how the type authenticates today
      // (subscription = CLI/OAuth login, api_key = a stored key, none = not
      // configured); keyMasked shows only the key's tail.
      let keyMasked = null;
      try {
        const env = connector.env.load(e.name) || {};
        const key = env.LLM_API_KEY || null;
        if (key && key.length > 7) keyMasked = `…${key.slice(-4)}`;
        else if (key) keyMasked = '…';
      } catch {}
      const mode = !h.ready
        ? 'none'
        : h.auth_mode === 'cli_login'
          ? 'subscription'
          : h.auth_mode === 'api_key'
            ? 'api_key'
            : 'none';
      return {
        type: e.name,
        installed: !!h.installed,
        ready: !!h.ready,
        version: h.version || null,
        reason: h.reason || null,
        message: h.message || null,
        authStatus: h.auth_status || null,
        auth: { mode, keyMasked: mode === 'api_key' ? keyMasked : null },
      };
    });
    process.stdout.write(JSON.stringify(runtimes));
    return;
  }

  let catalog;
  try {
    catalog = await connector.getCatalog();
  } catch {
    catalog = connector.registry.getCatalogSync().map((e) => {
      const info = connector.installer.getInstallInfo(e.name);
      return { ...e, installed: info.installed, managed: info.managed, location: info.location };
    });
  }

  const installed = catalog.filter((e) => e.installed);
  if (installed.length === 0) {
    print('No agent runtimes installed');
    return;
  }

  const rows = installed.map((e) => {
    const binary = connector.installer.which(e.name) || '-';
    return [e.name, e.label || e.name, binary];
  });
  table(rows, ['NAME', 'LABEL', 'PATH']);
}

async function cmdConnect(connector, flags, positional) {
  const name = positional[0];
  // Token resolution order: positional arg / --token flag, then env vars.
  // OPENAGENTS_WORKSPACE_TOKEN is preferred; OA_WORKSPACE_TOKEN is supported
  // for compatibility with the existing mcp-server env var.
  const token = positional[1]
    || flags.token
    || process.env.OPENAGENTS_WORKSPACE_TOKEN
    || process.env.OA_WORKSPACE_TOKEN;

  if (!name) {
    print('Usage: agn connect <agent-name> <token>');
    print('       agn connect <agent-name> --workspace <slug>   (paired/known workspace, no token)');
    process.exitCode = 1;
    return;
  }

  // --workspace <slug|id>: bind to a workspace this device already knows —
  // a registered network or a device pairing. No token, no /v1/token/resolve,
  // no server round-trip; the credential is already on disk. This is the
  // pairing-first path; the token form below stays for manual connection.
  if (flags.workspace && typeof flags.workspace === 'string') {
    connectKnownWorkspace(connector, name, flags.workspace);
    return;
  }

  if (!token) {
    // No token supplied and none in the environment. Never prompt — keep
    // CI / non-interactive environments from hanging. Print a helpful error
    // explaining why the agent stays invisible and how to fix it.
    print('Workspace token is required.');
    print('Local-only agents do not appear in Workspace Dashboard until connected.');
    print('Run:');
    print(`  agn connect ${name} <workspace-token>`);
    process.exitCode = 1;
    return;
  }

  print(`Resolving workspace token...`);
  try {
    const info = await connector.resolveToken(token);
    const slug = info.slug || info.workspace_id;
    const wsName = info.name || slug;

    // Save network
    connector.config.addNetwork({
      id: info.workspace_id,
      slug,
      name: wsName,
      endpoint: info.endpoint || connector.workspace.endpoint,
      token,
    });

    // Connect agent
    connector.connectWorkspace(name, slug);
    print(`'${name}' connected to workspace '${wsName}'`);
    // Manual token connection is being retired in favor of device pairing.
    // It keeps working (backward compatibility is deliberate); this is the
    // CLI half of the dismissible launcher notice.
    if (!process.env.OPENAGENTS_NO_DEPRECATION_NOTES) {
      print('note: manual token connection is being retired in favor of device pairing.');
      print('      Pair once with `agn node connect <code>`, then `agn connect <agent> --workspace <slug>`.');
      print('      (Silence this note with OPENAGENTS_NO_DEPRECATION_NOTES=1.)');
    }

    // Signal daemon reload
    const pid = connector.getDaemonPid();
    if (pid) {
      connector.sendDaemonCommand(`restart:${name}`);
      print('Daemon notified');
    } else {
      print('Daemon is not running. Run `agn up` to bring this agent online.');
    }
  } catch (e) {
    print(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}

/**
 * Bind an agent to a workspace already known to this device, by slug or id.
 * Sources, in order: registered networks (daemon.yaml), then device pairings
 * (node.json) — a pairing registers its network on the spot so the daemon can
 * pick up the token. Never touches the server.
 */
function connectKnownWorkspace(connector, name, ref) {
  const networks = connector.config.getNetworks() || [];
  let net = networks.find((n) => n.slug === ref || n.id === ref);

  if (!net) {
    const nodeCfg = require('./node-config');
    const pairing = (nodeCfg.listPairings() || []).find(
      (p) => p.workspace_slug === ref || p.workspace_id === ref,
    );
    if (pairing && pairing.token) {
      connector.config.addNetwork({
        id: pairing.workspace_id,
        slug: pairing.workspace_slug,
        name: pairing.workspace_name || pairing.workspace_slug,
        endpoint: pairing.endpoint || connector.workspace.endpoint,
        token: pairing.token,
      });
      net = { slug: pairing.workspace_slug, name: pairing.workspace_name };
    }
  }

  if (!net) {
    const known = [
      ...new Set([
        ...networks.map((n) => n.slug || n.id),
        ...(() => {
          try {
            return require('./node-config').listPairings().map((p) => p.workspace_slug);
          } catch { return []; }
        })(),
      ]),
    ].filter(Boolean);
    print(`No workspace '${ref}' is known on this device.`);
    if (known.length) print(`Known workspaces: ${known.join(', ')}`);
    print('Pair this device first (`agn node connect <code>`), or connect with a token.');
    process.exitCode = 1;
    return;
  }

  const slug = net.slug || ref;
  connector.connectWorkspace(name, slug);
  print(`'${name}' connected to workspace '${net.name || slug}'`);

  const pid = connector.getDaemonPid();
  if (pid) {
    connector.sendDaemonCommand(`restart:${name}`);
    print('Daemon notified');
  } else {
    print('Daemon is not running. Run `agn up` to bring this agent online.');
  }
}

async function cmdNode(connector, flags, positional) {
  const sub = positional[0] || 'status';
  const nodeCfg = require('./node-config');

  if (sub === 'connect') {
    const code = positional[1] || flags.code;
    if (!code) {
      print('Usage: agn node connect <pairing-code>');
      print('Get a pairing code from your workspace: Connect a Node.');
      process.exitCode = 1;
      return;
    }
    const info = nodeCfg.gatherDeviceInfo();
    if (flags.type) info.deviceType = flags.type;   // server | laptop | desktop
    if (flags.name) info.name = flags.name;

    print('Connecting this device to your workspace...');
    try {
      const res = await connector.redeemNodePairingCode(code, info);
      // recordPairing, not saveNode: this device can be a node in several
      // workspaces at once, and a bare save would drop the others' pairings.
      nodeCfg.recordPairing(info.nodeKey, {
        node_id: res.nodeId,
        workspace_id: res.workspaceId,
        workspace_slug: res.workspaceSlug,
        workspace_name: res.workspaceName,
        endpoint: connector.workspace.endpoint,
        token: res.token,
      });
      // Register the workspace locally so agents created on this node can use it.
      connector.config.addNetwork({
        id: res.workspaceId,
        slug: res.workspaceSlug,
        name: res.workspaceName,
        endpoint: connector.workspace.endpoint,
        token: res.token,
      });
      print(`Node connected to workspace '${res.workspaceName}' (${res.workspaceSlug})`);
      print(`  This device: ${info.hostname} (${info.deviceType})`);

      // (Re)start the daemon so it runs the CURRENT launcher build and loads
      // the new node identity. A daemon started before the connect-a-node
      // feature has no node-heartbeat loop, so reusing it would leave the node
      // showing offline — recycle it rather than reuse it.
      if (connector.getDaemonPid()) {
        print('  Restarting daemon...');
        connector.stopDaemon();
        for (let i = 0; i < 25 && connector.getDaemonPid(); i++) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } else {
        print('  Starting daemon...');
      }
      connector.startDaemon();
      print('');
      print('Next: add an agent from the workspace, or run:');
      print('  agn create <name> --type <type> --install');
    } catch (e) {
      print(`Error: ${e.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (sub === 'status') {
    const pairings = nodeCfg.listPairings().filter((p) => p.node_id);
    if (!pairings.length) {
      print('No node connected. Run: agn node connect <pairing-code>');
      return;
    }
    print(`Node connected to ${pairings.length} workspace(s):`);
    for (const p of pairings) {
      print(`  ${p.workspace_slug || p.workspace_id} — node ${p.node_id}`);
    }
    return;
  }

  print('Usage: agn node <connect|status> [pairing-code]');
  process.exitCode = 1;
}

async function cmdDisconnect(connector, _flags, positional) {
  const name = positional[0];
  if (!name) { print('Usage: agn disconnect <agent-name>'); return; }
  connector.disconnectWorkspace(name);
  print(`'${name}' disconnected from workspace`);

  const pid = connector.getDaemonPid();
  if (pid) {
    connector.sendDaemonCommand(`restart:${name}`);
  }
}

async function cmdLogs(connector, flags, positional) {
  const agent = positional[0] || flags.agent;
  const lines = parseInt(flags.lines || flags.n || '50', 10);
  const logLines = connector.getLogs(agent, lines);
  for (const line of logLines) {
    if (line) print(line);
  }
}

async function cmdAutostart(connector, flags) {
  const autostart = require('./autostart');
  if (flags.disable) {
    autostart.disable();
    print('Autostart disabled.');
  } else {
    const result = autostart.enable(connector._config ? connector._config.configDir : require('path').join(require('os').homedir(), '.openagents'));
    print(`Autostart enabled.${result.path ? ` Config: ${result.path}` : ''}`);
  }
}

async function cmdWorkspace(connector, flags, positional) {
  const sub = positional[0] || 'list';
  const subArgs = positional.slice(1);

  switch (sub) {
    case 'create': {
      const name = subArgs[0] || flags.name || 'My Workspace';
      print(`Creating workspace '${name}'...`);
      try {
        const result = await connector.createWorkspace({ name });
        print(`Workspace created: ${result.name}`);
        print(`  Slug:  ${result.slug}`);
        print(`  Token: ${result.token}`);
        print(`  URL:   ${result.url}`);
      } catch (e) {
        print(`Error: ${e.message}`);
        process.exitCode = 1;
      }
      break;
    }

    case 'join': {
      const token = subArgs[0] || flags.token;
      if (!token) { print('Usage: agn workspace join <token>'); return; }
      try {
        const info = await connector.resolveToken(token);
        connector.config.addNetwork({
          id: info.workspace_id,
          slug: info.slug || info.workspace_id,
          name: info.name || info.slug,
          endpoint: info.endpoint || connector.workspace.endpoint,
          token,
        });
        print(`Joined workspace '${info.name || info.slug}'`);
      } catch (e) {
        print(`Error: ${e.message}`);
        process.exitCode = 1;
      }
      break;
    }

    case 'list':
    default: {
      const workspaces = connector.listWorkspaces();
      if (workspaces.length === 0) {
        print('No workspaces configured');
        return;
      }
      const rows = workspaces.map((w) => [w.slug, w.name, w.endpoint || '-']);
      table(rows, ['SLUG', 'NAME', 'ENDPOINT']);
      break;
    }
  }
}

async function cmdEnv(connector, flags, positional) {
  const type = positional[0];
  if (!type) { print('Usage: agn env <type> [--set KEY=VALUE]'); return; }

  const setVal = flags.set;
  if (setVal) {
    const eq = setVal.indexOf('=');
    if (eq < 1) { print('Usage: --set KEY=VALUE'); return; }
    const key = setVal.slice(0, eq);
    const val = setVal.slice(eq + 1);
    connector.saveAgentEnv(type, { [key]: val });
    try { connector.sendDaemonCommand('reload'); } catch {}
    print(`Saved ${key} for ${type}`);
    return;
  }

  // Show current env
  const env = connector.getAgentEnv(type);
  const fields = connector.getEnvFields(type);

  if (fields.length > 0) {
    for (const field of fields) {
      const val = env[field.name];
      const display = field.password && val ? '***' : (val || '(not set)');
      print(`  ${field.name}: ${display}  ${field.required ? '(required)' : ''}`);
    }
    return;
  }

  // No env_config, but the agent may still require a sign-in/credential (e.g.
  // Gemini's OAuth login). Surface readiness + login guidance from the registry
  // check_ready rather than a misleading "No env vars configured". Gated on
  // credential metadata so plain no-config agents keep their existing output.
  const entry = connector.registry.getEntry(type);
  if (hasCredentialMetadata(entry && entry.check_ready)) {
    let health = null;
    try { health = connector.healthCheck(type); } catch {}
    const g = formatAuthGuidance(entry, health);
    print(`${entry.label || type} authentication status: ${g.ready ? 'Ready' : 'Not ready'}`);
    print('');
    for (const line of g.lines) print(line);
    return;
  }

  const entries = Object.entries(env);
  if (entries.length === 0) {
    print(`No env vars configured for ${type}`);
  } else {
    for (const [k, v] of entries) {
      print(`  ${k}: ${v}`);
    }
  }
}

async function cmdToolMode(connector, _flags, positional) {
  const first = positional[0];
  const second = positional[1];

  // agn tool-mode --all <mode>
  if (first === '--all') {
    const targetMode = second;
    if (!targetMode || (targetMode !== 'mcp' && targetMode !== 'skills')) {
      print("Usage: agn tool-mode --all <mcp|skills>");
      process.exitCode = 1;
      return;
    }
    const agents = connector.config.getAgents();
    if (agents.length === 0) { print('No agents configured'); return; }
    for (const a of agents) {
      connector.config.updateAgent(a.name, { tool_mode: targetMode });
      print(`  ${a.name}: ${a.tool_mode || 'skills'} → ${targetMode}`);
    }
    try { connector.sendDaemonCommand('reload'); } catch {}
    print(`\nSet all ${agents.length} agent(s) to '${targetMode}' mode.`);
    return;
  }

  if (!first) {
    // Show tool mode for all agents
    const agents = connector.config.getAgents();
    if (agents.length === 0) {
      print('No agents configured');
      return;
    }
    for (const a of agents) {
      print(`  ${a.name}: ${a.tool_mode || 'skills'}`);
    }
    print('\nUsage: agn tool-mode <agent|--all> <mcp|skills>');
    return;
  }

  if (!second) {
    // Show tool mode for specific agent
    const agent = connector.config.getAgent(first);
    if (!agent) { print(`Agent '${first}' not found`); process.exitCode = 1; return; }
    print(`${first}: ${agent.tool_mode || 'skills'}`);
    print('\nUsage: agn tool-mode <agent|--all> <mcp|skills>');
    return;
  }

  if (second !== 'mcp' && second !== 'skills') {
    print(`Invalid mode: ${second}. Must be 'mcp' or 'skills'.`);
    process.exitCode = 1;
    return;
  }

  connector.config.updateAgent(first, { tool_mode: second });
  try { connector.sendDaemonCommand('reload'); } catch {}
  print(`Set tool mode for ${first} to '${second}'`);
  if (second === 'skills') {
    print('Agent will use SKILL.md (Bash + curl) instead of MCP server for workspace tools.');
  } else {
    print('Agent will use MCP server for workspace tools (default).');
  }
}

async function cmdSkills(connector, _flags, positional) {
  const { SKILL_CATALOG, getSkillDefaults } = require('./skill-catalog');
  const toggleable = SKILL_CATALOG.filter(s => s.toggleable);
  const first = positional[0];
  const second = positional[1];
  const third = positional[2];

  // agn skills → list skills for all agents
  if (!first) {
    const agents = connector.config.getAgents();
    if (agents.length === 0) { print('No agents configured'); return; }
    for (const a of agents) {
      const defaults = getSkillDefaults();
      const skills = a.skills || {};
      const parts = toggleable.map(s => {
        const enabled = skills[s.id] !== undefined ? skills[s.id] : defaults[s.id];
        return `${enabled ? '+' : '-'}${s.id}`;
      });
      print(`  ${a.name}: ${parts.join(' ')}`);
    }
    print('\nUsage: agn skills <agent> [enable|disable <skill>]');
    print('Available skills: ' + toggleable.map(s => s.id).join(', '));
    return;
  }

  // agn skills catalog → show full catalog
  if (first === 'catalog') {
    print('Skill Hub — Available Skills:\n');
    for (const s of SKILL_CATALOG) {
      const tag = s.toggleable ? (s.defaultEnabled ? '[on]' : '[off]') : '[always]';
      print(`  ${s.id.padEnd(16)} ${tag.padEnd(10)} ${s.name}`);
      print(`  ${''.padEnd(16)} ${''.padEnd(10)} ${s.description}`);
      print('');
    }
    return;
  }

  const agent = connector.config.getAgent(first);
  if (!agent) { print(`Agent '${first}' not found`); process.exitCode = 1; return; }

  // agn skills <agent> → show agent's skills
  if (!second) {
    const defaults = getSkillDefaults();
    const skills = agent.skills || {};
    print(`Skills for ${first}:\n`);
    for (const s of toggleable) {
      const enabled = skills[s.id] !== undefined ? skills[s.id] : defaults[s.id];
      const marker = enabled ? '  ✓' : '  ✗';
      print(`${marker} ${s.id.padEnd(14)} ${s.name} — ${s.description}`);
    }
    print('\nUsage: agn skills <agent> enable|disable <skill>');
    return;
  }

  // agn skills <agent> enable|disable <skill>
  if (second !== 'enable' && second !== 'disable') {
    print(`Unknown action: ${second}. Use 'enable' or 'disable'.`);
    process.exitCode = 1;
    return;
  }
  if (!third) {
    print(`Usage: agn skills ${first} ${second} <skill>`);
    print('Available skills: ' + toggleable.map(s => s.id).join(', '));
    process.exitCode = 1;
    return;
  }

  const skillDef = toggleable.find(s => s.id === third);
  if (!skillDef) {
    print(`Unknown skill: ${third}`);
    print('Available skills: ' + toggleable.map(s => s.id).join(', '));
    process.exitCode = 1;
    return;
  }

  const current = agent.skills || {};
  const updated = { ...current, [third]: second === 'enable' };
  connector.config.updateAgent(first, { skills: updated });
  try { connector.sendDaemonCommand('reload'); } catch {}
  const verb = second === 'enable' ? 'Enabled' : 'Disabled';
  print(`${verb} '${skillDef.name}' for ${first}`);
}

async function cmdTestLLM(connector, _flags, positional) {
  const type = positional[0];
  if (!type) { print('Usage: agn test-llm <type>'); return; }

  const env = connector.getAgentEnv(type);
  const resolved = connector.resolveAgentEnv(type, env);
  const effective = { ...env, ...resolved };

  print(`Testing LLM connection for ${type}...`);
  const result = await connector.testLLM(effective);
  if (result.success) {
    print(`Success! Model: ${result.model}, Response: ${result.response}`);
  } else {
    print(`Failed: ${result.error}`);
    process.exitCode = 1;
  }
}

async function cmdProbe(connector, flags, positional) {
  const target = positional[0];
  if (!target) { print('Usage: agn probe <type|agent> [--json]'); return; }

  // Accept an agent name as a convenience — probe its type.
  let type = target;
  try {
    const agent = connector.config.getAgent(target);
    if (agent) type = agent.type || 'openclaw';
  } catch {}

  const result = await connector.probeAgentType(type);

  if (flags && flags.json) {
    // Machine consumers (the daemon's probe_agent node command) read ONLY
    // stdout JSON — same contract as `agn runtimes --json`.
    process.stdout.write(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (result.ok) {
    print(`OK (${result.method}, ${result.durationMs}ms)${result.reply ? ` — ${result.reply}` : ''}`);
    if (result.code === 'static_only') print(result.message);
  } else {
    print(`FAILED [${result.code}] ${result.message || ''}`.trim());
    for (const line of result.guidance || []) print(`  → ${line}`);
    process.exitCode = 1;
  }
}

async function cmdVersion() {
  const pkg = require('../package.json');
  print(`${pkg.name} v${pkg.version}`);
}

async function cmdUpdate(connector) {
  const { checkForUpdate, runUpdate, currentVersion } = require('./update-check');
  const info = await checkForUpdate();
  if (!info) {
    print('Could not reach the npm registry. Check your network.');
    process.exitCode = 1;
    return;
  }
  if (!info.isNewer) {
    print(`Already on the latest version (${currentVersion()}).`);
    return;
  }
  print(`Updating ${info.current} → ${info.latest}...`);
  const ok = runUpdate();
  if (!ok) {
    print('Update failed.');
    process.exitCode = 1;
    return;
  }
  print(`Updated to ${info.latest}.`);

  // Recycle a running daemon so the new build takes effect immediately. Without
  // this, a long-lived daemon keeps executing the OLD in-memory code (and misses
  // new features) until the next manual restart or reboot — the failure mode
  // that left a connected node showing offline after its launcher was upgraded.
  try {
    if (connector && connector.getDaemonPid()) {
      print('Restarting daemon to apply the update...');
      connector.stopDaemon();
      for (let i = 0; i < 25 && connector.getDaemonPid(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      connector.startDaemon();
    }
  } catch (e) {
    print(`Note: could not restart the daemon automatically (${e.message}). Run 'agn restart'.`);
  }
}

async function cmdHelp() {
  print(`Usage: agn <command> [options]

Commands:
  up [--foreground]           Start daemon (background by default)
  down                        Stop daemon
  restart [--foreground]      Restart daemon (down + up)
  status                      Show agent status
  list                        List configured agents
  create <name> [--type T]    Create a new agent
  remove <name>               Remove an agent
  start <name>                Start a single agent
  stop <name>                 Stop a single agent
  install <type>              Install an agent runtime
  uninstall <type>            Uninstall an agent runtime
  search [query]              Browse agent catalog
  runtimes                    List installed runtimes
  connect <agent> <token>     Connect agent to workspace (or --workspace <slug> for a paired one)
  disconnect <agent>          Disconnect agent from workspace
  env <type> [--set K=V]      View/set env vars for agent type
  skills [agent] [action]     Manage agent skills (enable/disable)
  tool-mode [agent] [mode]    View/set tool mode (mcp or skills)
  autostart [--disable]       Enable/disable auto-start on login
  test-llm <type>             Test LLM connection
  probe <type|agent> [--json] Smoke-test an agent (tiny end-to-end prompt)
  logs [agent] [--lines N]    View daemon logs
  workspace create [name]     Create a new workspace
  workspace join <token>      Join workspace with token
  workspace list              List configured workspaces
  mcp-server                  Start MCP server (stdio) for workspace tools
  update                      Upgrade launcher to the latest npm release
  version                     Show version
  help                        Show this help

Options:
  --config <dir>              Config directory (default: ~/.openagents)
  --install                   Install runtime during create
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { cmd, flags, positional } = parseArgs(process.argv);

  if (cmd === 'help' || flags.help) { await cmdHelp(); return; }
  if (cmd === 'version' || flags.version) { await cmdVersion(); return; }

  // Check for a newer launcher version and offer to install it. Skip for:
  //   - mcp-server: JSON-RPC subprocess spawned by Claude Code
  //   - up --foreground: the backgrounded daemon child
  //   - tui / auto-TUI: interactive UI manages its own rendering
  //   - update: already updating; avoid recursion
  const skipUpdateCheck =
    cmd === 'mcp-server' ||
    (cmd === 'up' && flags.foreground) ||
    cmd === 'tui' ||
    cmd === 'update' ||
    flags['no-update-check'] ||
    process.env.OPENAGENTS_SKIP_UPDATE_CHECK === '1' ||
    (cmd === 'status' && process.argv.length <= 2 && process.stdin.isTTY);
  if (!skipUpdateCheck) {
    try {
      const { notifyAndMaybeUpdate } = require('./update-check');
      await notifyAndMaybeUpdate();
    } catch {}
  }

  const connector = getConnector(flags);

  // Launch TUI if command is 'tui' or no command with interactive terminal
  if (cmd === 'tui' || (cmd === 'status' && process.argv.length <= 2 && process.stdin.isTTY)) {
    try {
      const { run } = require('./tui');
      run();
      return;
    } catch (e) {
      // Fall through to text-based status if blessed not available
      if (e.code !== 'MODULE_NOT_FOUND') {
        print(`TUI error: ${e.message}`);
        process.exitCode = 1;
        return;
      }
    }
  }

  const commands = {
    tui: () => { const { run } = require('./tui'); run(); },
    up: () => cmdUp(connector, flags),
    down: () => cmdDown(connector),
    restart: () => cmdRestart(connector, flags),
    status: () => cmdStatus(connector),
    list: () => cmdList(connector),
    create: () => cmdCreate(connector, flags, positional),
    remove: () => cmdRemove(connector, flags, positional),
    start: () => cmdStart(connector, flags, positional),
    stop: () => cmdStop(connector, flags, positional),
    install: () => cmdInstall(connector, flags, positional),
    uninstall: () => cmdUninstall(connector, flags, positional),
    search: () => cmdSearch(connector, flags, positional),
    runtimes: () => cmdRuntimes(connector, flags),
    connect: () => cmdConnect(connector, flags, positional),
    node: () => cmdNode(connector, flags, positional),
    disconnect: () => cmdDisconnect(connector, flags, positional),
    logs: () => cmdLogs(connector, flags, positional),
    autostart: () => cmdAutostart(connector, flags),
    workspace: () => cmdWorkspace(connector, flags, positional),
    env: () => cmdEnv(connector, flags, positional),
    skills: () => cmdSkills(connector, flags, positional),
    'tool-mode': () => cmdToolMode(connector, flags, positional),
    'test-llm': () => cmdTestLLM(connector, flags, positional),
    probe: () => cmdProbe(connector, flags, positional),
    update: () => cmdUpdate(connector),
    'mcp-server': () => {
      const { runMcpServer } = require('./mcp-server');
      const workspaceId = flags['workspace-id'] || process.env.OPENAGENTS_WORKSPACE_ID;
      const channelName = flags['channel-name'] || process.env.OPENAGENTS_CHANNEL_NAME || 'general';
      const agentName = flags['agent-name'] || process.env.OPENAGENTS_AGENT_NAME || 'agent';
      const endpoint = flags.endpoint || process.env.OPENAGENTS_ENDPOINT || 'https://workspace-endpoint.openagents.org';
      const token = process.env.OA_WORKSPACE_TOKEN || '';
      if (!workspaceId || !token) {
        print('Error: --workspace-id required and OA_WORKSPACE_TOKEN env var must be set');
        process.exitCode = 1;
        return;
      }
      const disabledModules = new Set();
      if (flags['disable-files']) disabledModules.add('files');
      if (flags['disable-browser']) disabledModules.add('browser');
      // Without this the server still registers the knowledge tools, and in
      // execute mode --dangerously-skip-permissions makes the allowlist a
      // suggestion, not a boundary.
      if (flags['disable-knowledge']) disabledModules.add('knowledge');
      runMcpServer({ workspaceId, channelName, agentName, endpoint, token, disabledModules });
    },
  };

  const handler = commands[cmd];
  if (!handler) {
    print(`Unknown command: ${cmd}`);
    print('Run: agn help');
    process.exitCode = 1;
    return;
  }

  try {
    await handler();
  } catch (e) {
    print(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}

main();

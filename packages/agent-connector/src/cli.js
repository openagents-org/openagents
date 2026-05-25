'use strict';

const { AgentConnector, Daemon } = require('./index');

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
    // Run in foreground (used by daemonize child) — skip PID check
    // because the parent already wrote our PID to the file.
    const daemon = connector.createDaemon();
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

  try {
    connector.addAgent({ name, type, role, path: flags.path || process.cwd() });
    print(`Agent '${name}' created (type: ${type})`);

    // Signal daemon to pick up the new agent
    try { connector.sendDaemonCommand('reload'); } catch {}

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
  connector.sendDaemonCommand(`restart:${name}`);
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

async function cmdRuntimes(connector) {
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
  const token = positional[1] || flags.token;
  if (!name || !token) {
    print('Usage: agn connect <agent-name> <token>');
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

    // Signal daemon reload
    const pid = connector.getDaemonPid();
    if (pid) {
      connector.sendDaemonCommand(`restart:${name}`);
      print('Daemon notified');
    }
  } catch (e) {
    print(`Error: ${e.message}`);
    process.exitCode = 1;
  }
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
  } else {
    const entries = Object.entries(env);
    if (entries.length === 0) {
      print(`No env vars configured for ${type}`);
    } else {
      for (const [k, v] of entries) {
        print(`  ${k}: ${v}`);
      }
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

async function cmdVersion() {
  const pkg = require('../package.json');
  print(`${pkg.name} v${pkg.version}`);
}

async function cmdUpdate() {
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
}

async function cmdHelp() {
  print(`Usage: agn <command> [options]

Commands:
  up [--foreground]           Start daemon (background by default)
  down                        Stop daemon
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
  connect <agent> <token>     Connect agent to workspace
  disconnect <agent>          Disconnect agent from workspace
  env <type> [--set K=V]      View/set env vars for agent type
  skills [agent] [action]     Manage agent skills (enable/disable)
  tool-mode [agent] [mode]    View/set tool mode (mcp or skills)
  autostart [--disable]       Enable/disable auto-start on login
  test-llm <type>             Test LLM connection
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
    status: () => cmdStatus(connector),
    list: () => cmdList(connector),
    create: () => cmdCreate(connector, flags, positional),
    remove: () => cmdRemove(connector, flags, positional),
    start: () => cmdStart(connector, flags, positional),
    stop: () => cmdStop(connector, flags, positional),
    install: () => cmdInstall(connector, flags, positional),
    uninstall: () => cmdUninstall(connector, flags, positional),
    search: () => cmdSearch(connector, flags, positional),
    runtimes: () => cmdRuntimes(connector),
    connect: () => cmdConnect(connector, flags, positional),
    disconnect: () => cmdDisconnect(connector, flags, positional),
    logs: () => cmdLogs(connector, flags, positional),
    autostart: () => cmdAutostart(connector, flags),
    workspace: () => cmdWorkspace(connector, flags, positional),
    env: () => cmdEnv(connector, flags, positional),
    skills: () => cmdSkills(connector, flags, positional),
    'tool-mode': () => cmdToolMode(connector, flags, positional),
    'test-llm': () => cmdTestLLM(connector, flags, positional),
    update: () => cmdUpdate(),
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

/**
 * Interactive TUI dashboard for OpenAgents — `openagents` or `openagents tui`
 *
 * Mirrors the Python Textual TUI (cli_tui.py) with blessed.
 */

'use strict';

const blessed = require('blessed');
const { AgentConnector } = require('./index');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getExtraBinDirs } = require('./paths');

const IS_WINDOWS = process.platform === 'win32';

// ── Color palette ───────────────────────────────────────────────────────────

const COLORS = {
  primary: 'blue',
  accent: 'cyan',
  surface: 'black',
  headerBg: 'blue',
  headerFg: 'white',
  footerBg: 'blue',
  footerFg: 'white',
  panelBorder: 'cyan',
  logBorder: 'blue',
  colHeaderBg: 'grey',
  colHeaderFg: 'black',
  selected: { bg: 'blue', fg: 'white' },
  stateRunning: 'green',
  stateStopped: 'gray',
  stateError: 'red',
  stateStarting: 'yellow',
};

const STATE_DISPLAY = {
  online:        { sym: '\u25CF', color: COLORS.stateRunning, label: 'connected' },
  running:       { sym: '\u25CF', color: COLORS.stateRunning, label: 'connected' },
  idle:          { sym: '\u25CB', color: COLORS.stateStarting, label: 'ready' },
  starting:      { sym: '\u25D0', color: COLORS.stateStarting, label: 'starting' },
  reconnecting:  { sym: '\u25D0', color: COLORS.stateStarting, label: 'reconnecting' },
  stopped:       { sym: '\u25CB', color: COLORS.stateStopped, label: 'stopped' },
  'not configured': { sym: '\u25CB', color: COLORS.stateStopped, label: 'not configured' },
  error:         { sym: '\u2717', color: COLORS.stateError, label: 'error' },
};

function stateMarkup(state, hasWorkspace) {
  const d = STATE_DISPLAY[state] || { sym: '?', color: 'white', label: state };
  let label = d.label;
  // For running/connected agents, clarify workspace status
  if ((state === 'running' || state === 'online') && !hasWorkspace) {
    label = 'running';
  }
  return `{${d.color}-fg}${d.sym} ${label}{/${d.color}-fg}`;
}

// ── Data helpers ────────────────────────────────────────────────────────────

function getConnector() {
  const configDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.openagents');
  return new AgentConnector({ configDir });
}

function loadAgentRows(connector) {
  const config = connector.config.load();
  const agents = config.agents || [];
  const agentStatuses = connector.getDaemonStatus() || {};
  const pid = connector.getDaemonPid();
  const networks = config.networks || [];
  return agents.map(agent => {
    const info = agentStatuses[agent.name] || {};
    const state = pid ? (info.state || 'stopped') : 'stopped';
    let workspace = '';
    if (agent.network) {
      const net = networks.find(n => n.slug === agent.network || n.id === agent.network);
      if (net) {
        const slug = net.slug || net.id;
        const isLocal = (net.endpoint || '').includes('localhost') || (net.endpoint || '').includes('127.0.0.1');
        if (isLocal) workspace = `${net.endpoint}/${slug}`;
        else workspace = `workspace.openagents.org/${slug}`;
      } else {
        workspace = agent.network;
      }
    }
    // Check if agent type needs configuration (API key etc.)
    let notReadyMsg = '';
    try {
      const agentType = agent.type || 'openclaw';
      const entry = connector.registry.getEntry(agentType);
      if (entry && entry.check_ready) {
        const cr = entry.check_ready;
        let isReady = false;
        // Check saved env
        if (cr.saved_env_key) {
          const saved = connector.env.load(agentType);
          if (saved[cr.saved_env_key]) isReady = true;
        }
        // Check process env vars
        if (!isReady && cr.env_vars) {
          for (const v of cr.env_vars) {
            if (process.env[v]) { isReady = true; break; }
          }
        }
        // Check creds file/directory (for claude)
        if (!isReady && cr.creds_file) {
          const credsPath = cr.creds_file.replace('~', process.env.HOME || process.env.USERPROFILE || '');
          try {
            if (fs.existsSync(credsPath)) {
              const stat = fs.statSync(credsPath);
              if (stat.isDirectory()) {
                // Directory (e.g. ~/.claude/sessions) — check if it has files
                isReady = fs.readdirSync(credsPath).length > 0;
              } else {
                const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
                if (cr.creds_key) isReady = !!creds[cr.creds_key];
                else isReady = true;
              }
            }
          } catch {}
        }
        // Also check OAuth credentials (Claude Code stores tokens in .credentials.json)
        if (!isReady) {
          try {
            const oauthFile = path.join(process.env.HOME || '', '.claude', '.credentials.json');
            if (fs.existsSync(oauthFile)) {
              const creds = JSON.parse(fs.readFileSync(oauthFile, 'utf-8'));
              if (creds.claudeAiOauth && creds.claudeAiOauth.accessToken) isReady = true;
            }
          } catch {}
        }
        if (!isReady) notReadyMsg = cr.not_ready_message || 'Not configured';
      }
    } catch {}

    return {
      name: agent.name,
      type: agent.type || 'openclaw',
      state,
      workspace,
      path: agent.path || '',
      network: agent.network || '',
      lastError: info.last_error || '',
      notReadyMsg,
      configured: true,
    };
  });
}

function loadCatalog(connector) {
  const { execSync } = require('child_process');
  const entries = connector.registry.getCatalogSync();
  return entries.map(e => {
    let installed = false;

    // If a verify command exists, use it for accurate detection
    const verifyCmd = IS_WINDOWS ? (e.install && e.install.verify_win) : (e.install && e.install.verify);
    if (verifyCmd) {
      try { execSync(verifyCmd, { stdio: 'ignore', timeout: 5000 }); installed = true; } catch {}
    } else {
      try { const { whichBinary } = require('./paths'); installed = !!whichBinary((e.install && e.install.binary) || e.name); } catch {}
    }

    if (!installed) {
      try {
        const f = path.join(connector._configDir, 'installed_agents.json');
        if (fs.existsSync(f)) installed = !!JSON.parse(fs.readFileSync(f, 'utf-8'))[e.name];
      } catch {}
    }
    return {
      name: e.name,
      label: e.label || e.name,
      description: e.description || '',
      installed,
      envConfig: e.env_config || [],
      checkReady: e.check_ready || null,
      loginCommand: (e.check_ready && e.check_ready.login_command) || null,
    };
  });
}

function generateAgentName(type) {
  const adj = ['swift', 'bright', 'calm', 'keen', 'bold'];
  const noun = ['wolf', 'hawk', 'fox', 'bear', 'lynx'];
  const a = adj[Math.floor(Math.random() * adj.length)];
  const n = noun[Math.floor(Math.random() * noun.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  return `${type}-${a}-${n}-${num}`;
}

// ── Main TUI ────────────────────────────────────────────────────────────────

function createTUI() {
  const screen = blessed.screen({
    smartCSR: true,
    mouse: true,
    title: 'OpenAgents',
    fullUnicode: true,
    tags: true,
  });

  // Full-screen background to ensure dark bg on all terminal themes
  const bgFill = blessed.box({
    top: 0, left: 0, width: '100%', height: '100%',
    style: { bg: 'black' },
  });
  screen.append(bgFill);
  const connector = getConnector();
  let pkg;
  try { pkg = require('../package.json'); } catch { pkg = { version: '?' }; }

  let agentRows = [];
  let currentView = 'main';

  // ── Header ──
  const header = blessed.box({
    top: 0, left: 0, width: '100%', height: 1,
    tags: true,
    style: { bg: COLORS.headerBg, fg: COLORS.headerFg, bold: true },
  });

  // ── Title ──
  const titleBox = blessed.box({
    top: 1, left: 0, width: '100%', height: 1,
    tags: true,
    content: `  {bold}OpenAgents{/bold} {gray-fg}v${pkg.version}{/gray-fg}`,
    style: { fg: 'white', bg: 'black' },
  });

  // ── Agent Panel (bordered) ──
  const agentPanel = blessed.box({
    top: 2, left: 0, width: '100%', height: '60%-1',
    border: { type: 'line' },
    label: ' {bold}Agents{/bold} ',
    tags: true,
    style: { bg: 'black', border: { fg: COLORS.panelBorder }, label: { fg: COLORS.accent } },
  });

  // ── Column Headers ──
  const colHeaders = blessed.box({
    parent: agentPanel,
    top: 0, left: 0, width: '100%-2', height: 1,
    tags: true,
    style: { bg: COLORS.colHeaderBg, fg: COLORS.colHeaderFg },
    content: `  ${'NAME'.padEnd(22)} ${'TYPE'.padEnd(14)} ${'STATUS'.padEnd(18)} WORKSPACE`,
  });

  // ── Agent List ──
  const agentList = blessed.list({
    parent: agentPanel,
    top: 1, left: 0, width: '100%-2', height: '100%-3',
    keys: false, vi: false, mouse: true,
    tags: true,
    style: {
      bg: 'black',
      selected: { bg: COLORS.selected.bg, fg: COLORS.selected.fg, bold: true },
      item: { fg: 'white', bg: 'black' },
    },
  });

  // ── Log Panel (bordered) ──
  const logPanel = blessed.box({
    top: '60%+1', left: 0, width: '100%', height: '40%-2',
    border: { type: 'line' },
    label: ' {bold}Activity Log{/bold} ',
    tags: true,
    style: { bg: 'black', border: { fg: COLORS.logBorder }, label: { fg: COLORS.primary } },
  });

  const logContent = blessed.log({
    parent: logPanel,
    top: 0, left: 0, width: '100%-2', height: '100%-2',
    scrollable: true, scrollOnInput: true,
    tags: true,
    style: { fg: 'white', bg: 'black' },
  });

  // ── Footer (clickable buttons) ──
  const footerBar = blessed.box({
    bottom: 0, left: 0, width: '100%', height: 1,
    tags: true,
    style: { bg: COLORS.footerBg, fg: COLORS.footerFg },
  });
  let footerButtons = [];

  screen.append(header);
  screen.append(titleBox);
  screen.append(agentPanel);
  screen.append(logPanel);
  screen.append(footerBar);

  // ── Log helper ──
  function log(msg) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logContent.log(`{gray-fg}${ts}{/gray-fg}  ${msg}`);
    screen.render();
  }

  // ── Footer rendering (context-aware, clickable) ──
  function updateFooter() {
    const agent = selectedAgent();
    const items = [];

    items.push({ key: 'i', label: 'Install' });
    items.push({ key: 'n', label: 'New' });

    if (agent && agent.configured) {
      const isRunning = ['running', 'online', 'starting', 'reconnecting'].includes(agent.state);
      const isStopped = ['stopped', 'error'].includes(agent.state);

      if (isStopped) items.push({ key: 's', label: 'Start' });
      if (isRunning) items.push({ key: 'x', label: 'Stop' });

      const envFields = connector.registry.getEnvFields(agent.type);
      if (envFields && envFields.length > 0) items.push({ key: 'e', label: 'Configure' });

      if (!agent.workspace) items.push({ key: 'c', label: 'Connect' });
      if (agent.workspace) items.push({ key: 'd', label: 'Disconnect' });
      if (agent.workspace) items.push({ key: 'w', label: 'Workspace' });

      items.push({ key: 'Del', label: 'Remove' });
    }

    items.push({ key: 'u', label: 'Daemon' });
    items.push({ key: 'r', label: 'Refresh' });
    items.push({ key: 'q', label: 'Quit' });

    // Remove old buttons
    for (const btn of footerButtons) { footerBar.remove(btn); btn.destroy(); }
    footerButtons = [];

    let left = 1;
    for (const item of items) {
      const text = `${item.key} ${item.label}`;
      const btn = blessed.box({
        parent: footerBar,
        left, top: 0, height: 1,
        width: text.length + 2,
        tags: true,
        mouse: true,
        clickable: true,
        content: `{cyan-fg}${item.key}{/cyan-fg} ${item.label}`,
        style: { bg: COLORS.footerBg, fg: COLORS.footerFg, hover: { bg: 'cyan', fg: 'black' } },
      });
      const action = footerActions[item.label];
      if (action) {
        btn.on('click', () => action());
      }
      footerButtons.push(btn);
      left += text.length + 2;
    }

    screen.render();
  }

  // ── Agent table refresh ──
  function refreshAgentTable() {
    const savedIdx = Math.floor((agentList.selected || 0) / 2);
    try { agentRows = loadAgentRows(connector); } catch { agentRows = []; }

    if (agentRows.length === 0) {
      agentList.setItems(['  {gray-fg}No agents configured. Press {bold}i{/bold} to install, {bold}n{/bold} to create.{/gray-fg}']);
    } else {
      // Two rows per agent: main row + detail row (path + config status)
      const items = [];
      for (const r of agentRows) {
        const state = stateMarkup(r.state, !!r.workspace);
        const ws = r.workspace || '';
        items.push(`  ${r.name.padEnd(22)} ${r.type.padEnd(14)} ${state.padEnd(30)} ${ws}`);
        // Detail row: working dir + config warning
        const details = [];
        details.push(r.path || process.env.HOME || '~');
        if (r.notReadyMsg) details.push(`{yellow-fg}⚠ ${r.notReadyMsg}{/yellow-fg}`);
        items.push(`  {gray-fg}  ${details.join('  |  ')}{/gray-fg}`);
      }
      agentList.setItems(items);
    }

    // Restore cursor position (2 rows per agent)
    if (agentRows.length > 0) {
      agentList.select(Math.min(savedIdx * 2, (agentRows.length - 1) * 2));
    }

    updateHeader();
    updateFooter();
    screen.render();
  }

  function updateHeader() {
    const pid = connector.getDaemonPid();
    const dot = pid ? `{green-fg}\u25CF{/green-fg}` : `{gray-fg}\u25CB{/gray-fg}`;
    const state = pid ? 'Daemon running' : 'Daemon idle';
    const count = agentRows.length;

    // Show installed runtimes
    let installed = [];
    try {
      const catalog = loadCatalog(connector);
      installed = catalog.filter(e => e.installed).map(e => e.name);
    } catch {}
    const installedStr = installed.length
      ? `  {gray-fg}|{/gray-fg}  {green-fg}${installed.join(', ')}{/green-fg} installed`
      : '';

    header.setContent(
      `  ${dot} ${state}  {gray-fg}|{/gray-fg}  ${count} agent${count !== 1 ? 's' : ''} configured${installedStr}`
    );
  }

  // Helper: get currently selected agent (2 rows per agent)
  function selectedAgent() {
    return agentRows[Math.floor((agentList.selected || 0) / 2)];
  }

  // Override up/down to skip detail rows (move by 2)
  agentList.key(['down', 'j'], () => {
    const idx = agentList.selected || 0;
    const next = idx + 2;
    if (next < agentList.items.length) {
      agentList.select(next);
      screen.render();
    }
  });
  agentList.key(['up', 'k'], () => {
    const idx = agentList.selected || 0;
    const prev = idx - 2;
    if (prev >= 0) {
      agentList.select(prev);
      screen.render();
    }
  });
  agentList.on('select item', () => updateFooter());

  // ── Enter key → Context menu ──
  agentList.key('enter', () => {
    if (currentView !== 'main') return;
    const agent = selectedAgent();
    if (!agent || !agent.configured) return;
    showAgentActionMenu(agent);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Agent Action Menu (context menu on Enter)
  // ────────────────────────────────────────────────────────────────────────

  function showAgentActionMenu(agent) {
    const actions = [];
    const isRunning = ['running', 'online', 'starting', 'reconnecting'].includes(agent.state);
    const isStopped = ['stopped', 'error'].includes(agent.state);

    const envFields = connector.registry.getEnvFields(agent.type);
    if (envFields && envFields.length > 0) actions.push({ label: 'Configure', key: 'configure' });

    const catalog = connector.registry.getCatalogSync();
    const entry = catalog.find(e => e.name === agent.type);
    if (entry && entry.check_ready && entry.check_ready.login_command) {
      actions.push({ label: 'Login', key: 'login' });
    }

    if (isStopped) actions.push({ label: 'Start', key: 'start' });
    if (isRunning) actions.push({ label: 'Stop', key: 'stop' });
    if (agent.workspace) actions.push({ label: 'Open Workspace', key: 'open_workspace' });
    if (!agent.workspace) actions.push({ label: 'Connect to Workspace', key: 'connect' });
    if (agent.workspace) actions.push({ label: 'Disconnect from Workspace', key: 'disconnect' });
    actions.push({ label: 'Remove', key: 'remove' });

    if (actions.length === 0) return;

    const listHeight = Math.min(actions.length + 2, 14);
    const dialog = blessed.box({
      top: 'center', left: 'center',
      width: 40, height: listHeight + 2,
      border: { type: 'line' },
      tags: true,
      label: ` {bold}${agent.name}{/bold} `,
      style: { border: { fg: COLORS.accent }, bg: COLORS.surface },
    });

    const actionList = blessed.list({
      parent: dialog,
      top: 0, left: 1, width: '100%-4', height: listHeight,
      keys: true, vi: true, mouse: true,
      tags: true,
      style: {
        selected: { bg: COLORS.selected.bg, fg: COLORS.selected.fg, bold: true },
        item: { fg: 'white' },
      },
      items: actions.map(a => `  ${a.label}`),
    });

    screen.append(dialog);
    actionList.focus();
    screen.render();

    const close = () => {
      screen.remove(dialog);
      dialog.destroy();
      agentList.focus();
      screen.render();
    };

    actionList.on('select', (_item, idx) => {
      const action = actions[idx];
      close();
      if (!action) return;
      switch (action.key) {
        case 'configure': showConfigureScreen(agent); break;
        case 'login': doLogin(agent); break;
        case 'start': doStart(agent.name); break;
        case 'stop': doStop(agent.name); break;
        case 'open_workspace': doOpenWorkspace(agent); break;
        case 'connect': showConnectWorkspaceScreen(agent.name); break;
        case 'disconnect': doDisconnect(agent.name); break;
        case 'remove': doRemove(agent.name); break;
      }
    });

    actionList.key('escape', close);
    dialog.key('escape', close);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Install Screen
  // ────────────────────────────────────────────────────────────────────────

  function showInstallScreen() {
    currentView = 'install';
    let catalog;
    try { catalog = loadCatalog(connector); } catch (e) { log(`{red-fg}Error:{/red-fg} ${e.message}`); return; }

    const box = blessed.box({ top: 0, left: 0, width: '100%', height: '100%', style: { bg: COLORS.surface } });

    blessed.box({
      parent: box, top: 0, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.headerBg, fg: COLORS.headerFg, bold: true },
      content: '  {bold}Install Agent Runtimes{/bold}  {gray-fg}\u2014  Enter to install, Esc to go back{/gray-fg}',
    });

    blessed.box({
      parent: box, top: 1, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.colHeaderBg, fg: COLORS.colHeaderFg },
      content: `  ${'AGENT'.padEnd(25)} ${'STATUS'.padEnd(18)} DESCRIPTION`,
    });

    const list = blessed.list({
      parent: box, top: 2, left: 0, width: '100%', height: '50%-1',
      keys: true, vi: true, mouse: true,
      tags: true,
      style: {
        selected: { bg: COLORS.selected.bg, fg: COLORS.selected.fg, bold: true },
        item: { fg: 'white' },
      },
    });

    // Install log panel — shows full streaming output
    const logPanel = blessed.box({
      parent: box, top: '50%+1', left: 0, width: '100%', height: '50%-2',
      border: { type: 'line' },
      label: ' {bold}Install Log{/bold} ',
      tags: true,
      style: { border: { fg: COLORS.panelBorder }, label: { fg: COLORS.accent } },
    });

    const installLog = blessed.log({
      parent: logPanel,
      top: 0, left: 0, width: '100%-2', height: '100%-2',
      scrollable: true, scrollOnInput: true,
      tags: true,
      padding: { left: 1 },
      style: { fg: 'grey' },
    });

    blessed.box({
      parent: box, bottom: 0, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.footerBg, fg: COLORS.footerFg },
      content: ' {cyan-fg}Enter{/cyan-fg} Install/Update  {cyan-fg}Esc{/cyan-fg} Back',
    });

    function renderList() {
      list.setItems(catalog.map(e => {
        const st = e.installed
          ? `{green-fg}\u25CF installed{/green-fg}`
          : `{yellow-fg}\u25CB available{/yellow-fg}`;
        const desc = e.description ? e.description.substring(0, 40) : '';
        return `  ${e.label.padEnd(25)} ${st.padEnd(30)} {gray-fg}${desc}{/gray-fg}`;
      }));
    }
    renderList();
    list.focus();

    let installing = false;

    list.on('select', (_item, idx) => {
      if (installing) return;
      const entry = catalog[idx];
      if (!entry) return;
      const verb = entry.installed ? 'Update' : 'Install';

      showConfirmDialog(`${verb} ${entry.label}?`, (yes) => {
        if (yes) {
          installing = true;
          doInstall(entry, logPanel, installLog, list, catalog, renderList, () => { installing = false; });
        }
        list.focus();
        screen.render();
      });
    });

    list.key('escape', () => {
      screen.remove(box);
      box.destroy();
      currentView = 'main';
      agentList.focus();
      refreshAgentTable();
    });

    screen.append(box);
    list.focus();
    screen.render();
  }

  function doInstall(entry, logPanel, installLog, list, catalog, renderList, onDone) {
    logPanel.setLabel(` {bold}Installing ${entry.name}...{/bold} `);
    installLog.setContent('');
    installLog.log(`{cyan-fg}>>> Installing ${entry.name}...{/cyan-fg}`);
    screen.render();
    log(`Installing {cyan-fg}${entry.name}{/cyan-fg}...`);

    connector.installer.installStreaming(entry.name, (chunk) => {
      const lines = chunk.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const clean = line.trim().substring(0, 120);
        installLog.log(clean);
        screen.render();
      }
    }).then(() => {
      installLog.log('');
      installLog.log(`{green-fg}\u2713 ${entry.name} installed successfully!{/green-fg}`);
      installLog.log('');
      installLog.log(`{cyan-fg}Press c to create a ${entry.name} agent, or Esc to go back.{/cyan-fg}`);
      logPanel.setLabel(` {bold}{green-fg}Install Complete{/green-fg}{/bold} `);
      log(`{green-fg}\u2713{/green-fg} ${entry.name} installed`);
      const idx = catalog.findIndex(c => c.name === entry.name);
      if (idx >= 0) catalog[idx].installed = true;
      renderList();
      onDone();
      list.focus();
      screen.render();

      // Listen for 'c' to create agent from just-installed type
      const onCreateKey = (ch) => {
        if (ch === 'c') {
          screen.unkey(['c', 'escape'], onCreateKey);
          // Go back to main and start agent creation flow
          list.emit('keypress', null, { name: 'escape' });
          setTimeout(() => {
            showStartAgentScreen(entry.name, (result) => {
              try {
                connector.addAgent({ name: result.name, type: result.type, path: result.path });
                log(`{green-fg}\u2713{/green-fg} Created agent {cyan-fg}${result.name}{/cyan-fg} (${result.type})`);
                const pid = connector.getDaemonPid();
                if (!pid) {
                  connector.startDaemon();
                  log('{green-fg}\u2713{/green-fg} Daemon starting...');
                } else {
                  signalDaemonReload();
                }
              } catch (e) {
                log(`{red-fg}\u2717{/red-fg} ${e.message}`);
              }
              setTimeout(refreshAgentTable, 3000);
            });
          }, 200);
        } else {
          screen.unkey(['c', 'escape'], onCreateKey);
        }
      };
      screen.key(['c', 'escape'], onCreateKey);
    }).catch((e) => {
      installLog.log('');
      installLog.log(`{red-fg}\u2717 Failed: ${e.message}{/red-fg}`);
      logPanel.setLabel(` {bold}{red-fg}Install Failed{/red-fg}{/bold} `);
      log(`{red-fg}\u2717 Install failed:{/red-fg} ${e.message}`);
      onDone();
      list.focus();
      screen.render();
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Select Agent Type Screen
  // ────────────────────────────────────────────────────────────────────────

  function showSelectAgentTypeScreen(callback) {
    const catalog = loadCatalog(connector);
    const installed = catalog.filter(e => e.installed);

    if (installed.length === 0) {
      log('{yellow-fg}No agent runtimes installed. Press i to install one first.{/yellow-fg}');
      return;
    }

    const dialogHeight = Math.min(installed.length + 4, 16);
    const dialog = blessed.box({
      top: 'center', left: 'center',
      width: 50, height: dialogHeight,
      border: { type: 'line' },
      tags: true,
      label: ' {bold}Select Agent Type{/bold} ',
      style: { border: { fg: COLORS.accent }, bg: COLORS.surface },
    });

    const typeList = blessed.list({
      parent: dialog,
      top: 1, left: 1, width: '100%-4', height: dialogHeight - 4,
      keys: true, vi: true, mouse: true,
      tags: true,
      style: {
        selected: { bg: COLORS.selected.bg, fg: COLORS.selected.fg, bold: true },
        item: { fg: 'white' },
      },
      items: installed.map(e => `  {green-fg}\u2713{/green-fg} ${e.label} {gray-fg}(${e.name}){/gray-fg}`),
    });

    blessed.box({
      parent: dialog,
      bottom: 0, left: 0, width: '100%-2', height: 1,
      tags: true,
      content: ' {gray-fg}Enter to select, Esc to cancel{/gray-fg}',
    });

    screen.append(dialog);
    typeList.focus();
    screen.render();

    const close = () => {
      screen.remove(dialog);
      dialog.destroy();
      agentList.focus();
      screen.render();
    };

    typeList.on('select', (_item, idx) => {
      const selected = installed[idx];
      close();
      if (selected) callback(selected.name);
    });

    typeList.key('escape', close);
    dialog.key('escape', close);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Start Agent Screen (name + working dir)
  // ────────────────────────────────────────────────────────────────────────

  function showStartAgentScreen(agentType, callback) {
    const defaultName = generateAgentName(agentType);
    const defaultPath = process.cwd();

    const dialog = blessed.box({
      top: 'center', left: 'center',
      width: 60, height: 15,
      border: { type: 'line' },
      tags: true,
      label: ` {bold}Start ${agentType} Agent{/bold} `,
      style: { border: { fg: COLORS.accent }, bg: COLORS.surface },
    });

    blessed.text({ parent: dialog, top: 1, left: 2, tags: true, content: `{bold}Agent name:{/bold} {gray-fg}(default: ${defaultName}){/gray-fg}` });
    const nameInput = blessed.textbox({
      parent: dialog, top: 2, left: 2, width: 50, height: 3,
      border: { type: 'line' }, inputOnFocus: true,
      style: { fg: 'white', bg: COLORS.surface, focus: { border: { fg: COLORS.accent } }, border: { fg: 'grey' } },
    });

    blessed.text({ parent: dialog, top: 5, left: 2, tags: true, content: `{bold}Working directory:{/bold} {gray-fg}(default: ${defaultPath}){/gray-fg}` });
    const pathInput = blessed.textbox({
      parent: dialog, top: 6, left: 2, width: 50, height: 3,
      border: { type: 'line' }, inputOnFocus: true,
      value: defaultPath,
      style: { fg: 'white', bg: COLORS.surface, focus: { border: { fg: COLORS.accent } }, border: { fg: 'grey' } },
    });

    blessed.text({
      parent: dialog, top: 10, left: 2,
      tags: true,
      content: '{gray-fg}Enter to confirm, Escape to cancel{/gray-fg}',
    });

    const msg = blessed.text({ parent: dialog, top: 11, left: 2, tags: true, content: '' });

    screen.append(dialog);
    nameInput.focus();
    screen.render();

    // Override _listener on textboxes to intercept Tab before it's inserted
    const origNameListener = nameInput._listener.bind(nameInput);
    nameInput._listener = function(ch, key) {
      if (key.name === 'tab') { nameInput._done(null, nameInput.value); pathInput.focus(); return; }
      return origNameListener(ch, key);
    };
    const origPathListener = pathInput._listener.bind(pathInput);
    pathInput._listener = function(ch, key) {
      if (key.name === 'tab') { pathInput._done(null, pathInput.value); nameInput.focus(); return; }
      return origPathListener(ch, key);
    };

    const close = () => {
      screen.remove(dialog);
      dialog.destroy();
      agentList.focus();
      screen.render();
    };

    nameInput.key('enter', () => pathInput.focus());
    pathInput.key('enter', () => {
      const name = nameInput.getValue().trim() || defaultName;
      const agentPath = pathInput.getValue().trim() || defaultPath;
      close();
      callback({ name, type: agentType, path: agentPath });
    });

    dialog.key('escape', close);
    nameInput.key('escape', close);
    pathInput.key('escape', close);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Configure Agent Screen (env vars + LLM test)
  // ────────────────────────────────────────────────────────────────────────

  function showConfigureScreen(agent) {
    currentView = 'configure';
    const envFields = connector.registry.getEnvFields(agent.type);
    if (!envFields || envFields.length === 0) {
      log('{gray-fg}No configuration required for this agent type.{/gray-fg}');
      return;
    }

    const saved = connector.getAgentEnv(agent.type);

    const box = blessed.box({ top: 0, left: 0, width: '100%', height: '100%', style: { bg: COLORS.surface } });

    blessed.box({
      parent: box, top: 0, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.headerBg, fg: COLORS.headerFg, bold: true },
      content: `  {bold}Configure ${agent.type}{/bold}  {gray-fg}\u2014  Saved to ~/.openagents/env/{/gray-fg}`,
    });

    const inputs = [];
    let yPos = 2;

    for (const field of envFields) {
      const current = saved[field.name] || field.default || '';
      const req = field.required ? ' {red-fg}*{/red-fg}' : '';
      const placeholder = field.placeholder || `Enter ${field.name}...`;

      blessed.text({
        parent: box, top: yPos, left: 2,
        tags: true,
        content: `{bold}${field.description || field.name}{/bold}${req}`,
      });
      yPos++;

      const input = blessed.textbox({
        parent: box, top: yPos, left: 2, width: '80%', height: 3,
        border: { type: 'line' }, inputOnFocus: true,
        value: current,
        censor: field.password || false,
        style: { fg: 'white', bg: COLORS.surface, focus: { border: { fg: COLORS.accent } }, border: { fg: 'grey' } },
      });
      input._fieldName = field.name;
      inputs.push(input);
      yPos += 3;
    }

    // Buttons row
    const btnSave = blessed.button({
      parent: box, top: yPos + 1, left: 2,
      width: 12, height: 3,
      border: { type: 'line' },
      tags: true,
      content: '  {bold}Save{/bold}',
      style: { bg: COLORS.primary, fg: 'white', border: { fg: COLORS.accent }, focus: { bg: 'blue' } },
      mouse: true, keys: true,
    });

    const btnTest = blessed.button({
      parent: box, top: yPos + 1, left: 16,
      width: 12, height: 3,
      border: { type: 'line' },
      tags: true,
      content: '  {bold}Test{/bold}',
      style: { fg: 'white', border: { fg: 'grey' }, focus: { bg: 'blue' } },
      mouse: true, keys: true,
    });

    const testResult = blessed.text({
      parent: box, top: yPos + 4, left: 2,
      tags: true,
      content: '',
    });

    blessed.box({
      parent: box, bottom: 0, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.footerBg, fg: COLORS.footerFg },
      content: ' {cyan-fg}Tab{/cyan-fg} Next  {cyan-fg}Ctrl+U{/cyan-fg} Clear  {cyan-fg}Ctrl+S{/cyan-fg} Save  {cyan-fg}Ctrl+T{/cyan-fg} Test  {cyan-fg}Esc{/cyan-fg} Back',
    });

    screen.append(box);
    if (inputs.length > 0) inputs[0].focus();
    screen.render();

    // Enter moves to next field, last field triggers save
    for (let i = 0; i < inputs.length; i++) {
      inputs[i].key('enter', () => {
        if (i < inputs.length - 1) {
          inputs[i + 1].focus();
        } else {
          doSave();
        }
      });
    }

    // Override _listener on textboxes to intercept Tab and Escape
    for (let i = 0; i < inputs.length; i++) {
      const orig = inputs[i]._listener.bind(inputs[i]);
      const idx = i;
      inputs[i]._listener = function(ch, key) {
        if (key.name === 'tab' && inputs.length > 1) {
          inputs[idx]._done(null, inputs[idx].value);
          inputs[(idx + 1) % inputs.length].focus();
          return;
        }
        if (key.name === 'escape') {
          inputs[idx]._done(null, inputs[idx].value);
          closeConfig();
          return;
        }
        // Ctrl+U to clear field
        if (key.ctrl && key.name === 'u') {
          inputs[idx].value = '';
          inputs[idx].setValue('');
          screen.render();
          return;
        }
        // Ctrl+S to save, Ctrl+T to test
        if (key.ctrl && key.name === 's') { inputs[idx]._done(null, inputs[idx].value); doSave(); return; }
        if (key.ctrl && key.name === 't') { inputs[idx]._done(null, inputs[idx].value); doTest(); return; }
        return orig(ch, key);
      };
    }

    function gatherEnv() {
      const env = {};
      for (const input of inputs) {
        const val = input.getValue().trim();
        if (val) env[input._fieldName] = val;
      }
      return env;
    }

    function doSave() {
      const env = gatherEnv();
      connector.saveAgentEnv(agent.type, env);
      signalDaemonReload();
      log(`{green-fg}\u2713{/green-fg} Configuration saved for ${agent.type}`);
      closeConfig();
    }

    function doTest() {
      const env = gatherEnv();
      const resolved = connector.resolveAgentEnv(agent.type, env);
      const effective = { ...env, ...resolved };

      if (!effective.LLM_API_KEY && !effective.OPENAI_API_KEY && !effective.ANTHROPIC_API_KEY) {
        testResult.setContent('{red-fg}No API key entered{/red-fg}');
        screen.render();
        return;
      }

      testResult.setContent('{gray-fg}Testing...{/gray-fg}');
      screen.render();

      connector.testLLM(effective).then(result => {
        if (result.success) {
          testResult.setContent(`{green-fg}\u2713 OK{/green-fg} \u2014 model: ${result.model}, response: ${(result.response || '').substring(0, 50)}`);
        } else {
          testResult.setContent(`{red-fg}\u2717 ${result.error || 'Unknown error'}{/red-fg}`);
        }
        screen.render();
      }).catch(err => {
        testResult.setContent(`{red-fg}\u2717 ${err.message}{/red-fg}`);
        screen.render();
      });
    }

    function closeConfig() {
      screen.remove(box);
      box.destroy();
      currentView = 'main';
      agentList.focus();
      refreshAgentTable();
    }

    btnSave.on('press', doSave);
    btnTest.on('press', doTest);

    box.key('escape', closeConfig);
    box.key('C-s', doSave);
    box.key('C-t', doTest);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Connect Workspace Screen
  // ────────────────────────────────────────────────────────────────────────

  function showConnectWorkspaceScreen(agentName) {
    currentView = 'connect';
    const config = connector.config.load();
    const networks = config.networks || [];

    const box = blessed.box({ top: 0, left: 0, width: '100%', height: '100%', style: { bg: COLORS.surface } });

    blessed.box({
      parent: box, top: 0, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.headerBg, fg: COLORS.headerFg, bold: true },
      content: `  {bold}Connect '${agentName}' to Workspace{/bold}  {gray-fg}\u2014  Select a workspace and press Enter{/gray-fg}`,
    });

    blessed.box({
      parent: box, top: 1, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.colHeaderBg, fg: COLORS.colHeaderFg },
      content: `  ${'WORKSPACE'.padEnd(30)} URL`,
    });

    const rowActions = [];
    const items = [];

    for (const net of networks) {
      const name = net.name || net.slug || net.id;
      const slug = net.slug || net.id;
      const isLocal = (net.endpoint || '').includes('localhost') || (net.endpoint || '').includes('127.0.0.1');
      const url = isLocal ? `${net.endpoint}/${slug}` : `https://workspace.openagents.org/${slug}`;
      items.push(`  ${name.padEnd(30)} {gray-fg}${url}{/gray-fg}`);
      rowActions.push(`existing:${slug}`);
    }

    items.push(`  {bold}{green-fg}\u271A Create new workspace{/green-fg}{/bold}`);
    rowActions.push('__create__');
    items.push(`  {bold}{yellow-fg}\u{1F511} Join with token{/yellow-fg}{/bold}`);
    rowActions.push('__token__');

    const list = blessed.list({
      parent: box, top: 2, left: 0, width: '100%', height: '100%-4',
      keys: true, vi: true, mouse: true,
      tags: true,
      style: {
        selected: { bg: COLORS.selected.bg, fg: COLORS.selected.fg, bold: true },
        item: { fg: 'white' },
      },
      items,
    });

    blessed.box({
      parent: box, bottom: 0, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.footerBg, fg: COLORS.footerFg },
      content: ' {cyan-fg}Enter{/cyan-fg} Select  {cyan-fg}Esc{/cyan-fg} Back',
    });

    screen.append(box);
    list.focus();
    screen.render();

    const closeScreen = () => {
      screen.remove(box);
      box.destroy();
      currentView = 'main';
      agentList.focus();
      refreshAgentTable();
    };

    list.on('select', (_item, idx) => {
      const action = rowActions[idx];
      closeScreen();

      if (action && action.startsWith('existing:')) {
        const slug = action.split(':')[1];
        try {
          connector.connectWorkspace(agentName, slug);
          signalDaemonReload();
          log(`{green-fg}\u2713{/green-fg} Connected {cyan-fg}${agentName}{/cyan-fg} \u2192 ${slug}`);
        } catch (e) {
          log(`{red-fg}\u2717 ${e.message}{/red-fg}`);
        }
        refreshAgentTable();
      } else if (action === '__create__') {
        showTextInputDialog('Workspace name', `${agentName}'s workspace`, (name) => {
          if (!name) return;
          doCreateWorkspace(agentName, name);
        });
      } else if (action === '__token__') {
        showTextInputDialog('Paste workspace token', '', (token) => {
          if (!token) return;
          doJoinToken(agentName, token);
        });
      }
    });

    list.key('escape', closeScreen);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Shared dialogs
  // ────────────────────────────────────────────────────────────────────────

  function showConfirmDialog(message, callback) {
    const dialog = blessed.box({
      top: 'center', left: 'center',
      width: 50, height: 5,
      border: { type: 'line' },
      tags: true,
      style: { border: { fg: COLORS.accent }, bg: COLORS.surface },
      content: `\n  ${message}\n  {gray-fg}y = yes, n = no{/gray-fg}`,
    });
    screen.append(dialog);
    screen.render();

    const onKey = (ch) => {
      screen.unkey(['y', 'n', 'escape'], onKey);
      dialog.destroy();
      screen.render();
      callback(ch === 'y');
    };
    screen.key(['y', 'n', 'escape'], onKey);
  }

  function showTextInputDialog(title, defaultValue, callback) {
    const dialog = blessed.box({
      top: 'center', left: 'center',
      width: 60, height: 8,
      border: { type: 'line' },
      tags: true,
      label: ` {bold}${title}{/bold} `,
      style: { border: { fg: COLORS.accent }, bg: COLORS.surface },
    });

    const input = blessed.textbox({
      parent: dialog,
      top: 1, left: 2, width: '100%-6', height: 3,
      border: { type: 'line' }, inputOnFocus: true,
      value: defaultValue || '',
      style: { fg: 'white', bg: COLORS.surface, focus: { border: { fg: COLORS.accent } }, border: { fg: 'grey' } },
    });

    blessed.text({
      parent: dialog, top: 4, left: 2,
      tags: true,
      content: '{gray-fg}Enter to confirm, Escape to cancel{/gray-fg}',
    });

    screen.append(dialog);
    input.focus();
    screen.render();

    const close = () => {
      screen.remove(dialog);
      dialog.destroy();
      agentList.focus();
      screen.render();
    };

    input.key('enter', () => {
      const val = input.getValue().trim();
      close();
      callback(val || null);
    });

    input.key('escape', () => {
      close();
      callback(null);
    });

    dialog.key('escape', () => {
      close();
      callback(null);
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Actions
  // ────────────────────────────────────────────────────────────────────────

  function signalDaemonReload() {
    try { connector.sendDaemonCommand('reload'); } catch {}
  }

  function doStart(agentName) {
    log(`Starting {cyan-fg}${agentName}{/cyan-fg}...`);
    const pid = connector.getDaemonPid();
    if (!pid) {
      try {
        connector.startDaemon();
        log(`{green-fg}\u2713{/green-fg} Starting daemon (will launch {cyan-fg}${agentName}{/cyan-fg})`);
      } catch (e) {
        log(`{red-fg}\u2717 Failed to start daemon:{/red-fg} ${e.message}`);
        return;
      }
    } else {
      try {
        connector.sendDaemonCommand(`restart:${agentName}`);
        log(`{green-fg}\u2713{/green-fg} Restarting {cyan-fg}${agentName}{/cyan-fg} via daemon`);
      } catch (e) {
        log(`{red-fg}\u2717 Failed:{/red-fg} ${e.message}`);
        return;
      }
    }
    setTimeout(refreshAgentTable, 3000);
  }

  function doStop(agentName) {
    log(`Stopping {cyan-fg}${agentName}{/cyan-fg}...`);
    try {
      connector.sendDaemonCommand(`stop:${agentName}`);
      log(`{green-fg}\u2713{/green-fg} Stopped {cyan-fg}${agentName}{/cyan-fg}`);
    } catch (e) {
      log(`{red-fg}\u2717{/red-fg} ${e.message}`);
    }
    setTimeout(refreshAgentTable, 1000);
  }

  function doRemove(agentName) {
    showConfirmDialog(`Remove ${agentName}?`, (yes) => {
      if (!yes) return;
      // Disconnect first if connected
      const agent = agentRows.find(a => a.name === agentName);
      if (agent && agent.workspace) {
        try {
          connector.disconnectWorkspace(agentName);
          signalDaemonReload();
          log(`Disconnected {cyan-fg}${agentName}{/cyan-fg}`);
        } catch {}
      }
      // Stop if daemon running
      const pid = connector.getDaemonPid();
      if (pid) {
        try { connector.sendDaemonCommand(`stop:${agentName}`); } catch {}
      }
      // Remove from config
      try {
        connector.removeAgent(agentName);
        signalDaemonReload();
        log(`{green-fg}\u2713{/green-fg} Removed {cyan-fg}${agentName}{/cyan-fg}`);
      } catch (e) {
        log(`{red-fg}\u2717{/red-fg} ${e.message}`);
      }
      refreshAgentTable();
    });
  }

  function doDisconnect(agentName) {
    try {
      connector.disconnectWorkspace(agentName);
      signalDaemonReload();
      log(`{green-fg}\u2713{/green-fg} Disconnected {cyan-fg}${agentName}{/cyan-fg}`);
    } catch (e) {
      log(`{red-fg}\u2717{/red-fg} ${e.message}`);
    }
    refreshAgentTable();
  }

  function doOpenWorkspace(agent) {
    const config = connector.config.load();
    const networks = config.networks || [];
    const net = networks.find(n => n.slug === agent.network || n.id === agent.network);
    if (!net) {
      log('{yellow-fg}No workspace config found{/yellow-fg}');
      return;
    }
    const slug = net.slug || net.id;
    const isLocal = (net.endpoint || '').includes('localhost') || (net.endpoint || '').includes('127.0.0.1');
    let url;
    if (isLocal) {
      url = `${net.endpoint}/${slug}`;
    } else {
      url = `https://workspace.openagents.org/${slug}`;
    }
    if (net.token) url += `?token=${net.token}`;

    // Try opening in browser
    let opened = false;
    try {
      const { exec } = require('child_process');
      const cmd = IS_WINDOWS ? `start "${url}"` :
                  process.platform === 'darwin' ? `open "${url}"` :
                  `xdg-open "${url}"`;
      exec(cmd);
      opened = true;
    } catch {}

    // Show URL in a dialog — full width, auto-height for long URLs
    const innerW = screen.width - 4;
    const urlLines = Math.ceil(url.length / innerW);
    const dialog = blessed.box({
      top: 'center', left: 0,
      width: '100%', height: 4 + urlLines + 2,
      border: { type: 'line' },
      tags: true,
      label: ' {bold}Workspace URL{/bold} ',
      style: { border: { fg: COLORS.accent }, bg: COLORS.surface },
      content: `\n {bold}${url}{/bold}\n\n {gray-fg}${opened ? 'Opened in browser.' : 'Copy the URL above.'} Press Esc to close.{/gray-fg}`,
    });

    screen.append(dialog);
    screen.render();

    const close = () => {
      screen.remove(dialog);
      dialog.destroy();
      agentList.focus();
      screen.render();
    };
    screen.key(['escape', 'enter'], function handler() {
      screen.unkey(['escape', 'enter'], handler);
      close();
    });

    if (opened) log(`{green-fg}\u2713{/green-fg} Opened workspace in browser`);
  }

  function doLogin(agent) {
    const catalog = connector.registry.getCatalogSync();
    const entry = catalog.find(e => e.name === agent.type);
    if (!entry || !entry.check_ready || !entry.check_ready.login_command) {
      log('{yellow-fg}No login command for this agent type{/yellow-fg}');
      return;
    }
    const cmd = entry.check_ready.login_command;
    log(`Running {bold}${cmd}{/bold}...`);

    // Suspend TUI and run login command interactively
    screen.exec(cmd, {}, (err, ok) => {
      if (err) {
        log(`{red-fg}\u2717 Login error:{/red-fg} ${err.message}`);
      } else {
        log(`{green-fg}\u2713{/green-fg} Login completed`);
      }
      refreshAgentTable();
    });
  }

  function doCreateWorkspace(agentName, wsName) {
    log(`Creating workspace {bold}${wsName}{/bold}...`);
    connector.createWorkspace({ agentName, name: wsName }).then(result => {
      const slug = result.slug || result.workspaceId;
      // Save to config
      connector.config.addNetwork({
        id: result.workspaceId,
        slug,
        name: wsName,
        endpoint: connector.workspace.endpoint,
        token: result.token,
      });
      connector.connectWorkspace(agentName, slug);
      signalDaemonReload();
      log(`{green-fg}\u2713{/green-fg} Created & connected \u2192 ${result.url || slug}`);
      refreshAgentTable();
    }).catch(e => {
      log(`{red-fg}\u2717 Create failed:{/red-fg} ${e.message}`);
    });
  }

  function doJoinToken(agentName, token) {
    log('Joining workspace with token...');
    connector.resolveToken(token).then(info => {
      const slug = info.slug || info.workspace_id;
      connector.config.addNetwork({
        id: info.workspace_id,
        slug,
        name: info.name || slug,
        endpoint: connector.workspace.endpoint,
        token,
      });
      connector.connectWorkspace(agentName, slug);
      signalDaemonReload();
      log(`{green-fg}\u2713{/green-fg} Joined & connected {cyan-fg}${agentName}{/cyan-fg} \u2192 ${slug}`);
      refreshAgentTable();
    }).catch(e => {
      log(`{red-fg}\u2717 Join failed:{/red-fg} ${e.message}`);
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Key bindings
  // ────────────────────────────────────────────────────────────────────────

  // ── Action handlers (shared by keys and clickable footer) ──
  const footerActions = {
    Install() { if (currentView === 'main') showInstallScreen(); },
    New() {
      if (currentView !== 'main') return;
      showSelectAgentTypeScreen((type) => {
        showStartAgentScreen(type, (result) => {
          try {
            connector.addAgent({ name: result.name, type: result.type, path: result.path });
            log(`{green-fg}\u2713{/green-fg} Created agent {cyan-fg}${result.name}{/cyan-fg} (${result.type})`);
            const pid = connector.getDaemonPid();
            if (!pid) {
              connector.startDaemon();
              log('{green-fg}\u2713{/green-fg} Daemon starting...');
            } else {
              signalDaemonReload();
            }
          } catch (e) {
            log(`{red-fg}\u2717{/red-fg} ${e.message}`);
          }
          setTimeout(refreshAgentTable, 3000);
        });
      });
    },
    Start() {
      if (currentView !== 'main' || !selectedAgent()) return;
      const a = selectedAgent();
      if (a.configured) doStart(a.name);
    },
    Stop() {
      if (currentView !== 'main' || !selectedAgent()) return;
      const a = selectedAgent();
      if (a.configured) doStop(a.name);
    },
    Configure() {
      if (currentView !== 'main' || !selectedAgent()) return;
      const a = selectedAgent();
      if (a.configured) showConfigureScreen(a);
    },
    Connect() {
      if (currentView !== 'main' || !selectedAgent()) return;
      const a = selectedAgent();
      if (a.configured && !a.workspace) showConnectWorkspaceScreen(a.name);
    },
    Disconnect() {
      if (currentView !== 'main' || !selectedAgent()) return;
      const a = selectedAgent();
      if (a.configured && a.workspace) doDisconnect(a.name);
    },
    Workspace() {
      if (currentView !== 'main' || !selectedAgent()) return;
      const a = selectedAgent();
      if (a.configured && a.workspace) doOpenWorkspace(a);
    },
    Remove() {
      if (currentView !== 'main' || !selectedAgent()) return;
      const a = selectedAgent();
      if (a.configured) doRemove(a.name);
    },
    Daemon() {
      if (currentView !== 'main') return;
      const pid = connector.getDaemonPid();
      if (pid) {
        showConfirmDialog('Stop daemon? This will disconnect ALL agents.', (yes) => {
          if (!yes) { log('{gray-fg}Cancelled{/gray-fg}'); return; }
          try {
            connector.stopDaemon();
            log('{green-fg}\u2713{/green-fg} Daemon stopped');
          } catch (e) {
            log(`{red-fg}\u2717{/red-fg} ${e.message}`);
          }
          setTimeout(refreshAgentTable, 1000);
        });
      } else {
        try {
          connector.startDaemon();
          log('{green-fg}\u2713{/green-fg} Daemon starting...');
        } catch (e) {
          log(`{red-fg}\u2717{/red-fg} ${e.message}`);
        }
        setTimeout(refreshAgentTable, 3000);
      }
    },
    Refresh() {
      if (currentView === 'main') {
        refreshAgentTable();
        log('{green-fg}\u2713{/green-fg} Refreshed');
      }
    },
    Quit() { if (currentView === 'main') process.exit(0); },
  };

  // Bind keyboard shortcuts
  screen.key('q', footerActions.Quit);
  screen.key('C-c', () => process.exit(0));
  screen.key('i', footerActions.Install);
  screen.key('n', footerActions.New);
  screen.key('r', footerActions.Refresh);
  screen.key('s', footerActions.Start);
  screen.key('x', footerActions.Stop);
  screen.key('u', footerActions.Daemon);
  screen.key('c', footerActions.Connect);
  screen.key('d', footerActions.Disconnect);
  screen.key('w', footerActions.Workspace);
  screen.key('e', footerActions.Configure);
  screen.key('delete', footerActions.Remove);

  // ── Init ──
  agentList.focus();
  refreshAgentTable();
  log('Welcome to {bold}OpenAgents{/bold}. Press {cyan-fg}i{/cyan-fg} to install agents, {cyan-fg}n{/cyan-fg} to create one.');

  // Show installed runtimes that don't have any agent instances yet
  try {
    const catalog = loadCatalog(connector);
    const installed = catalog.filter(e => e.installed).map(e => e.name);
    const configuredTypes = new Set(agentRows.map(r => r.type));
    const unused = installed.filter(t => !configuredTypes.has(t));
    if (unused.length > 0) {
      log(`{green-fg}\u2713{/green-fg} Installed: {bold}${unused.join(', ')}{/bold} — press {cyan-fg}n{/cyan-fg} to create an agent`);
    }
    if (installed.length === 0) {
      log('{yellow-fg}!{/yellow-fg} No agent runtimes installed. Press {cyan-fg}i{/cyan-fg} to install one.');
    }
  } catch {}

  setInterval(refreshAgentTable, 5000);
  screen.render();
}

function run() { createTUI(); }
module.exports = { run };

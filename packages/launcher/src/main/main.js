const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
// AgentManager is loaded lazily after core library is ensured

// ── Core library resolution ──
// Use the globally installed core library at ~/.openagents/nodejs/ instead of
// the bundled copy. This allows independent updates without rebuilding the app.
const PORTABLE_NODE_DIR = path.join(os.homedir(), '.openagents', 'nodejs');
const GLOBAL_MODULES = path.join(PORTABLE_NODE_DIR, 'node_modules');
const CORE_PKG = '@openagents-org/agent-launcher';

// Add global modules to Node's resolution path so require(CORE_PKG) finds it
if (fs.existsSync(GLOBAL_MODULES) && !require('module').globalPaths.includes(GLOBAL_MODULES)) {
  require('module').globalPaths.push(GLOBAL_MODULES);
}

const { Store } = require('./store');

const store = new Store();
let mainWindow = null;
let tray = null;
let agentManager = null;
let coreVersion = null;

// ── Startup log (helps debug first-launch issues) ──
const STARTUP_LOG = path.join(os.homedir(), '.openagents', 'startup.log');
function slog(msg) {
  try {
    fs.mkdirSync(path.dirname(STARTUP_LOG), { recursive: true });
    fs.appendFileSync(STARTUP_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
  console.log('[startup]', msg);
}

// ── File download helper ──
function downloadFile(https, url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const doGet = (u) => {
      https.get(u, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          doGet(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const total = parseInt(res.headers['content-length'] || '0');
        let downloaded = 0;
        const file = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          file.write(chunk);
          if (total && onProgress) onProgress(Math.round(downloaded / total * 100), `${(downloaded/1e6).toFixed(1)} MB`);
        });
        res.on('end', () => { file.end(resolve); });
        res.on('error', reject);
      }).on('error', reject);
    };
    doGet(url);
  });
}

// ── Node.js download (no external deps — works from packaged app) ──
async function downloadNodejs(nodejsDir, onProgress) {
  const https = require('https');
  const nodeVersion = 'v22.14.0';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  // Clean any previous failed install to avoid merge conflicts
  try { fs.rmSync(nodejsDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(nodejsDir, { recursive: true });
  slog(`downloadNodejs: platform=${process.platform} arch=${arch} dir=${nodejsDir}`);

  if (process.platform === 'win32') {
    // Download just node.exe (single binary, no zip extraction needed)
    const nodeExeUrl = `https://nodejs.org/dist/${nodeVersion}/win-${arch}/node.exe`;
    const nodeExeDest = path.join(nodejsDir, 'node.exe');
    slog(`Downloading: ${nodeExeUrl} → ${nodeExeDest}`);

    await downloadFile(https, nodeExeUrl, nodeExeDest, onProgress);
    slog(`node.exe downloaded: ${fs.existsSync(nodeExeDest)}`);

    // Download npm separately (needed for installing agents)
    // npm is distributed as a tarball — download and extract
    const npmVersion = '10.9.2';
    const npmUrl = `https://registry.npmjs.org/npm/-/npm-${npmVersion}.tgz`;
    const npmTgz = path.join(os.tmpdir(), `npm-${npmVersion}.tgz`);
    const npmModDir = path.join(nodejsDir, 'node_modules', 'npm');
    slog(`Downloading npm: ${npmUrl}`);

    if (onProgress) onProgress(85, 'Installing npm...');
    await downloadFile(https, npmUrl, npmTgz, null);

    // Extract npm tarball using tar (built into Windows 10+)
    fs.mkdirSync(npmModDir, { recursive: true });
    try {
      execSync(`tar -xzf "${npmTgz}" -C "${npmModDir}" --strip-components=1`, { timeout: 60000, stdio: 'pipe' });
      slog('npm extracted successfully');
    } catch (e) {
      slog(`npm extraction failed: ${e.message}`);
    }
    try { fs.unlinkSync(npmTgz); } catch {}

    // Create npm.cmd shim
    const npmCliPath = path.join(npmModDir, 'bin', 'npm-cli.js');
    if (fs.existsSync(npmCliPath)) {
      fs.writeFileSync(path.join(nodejsDir, 'npm.cmd'),
        `@echo off\r\n"${nodeExeDest}" "${npmCliPath}" %*\r\n`);
      fs.writeFileSync(path.join(nodejsDir, 'npx.cmd'),
        `@echo off\r\n"${nodeExeDest}" "${path.join(npmModDir, 'bin', 'npx-cli.js')}" %*\r\n`);
      slog('npm.cmd created');
    } else {
      slog(`npm-cli.js not found at ${npmCliPath}`);
    }

  } else {
    // macOS/Linux: download tar.gz
    const platName = process.platform === 'darwin' ? 'darwin' : 'linux';
    const ext = process.platform === 'darwin' ? 'tar.gz' : 'tar.xz';
    const url = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-${platName}-${arch}.${ext}`;
    const tarPath = path.join(os.tmpdir(), `node-${nodeVersion}.${ext}`);

    await downloadFile(https, url, tarPath, onProgress);

    if (onProgress) onProgress(90, 'Extracting...');
    const flag = ext === 'tar.gz' ? '-xzf' : '-xJf';
    execSync(`tar ${flag} "${tarPath}" -C "${nodejsDir}" --strip-components=1`, { timeout: 120000 });
    try { fs.unlinkSync(tarPath); } catch {}

    // Unify paths with Windows: create symlinks in root so node/npm are at
    // ~/.openagents/nodejs/node and ~/.openagents/nodejs/npm (same as Windows)
    const binDir = path.join(nodejsDir, 'bin');
    for (const name of ['node', 'npm', 'npx']) {
      const src = path.join(binDir, name);
      const dest = path.join(nodejsDir, name);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        try { fs.symlinkSync(src, dest); } catch {}
      }
    }
  }

  if (onProgress) onProgress(100, 'Done');
}

// ── Core library management ──
const SKIP_DIRS = new Set(['.git', 'test', 'tests', 'docs', 'example', 'examples', '.github']);
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

function findNpmCommand() {
  const nodeUnified = path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'node.exe' : 'node');
  const nodeBin = fs.existsSync(nodeUnified) ? nodeUnified : path.join(PORTABLE_NODE_DIR, 'bin', 'node');
  if (!fs.existsSync(nodeBin)) return null;
  // Always prefer node.exe + npm-cli.js (avoids cmd.exe Unicode path encoding issues)
  const candidates = [
    path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(PORTABLE_NODE_DIR, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const npmCli = candidates.find(p => fs.existsSync(p));
  if (npmCli) return `"${nodeBin}" "${npmCli}"`;
  // Fallback to npm.cmd (may fail on non-ASCII usernames)
  if (process.platform !== 'win32') {
    const npmBin = path.join(PORTABLE_NODE_DIR, 'bin', 'npm');
    if (fs.existsSync(npmBin)) return `"${npmBin}"`;
  }
  return null;
}

/**
 * Add a package to the prefix's package.json so npm --prefix won't prune it.
 * Tarball-extracted packages aren't tracked by npm — any subsequent
 * `npm install --prefix` would delete them as extraneous.
 */
function _addToPrefixPackageJson(pkg, version) {
  const pkgJsonPath = path.join(PORTABLE_NODE_DIR, 'package.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')); } catch {}
  if (!data.dependencies) data.dependencies = {};
  data.dependencies[pkg] = version;
  try { fs.writeFileSync(pkgJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf-8'); } catch {}
}

let _updateSplash = null; // set by app.whenReady, used by ensureCoreLibrary

async function ensureCoreLibrary() {
  const corePkgPath = path.join(GLOBAL_MODULES, CORE_PKG, 'package.json');
  let installedVersion = null;

  if (fs.existsSync(corePkgPath)) {
    try { installedVersion = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')).version; } catch {}
  }

  // Always try to update to latest on startup
  // Use direct tarball download — avoids npm --prefix which prunes npm itself
  const https = require('https');
  try {
    // Check latest version from registry
    const latestVersion = await new Promise((res, rej) => {
      https.get(`https://registry.npmjs.org/${CORE_PKG}/latest`, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => { try { res(JSON.parse(d).version); } catch { rej(new Error('parse error')); } });
      }).on('error', rej);
    });

    if (!installedVersion) {
      slog('Core library not found — installing v' + latestVersion + '...');
      if (_updateSplash) _updateSplash('Installing core library...', 65, 'v' + latestVersion);
    } else if (latestVersion !== installedVersion) {
      slog('Core library v' + installedVersion + ' → v' + latestVersion + ' update available');
      if (_updateSplash) _updateSplash('Updating core library...', 65, 'v' + installedVersion + ' → v' + latestVersion);
    } else {
      slog('Core library v' + installedVersion + ' (already latest)');
      if (_updateSplash) _updateSplash('Core library up to date', 80, 'v' + installedVersion);
    }

    if (!installedVersion || latestVersion !== installedVersion) {
      // Download and extract tarball directly — no npm needed
      const tgzUrl = `https://registry.npmjs.org/${CORE_PKG}/-/agent-launcher-${latestVersion}.tgz`;
      const tgzPath = path.join(os.tmpdir(), `agent-launcher-${latestVersion}.tgz`);
      const destDir = path.join(GLOBAL_MODULES, CORE_PKG);

      await downloadFile(https, tgzUrl, tgzPath, null);
      // Remove old version
      try { fs.rmSync(destDir, { recursive: true, force: true }); } catch {}
      fs.mkdirSync(destDir, { recursive: true });
      execSync(`tar -xzf "${tgzPath}" -C "${destDir}" --strip-components=1`, { timeout: 60000, stdio: 'pipe' });
      try { fs.unlinkSync(tgzPath); } catch {}

      const newVersion = (() => { try { return JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')).version; } catch { return null; } })();
      if (newVersion) {
        slog('Core library installed: v' + newVersion);
        if (_updateSplash) _updateSplash('Core library ready', 80, 'v' + newVersion);
        installedVersion = newVersion;
        // Register in prefix package.json so npm --prefix won't prune it
        _addToPrefixPackageJson(CORE_PKG, newVersion);
      }
    }
  } catch (e) {
    slog('Core update failed: ' + e.message);
    if (!installedVersion) {
      slog('Falling back to npm...');
      const npmCmd = findNpmCommand();
      if (npmCmd) {
        try {
          execSync(`${npmCmd} install --prefix "${PORTABLE_NODE_DIR}" ${CORE_PKG}@latest --ignore-scripts`, {
            stdio: 'pipe', timeout: 120000,
            env: { ...process.env, PATH: PORTABLE_NODE_DIR + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '') },
          });
          try { installedVersion = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')).version; } catch {}
        } catch {}
      }
    }
  }

  coreVersion = installedVersion;

  // npm --prefix prunes packages not in package.json — npm itself gets deleted.
  // Reinstall npm if it was removed by the core update.
  const npmCheck = path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(npmCheck)) {
    slog('npm was removed by --prefix install — reinstalling...');
    try {
      const https = require('https');
      const npmTgz = path.join(os.tmpdir(), 'npm-reinstall.tgz');
      const npmDir = path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm');
      await downloadFile(https, 'https://registry.npmjs.org/npm/-/npm-10.9.2.tgz', npmTgz, null);
      fs.mkdirSync(npmDir, { recursive: true });
      execSync(`tar -xzf "${npmTgz}" -C "${npmDir}" --strip-components=1`, { timeout: 60000, stdio: 'pipe' });
      try { fs.unlinkSync(npmTgz); } catch {}
      slog('npm reinstalled');
    } catch (e) {
      slog('npm reinstall failed: ' + e.message);
    }
  }

  // Reload agent manager with the (potentially updated) core
  if (installedVersion && agentManager) {
    agentManager.reloadCore();
  }
}

async function checkCoreUpdate() {
  const npmCmd = findNpmCommand();
  if (!npmCmd) {
    slog('checkCoreUpdate: skipped — npm not found');
    return;
  }
  slog('checkCoreUpdate: using ' + npmCmd);
  try {
    const latest = execSync(`${npmCmd} view ${CORE_PKG} version`, {
      encoding: 'utf-8', timeout: 15000,
      env: { ...process.env, PATH: PORTABLE_NODE_DIR + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '') },
    }).trim();

    if (coreVersion && latest && latest !== coreVersion) {
      // Send update info to renderer (shown in sidebar, not a popup)
      if (mainWindow) {
        mainWindow.webContents.send('core-update-available', { current: coreVersion, latest });
      }
    }
  } catch {}
}

function createWindow() {
  if (mainWindow) {
    // Restore Dock icon on macOS before showing window
    if (process.platform === 'darwin' && app.dock) {
      app.dock.show();
    }
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    title: 'OpenAgents Launcher',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    // Minimize to tray instead of closing
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      // Hide Dock icon on macOS so it doesn't distract
      if (process.platform === 'darwin' && app.dock) {
        app.dock.hide();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const assetsDir = path.join(__dirname, '..', '..', 'assets');
  let trayIcon;

  if (process.platform === 'darwin') {
    // macOS: use Template icon (auto-adapts to dark/light menu bar)
    trayIcon = nativeImage.createFromPath(path.join(assetsDir, 'tray-iconTemplate.png'));
  } else {
    // Windows/Linux: use color icon
    trayIcon = nativeImage.createFromPath(path.join(assetsDir, 'tray-icon.png'));
  }

  if (!trayIcon || trayIcon.isEmpty()) trayIcon = createPlaceholderIcon();

  tray = new Tray(trayIcon);
  tray.setToolTip('OpenAgents Launcher');

  updateTrayMenu();

  tray.on('click', () => {
    createWindow();
  });
}

function createPlaceholderIcon() {
  // Generate a 16x16 "OA" tray icon — purple circle with white center
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  const cx = 7.5, cy = 7.5, r = 7, ri = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d <= r) {
        if (d <= ri) {
          // White inner circle
          canvas[i] = 0xFF; canvas[i+1] = 0xFF; canvas[i+2] = 0xFF; canvas[i+3] = 0xFF;
        } else {
          // Purple ring (#6C63FF)
          canvas[i] = 0x6C; canvas[i+1] = 0x63; canvas[i+2] = 0xFF; canvas[i+3] = 0xFF;
        }
      } else {
        // Transparent
        canvas[i] = 0; canvas[i+1] = 0; canvas[i+2] = 0; canvas[i+3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function updateTrayMenu() {
  if (!tray) return;

  const agents = agentManager ? agentManager.getAgents() : [];
  const agentItems = agents.length > 0
    ? agents.map((a) => ({
        label: `${a.name} (${a.state})`,
        enabled: false,
      }))
    : [{ label: 'No agents configured', enabled: false }];

  const menu = Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => createWindow() },
    { type: 'separator' },
    ...agentItems,
    { type: 'separator' },
    {
      label: 'Quit OpenAgents',
      click: async () => {
        const { dialog } = require('electron');
        const result = await dialog.showMessageBox({
          type: 'question',
          buttons: ['Quit', 'Cancel'],
          defaultId: 1,
          title: 'Quit OpenAgents Launcher',
          message: 'Quit OpenAgents Launcher?',
          detail: 'The daemon will stop and all connected agents will go offline.',
        });
        if (result.response === 0) {
          app.isQuitting = true;
          try { if (agentManager) await agentManager.stopAll(); } catch {}
          app.quit();
        }
      },
    },
  ]);

  tray.setContextMenu(menu);
}

// ---- IPC Handlers ----

function setupIPC() {
  // Runtime status (was Python, now Node.js agent-connector)
  ipcMain.handle('python:status', () => ({
    pythonPath: null,
    pythonFound: true,  // No longer needed — always "found" since we're Node.js native
    sdkInstalled: true,
    sdkVersion: coreVersion || 'not installed',
    launcherVersion: require('../../package.json').version,
    runtime: 'node',
  }));
  ipcMain.handle('python:install', () => ({ success: true, message: 'No installation needed — using Node.js agent-connector' }));

  ipcMain.handle('runtime:info', async () => {
    const info = { nodeVersion: null, npmVersion: null, coreVersion: coreVersion || null, latestVersion: null };
    // Node.js version — check unified path (symlink on Unix), then legacy bin/
    const nodeUnified = path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'node.exe' : 'node');
    const nodeBin = fs.existsSync(nodeUnified) ? nodeUnified : path.join(PORTABLE_NODE_DIR, 'bin', 'node');
    if (fs.existsSync(nodeBin)) {
      try { info.nodeVersion = execSync(`"${nodeBin}" --version`, { encoding: 'utf-8', timeout: 5000 }).trim(); } catch {}
    }
    // npm version
    const npmCmd = findNpmCommand();
    if (npmCmd) {
      try {
        info.npmVersion = execSync(`${npmCmd} --version`, {
          encoding: 'utf-8', timeout: 5000,
          env: { ...process.env, PATH: PORTABLE_NODE_DIR + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '') },
        }).trim();
      } catch {}
    }
    // Latest version (from background check or fetch now)
    if (npmCmd) {
      try {
        info.latestVersion = execSync(`${npmCmd} view ${CORE_PKG} version`, {
          encoding: 'utf-8', timeout: 10000,
          env: { ...process.env, PATH: PORTABLE_NODE_DIR + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '') },
        }).trim();
      } catch {}
    }
    return info;
  });

  // Agent CRUD
  ipcMain.handle('agents:list', () => agentManager.getAgents());
  ipcMain.handle('agents:add', (_e, config) => agentManager.addAgent(config));
  ipcMain.handle('agents:remove', (_e, name) => agentManager.removeAgent(name));
  ipcMain.handle('agents:update', (_e, name, config) => agentManager.updateAgent(name, config));

  // Agent lifecycle
  ipcMain.handle('agents:start', (_e, name) => agentManager.startAgent(name));
  ipcMain.handle('agents:stop', (_e, name) => agentManager.stopAgent(name));
  ipcMain.handle('agents:start-all', () => agentManager.startAll());
  ipcMain.handle('agents:stop-all', () => agentManager.stopAll());
  ipcMain.handle('agents:status', () => agentManager.getAllStatus());
  ipcMain.handle('agents:logs', (_e, name, lines) => agentManager.getLogs(name, lines));

  // Agent install (openclaw, etc.)
  ipcMain.handle('agents:install-type', (_e, agentType) => agentManager.installAgentType(agentType));
  ipcMain.handle('agents:install-type-streaming', async (_e, agentType) => {
    return agentManager.installAgentTypeStreaming(agentType, (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('install:output', data);
      }
    });
  });
  ipcMain.handle('agents:uninstall-type', (_e, agentType) => agentManager.uninstallAgentType(agentType));
  ipcMain.handle('agents:uninstall-type-streaming', async (_e, agentType) => {
    return agentManager.uninstallAgentTypeStreaming(agentType, (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('install:output', data);
      }
    });
  });
  ipcMain.handle('agents:check-type', (_e, agentType) => agentManager.checkAgentType(agentType));
  ipcMain.handle('agents:catalog', () => {
    // Clear cached catalog to ensure fresh installed-status check
    try { agentManager._connector.registry._catalog = null; } catch {}
    return agentManager.getCatalog();
  });

  // Agent configuration
  ipcMain.handle('agents:env-fields', (_e, agentType) => agentManager.getEnvFields(agentType));
  ipcMain.handle('agents:get-env', (_e, agentType) => agentManager.getAgentEnv(agentType));
  ipcMain.handle('agents:save-env', (_e, agentType, env) => agentManager.saveAgentEnv(agentType, env));
  ipcMain.handle('agents:test-llm', (_e, env) => agentManager.testLLM(env));
  ipcMain.handle('agents:signal-reload', () => agentManager.signalReload());

  // Workspace connection
  ipcMain.handle('workspace:connect', (_e, agentName, slug) => agentManager.connectWorkspace(agentName, slug));
  ipcMain.handle('workspace:disconnect', (_e, agentName) => agentManager.disconnectWorkspace(agentName));
  ipcMain.handle('workspace:list', () => agentManager.getNetworks());
  ipcMain.handle('workspace:create', (_e, name) => agentManager.createWorkspace(name));

  // Settings
  ipcMain.handle('settings:get', (_e, key) => store.get(key));
  ipcMain.handle('settings:set', (_e, key, value) => store.set(key, value));

  // Health check
  ipcMain.handle('agents:health-check', (_e, type) => agentManager.healthCheck(type));

  // Core library update
  ipcMain.handle('core:update', async () => {
    const npmUnified = path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    const npmBin = fs.existsSync(npmUnified) ? npmUnified : path.join(PORTABLE_NODE_DIR, 'bin', 'npm');
    try {
      execSync(`"${npmBin}" install --prefix "${PORTABLE_NODE_DIR}" ${CORE_PKG}@latest --ignore-scripts`, {
        stdio: 'ignore', timeout: 120000,
        env: { ...process.env, PATH: PORTABLE_NODE_DIR + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '') },
      });
      const corePkgPath = path.join(GLOBAL_MODULES, CORE_PKG, 'package.json');
      try { coreVersion = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')).version; } catch {}
      // Restart daemon
      if (agentManager) {
        try { await agentManager.stopAll(); } catch {}
        agentManager._ensureDaemon().catch(() => {});
      }
      return { success: true, version: coreVersion };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Shell
  ipcMain.handle('shell:open-external', (_e, url) => shell.openExternal(url));
  ipcMain.handle('shell:open-terminal', (_e, cmd) => {
    const { spawn } = require('child_process');
    const { getEnhancedEnv } = (() => { try { return require(path.join(os.homedir(), '.openagents', 'nodejs', 'node_modules', '@openagents-org', 'agent-launcher')).paths; } catch { try { return require('@openagents-org/agent-launcher').paths; } catch { return { getEnhancedEnv: () => process.env }; } } })();
    const env = getEnhancedEnv();
    if (process.platform === 'win32') {
      // Open a visible terminal window with PATH set
      const { execSync } = require('child_process');
      const home = process.env.USERPROFILE || require('os').homedir();
      const portableNode = path.join(home, '.openagents', 'nodejs');
      const npmBin = path.join(process.env.APPDATA || '', 'npm');
      // Include per-agent runtime bins + legacy shared bin
      const runtimeBins = [];
      try {
        const rd = path.join(home, '.openagents', 'runtimes');
        for (const d of fs.readdirSync(rd, { withFileTypes: true })) {
          if (d.isDirectory()) runtimeBins.push(path.join(rd, d.name, 'node_modules', '.bin'));
        }
      } catch {}
      const allBins = [...runtimeBins, path.join(portableNode, 'node_modules', '.bin'), portableNode, npmBin].join(';');
      const setPath = `set PATH=${allBins};%PATH%`;
      execSync(`start "" cmd /K "${setPath} && ${cmd}"`, { stdio: 'ignore', env, shell: true });
    } else if (process.platform === 'darwin') {
      // Open Terminal.app with PATH set so agent binaries are found
      const home = require('os').homedir();
      const portableNode = path.join(home, '.openagents', 'nodejs');
      const portableNodeBin = path.join(portableNode, 'bin');
      // Include per-agent runtime bins + legacy shared bin
      const runtimeBins = [];
      try {
        const rd = path.join(home, '.openagents', 'runtimes');
        for (const d of fs.readdirSync(rd, { withFileTypes: true })) {
          if (d.isDirectory()) runtimeBins.push(path.join(rd, d.name, 'node_modules', '.bin'));
        }
      } catch {}
      const allBins = [...runtimeBins, path.join(portableNode, 'node_modules', '.bin'), portableNodeBin, portableNode, '/usr/local/bin'].join(':');
      const setPath = `export PATH=${allBins}:$PATH`;
      const fullCmd = `${setPath} && ${cmd}`.replace(/"/g, '\\"');
      spawn('osascript', ['-e', `tell app "Terminal" to do script "${fullCmd}"`], { detached: true, stdio: 'ignore' });
    } else {
      // Linux — try common terminal emulators
      const terminals = ['x-terminal-emulator', 'gnome-terminal', 'xterm'];
      for (const term of terminals) {
        try { spawn(term, ['-e', cmd], { detached: true, stdio: 'ignore', env }); return; } catch {}
      }
    }
  });
  ipcMain.handle('shell:exec', (_e, cmd) => {
    const { execSync } = require('child_process');
    const { getEnhancedEnv } = (() => { try { return require(path.join(os.homedir(), '.openagents', 'nodejs', 'node_modules', '@openagents-org', 'agent-launcher')).paths; } catch { try { return require('@openagents-org/agent-launcher').paths; } catch { return { getEnhancedEnv: () => process.env }; } } })();
    const env = getEnhancedEnv();
    // Use ComSpec directly — guaranteed to be the correct path on this system
    const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : true;
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000, shell, env });
  });

  // Debug: expose env for troubleshooting
  // Icons — serve from core library, fall back to bundled
  ipcMain.handle('icons:get-dir', () => {
    const coreIconsDir = path.join(GLOBAL_MODULES, CORE_PKG, 'icons');
    if (fs.existsSync(coreIconsDir)) return coreIconsDir;
    return null;
  });

  ipcMain.handle('icons:get-path', (_e, name) => {
    const slug = (name || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    const coreIcon = path.join(GLOBAL_MODULES, CORE_PKG, 'icons', `${slug}.svg`);
    if (fs.existsSync(coreIcon)) return coreIcon;
    return null;
  });

  ipcMain.handle('debug:env', () => {
    return {
      ComSpec: process.env.ComSpec,
      SystemRoot: process.env.SystemRoot,
      PATH: (process.env.PATH || '').slice(0, 500),
      platform: process.platform,
    };
  });
}

// ---- Single instance lock ----

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another instance is already running — quit silently
  // Note: dialog.showMessageBoxSync() cannot be used here because
  // the app may not be ready yet, which crashes on Windows.
  app.quit();
} else {
  // When a second instance tries to start, focus the existing window
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ---- App lifecycle ----

app.whenReady().then(async () => {
  // Hide menu bar on Windows/Linux (keep on macOS for system conventions)
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }

  createTray();

  // ── Splash screen ──
  const nodeExists = fs.existsSync(path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'node.exe' : 'node'))
    || fs.existsSync(path.join(PORTABLE_NODE_DIR, 'bin', 'node'));
  const coreExists = fs.existsSync(path.join(GLOBAL_MODULES, CORE_PKG, 'package.json'));

  // Always show splash — used for Node.js download, core install, AND core updates
  let splash = new BrowserWindow({
    width: 420, height: 260, frame: false, resizable: false, center: true,
    alwaysOnTop: true, transparent: false, skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  const splashHtml = `data:text/html,
    <html><body style="margin:0;font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:%23f5f5f7;color:%23333;">
      <div style="font-size:28px;font-weight:700;margin-bottom:8px;">OpenAgents Launcher</div>
      <div id="msg" style="font-size:14px;color:%23888;margin-bottom:20px;">${!nodeExists ? 'Preparing first launch...' : 'Starting...'}</div>
      <div style="width:240px;height:6px;background:%23e0e0e0;border-radius:3px;overflow:hidden;">
        <div id="bar" style="width:10%25;height:100%25;background:%236C63FF;border-radius:3px;transition:width 0.5s;"></div>
        </div>
        <div id="detail" style="font-size:11px;color:%23aaa;margin-top:8px;"></div>
      </body></html>`;
  splash.loadURL(splashHtml);
  splash.show();

  const updateSplash = (msg, pct, detail) => {
    if (splash && !splash.isDestroyed()) {
      splash.webContents.executeJavaScript(`
        document.getElementById('msg').textContent='${msg.replace(/'/g, "\\'")}';
        document.getElementById('bar').style.width='${pct}%';
        document.getElementById('detail').textContent='${(detail || '').replace(/'/g, "\\'")}';
      `).catch(() => {});
    }
  };

  // Step 1: Install Node.js if needed
  if (!nodeExists) {
    slog('Node.js not found — starting download');
    updateSplash('Downloading Node.js runtime...', 20, 'This only happens once');
    try {
      await downloadNodejs(PORTABLE_NODE_DIR, (pct, detail) => {
        updateSplash('Downloading Node.js...', 20 + pct * 0.5, detail);
      });
      const nodeExe = path.join(PORTABLE_NODE_DIR, 'node.exe');
      slog(`Download done. node.exe exists: ${fs.existsSync(nodeExe)}`);
      updateSplash('Node.js installed', 70);
    } catch (e) {
      slog(`Node.js install FAILED: ${e.message}\n${e.stack}`);
      updateSplash('Setup failed: ' + e.message, 50, 'Check ~/.openagents/startup.log');
      await new Promise(r => setTimeout(r, 5000));
    }
  } else {
    slog('Node.js already exists');
    updateSplash('Starting...', 50);
  }

  // Step 1b: Ensure npm is installed (might be missing if old launcher installed node without npm)
  const npmCliPath = path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(npmCliPath)) {
    slog('npm not found — installing...');
    updateSplash('Installing npm...', 55);
    try {
      const https = require('https');
      const npmVersion = '10.9.2';
      const npmTgz = path.join(os.tmpdir(), `npm-${npmVersion}.tgz`);
      const npmModDir = path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm');
      await downloadFile(https, `https://registry.npmjs.org/npm/-/npm-${npmVersion}.tgz`, npmTgz, null);
      fs.mkdirSync(npmModDir, { recursive: true });
      execSync(`tar -xzf "${npmTgz}" -C "${npmModDir}" --strip-components=1`, { timeout: 60000, stdio: 'pipe' });
      try { fs.unlinkSync(npmTgz); } catch {}
      // Create npm.cmd shim on Windows
      if (process.platform === 'win32') {
        const nodeExe = path.join(PORTABLE_NODE_DIR, 'node.exe');
        fs.writeFileSync(path.join(PORTABLE_NODE_DIR, 'npm.cmd'),
          `@echo off\r\n"${nodeExe}" "${path.join(npmModDir, 'bin', 'npm-cli.js')}" %*\r\n`);
      }
      slog('npm installed');
    } catch (e) {
      slog('npm install failed: ' + e.message);
    }
  }

  // Step 2: Ensure core library (install or update)
  updateSplash('Checking for updates...', 60);
  _updateSplash = updateSplash;

  // ── PATH setup ──
  if (process.platform === 'win32') {
    const pathDirs = (process.env.PATH || '').toLowerCase().split(';');
    const candidates = [
      PORTABLE_NODE_DIR,
      path.join(process.env.APPDATA || '', 'npm'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
    ].filter(d => {
      try { return d && fs.existsSync(d) && !pathDirs.includes(d.toLowerCase()); }
      catch { return false; }
    });
    if (candidates.length) {
      process.env.PATH += ';' + candidates.join(';');
    }
  } else {
    const binDir = path.join(PORTABLE_NODE_DIR, 'bin');
    if (fs.existsSync(binDir) && !process.env.PATH.includes(binDir)) {
      process.env.PATH = binDir + ':' + process.env.PATH;
    }
  }

  // Ensure core library is installed and check for updates
  await ensureCoreLibrary();

  // Add global modules path
  if (fs.existsSync(GLOBAL_MODULES) && !require('module').globalPaths.includes(GLOBAL_MODULES)) {
    require('module').globalPaths.push(GLOBAL_MODULES);
  }

  // Close splash
  if (splash && !splash.isDestroyed()) {
    splash.webContents.executeJavaScript(`
      document.getElementById('msg').textContent='Ready!';
      document.getElementById('bar').style.width='100%';
    `).catch(() => {});
    await new Promise(r => setTimeout(r, 500));
    splash.close();
    splash = null;
  }

  const { AgentManager } = require('./agent-manager');
  agentManager = new AgentManager(store);

  // Start the daemon on app launch (long-lived background process)
  agentManager._ensureDaemon().catch(() => {});

  // Periodically update tray menu with agent status
  setInterval(() => updateTrayMenu(), 5000);

  setupIPC();
  createWindow();

  // Check for core library updates periodically (every 4 hours)
  // On startup, the auto-update already ran in ensureCoreLibrary.
  // This periodic check catches updates while the app stays open for days.
  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  setInterval(() => checkCoreUpdate().catch(() => {}), FOUR_HOURS);
  // Also check once after 30s (in case the startup auto-update was slow)
  setTimeout(() => checkCoreUpdate().catch(() => {}), 30000);
});

app.on('window-all-closed', () => {
  // Don't quit — keep running in tray
});

app.on('activate', () => {
  createWindow();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  // Stop daemon — agents go offline when launcher quits
  try { if (agentManager) agentManager.stopAll(); } catch {}
});

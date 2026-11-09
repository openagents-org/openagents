/**
 * Autostart — register agent-connector daemon as a system service.
 *
 * - macOS: launchd plist
 * - Linux: systemd user unit
 * - Windows: Task Scheduler XML
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { whichBinary, IS_WINDOWS } = require('./paths');

const IS_MACOS = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux' && !IS_MACOS;
const HOME = process.env.HOME || process.env.USERPROFILE || '';

const SERVICE_LABEL = 'org.openagents.connector';

const DEFAULT_PATH = {
  darwin: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin',
  linux: '/usr/local/bin:/usr/bin:/bin',
};

// Written into the service when set: what the daemon needs to find the
// agents' CLIs and reach the network the way the installing shell did.
// No credentials: a proxy URL with user:pass@ in it is left out.
const SERVICE_ENV_KEYS = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL',
  'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'OPENAGENTS_ENDPOINT',
];

/**
 * The environment a service is written with, taken from `env`. PATH drops
 * entries that belong only to the installing process (npx's cache, a
 * project's node_modules/.bin, relative entries). Returns `{ env, skipped }`,
 * `skipped` naming variables left out because they carry credentials.
 */
function serviceEnv(env = process.env) {
  const out = {};
  const skipped = [];
  for (const key of SERVICE_ENV_KEYS) {
    const value = env[key];
    if (typeof value !== 'string' || value === '' || /[\r\n]/.test(value)) continue;
    if (/PROXY$/i.test(key) && value.includes('@')) { skipped.push(key); continue; }
    out[key] = value;
  }
  if (out.PATH) {
    const sep = IS_WINDOWS ? ';' : ':';
    out.PATH = out.PATH.split(sep).filter((d) => d && path.isAbsolute(d)
      && !/[\\/]_npx[\\/]/.test(d) && !/[\\/]node_modules[\\/]\.bin$/.test(d)).join(sep);
  }
  return { env: out, skipped };
}

/**
 * Enable autostart on login.
 *
 * @param {string} configDir
 * @param {object} [opts]
 * @param {string} [opts.cliPath] - the CLI entry to run; defaults to this
 *   package's. Pass a stable one when this package runs from npx's cache.
 * @param {string} [opts.nodeBin]
 * @param {object} [opts.env] - variables for the service (see serviceEnv);
 *   without it only a default PATH is written, as before.
 */
function enable(configDir, opts = {}) {
  const nodeBin = opts.nodeBin || whichBinary('node') || process.execPath;
  const cliPath = opts.cliPath || path.resolve(__dirname, '..', 'bin', 'agent-connector.js');
  const env = { PATH: DEFAULT_PATH[process.platform] || DEFAULT_PATH.linux, ...(opts.env || {}) };

  if (IS_MACOS) return _enableMacOS(nodeBin, cliPath, configDir, env);
  if (IS_LINUX) return _enableLinux(nodeBin, cliPath, configDir, env);
  if (IS_WINDOWS) return _enableWindows(nodeBin, cliPath, configDir);
  throw new Error(`Autostart not supported on ${process.platform}`);
}

/**
 * Disable autostart.
 */
function disable() {
  if (IS_MACOS) return _disableMacOS();
  if (IS_LINUX) return _disableLinux();
  if (IS_WINDOWS) return _disableWindows();
  throw new Error(`Autostart not supported on ${process.platform}`);
}

/**
 * Check if autostart is enabled.
 */
function isEnabled() {
  if (IS_MACOS) {
    const plistPath = path.join(HOME, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
    return fs.existsSync(plistPath);
  }
  if (IS_LINUX) {
    const unitPath = path.join(HOME, '.config', 'systemd', 'user', 'openagents-connector.service');
    return fs.existsSync(unitPath);
  }
  if (IS_WINDOWS) {
    try {
      execSync(`schtasks /Query /TN "OpenAgents Connector"`, { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// ---- macOS: launchd ----

function _xml(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderPlist(nodeBin, cliPath, configDir, env) {
  const logPath = path.join(configDir, 'daemon.log');
  const envXml = Object.entries(env)
    .map(([k, v]) => `    <key>${_xml(k)}</key>\n    <string>${_xml(v)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${_xml(nodeBin)}</string>
    <string>${_xml(cliPath)}</string>
    <string>up</string>
    <string>--foreground</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${_xml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${_xml(logPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
</dict>
</plist>`;
}

function _enableMacOS(nodeBin, cliPath, configDir, env) {
  const plistDir = path.join(HOME, 'Library', 'LaunchAgents');
  fs.mkdirSync(plistDir, { recursive: true });

  const plistPath = path.join(plistDir, `${SERVICE_LABEL}.plist`);
  const plist = renderPlist(nodeBin, cliPath, configDir, env);

  fs.writeFileSync(plistPath, plist, 'utf-8');
  execSync(`launchctl load -w "${plistPath}"`, { stdio: 'pipe', timeout: 5000 });
  return { enabled: true, path: plistPath };
}

function _disableMacOS() {
  const plistPath = path.join(HOME, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe', timeout: 5000 });
  } catch {}
  try { fs.unlinkSync(plistPath); } catch {}
  return { enabled: false };
}

// ---- Linux: systemd user unit ----

function _systemdQuote(v) {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
}

function renderUnit(nodeBin, cliPath, env) {
  const envLines = Object.entries(env)
    .map(([k, v]) => `Environment=${_systemdQuote(`${k}=${v}`)}`).join('\n');
  return `[Unit]
Description=OpenAgents Connector Daemon
After=network.target

[Service]
Type=simple
ExecStart=${_systemdQuote(nodeBin)} ${_systemdQuote(cliPath)} up --foreground
Restart=on-failure
RestartSec=10
${envLines}

[Install]
WantedBy=default.target
`;
}

function _enableLinux(nodeBin, cliPath, configDir, env) {
  const unitDir = path.join(HOME, '.config', 'systemd', 'user');
  fs.mkdirSync(unitDir, { recursive: true });

  const unitPath = path.join(unitDir, 'openagents-connector.service');

  const unit = renderUnit(nodeBin, cliPath, env);

  fs.writeFileSync(unitPath, unit, 'utf-8');
  execSync('systemctl --user daemon-reload', { stdio: 'pipe', timeout: 5000 });
  execSync('systemctl --user enable openagents-connector.service', { stdio: 'pipe', timeout: 5000 });
  execSync('systemctl --user start openagents-connector.service', { stdio: 'pipe', timeout: 5000 });
  return { enabled: true, path: unitPath };
}

function _disableLinux() {
  try {
    execSync('systemctl --user stop openagents-connector.service', { stdio: 'pipe', timeout: 5000 });
  } catch {}
  try {
    execSync('systemctl --user disable openagents-connector.service', { stdio: 'pipe', timeout: 5000 });
  } catch {}
  const unitPath = path.join(HOME, '.config', 'systemd', 'user', 'openagents-connector.service');
  try { fs.unlinkSync(unitPath); } catch {}
  return { enabled: false };
}

// ---- Windows: Task Scheduler ----

function _enableWindows(nodeBin, cliPath, configDir) {
  const taskName = 'OpenAgents Connector';
  const cmd = `schtasks /Create /SC ONLOGON /TN "${taskName}" /TR "\\"${nodeBin}\\" \\"${cliPath}\\" up --foreground" /RL HIGHEST /F`;
  execSync(cmd, { stdio: 'pipe', timeout: 10000 });
  return { enabled: true, method: 'Task Scheduler' };
}

function _disableWindows() {
  try {
    execSync('schtasks /Delete /TN "OpenAgents Connector" /F', { stdio: 'pipe', timeout: 5000 });
  } catch {}
  return { enabled: false };
}

module.exports = { enable, disable, isEnabled, serviceEnv, renderPlist, renderUnit };

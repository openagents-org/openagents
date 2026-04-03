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

/**
 * Enable autostart on login.
 */
function enable(configDir) {
  const nodeBin = whichBinary('node') || process.execPath;
  const cliPath = path.resolve(__dirname, '..', 'bin', 'agent-connector.js');

  if (IS_MACOS) return _enableMacOS(nodeBin, cliPath, configDir);
  if (IS_LINUX) return _enableLinux(nodeBin, cliPath, configDir);
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

function _enableMacOS(nodeBin, cliPath, configDir) {
  const plistDir = path.join(HOME, 'Library', 'LaunchAgents');
  fs.mkdirSync(plistDir, { recursive: true });

  const plistPath = path.join(plistDir, `${SERVICE_LABEL}.plist`);
  const logPath = path.join(configDir, 'daemon.log');

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${cliPath}</string>
    <string>up</string>
    <string>--foreground</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>`;

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

function _enableLinux(nodeBin, cliPath, configDir) {
  const unitDir = path.join(HOME, '.config', 'systemd', 'user');
  fs.mkdirSync(unitDir, { recursive: true });

  const unitPath = path.join(unitDir, 'openagents-connector.service');

  const unit = `[Unit]
Description=OpenAgents Connector Daemon
After=network.target

[Service]
Type=simple
ExecStart=${nodeBin} ${cliPath} up --foreground
Restart=on-failure
RestartSec=10
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
`;

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

module.exports = { enable, disable, isEnabled };

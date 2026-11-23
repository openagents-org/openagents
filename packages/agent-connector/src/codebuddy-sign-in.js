'use strict';

const os = require('os');
const { getEnhancedEnv, isNodeShebangScript, resolveManagedNpmPackageBin } = require('./paths');
const { spawn, isWslBinary } = require('./wsl');
const { AcpClient } = require('./adapters/acp-client');
const { shouldUseShellForBinary } = require('./adapters/health-status');
const { resolveCodeBuddyEnv } = require('./adapters/codebuddy-stream');
const { stripForCliLogin, AUTH_MODE_KEY, CLI_LOGIN } = require('./env');
const { killTree } = require('./probe');

function codeBuddyLoginEnv(connector, agentEnv = {}) {
  const env = stripForCliLogin('codebuddy', {
    ...getEnhancedEnv(), ...connector.getAgentEnv('codebuddy'), ...agentEnv,
  }, connector.registry, { [AUTH_MODE_KEY]: CLI_LOGIN });
  return { ...env, ...resolveCodeBuddyEnv(env) };
}

function spawnCodeBuddy(binary, args, opts) {
  // Prefer the managed package entry on Windows. This also works under a user
  // profile with spaces or non-ASCII characters, without an npm command shim.
  let file = binary;
  const shell = shouldUseShellForBinary(file);
  if (shell) file = resolveManagedNpmPackageBin('codebuddy', '@tencent-ai/codebuddy-code', 'codebuddy') || binary;
  if (!isWslBinary(file) && (/\.[cm]?js$/i.test(file) || isNodeShebangScript(file))) {
    return spawn(process.execPath, [file, ...args], opts);
  }
  return shouldUseShellForBinary(file)
    ? spawn('"' + file + '"', args, { ...opts, shell: true })
    : spawn(file, args, opts);
}

/** Account presence in the CLI's own session. All provider data stays in this process. */
async function checkCodeBuddySignIn(binary, env, { timeoutMs = 12_000 } = {}) {
  if (!binary) return null;
  let child, client;
  try {
    child = spawnCodeBuddy(binary, ['--acp'], { env, cwd: os.homedir(), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    client = new AcpClient(child);
    const deadline = Date.now() + timeoutMs;
    const init = await client.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, { timeoutMs });
    if (init?.protocolVersion !== 1) return null;
    const reply = await client.request('_codebuddy.ai/getUserInfo', {}, { timeoutMs: Math.max(1, deadline - Date.now()) });
    if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return null;
    // The CLI serializes { userInfo: undefined } to {} after auth initialization
    // when signed out. Unrecognized shapes and unsupported methods stay unknown.
    if (!Object.keys(reply).length || reply.userInfo === null) return false;
    const id = reply.userInfo?.userId;
    return typeof id === 'string' && id.trim() ? true : null;
  } catch {
    return null;
  } finally {
    client?.close();
    if (child) {
      child.stdin?.end();
      if (child.pid && child.exitCode === null && !child.signalCode) killTree(child);
      child.stdout?.destroy();
      child.stdin?.destroy();
    }
  }
}

module.exports = { codeBuddyLoginEnv, spawnCodeBuddy, checkCodeBuddySignIn };

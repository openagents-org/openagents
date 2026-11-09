'use strict';

/**
 * `agn login <agent>` — sign an agent's own CLI in to its account on this device.
 *
 * The account belongs to the CLI, not to OpenAgents (`codex login` writes
 * ~/.codex/auth.json and the adapter only runs codex), so this runs the CLI's
 * own login command from the registry. What it adds over typing that command:
 *
 *   - The CLI is found where OpenAgents installed it. An agent added from the
 *     workspace lands in ~/.openagents/runtimes/<type>/, which the install
 *     scripts never put on the user's PATH, so a bare `codex login` on that
 *     machine is "command not found".
 *   - A machine with no local browser gets the login that works without one.
 *   - The daemon re-detects afterwards, so the workspace stops saying the agent
 *     has no credentials without waiting for its 2-minute refresh.
 */

/**
 * Arguments a CLI's login needs when the browser is not on this machine.
 * `codex login` waits for its browser on 127.0.0.1:1455, which a browser on
 * another computer can never reach; `--device-auth` prints a URL and a one-time
 * code that work from any browser. Claude (paste the code back) and Cursor (the
 * CLI polls its own server) need nothing extra.
 */
const HEADLESS_LOGIN_ARGS = {
  codex: ['--device-auth'],
};

/**
 * Sign-ins the registry does not declare as `login_command`. Declaring one
 * there also changes how the add form and the daemon treat the type's keys
 * and models, so `agn login` knows these on its own.
 */
const EXTRA_LOGIN_COMMANDS = {
  // In `opencode auth login` (1.19.5) OpenAI offers a ChatGPT Plus/Pro sign-in
  // and GitHub Copilot a GitHub one; every other provider only takes a key.
  opencode: 'opencode auth login',
};

/** The login command for a registry entry: its own, else one named above. */
function loginCommandOf(entry) {
  if (!entry) return null;
  const declared = entry.check_ready && entry.check_ready.login_command;
  const command = (declared && String(declared).trim()) || EXTRA_LOGIN_COMMANDS[entry.name] || '';
  return command || null;
}

/**
 * Whether a browser opened by the CLI would not be in front of the user: an
 * SSH session anywhere, or Linux with no display server.
 */
function isHeadless(env = process.env, platform = process.platform) {
  if (env.SSH_CONNECTION || env.SSH_TTY) return true;
  return platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY;
}

/** `"claude auth login"` → `["auth", "login"]`: the binary is resolved separately. */
function loginArgs(loginCommand) {
  return String(loginCommand || '').trim().split(/\s+/).filter(Boolean).slice(1);
}

/**
 * The login to run for a registry entry, or null when its CLI has no sign-in
 * of its own (those agents only take an API key).
 */
function loginPlan(entry, { env = process.env, platform = process.platform } = {}) {
  const command = loginCommandOf(entry);
  if (!command) return null;
  const args = loginArgs(command);
  const headless = isHeadless(env, platform);
  const extra = headless ? (HEADLESS_LOGIN_ARGS[entry.name] || []) : [];
  return {
    command,
    args: [...args, ...extra.filter((a) => !args.includes(a))],
    headless,
  };
}

/** The command a workspace shows for signing an agent type in on a device. */
function agnLoginCommand(type) {
  return `agn login ${type}`;
}

module.exports = {
  HEADLESS_LOGIN_ARGS,
  EXTRA_LOGIN_COMMANDS,
  isHeadless,
  loginArgs,
  loginCommandOf,
  loginPlan,
  agnLoginCommand,
};

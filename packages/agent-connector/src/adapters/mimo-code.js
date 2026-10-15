/**
 * MiMo Code adapter — Xiaomi's terminal coding agent (`mimo`).
 *
 * The CLI is a fork of OpenCode: `run --format json` streams OpenCode's JSON
 * events and `--session` resumes, so stream parsing, sessions and the failure
 * taxonomy are OpenCodeAdapter's. What differs (verified against 0.1.14 and
 * 0.1.15):
 *
 *   - Installed by Xiaomi's own script into ~/.mimocode/bin (Windows:
 *     %USERPROFILE%\.mimocode\bin\mimo.exe, or MIMOCODE_INSTALL_DIR), never
 *     npm. The file is the native binary itself, so it is spawned directly.
 *   - Everything a run needs — the provider, the key, the workspace MCP server
 *     and the workspace briefing — goes in through MIMOCODE_CONFIG_CONTENT,
 *     which MiMo loads after the user's own config and keeps out of the
 *     environment of the commands its tools run. Nothing is written into the
 *     project or into the user's MiMo config. See mimo-code-runtime.js for why
 *     the run is pinned to one provider.
 *   - The briefing is an `instructions` file read on every run, so it is part
 *     of the system prompt each turn (fresh mode and pinned decisions) rather
 *     than a preamble in the first message.
 *   - Nearly every failure exits 0: an API error is an `error` event on stdout;
 *     no credential, or a session the CLI does not have, is an `error:` line
 *     on stderr after a dump of the CLI's bundled source.
 *   - A permission the run would have to ask for is refused on the spot and
 *     the turn ends with no reply, so runs pass --dangerously-skip-permissions:
 *     the daemon is the approval boundary, as for every other agent here.
 *   - Stop: the CLI has no signal handling and dies at once, while each shell
 *     command it started runs in a session of its own — outside the CLI's
 *     process group — and is left running. Stop walks the process tree.
 *   - Claude Code's MCP servers (~/.claude.json) and its CLAUDE.md, which
 *     MiMo imports by default, are left out (MIMOCODE_DISABLE_CLAUDE_CODE_MCP,
 *     MIMOCODE_DISABLE_CLAUDE_CODE_PROMPT).
 *   - Its scheduler is turned off (MIMOCODE_EXPERIMENTAL_CRON=0): a one-shot
 *     run cannot fire a schedule, and while on it creates `.mimocode/` in the
 *     project, which the next run then installs MiMo's plugin package into.
 */

'use strict';

const { execFileSync, execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OpenCodeAdapter = require('./opencode');
const { buildClaudeSystemPrompt } = require('./workspace-prompt');
const { whichBinary } = require('../paths');
const {
  MIMO_DEFAULT_BASE_URL,
  resolveMimoRoute,
  buildMimoRunConfig,
  buildMimoRunArgs,
  descendantsOf,
  parseProcessTable,
  mimoErrorLine,
  isMissingSession,
} = require('./mimo-code-runtime');

const IS_WINDOWS = process.platform === 'win32';

/** Newest CLI this adapter was checked against. Newer still runs, flagged. */
const MIMO_TESTED_VERSION = '0.1.15';
/** Oldest release still downloadable when this was written, and verified to work. */
const MIMO_MIN_VERSION = '0.1.14';

/** How long Stop waits for a polite exit before SIGKILL. */
const STOP_GRACE_MS = 1500;

const INSTALL_HINT = 'curl -fsSL https://mimo.xiaomi.com/install | bash  (Windows: irm https://mimo.xiaomi.com/install.ps1 | iex)';
const KEY_URL = 'https://platform.xiaomimimo.com';

const FAILURE_MESSAGES = {
  cli_not_found: `MiMo Code CLI not found. Install it (${INSTALL_HINT}) and try again.`,
  cli_not_executable: 'MiMo Code CLI was found but could not be started. Reinstall it, then retry.',
  unsupported_version: `This MiMo Code version is not supported (requires >= ${MIMO_MIN_VERSION}). Update it with \`mimo upgrade\` and retry.`,
  model_missing: "No model is configured for MiMo Code. Set a model (LLM_MODEL) in this agent's configuration, then retry.",
  credential_missing: `MiMo Code is not signed in and has no API key. Sign in with a Xiaomi account (the agent's Sign in button, or \`mimo providers login -p xiaomi\`), or add an API key (LLM_API_KEY — a MiMo key from ${KEY_URL}, or a key for the base URL you set) in this agent's configuration, then retry.`,
  auth_failed: "The model service rejected MiMo Code's API key. Check LLM_API_KEY, and that it belongs to the base URL you set (a Token Plan key needs its Token Plan base URL), then retry. Signed in with a Xiaomi account instead? Sign in again — the key that sign-in created may have been deleted on the MiMo platform.",
  provider_not_configured: "MiMo Code has no usable model provider. Check this agent's base URL and model, then retry.",
  model_not_found: 'The configured model was not found or this key cannot use it. Pick one from the model list in this agent\'s configuration, then retry.',
  rate_limited: 'The model service is rate-limiting requests. Wait a moment and retry.',
  network_error: 'MiMo Code could not reach the model service (network or service error). Retry shortly.',
  provider_server_error: 'The model service returned a server error. Retry shortly.',
  timeout: 'MiMo Code went quiet for too long and was stopped. If the model service keeps failing, MiMo retries without saying so — check the base URL and model, then retry.',
  stream_parse_error: 'MiMo Code produced output this version could not parse. Update it with `mimo upgrade`, or open diagnostics.',
  empty_response: 'MiMo Code finished without producing a final reply. Retry; if it persists, open diagnostics.',
  incomplete_run: 'MiMo Code stopped mid-task right after a tool call and never produced a final reply — its progress notes are shown above. Send "continue" to pick up where it left off.',
  process_crashed: 'MiMo Code exited unexpectedly. Open diagnostics or retry.',
  cwd_unavailable: "MiMo Code's working directory is not accessible. Check the agent's configured path (or agent home) permissions.",
  session_missing: 'MiMo Code no longer has this conversation\'s session. Send the message again to start a new one.',
  unknown_error: 'MiMo Code failed for an undetermined reason. Open diagnostics or retry.',
};

class MiMoCodeAdapter extends OpenCodeAdapter {
  constructor(opts) {
    super(opts);
    this._runDir = path.join(this.agentHome, 'mimo-code');
  }

  _cliLabel() {
    return 'MiMo Code';
  }

  _installHint() {
    return `Install with: ${INSTALL_HINT}`;
  }

  _failureMessages() {
    return FAILURE_MESSAGES;
  }

  /**
   * `mimo` where the installer puts it. ~/.mimocode/bin and
   * MIMOCODE_INSTALL_DIR are among the known bin dirs (paths.js), so the
   * lookup that decides whether the CLI is installed is the one that runs it.
   */
  _findOpencodeBinary() {
    return whichBinary('mimo');
  }

  /** Where one run goes — see resolveMimoRoute. */
  _route() {
    return resolveMimoRoute(this.agentEnv || process.env, this.workspaceModel);
  }

  /** `provider/model`, or '' when a key is set for an endpoint with no model given. */
  _resolveModel() {
    return this._route().modelRef;
  }

  modelLabel() {
    return this._route().model || super.modelLabel();
  }

  // Providers are declared per run in MIMOCODE_CONFIG_CONTENT, never on disk,
  // and the workspace is reached over MCP rather than a skill file.
  _customBaseUrl() {
    return '';
  }

  _ensureCustomProviderConfig() {}

  _ensureWorkspaceSkill() {}

  /**
   * 'present' with a key in this agent's configuration, or with a MiMo
   * sign-in for the provider the model names. A Xiaomi-account sign-in is
   * stored as an API key the MiMo platform issued for the CLI, under `xiaomi`
   * in auth.json; an entry without one signs nothing in. A model on some other provider
   * the user set up in MiMo is theirs to vouch for: 'unknown', and the run
   * reports what the CLI says.
   */
  _credentialState() {
    const route = this._route();
    if (route.mode === 'key') return 'present';
    const env = this.agentEnv || process.env;
    if (route.providerId !== 'xiaomi') return 'unknown';
    if (String(env.XIAOMI_API_KEY || '').trim()) return 'present';
    const auth = MiMoCodeAdapter._readAuthFile(env);
    const entry = auth && auth.xiaomi;
    if (entry && typeof entry === 'object' && String(entry.key || '').trim()) return 'present';
    return 'missing';
  }

  /**
   * MiMo's credential store. It follows the XDG data dir on every platform
   * (on Windows too, under the user profile), as OpenCode's does.
   */
  static _authFilePath(env = process.env, home = os.homedir()) {
    const dataHome = String(env.XDG_DATA_HOME || '').trim() || path.join(home, '.local', 'share');
    return path.join(dataHome, 'mimocode', 'auth.json');
  }

  static _readAuthFile(env) {
    try {
      const data = JSON.parse(fs.readFileSync(MiMoCodeAdapter._authFilePath(env), 'utf-8'));
      return data && typeof data === 'object' ? data : null;
    } catch {
      return null;
    }
  }

  static _classifyVersion(version) {
    if (!version || !/^\d+\.\d+/.test(String(version))) return 'unknown';
    if (OpenCodeAdapter._cmpVer(version, MIMO_MIN_VERSION) < 0) return 'unsupported';
    return OpenCodeAdapter._cmpVer(version, MIMO_TESTED_VERSION) > 0 ? 'degraded' : 'ok';
  }

  // ------------------------------------------------------------------
  // One run
  // ------------------------------------------------------------------

  _buildRunArgs({ runCwd, model, sessionId, channel }) {
    return buildMimoRunArgs({
      runCwd,
      model,
      sessionId,
      title: `OpenAgents - ${channel || this.channelName}`,
      plan: this._mode === 'plan',
    });
  }

  /**
   * The message as typed. The briefing reaches the model through the run's
   * `instructions` file; only when that file could not be written does a new
   * session fall back to carrying it in its first message.
   */
  _composePrompt(content, msgChannel, sessionId) {
    if (this._instructionsReady(msgChannel)) return content;
    return super._composePrompt(content, msgChannel, sessionId);
  }

  _buildSystemContext(channelName) {
    return buildClaudeSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName,
      mode: this._mode,
      model: this.modelLabel(),
      browserEnabled: !!this._browserEnabledCache,
      toolMode: 'mcp',
      ...this.pinnedPromptOpts(channelName),
    });
  }

  _instructionsPath(channel) {
    const slug = crypto.createHash('sha256').update(String(channel)).digest('hex').slice(0, 16);
    return path.join(this._runDir, `instructions-${slug}.md`);
  }

  _instructionsReady(channel) {
    return !!(this._instructionsWritten && this._instructionsWritten.has(channel));
  }

  /** (Re)write this channel's briefing, read by the CLI at the start of the run. */
  _writeInstructions(channel) {
    if (!this._instructionsWritten) this._instructionsWritten = new Set();
    try {
      fs.mkdirSync(this._runDir, { recursive: true });
      fs.writeFileSync(this._instructionsPath(channel), this._buildSystemContext(channel), 'utf-8');
      this._instructionsWritten.add(channel);
    } catch (e) {
      this._instructionsWritten.delete(channel);
      this._log(`Could not write the workspace briefing (it goes in the first message instead): ${OpenCodeAdapter._redact(e && e.message)}`);
    }
  }

  /**
   * The workspace MCP server: this package's own CLI, run by the Node that
   * runs the daemon (or the launcher's portable one). Its token goes in the
   * server's environment only.
   */
  _mcpServer(channel) {
    const entry = path.resolve(__dirname, '..', '..', 'bin', 'agent-connector.js');
    if (!fs.existsSync(entry)) {
      this._log('Could not find the agent-connector CLI — workspace MCP tools are unavailable this run');
      return null;
    }
    const args = [
      entry, 'mcp-server',
      '--workspace-id', this.workspaceId,
      '--channel-name', channel,
      '--agent-name', this.agentName,
      '--endpoint', this.endpoint,
    ];
    if (this.disabledModules.has('files')) args.push('--disable-files');
    if (this.disabledModules.has('browser')) args.push('--disable-browser');
    if (this.disabledModules.has('knowledge')) args.push('--disable-knowledge');
    return { command: this._nodeBin(), args, env: { OA_WORKSPACE_TOKEN: this.token } };
  }

  /** The launcher's portable Node when present, else the one running the daemon. */
  _nodeBin() {
    const root = path.join(os.homedir(), '.openagents', 'nodejs');
    const candidates = IS_WINDOWS
      ? [path.join(root, 'node.exe')]
      : [path.join(root, 'node'), path.join(root, 'bin', 'node')];
    return candidates.find((c) => fs.existsSync(c)) || process.execPath;
  }

  _spawnEnv(channel) {
    const env = { ...(this.agentEnv || process.env) };
    // The key is in the run config, which MiMo keeps away from its tools'
    // commands; left in the environment, any `env` the model runs would print it.
    delete env.LLM_API_KEY;
    const ch = channel || this.channelName;
    const config = buildMimoRunConfig(this._route(), {
      mcp: this._mcpServer(ch),
      instructions: this._instructionsReady(ch) ? [this._instructionsPath(ch)] : [],
    });
    return {
      ...env,
      MIMOCODE_CONFIG_CONTENT: JSON.stringify(config),
      MIMOCODE_EXPERIMENTAL_CRON: '0',
      MIMOCODE_DISABLE_AUTOUPDATE: '1',
      // MiMo otherwise starts every MCP server in Claude Code's ~/.claude.json
      // on each run and offers its tools to the model, and puts Claude Code's
      // ~/.claude/CLAUDE.md in the system prompt. MiMo's own AGENTS.md still loads.
      MIMOCODE_DISABLE_CLAUDE_CODE_MCP: '1',
      MIMOCODE_DISABLE_CLAUDE_CODE_PROMPT: '1',
    };
  }

  /**
   * Prepare the briefing, then run. A session the CLI no longer has (its
   * database was reset, or the agent moved machines) fails the resume; the
   * binding is dropped and the turn runs once more in a new session.
   */
  async _runOpencode(content, msgChannel) {
    await this.getBrowserEnabled();
    this._writeInstructions(msgChannel);
    try {
      return await super._runOpencode(content, msgChannel);
    } catch (e) {
      if (!e || e.category !== 'session_missing' || !this._channelSessions[msgChannel]) throw e;
      this._log(`MiMo Code has no session ${this._channelSessions[msgChannel]} — starting a new one`);
      delete this._channelSessions[msgChannel];
      this._saveSessions();
      return super._runOpencode(content, msgChannel);
    }
  }

  /**
   * Remember the session as soon as the CLI names it, not only when the run
   * ends cleanly: a stopped turn is resumable, and the next message should
   * continue it rather than start over.
   */
  async _handleStreamEvent(event, msgChannel, responseState = null) {
    const sid = event && typeof event.sessionID === 'string' ? event.sessionID : '';
    if (sid && this._channelSessions[msgChannel] !== sid) {
      this._channelSessions[msgChannel] = sid;
      this._saveSessions();
      this._log(`MiMo Code session for channel ${msgChannel}: ${sid}`);
    }
    // Reasoning only appears with --thinking, which runs do not pass; should
    // it ever arrive it is not part of the reply.
    if (event && event.type === 'reasoning') return;
    return super._handleStreamEvent(event, msgChannel, responseState);
  }

  // ------------------------------------------------------------------
  // Stop
  // ------------------------------------------------------------------

  /**
   * End the CLI and every command it started. Returns whether the CLI itself
   * is gone.
   *
   * Windows: taskkill /T walks the tree by parent, which is all it takes — as
   * long as the CLI is still alive to walk from, so it is not asked to exit
   * first. Elsewhere the descendants are read from the process table before
   * anything is signalled, because each shell command sits in its own session
   * and is reparented the moment the CLI dies.
   */
  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null || proc.signalCode) return true;
    if (IS_WINDOWS) {
      try { execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 5000, windowsHide: true }); } catch {}
      return this._waitForExit(proc, STOP_GRACE_MS);
    }

    const groups = new Set([proc.pid]);
    const pids = new Set();
    for (const d of descendantsOf(MiMoCodeAdapter._processTable(), proc.pid)) {
      pids.add(d.pid);
      if (d.pgid > 1 && d.pgid !== process.pid) groups.add(d.pgid);
    }
    const signal = (sig) => {
      for (const g of groups) { try { process.kill(-g, sig); } catch {} }
      for (const p of pids) { try { process.kill(p, sig); } catch {} }
      try { proc.kill(sig); } catch {}
    };

    signal('SIGTERM');
    if (await this._waitForExit(proc, STOP_GRACE_MS) && ![...pids].some(MiMoCodeAdapter._alive)) return true;
    signal('SIGKILL');
    return this._waitForExit(proc, 1000);
  }

  _waitForExit(proc, ms) {
    if (proc.exitCode !== null || proc.signalCode) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(proc.exitCode !== null || !!proc.signalCode), ms);
      proc.once('exit', () => { clearTimeout(timer); resolve(true); });
    });
  }

  static _processTable() {
    try {
      return parseProcessTable(execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid='], { encoding: 'utf-8', timeout: 3000 }));
    } catch {
      return [];
    }
  }

  static _alive(pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); }
  }

  // ------------------------------------------------------------------
  // Failure classification
  // ------------------------------------------------------------------

  /** OpenCode's taxonomy plus the CLI's own wording, read from its error line. */
  static _classifyFailure(input = {}) {
    const line = mimoErrorLine(input.stderr);
    const result = super._classifyFailure(line ? { ...input, stderr: line } : input);
    if (isMissingSession(input.stderr)) return { ...result, category: 'session_missing' };
    // "MiMo free API service has ended. Sign in or configure a third-party API."
    if (/free API service has ended|sign in or configure/i.test(line)) {
      return { ...result, category: 'credential_missing' };
    }
    // MiMo's API answers a model it does not serve with a 400 worded
    // "Unsupported model <id>", which OpenCode's patterns read as unknown.
    const err = input.stdoutErr || OpenCodeAdapter._extractErrorFromStdout(input.stdout || '');
    if (/unsupported model/i.test(`${(err && err.message) || ''} ${line}`)) {
      return { ...result, category: 'model_not_found' };
    }
    return result;
  }

  /**
   * Exit 0 with nothing on stdout is a failure the CLI described on stderr —
   * a missing credential, an unknown session — not an empty reply.
   */
  static _outcomeForCleanExit(args = {}) {
    const outcome = super._outcomeForCleanExit(args);
    if (!outcome.failure || outcome.failure.category !== 'empty_response') return outcome;
    const line = mimoErrorLine(args.stderr);
    if (!line && !isMissingSession(args.stderr)) return outcome;
    const cls = this._classifyFailure({ code: 0, signal: null, stdout: '', stderr: args.stderr });
    return {
      failure: {
        category: ['stream_parse_error', 'process_crashed'].includes(cls.category) ? 'unknown_error' : cls.category,
        diagnostic: `exit 0, stderr: ${line}`,
        detail: OpenCodeAdapter._redact(line).slice(0, 200),
      },
    };
  }
}

MiMoCodeAdapter.MIMO_TESTED_VERSION = MIMO_TESTED_VERSION;
MiMoCodeAdapter.MIMO_MIN_VERSION = MIMO_MIN_VERSION;
MiMoCodeAdapter.MIMO_DEFAULT_BASE_URL = MIMO_DEFAULT_BASE_URL;

module.exports = MiMoCodeAdapter;

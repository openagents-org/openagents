/**
 * Claude Code adapter for OpenAgents workspace.
 *
 * Bridges Claude Code to an OpenAgents workspace via:
 * - Polling loop for incoming messages
 * - Claude CLI subprocess (stream-json) for task execution
 * - MCP server for workspace tool access
 *
 * Direct port of Python: sdk/src/openagents/adapters/claude.py
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt, SESSION_DEFAULT_RE, generateSessionTitle } = require('./utils');
const { buildClaudeSystemPrompt, buildClaudeSkillMd } = require('./workspace-prompt');
const { defaultAgentWorkdir, whichBinary, getEnhancedEnv } = require('../paths');

const IS_WINDOWS = process.platform === 'win32';

class ClaudeAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   * @param {string} [opts.workingDir]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();
    /** @type {'mcp' | 'skills'} Tool integration mode */
    this.toolMode = opts.toolMode || 'skills';
    this._channelSessions = {}; // channel → Claude CLI session_id
    this._channelProcesses = {}; // channel → child process
    this._stoppingChannels = new Set();
    this._persistentProcs = {}; // channel → { proc, lineBuffer, pendingLines, idleTimer, messageResolve }
    this._IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
    this._WATCHDOG_INTERVAL_MS = 15_000; // 15s between checks
    this._WATCHDOG_MAX_TIMEOUTS = 20;    // 20 * 15s = 5 min of silence → kill
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}.json`
    );
    this._loadSessions();
  }

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelSessions, data);
          this._log(`Loaded ${Object.keys(data).length} session(s)`);
        }
      }
    } catch {
      this._log('Could not load sessions file, starting fresh');
    }
  }

  _saveSessions() {
    try {
      const dir = path.dirname(this._sessionsFile);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions));
    } catch {}
  }

  async _onControlAction(action, payload) {
    if (action === 'stop') {
      const channel = (payload && typeof payload === 'object') ? payload.channel : null;
      if (channel) {
        const pp = this._persistentProcs[channel];
        if (pp) pp.userStopped = true;
      }
      if (channel && this._channelProcesses[channel]) {
        this._log(`Stopping process for channel=${channel}`);
        this._stoppingChannels.add(channel);
        const proc = this._channelProcesses[channel];
        await this._stopProcess(proc);
        delete this._channelProcesses[channel];
        delete this._channelQueues[channel];
        try {
          await this.sendResponse(channel, 'Execution stopped by user.');
        } catch {}
      } else {
        for (const pp of Object.values(this._persistentProcs)) pp.userStopped = true;
        await this._stopAllProcesses('Execution stopped by user.');
      }
      return;
    }
    if (action === 'restart') {
      const channel = (payload && typeof payload === 'object') ? payload.channel : null;
      if (channel) {
        // Kill in-flight subprocess + clear the per-channel session BEFORE
        // asking the daemon to bounce us. The new adapter spawned after
        // the bounce loads sessions from disk, so the cleared state must
        // be persisted first.
        const proc = this._channelProcesses[channel];
        if (proc) {
          try { await this._stopProcess(proc); } catch {}
          delete this._channelProcesses[channel];
        }
        if (this._channelSessions[channel]) {
          delete this._channelSessions[channel];
          try { this._saveSessions(); } catch {}
          this._log(`Restart: cleared session for channel=${channel}`);
        } else {
          this._log(`Restart: no session to clear for channel=${channel}`);
        }
        // Post the status BEFORE the bounce so the message lands while
        // we're still online.
        try {
          await this.client.sendMessage(this.workspaceId, channel, this.token,
            'Session restarted — next message starts fresh.',
            {
              senderType: 'agent',
              senderName: this.agentName,
              messageType: 'status',
              metadata: { agent_mode: this._mode },
              sessionId: this._sessionId,
            });
        } catch (e) {
          this._log(`Restart: failed to post status: ${e && e.message ? e.message : e}`);
        }
      } else {
        // Defensive — no channel, clear everything before the bounce.
        this._channelSessions = {};
        try { this._saveSessions(); } catch {}
        await this._stopAllProcesses('Execution stopped by user.');
        this._log('Restart: cleared all sessions (no channel param)');
      }
      // Ask the daemon to bounce just THIS agent — true process-level
      // restart. Daemon's command-file poller picks up `restart:<name>`
      // within ~1s, calls restartAgent, our run() loop exits cleanly,
      // and a fresh adapter is spawned with a new `_startedAt`. Sibling
      // agents on the same daemon are untouched.
      try {
        const path = require('path');
        const os = require('os');
        const fs = require('fs');
        const cmdFile = path.join(os.homedir(), '.openagents', 'daemon.cmd');
        fs.writeFileSync(cmdFile, `restart:${this.agentName}\n`);
        this._log(`Restart: requested daemon bounce for agent=${this.agentName}`);
      } catch (e) {
        this._log(`Restart: failed to write daemon.cmd: ${e && e.message ? e.message : e}`);
        // Fallback: reset uptime in-place so the next /status reflects
        // SOMETHING changed even if the daemon bounce didn't happen.
        this._startedAt = Date.now();
      }
      return;
    }
    // Fall through to base for shared actions (status, etc.).
    await super._onControlAction(action, payload);
  }

  /**
   * Override BaseAdapter.stop so daemon shutdown also tears down in-flight
   * claude subprocesses cleanly. Without this, killing the daemon leaves
   * the channel's last event as a `status` (e.g. "Bash › ..." mid-tool-call)
   * forever — the workspace UI then shows the thread as "running" until a
   * new message arrives. Fire-and-forget; daemon._killAgent gives us up to
   * 5s to actually finish the cleanup before the parent exits.
   */
  stop() {
    for (const channel of Object.keys(this._persistentProcs)) {
      this._killPersistentProc(channel);
    }
    this._stopAllProcesses(
      'Task interrupted — daemon restarting. Send another message to continue.'
    ).catch(() => {});
    super.stop();
  }

  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null) return;
    try {
      if (IS_WINDOWS) {
        // Give Claude Code a Ctrl+C-like interrupt first so it can cancel
        // shell/background tasks it manages before the forceful process-tree
        // cleanup below. Going straight to /F can leave detached tool work
        // alive even though the Claude CLI process itself is gone.
        try { proc.kill('SIGINT'); } catch {}
        const exited = await new Promise((resolve) => {
          if (proc.exitCode !== null) {
            resolve(true);
            return;
          }
          const timeout = setTimeout(() => resolve(false), 1500);
          proc.once('exit', () => { clearTimeout(timeout); resolve(true); });
        });
        if (!exited) {
          try { execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 5000 }); } catch {}
        }
      } else {
        try { process.kill(-proc.pid, 'SIGTERM'); } catch {
          proc.kill('SIGTERM');
        }
        await new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };
          const timeout = setTimeout(() => {
            try { process.kill(-proc.pid, 'SIGKILL'); } catch {
              proc.kill('SIGKILL');
            }
            const reapTimeout = setTimeout(finish, 1000);
            proc.once('exit', () => { clearTimeout(reapTimeout); finish(); });
          }, 1500);
          proc.once('exit', () => { clearTimeout(timeout); finish(); });
        });
      }
    } catch {}
  }

  /**
   * Build a short transcript of the channel's last chat exchanges, used to
   * re-seed context when --resume fails and we have to start a fresh
   * Claude Code session. Returns null when there's nothing useful to add.
   *
   * Excludes the user's current message (the for-loop will append it
   * normally) and any status/thinking events, which are mostly tool-call
   * noise and inflate the prompt without adding signal.
   */
  async _buildChannelRecap(channelName, currentMessage) {
    const messages = await this.client.getRecentMessages(
      this.workspaceId, channelName, this.token, 60
    );
    if (!messages || messages.length === 0) return null;

    const lines = [];
    for (const m of messages) {
      const mt = m.messageType || 'chat';
      if (mt === 'status' || mt === 'thinking' || mt === 'loading') continue;
      const text = (m.content || '').trim();
      if (!text) continue;
      if (text === currentMessage) continue;
      const who = m.senderType === 'human'
        ? (m.senderName || 'user')
        : (m.senderName || 'agent');
      const truncated = text.length > 2000 ? text.slice(0, 2000) + '…' : text;
      lines.push(`[${who}] ${truncated}`);
    }
    if (lines.length === 0) return null;

    const tail = lines.slice(-20).join('\n');
    return (
      'You previously worked in this channel but your prior session is no ' +
      'longer available, so here is the recent conversation for context:\n\n' +
      tail
    );
  }

  async _stopAllProcesses(completionMessage = 'Execution stopped.') {
    for (const channel of Object.keys(this._persistentProcs)) {
      this._killPersistentProc(channel);
    }
    const entries = Object.entries(this._channelProcesses);
    if (!entries.length) return;
    this._log(`Stopping ${entries.length} running process(es)...`);
    for (const [channel, proc] of entries) {
      this._stoppingChannels.add(channel);
      await this._stopProcess(proc);
      delete this._channelProcesses[channel];
      delete this._channelQueues[channel];
      try {
        await this.sendResponse(channel, completionMessage);
      } catch {}
    }
  }

  /**
   * Find the portable Node.js binary.
   */
  _findNodeBin() {
    const home = os.homedir();
    const candidates = IS_WINDOWS
      ? [path.join(home, '.openagents', 'nodejs', 'node.exe')]
      : [path.join(home, '.openagents', 'nodejs', 'node'),
         path.join(home, '.openagents', 'nodejs', 'bin', 'node')];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return 'node';
  }

  /**
   * Resolve a binary shim/symlink to [nodeBin, jsEntryPoint].
   * On Windows: parses .cmd shim to extract the JS path.
   * On macOS/Linux: follows symlink to the actual .js file.
   * Returns [nodeBin, jsPath] or null if resolution fails.
   */
  _resolveToNodeCmd(binPath) {
    const nodeBin = this._findNodeBin();
    if (IS_WINDOWS && binPath.toLowerCase().endsWith('.cmd')) {
      const cmdDir = path.dirname(path.resolve(binPath));
      const cmdContent = fs.readFileSync(binPath, 'utf-8');
      const jsMatch = cmdContent.match(/%dp0%\\([^\s"*?]+\.m?js)/i);
      if (jsMatch) {
        return [nodeBin, path.resolve(cmdDir, jsMatch[1])];
      }
      // .cmd shims that forward to a native .exe (e.g. Claude Code's
      // claude.cmd → @anthropic-ai/claude-code/bin/claude.exe). Resolve to the
      // exe and spawn it directly. Wrapping such a .cmd in `cmd.exe /c` caps the
      // command line at cmd.exe's 8191-char limit, which truncates the ~14KB
      // --append-system-prompt and makes the agent hang ("command line too long").
      const exeMatch = cmdContent.match(/%dp0%\\([^\s"*?]+\.exe)/i);
      if (exeMatch) {
        return [path.resolve(cmdDir, exeMatch[1])];
      }
    } else {
      // Unix: symlink → resolve to actual .js file
      try {
        let target = binPath;
        if (fs.lstatSync(binPath).isSymbolicLink()) {
          target = path.resolve(path.dirname(binPath), fs.readlinkSync(binPath));
        }
        if (target.endsWith('.js') || target.endsWith('.mjs')) {
          return [nodeBin, target];
        }
      } catch {}
    }
    return null;
  }

  _findClaudeBinary() {
    const home = os.homedir();

    // Tier 0: Isolated runtime prefix (~/.openagents/runtimes/claude/)
    const ext = IS_WINDOWS ? '.cmd' : '';
    const runtimeCandidate = path.join(home, '.openagents', 'runtimes', 'claude', 'node_modules', '.bin', `claude${ext}`);
    if (fs.existsSync(runtimeCandidate)) return runtimeCandidate;

    // Tier 0b: Legacy portable install at ~/.openagents/nodejs/node_modules/.bin/
    const portableBin = path.join(home, '.openagents', 'nodejs', 'node_modules', '.bin');
    const portableCandidate = path.join(portableBin, `claude${ext}`);
    if (fs.existsSync(portableCandidate)) return portableCandidate;

    // Tier 1: PATH search. Use the ENRICHED env so the lookup sees the same
    // node-version-manager / homebrew / npm-global dirs the launcher adds —
    // a packaged Electron daemon's own PATH is minimal, which is why `which
    // claude` came up empty and the agent reported "claude CLI not found".
    // windowsHide stops a console window from flashing.
    try {
      const env = getEnhancedEnv();
      if (IS_WINDOWS) {
        const r = execSync('where claude.cmd 2>nul || where claude.exe 2>nul || where claude 2>nul', {
          encoding: 'utf-8', timeout: 5000, windowsHide: true, env,
        });
        const hit = r.split(/\r?\n/)[0].trim();
        if (hit) return hit;
      } else {
        const hit = execSync('which claude', { encoding: 'utf-8', timeout: 5000, windowsHide: true, env }).trim();
        if (hit) return hit;
      }
    } catch {}

    // Tier 2: Next to current Node.js interpreter (npm global)
    const nodeBinDir = path.dirname(process.execPath);
    const nearNode = path.join(nodeBinDir, `claude${ext}`);
    if (fs.existsSync(nearNode)) return nearNode;

    // Tier 3: Common install locations
    const candidates = IS_WINDOWS ? [
      path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
    ] : [
      path.join(home, '.local', 'bin', 'claude'),
      path.join(home, '.claude', 'local', 'claude'),
      path.join(home, '.npm-global', 'bin', 'claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    // Tier 4: Deep scan of every known bin dir (nvm/fnm/volta node-global,
    // homebrew, cargo, pip, …). This is what catches a `claude` installed as a
    // global npm package under a version-managed Node — the most common setup,
    // and the one the fixed-PATH tiers above miss.
    const viaWhich = whichBinary('claude');
    if (viaWhich) return viaWhich;

    return null;
  }

  _buildClaudeCmd(prompt, channelName, { skipResume = false, browserEnabled = false } = {}) {
    const claudeBin = this._findClaudeBinary();
    if (!claudeBin) {
      throw new Error('claude CLI not found. Install with: curl -fsSL https://claude.ai/install.sh | bash');
    }

    let systemPrompt = '\n' + buildClaudeSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName,
      mode: this._mode,
      browserEnabled,
    });

    // In skills mode, replace MCP tool references with curl-based instructions
    if (this.toolMode === 'skills') {
      systemPrompt = systemPrompt
        .replace(
          'Use workspace_get_history to read previous messages.\n' +
          'Use workspace_get_agents to see other agents.\n' +
          'Use workspace_put_todos to track your progress. ALWAYS create a to-do list when given multiple tasks or multi-step work.\n' +
          'Use workspace_create_timer to set a reminder that wakes you up later.\n' +
          'Use workspace_create_routine to set up recurring scheduled tasks (e.g. daily reviews).\n',
          'Use the openagents-workspace skill (Bash + curl) for workspace operations:\n' +
          'reading message history, discovering agents, sharing files, browsing,\n' +
          'managing to-do lists, setting timers, and creating routines.\n' +
          'Refer to the skill instructions for the exact curl commands.\n'
        );
    }

    const cmd = [claudeBin, '-p', prompt, '--output-format', 'stream-json', '--verbose'];

    cmd.push('--append-system-prompt', systemPrompt);
    cmd.push('--disallowedTools', 'AskUserQuestion', 'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup');

    // Resume existing conversation (skipped on retry after stale session)
    const sessionId = this._channelSessions[channelName];
    if (sessionId && !skipResume) {
      cmd.push('--resume', sessionId);
    }

    // ── Skills mode: write SKILL.md, no MCP server ──
    if (this.toolMode === 'skills') {
      return this._buildSkillsCmd(cmd, channelName);
    }

    // ── MCP mode (default): spawn MCP server ──
    return this._buildMcpCmd(cmd, channelName);
  }

  /**
   * Skills mode: write a SKILL.md file and allow Bash + curl for workspace ops.
   */
  _buildSkillsCmd(cmd, channelName) {
    if (this._mode === 'plan') {
      cmd.push('--permission-mode', 'plan');
      cmd.push('--allowedTools', 'Read', 'Glob', 'Grep', 'Bash');
    } else {
      cmd.push('--dangerously-skip-permissions');
      cmd.push('--allowedTools', 'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep');
    }

    // Write SKILL.md to .claude/skills/ in the working directory. Never use
    // process.cwd() as the fallback — on a packaged Windows daemon that is
    // C:\WINDOWS\system32 and mkdir there throws EPERM.
    const workDir = this.workingDir || defaultAgentWorkdir(this.agentName);
    const skillDir = path.join(workDir, '.claude', 'skills');
    fs.mkdirSync(skillDir, { recursive: true });
    const skillFile = path.join(skillDir, 'openagents-workspace.md');

    const skillContent = buildClaudeSkillMd({
      endpoint: this.endpoint,
      workspaceId: this.workspaceId,
      token: this.token,
      agentName: this.agentName,
      channelName,
      disabledModules: this.disabledModules,
      browserEnabled: this._browserEnabledCache === true,
    });
    fs.writeFileSync(skillFile, skillContent, 'utf-8');
    this._log(`Wrote workspace skill to ${skillFile}`);

    return { cmd, skillFile };
  }

  /**
   * MCP mode (default): spawn MCP server subprocess for workspace tools.
   */
  _buildMcpCmd(cmd, channelName) {
    // Mode-dependent permission and tool flags
    const pfx = 'mcp__openagents-workspace__';
    const mcpTools = [
      `${pfx}workspace_get_history`,
      `${pfx}workspace_get_agents`,
      `${pfx}workspace_status`,
    ];
    const mcpWriteTools = [];

    if (!this.disabledModules.has('files')) {
      mcpTools.push(`${pfx}workspace_list_files`, `${pfx}workspace_read_file`);
      mcpWriteTools.push(`${pfx}workspace_write_file`, `${pfx}workspace_delete_file`);
    }
    if (!this.disabledModules.has('browser')) {
      mcpTools.push(
        `${pfx}workspace_browser_list_tabs`,
        `${pfx}workspace_browser_snapshot`,
        `${pfx}workspace_browser_screenshot`
      );
      mcpWriteTools.push(
        `${pfx}workspace_browser_open`,
        `${pfx}workspace_browser_navigate`,
        `${pfx}workspace_browser_click`,
        `${pfx}workspace_browser_type`,
        `${pfx}workspace_browser_close`
      );
    }
    if (!this.disabledModules.has('tunnel')) {
      mcpTools.push(`${pfx}tunnel_list`);
      mcpWriteTools.push(`${pfx}tunnel_expose`, `${pfx}tunnel_close`);
    }

    // Todos, Timers & Routines (always enabled)
    mcpTools.push(`${pfx}workspace_get_todos`, `${pfx}workspace_list_timers`, `${pfx}workspace_list_routines`);
    mcpWriteTools.push(`${pfx}workspace_put_todos`, `${pfx}workspace_create_timer`, `${pfx}workspace_cancel_timer`, `${pfx}workspace_create_routine`, `${pfx}workspace_cancel_routine`);

    if (this._mode === 'plan') {
      cmd.push('--permission-mode', 'plan');
      cmd.push('--allowedTools', ...mcpTools, 'Read', 'Glob', 'Grep');
    } else {
      cmd.push('--dangerously-skip-permissions');
      cmd.push('--allowedTools', ...mcpTools, ...mcpWriteTools, 'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep');
    }

    // MCP config for workspace tools
    const mcpArgs = [
      'mcp-server',
      '--workspace-id', this.workspaceId,
      '--channel-name', channelName,
      '--agent-name', this.agentName,
      '--endpoint', this.endpoint,
    ];
    if (this.disabledModules.has('files')) mcpArgs.push('--disable-files');
    if (this.disabledModules.has('browser')) mcpArgs.push('--disable-browser');

    // Resolve the MCP server entry point
    let mcpCommand = this._findNodeBin();
    let mcpFinalArgs = mcpArgs;
    const siblingBin = path.resolve(__dirname, '..', '..', 'bin', 'agent-connector.js');
    if (fs.existsSync(siblingBin)) {
      mcpFinalArgs = [siblingBin, ...mcpArgs];
    } else {
      let oaBin = null;
      const home3 = os.homedir();
      const oaExt = IS_WINDOWS ? '.cmd' : '';
      const runtimesRoot = path.join(home3, '.openagents', 'runtimes');
      try {
        for (const d of fs.readdirSync(runtimesRoot, { withFileTypes: true })) {
          if (d.isDirectory()) {
            const candidate = path.join(runtimesRoot, d.name, 'node_modules', '.bin', `openagents${oaExt}`);
            if (fs.existsSync(candidate)) { oaBin = candidate; break; }
          }
        }
      } catch {}
      if (!oaBin) {
        const oaPortable = path.join(home3, '.openagents', 'nodejs', 'node_modules', '.bin', `openagents${oaExt}`);
        if (fs.existsSync(oaPortable)) oaBin = oaPortable;
      }
      if (!oaBin) try {
        if (IS_WINDOWS) {
          oaBin = execSync('where openagents.cmd 2>nul || where openagents.exe 2>nul || where openagents 2>nul', {
            encoding: 'utf-8', timeout: 5000,
          }).split(/\r?\n/)[0].trim();
        } else {
          oaBin = execSync('which openagents', { encoding: 'utf-8', timeout: 5000 }).trim();
        }
      } catch {}
      if (!oaBin) {
        this._log('Could not find openagents binary — MCP tools may not be available');
        mcpCommand = 'openagents';
      } else {
        const resolved = this._resolveToNodeCmd(oaBin);
        if (resolved) {
          mcpCommand = resolved[0];
          mcpFinalArgs = [...resolved.slice(1), ...mcpArgs];
        } else {
          mcpCommand = oaBin;
        }
      }
    }

    const mcpConfig = {
      mcpServers: {
        'openagents-workspace': {
          type: 'stdio',
          command: mcpCommand,
          args: mcpFinalArgs,
          env: { OA_WORKSPACE_TOKEN: this.token },
        },
      },
    };

    // Write MCP config to temp file (avoids cmd.exe JSON quoting issues)
    const mcpDir = path.join(os.homedir(), '.openagents', 'mcp-configs');
    fs.mkdirSync(mcpDir, { recursive: true });
    const mcpFile = path.join(mcpDir, `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(mcpFile, JSON.stringify(mcpConfig));
    cmd.push('--mcp-config', mcpFile);

    return { cmd, mcpConfigFile: mcpFile };
  }

  /**
   * Kill a persistent process for a channel and clean up its idle timer.
   */
  _killPersistentProc(channel) {
    const pp = this._persistentProcs[channel];
    if (!pp) return;
    if (pp.idleTimer) clearTimeout(pp.idleTimer);
    this._stopWatchdog(pp);
    this._stopProcess(pp.proc).catch(() => {});
    delete this._persistentProcs[channel];
  }

  /**
   * Reset the idle timer for a persistent process. Kills the process
   * after _IDLE_TIMEOUT_MS of inactivity.
   */
  _resetIdleTimer(channel) {
    const pp = this._persistentProcs[channel];
    if (!pp) return;
    if (pp.idleTimer) clearTimeout(pp.idleTimer);
    pp.idleTimer = setTimeout(() => {
      this._log(`Persistent process idle for ${this._IDLE_TIMEOUT_MS / 60000}min, releasing ${channel}`);
      this._killPersistentProc(channel);
    }, this._IDLE_TIMEOUT_MS);
  }

  /**
   * Start a watchdog that kills the persistent process if stdout goes
   * silent for too long while a message is in flight.  Pauses during
   * tool execution (awaitingToolResult) since long-running commands
   * like builds or sleep produce no stdout legitimately.
   */
  _startWatchdog(pp) {
    this._stopWatchdog(pp);
    pp.lastStdoutTime = Date.now();
    let consecutiveTimeouts = 0;

    pp.watchdogTimer = setInterval(async () => {
      if (!pp.messageResolve) { consecutiveTimeouts = 0; return; }
      if (pp.awaitingToolResult) { consecutiveTimeouts = 0; return; }

      const elapsed = Date.now() - pp.lastStdoutTime;
      if (elapsed < this._WATCHDOG_INTERVAL_MS) { consecutiveTimeouts = 0; return; }

      consecutiveTimeouts++;
      pp.lastStdoutTime = Date.now();

      if (consecutiveTimeouts === 2) {
        try { await this.sendStatus(pp.msgChannel, 'Still processing...'); } catch {}
      }

      if (consecutiveTimeouts >= this._WATCHDOG_MAX_TIMEOUTS) {
        this._log(`Watchdog: process unresponsive for ${consecutiveTimeouts * 15}s on ${pp.msgChannel} — killing`);
        this._stopWatchdog(pp);
        try { await this.sendError(pp.msgChannel, 'Agent process became unresponsive and was restarted.'); } catch {}
        if (pp.messageResolve) {
          const resolve = pp.messageResolve;
          pp.messageResolve = null;
          resolve({ exited: true, error: new Error('watchdog timeout') });
        }
        this._killPersistentProc(pp.msgChannel);
      }
    }, this._WATCHDOG_INTERVAL_MS);
  }

  _stopWatchdog(pp) {
    if (pp.watchdogTimer) { clearInterval(pp.watchdogTimer); pp.watchdogTimer = null; }
  }

  /**
   * Spawn a persistent Claude process for a channel that accepts messages
   * via stdin (--input-format stream-json). Returns the persistent proc entry.
   */
  _spawnPersistentProc(channel, cmd, cleanEnv) {
    // Remove -p and its argument from cmd — prompts go via stdin
    const filteredCmd = [];
    for (let i = 0; i < cmd.length; i++) {
      if (cmd[i] === '-p' || cmd[i] === '--print') {
        // -p in stream-json mode is just a flag (no argument to skip)
        // but _buildClaudeCmd passes [-p, prompt] — skip both
        if (i + 1 < cmd.length && !cmd[i + 1].startsWith('-')) {
          i++; // skip the prompt argument
        }
        continue;
      }
      filteredCmd.push(cmd[i]);
    }
    // Add stdin streaming flags
    filteredCmd.push('--input-format', 'stream-json');
    // Ensure -p is present (required for stream-json)
    if (!filteredCmd.includes('-p') && !filteredCmd.includes('--print')) {
      filteredCmd.splice(1, 0, '-p');
    }

    const resolved = this._resolveToNodeCmd(filteredCmd[0]);
    let finalCmd = filteredCmd;
    if (resolved) {
      finalCmd = [...resolved, ...filteredCmd.slice(1)];
    } else if (IS_WINDOWS && filteredCmd[0].toLowerCase().endsWith('.cmd')) {
      finalCmd = ['cmd.exe', '/c', ...filteredCmd];
    }

    const proc = spawn(finalCmd[0], finalCmd.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv,
      cwd: this.workingDir,
      detached: !IS_WINDOWS,
      windowsHide: true,
    });

    const pp = {
      proc,
      lineBuffer: '',
      pendingLines: Promise.resolve(),
      idleTimer: null,
      messageResolve: null,
      msgChannel: channel,
      lastResponseText: [],
      lastErrorText: '',
      hasToolUseSinceLastText: false,
      postedThinking: false,
      everPostedAnything: false,
      stderrBuf: '',
      alive: true,
      lastStdoutTime: Date.now(),
      watchdogTimer: null,
      awaitingToolResult: false,
      userStopped: false,
    };

    if (proc.stderr) {
      proc.stderr.on('data', (chunk) => { pp.stderrBuf += chunk.toString('utf-8'); });
    }

    const processLine = async (line) => {
      line = line.trim();
      if (!line) return;
      let event;
      try { event = JSON.parse(line); } catch { return; }
      const eventType = event.type;

      if (eventType === 'assistant') {
        pp.awaitingToolResult = false;
        const blocks = (event.message || {}).content || [];
        for (const block of blocks) {
          if (block.type === 'text' && block.text && block.text.trim()) {
            if (pp.hasToolUseSinceLastText) {
              pp.lastResponseText.length = 0;
              pp.hasToolUseSinceLastText = false;
            }
            pp.lastResponseText.push(block.text.trim());
            pp.postedThinking = true;
            pp.everPostedAnything = true;
            try { await this.sendThinking(pp.msgChannel, block.text.trim()); } catch {}
          } else if (block.type === 'tool_use') {
            pp.hasToolUseSinceLastText = true;
            pp.postedThinking = false;
            pp.lastResponseText.length = 0;
            pp.awaitingToolResult = true;
            const toolName = block.name || '';
            if (toolName === 'TodoWrite' && block.input && block.input.todos) {
              try {
                const wsTodos = block.input.todos.map((t) => ({
                  content: t.content, status: t.status || 'pending', assignee: t.assignee,
                }));
                await this.sendTodos(pp.msgChannel, wsTodos);
              } catch {}
            }
            let inputPreview = '';
            if (block.input && typeof block.input === 'object') {
              const inp = block.input;
              if (inp.command) inputPreview = inp.command;
              else if (inp.file_path || inp.path) inputPreview = inp.file_path || inp.path;
              else if (inp.pattern) inputPreview = inp.pattern;
              else if (inp.query) inputPreview = inp.query;
              else if (inp.url) inputPreview = inp.url;
              else if (inp.content) inputPreview = inp.content.slice(0, 100);
              else inputPreview = JSON.stringify(inp).slice(0, 150);
            } else {
              inputPreview = String(block.input || '').slice(0, 150);
            }
            await this.sendStatus(pp.msgChannel, `${toolName} › ${inputPreview}`);
            pp.everPostedAnything = true;
          }
        }
      } else if (eventType === 'result') {
        pp.awaitingToolResult = false;
        const sessionId = event.session_id;
        if (sessionId) {
          this._channelSessions[pp.msgChannel] = sessionId;
          this._saveSessions();
        }
        if (event.is_error) {
          // Capture the error so _handleMessage can surface it to the user.
          // Without this, an auth/API failure (e.g. 401 invalid token) is only
          // logged and the user just sees "No response generated", hiding the
          // real cause and making it nearly impossible to diagnose.
          pp.lastErrorText = String(event.result || '').trim();
          this._log(`Claude error: ${pp.lastErrorText.slice(0, 200)}`);
        }
        if (pp.messageResolve) {
          pp.messageResolve({ resultEvent: event });
          pp.messageResolve = null;
        }
      } else if (eventType === 'system') {
        const subtype = event.subtype || '';
        const message = event.message || '';
        if (subtype.includes('compact') || String(message).toLowerCase().includes('compact')) {
          await this.sendStatus(pp.msgChannel, String(message) || 'Compacting conversation...');
        }
      } else if (eventType === 'rate_limit_event') {
        this._log(`Rate limited: ${JSON.stringify(event).slice(0, 200)}`);
      }
    };

    proc.stdout.on('data', (chunk) => {
      pp.lineBuffer += chunk.toString('utf-8');
      pp.lastStdoutTime = Date.now();
      const lines = pp.lineBuffer.split('\n');
      pp.lineBuffer = lines.pop();
      for (const line of lines) {
        pp.pendingLines = pp.pendingLines.then(() => processLine(line)).catch(() => {});
      }
    });

    proc.on('exit', (code) => {
      this._log(`Persistent process exited: channel=${channel} code=${code}`);
      pp.alive = false;
      if (pp.idleTimer) clearTimeout(pp.idleTimer);
      this._stopWatchdog(pp);
      if (pp.messageResolve) {
        pp.messageResolve({ exited: true, code });
        pp.messageResolve = null;
      }
      delete this._persistentProcs[channel];
      delete this._channelProcesses[channel];
    });

    proc.on('error', (err) => {
      this._log(`Persistent process error: ${err.message}`);
      pp.alive = false;
      this._stopWatchdog(pp);
      if (pp.messageResolve) {
        pp.messageResolve({ exited: true, error: err });
        pp.messageResolve = null;
      }
      delete this._persistentProcs[channel];
    });

    this._persistentProcs[channel] = pp;
    this._channelProcesses[channel] = proc;
    this._resetIdleTimer(channel);
    return pp;
  }

  /**
   * Send a user message to a persistent process via stdin and wait for
   * the result event. Returns { resultEvent } on success or { exited, code }
   * if the process dies mid-message.
   */
  _sendToPersistentProc(pp, content) {
    pp.lastResponseText = [];
    pp.lastErrorText = '';
    pp.hasToolUseSinceLastText = false;
    pp.postedThinking = false;
    pp.everPostedAnything = false;
    pp.awaitingToolResult = false;

    const stdinMsg = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: content }],
      },
    }) + '\n';

    return new Promise((resolve) => {
      pp.messageResolve = (result) => {
        this._stopWatchdog(pp);
        resolve(result);
      };
      pp.lastStdoutTime = Date.now();
      this._startWatchdog(pp);
      try {
        pp.proc.stdin.write(stdinMsg);
      } catch (e) {
        this._log(`stdin write failed: ${e.message}`);
        this._stopWatchdog(pp);
        pp.messageResolve = null;
        resolve({ exited: true, error: e });
      }
    });
  }

  /**
   * Turn a raw Claude `result` error into a user-facing message. Auth failures
   * (401 / invalid token) are the most common real-world cause and are otherwise
   * invisible — add a concrete hint about which env vars to check.
   */
  _formatClaudeError(text) {
    const msg = String(text || '').trim() || 'Claude returned an error.';
    if (/401|403|authenticate|invalid.*(token|key|api)|无效的?\s*(令牌|密钥|key)/i.test(msg)) {
      return `Claude authentication failed: ${msg}\n\n` +
        'Check this agent\'s API key and Base URL in the launcher — the key may be invalid or expired.';
    }
    return `Claude error: ${msg}`;
  }

  async _handleMessage(msg) {
    let content = (msg.content || '').trim();
    const attachments = msg.attachments || [];

    const attText = formatAttachmentsForPrompt(attachments, this.toolMode);
    if (attText) {
      content = content ? content + attText : attText.trim();
    }

    if (!content) return;

    const msgChannel = msg.sessionId || this.channelName;
    this._stoppingChannels.delete(msgChannel);
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing message from ${sender} in ${msgChannel}: ${content.slice(0, 80)}...`);

    // Auto-title + resume-from on first encounter
    if (!this._titledSessions.has(msgChannel)) {
      this._titledSessions.add(msgChannel);
      try {
        const info = await this.client.getSession(this.workspaceId, msgChannel, this.token);
        const resumeFrom = info.resumeFrom;
        if (resumeFrom && !this._channelSessions[msgChannel]) {
          const sourceSession = this._channelSessions[resumeFrom];
          if (sourceSession) {
            this._channelSessions[msgChannel] = sourceSession;
            this._saveSessions();
            this._log(`Resuming channel ${msgChannel} from ${resumeFrom}`);
          }
        }
        const title = generateSessionTitle(content);
        if (title && !info.titleManuallySet && SESSION_DEFAULT_RE.test(info.title || '')) {
          await this.client.updateSession(
            this.workspaceId, msgChannel, this.token,
            { title, autoTitle: true }
          );
        }
      } catch {}
    }

    await this.sendStatus(msgChannel, 'thinking...');

    // ── Persistent process fast-path ──
    // If we have a living persistent process for this channel, send via stdin
    // instead of spawning a new CLI (saves ~2s startup time).
    const existingPP = this._persistentProcs[msgChannel];
    if (existingPP && existingPP.alive) {
      this._log(`Reusing persistent process for ${msgChannel}`);
      this._resetIdleTimer(msgChannel);
      existingPP.msgChannel = msgChannel;
      const result = await this._sendToPersistentProc(existingPP, content);
      if (result.resultEvent) {
        const fullResponse = existingPP.lastResponseText.join('\n').trim();
        if (fullResponse) {
          try { await this.sendResponse(msgChannel, fullResponse); } catch {}
        } else if (existingPP.lastErrorText) {
          try { await this.sendError(msgChannel, this._formatClaudeError(existingPP.lastErrorText)); } catch {}
        }
        this._resetIdleTimer(msgChannel);
        if (!msg._todoNudge) {
          try {
            const remaining = await this.getRemainingTodos(msgChannel);
            if (remaining.length > 0) {
              const items = remaining.map((t) => `- ${t.content}`).join('\n');
              const nudge = `You have ${remaining.length} remaining task(s) from your plan:\n${items}\n\nPlease continue working on them.`;
              if (!this._channelQueues[msgChannel]) this._channelQueues[msgChannel] = [];
              this._channelQueues[msgChannel].push({
                content: nudge, senderType: 'system', senderName: 'system:todos',
                sessionId: msgChannel, messageType: 'chat', _todoNudge: true,
              });
            }
          } catch {}
        }
        return;
      }
      if (existingPP.userStopped) {
        if (!existingPP.everPostedAnything) {
          try { await this.sendResponse(msgChannel, 'Execution stopped by user.'); } catch {}
        }
        return;
      }
      // Process died mid-message — fall through to spawn a fresh one
      this._log(`Persistent process died, falling back to fresh spawn for ${msgChannel}`);
    }

    let mcpConfigFile = null;
    let cmd;

    // Clean env: strip CLAUDE_* / AI_AGENT variables that make the spawned
    // `claude` think it's running under an SDK harness (org-scoped auth
    // path → 403). But preserve config vars the child needs for cloud
    // provider auth (Vertex, Bedrock) and model selection.
    const CLAUDE_ENV_KEEP = new Set([
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_MODEL',
      'CLAUDE_API_KEY',
      'CLAUDE_CODE_MAX_TURNS',
    ]);
    const cleanEnv = { ...(this.agentEnv || process.env) };
    for (const k of Object.keys(cleanEnv)) {
      if ((k.startsWith('CLAUDE_') && !CLAUDE_ENV_KEEP.has(k)) || k === 'CLAUDECODE' || k === 'AI_AGENT') {
        delete cleanEnv[k];
      }
    }

    // Third-party Anthropic-compatible relays (the common reason a custom
    // ANTHROPIC_BASE_URL is set) authenticate via `Authorization: Bearer`, which
    // the Claude CLI only sends when ANTHROPIC_AUTH_TOKEN is set. With just
    // ANTHROPIC_API_KEY the CLI sends `x-api-key`, which most relays ignore — the
    // relay then rejects every request as 401 "invalid token / 无效的令牌". When a
    // non-official base URL is configured and no auth token was provided, mirror
    // the API key into ANTHROPIC_AUTH_TOKEN (it outranks the API key in Claude
    // Code's auth precedence) so the CLI uses Bearer auth. The launcher normally
    // sets this when saving env; this is the runtime backstop for envs saved by
    // an older launcher or coming from any other source. The official
    // api.anthropic.com endpoint keeps x-api-key, so it is left untouched.
    const anthropicBase = (cleanEnv.ANTHROPIC_BASE_URL || '').trim();
    const anthropicKey = (cleanEnv.ANTHROPIC_API_KEY || '').trim();
    if (anthropicKey && anthropicBase && !(cleanEnv.ANTHROPIC_AUTH_TOKEN || '').trim()) {
      let officialAnthropic = false;
      try {
        const host = new URL(anthropicBase).hostname.toLowerCase();
        officialAnthropic = host === 'anthropic.com' || host.endsWith('.anthropic.com');
      } catch { officialAnthropic = false; }
      if (!officialAnthropic) {
        cleanEnv.ANTHROPIC_AUTH_TOKEN = anthropicKey;
      }
    }

    // Spawn a persistent process and send the first message via stdin
    let effectiveContent = content;

    // When starting without a session (no --resume), prepend channel
    // history so the fresh CLI has conversation context.
    if (!this._channelSessions[msgChannel]) {
      try {
        const recap = await this._buildChannelRecap(msgChannel, content);
        if (recap) effectiveContent = `${recap}\n\n---\n\n${content}`;
      } catch {}
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      if (mcpConfigFile) { try { fs.unlinkSync(mcpConfigFile); } catch {} mcpConfigFile = null; }

      if (attempt > 0) {
        this._killPersistentProc(msgChannel);
        // Rebuild recap for retry without resume
        try {
          const recap = await this._buildChannelRecap(msgChannel, content);
          if (recap) effectiveContent = `${recap}\n\n---\n\n${content}`;
        } catch {}
      }

      try {
        const browserEnabled = await this.getBrowserEnabled();
        const built = this._buildClaudeCmd(effectiveContent, msgChannel, {
          skipResume: attempt > 0,
          browserEnabled,
        });
        cmd = built.cmd;
        mcpConfigFile = built.mcpConfigFile;
      } catch (e) {
        await this.sendError(msgChannel, e.message);
        return;
      }

      try {
        const pp = this._spawnPersistentProc(msgChannel, cmd, cleanEnv);
        this._log(`Spawned persistent process for ${msgChannel} (attempt ${attempt + 1})`);

        const result = await this._sendToPersistentProc(pp, effectiveContent);

        if (result.exited) {
          this._log(`Process exited during first message (attempt ${attempt + 1}), userStopped=${pp.userStopped}`);
          if (pp.userStopped) {
            if (!pp.everPostedAnything) {
              try { await this.sendResponse(msgChannel, 'Execution stopped by user.'); } catch {}
            }
            break;
          }
          if (attempt === 0 && this._channelSessions[msgChannel]) {
            this._log(`Stale session detected, retrying without resume`);
            delete this._channelSessions[msgChannel];
            this._saveSessions();
            continue;
          }
          if (!pp.everPostedAnything) {
            if (pp.lastErrorText) {
              try { await this.sendError(msgChannel, this._formatClaudeError(pp.lastErrorText)); } catch {}
            } else {
              try { await this.sendResponse(msgChannel, 'No response generated. Please try again.'); } catch {}
            }
          }
          break;
        }

        // Success — post final response
        const fullResponse = pp.lastResponseText.join('\n').trim();

        if (this._mode === 'plan') {
          try {
            const planDir = path.join(this.workingDir || defaultAgentWorkdir(this.agentName), '.claude', 'plans');
            if (fs.existsSync(planDir)) {
              const planFiles = fs.readdirSync(planDir)
                .filter((f) => f.endsWith('.md'))
                .map((f) => ({ name: f, mtime: fs.statSync(path.join(planDir, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime);
              if (planFiles.length > 0) {
                const planContent = fs.readFileSync(path.join(planDir, planFiles[0].name), 'utf-8').trim();
                if (planContent) pp.lastResponseText.push('\n\n---\n\n**Plan:**\n\n' + planContent);
              }
            }
          } catch {}
        }

        const finalResponse = pp.lastResponseText.join('\n').trim();
        if (/prompt is too long/i.test(finalResponse) && this._channelSessions[msgChannel]) {
          this._log(`Prompt too long, clearing session and retrying`);
          delete this._channelSessions[msgChannel];
          this._saveSessions();
          this._killPersistentProc(msgChannel);
          continue;
        }

        if (finalResponse) {
          try { await this.sendResponse(msgChannel, finalResponse); } catch {}
        } else if (pp.lastErrorText) {
          // Claude finished with an error and no assistant text (e.g. 401 invalid
          // token). Surface it instead of silently dropping the turn.
          try { await this.sendError(msgChannel, this._formatClaudeError(pp.lastErrorText)); } catch {}
        }

        this._resetIdleTimer(msgChannel);

        if (!msg._todoNudge) {
          try {
            const remaining = await this.getRemainingTodos(msgChannel);
            if (remaining.length > 0) {
              const items = remaining.map((t) => `- ${t.content}`).join('\n');
              const nudge = `You have ${remaining.length} remaining task(s) from your plan:\n${items}\n\nPlease continue working on them.`;
              if (!this._channelQueues[msgChannel]) this._channelQueues[msgChannel] = [];
              this._channelQueues[msgChannel].push({
                content: nudge, senderType: 'system', senderName: 'system:todos',
                sessionId: msgChannel, messageType: 'chat', _todoNudge: true,
              });
            }
          } catch {}
        }
        break;
      } catch (e) {
        this._log(`Error handling message: ${e.message}`);
        await this.sendError(msgChannel, `Error processing message: ${e.message}`);
        break;
      }
    }

    if (mcpConfigFile) {
      try { fs.unlinkSync(mcpConfigFile); } catch {}
    }
  }
}

module.exports = ClaudeAdapter;

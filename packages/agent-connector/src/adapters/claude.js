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

const IS_WINDOWS = process.platform === 'win32';
const CLAUDE_ENV_KEEP = new Set([
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_MODEL',
  'CLAUDE_API_KEY',
  'CLAUDE_CODE_MAX_TURNS',
]);

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
      this.workspaceId, channelName, this.token, 30
    );
    if (!messages || messages.length === 0) return null;

    const lines = [];
    for (const m of messages) {
      const mt = m.messageType || 'chat';
      if (mt === 'status' || mt === 'thinking' || mt === 'loading') continue;
      const text = (m.content || '').trim();
      if (!text) continue;
      // Don't echo the user's current message back at them.
      if (text === currentMessage) continue;
      const who = m.senderType === 'human'
        ? (m.senderName || 'user')
        : (m.senderName || 'agent');
      // Cap each line so a single huge paste doesn't blow up the prompt.
      const truncated = text.length > 800 ? text.slice(0, 800) + '…' : text;
      lines.push(`[${who}] ${truncated}`);
    }
    if (lines.length === 0) return null;

    // Keep only the tail; older context has diminishing value and we
    // don't want to balloon the system prompt.
    const tail = lines.slice(-15).join('\n');
    return (
      'You previously worked in this channel but your prior session is no ' +
      'longer available, so here is the recent conversation for context:\n\n' +
      tail
    );
  }

  async _stopAllProcesses(completionMessage = 'Execution stopped.') {
    const entries = Object.entries(this._channelProcesses);
    if (!entries.length) return;
    this._log(`Stopping ${entries.length} running process(es)...`);
    for (const [channel, proc] of entries) {
      this._stoppingChannels.add(channel);
      await this._stopProcess(proc);
      delete this._channelProcesses[channel];
      delete this._channelQueues[channel];
      // Post as a chat message (not status) so the channel's last event
      // type is non-status — the workspace UI then transitions out of
      // "agent is working" state instead of shimmering forever.
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

    // Tier 1: PATH search
    try {
      if (IS_WINDOWS) {
        const r = execSync('where claude.cmd 2>nul || where claude.exe 2>nul || where claude 2>nul', {
          encoding: 'utf-8', timeout: 5000,
        });
        return r.split(/\r?\n/)[0].trim();
      } else {
        return execSync('which claude', { encoding: 'utf-8', timeout: 5000 }).trim();
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
      path.join(home, '.npm-global', 'bin', 'claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    return null;
  }

  _buildClaudeCmd(prompt, channelName, { skipResume = false, browserEnabled = false } = {}) {
    const claudeBin = this._findClaudeBinary();
    if (!claudeBin) {
      throw new Error('claude CLI not found. Install with: curl -fsSL https://claude.ai/install.sh | bash');
    }

    const cmd = [claudeBin, '-p', prompt, '--output-format', 'stream-json', '--verbose'];

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

  _buildClaudeBootstrapPrompt(channelName, browserEnabled) {
    let prompt = buildClaudeSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName,
      mode: this._mode,
      browserEnabled,
    });

    if (this.toolMode === 'skills') {
      prompt = prompt.replace(
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
    return prompt;
  }

  _buildClaudeEnv(channelName) {
    // Strip CLAUDE_* / AI_AGENT variables that make the spawned `claude`
    // think it's running under an SDK harness (org-scoped auth path -> 403).
    // Preserve provider auth and model selection vars needed by the child.
    const cleanEnv = { ...(this.agentEnv || process.env), ...this._runtimeEnv(channelName) };
    for (const k of Object.keys(cleanEnv)) {
      if ((k.startsWith('CLAUDE_') && !CLAUDE_ENV_KEEP.has(k)) || k === 'CLAUDECODE' || k === 'AI_AGENT') {
        delete cleanEnv[k];
      }
    }
    return cleanEnv;
  }

  _spawnClaudeProcess(cmd, channelName, env) {
    // Always resolve shim/symlink to node + JS entry point.
    // On Windows: .cmd shims need cmd.exe which creates visible windows.
    // On macOS/Linux: #!/usr/bin/env node fails when node isn't on system PATH.
    const resolved = this._resolveToNodeCmd(cmd[0]);
    if (resolved) {
      cmd = [resolved[0], resolved[1], ...cmd.slice(1)];
    } else if (IS_WINDOWS && cmd[0].toLowerCase().endsWith('.cmd')) {
      cmd = ['cmd.exe', '/c', ...cmd];
    }

    const proc = spawn(cmd[0], cmd.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      cwd: this.workingDir,
      detached: !IS_WINDOWS,
      windowsHide: true,
    });
    this._channelProcesses[channelName] = proc;
    return proc;
  }

  async _bootstrapChannel(channelName) {
    if (this._channelSessions[channelName]) return;
    this._log(`Bootstrapping Claude session for ${channelName}`);
    const browserEnabled = await this.getBrowserEnabled();
    const built = this._buildClaudeCmd(
      this._buildClaudeBootstrapPrompt(channelName, browserEnabled),
      channelName,
      { browserEnabled },
    );
    let cmd = built.cmd;
    const mcpConfigFile = built.mcpConfigFile;
    const cleanEnv = this._buildClaudeEnv(channelName);

    try {
      await new Promise((resolve, reject) => {
        const proc = this._spawnClaudeProcess(cmd, channelName, cleanEnv);

        let stderrBuf = '';
        let lineBuffer = '';
        if (proc.stderr) proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString('utf-8'); });
        const processLine = (line) => {
          line = line.trim();
          if (!line) return;
          let event;
          try { event = JSON.parse(line); } catch { return; }
          if (event.type === 'result' && event.session_id) {
            this._channelSessions[channelName] = event.session_id;
            this._saveSessions();
          }
        };
        proc.stdout.on('data', (chunk) => {
          lineBuffer += chunk.toString('utf-8');
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop();
          for (const line of lines) processLine(line);
        });
        proc.on('exit', (code) => {
          delete this._channelProcesses[channelName];
          for (const line of lineBuffer.split('\n')) processLine(line);
          if (code !== 0) {
            const detail = stderrBuf.trim() ? `: ${stderrBuf.trim().slice(0, 500)}` : '';
            reject(new Error(`Claude bootstrap failed with code ${code}${detail}`));
            return;
          }
          resolve();
        });
        proc.on('error', (err) => {
          delete this._channelProcesses[channelName];
          reject(err);
        });
      });
    } finally {
      if (mcpConfigFile) {
        try { fs.unlinkSync(mcpConfigFile); } catch {}
      }
    }
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

    // Write SKILL.md to .claude/skills/openagents-workspace/ in the working directory
    const workDir = this.workingDir || process.cwd();
    const skillDir = path.join(workDir, '.claude', 'skills', 'openagents-workspace');
    fs.mkdirSync(skillDir, { recursive: true });
    const skillFile = path.join(skillDir, 'SKILL.md');

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
          mcpFinalArgs = [resolved[1], ...mcpArgs];
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
        // Resume from a previous channel's Claude session if specified
        const resumeFrom = info.resumeFrom;
        if (resumeFrom && !this._channelSessions[msgChannel]) {
          const sourceSession = this._channelSessions[resumeFrom];
          if (sourceSession) {
            this._channelSessions[msgChannel] = sourceSession;
            this._saveSessions();
            this._log(`Resuming channel ${msgChannel} from ${resumeFrom}`);
          }
        }
        // Auto-title
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

    let mcpConfigFile = null;
    let cmd;

    const cleanEnv = this._buildClaudeEnv(msgChannel);

    // Run up to 2 attempts: first with session resume, then fresh if stale session detected
    let _shouldRetry = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (mcpConfigFile) { try { fs.unlinkSync(mcpConfigFile); } catch {} mcpConfigFile = null; }

      try {
        const browserEnabled = await this.getBrowserEnabled();
        const built = this._buildClaudeCmd(content, msgChannel, {
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
      const proc = this._spawnClaudeProcess(cmd, msgChannel, cleanEnv);

      const lastResponseText = [];
      let hasToolUseSinceLastText = false;
      let postedThinking = false;
      let everPostedAnything = false;
      let stderrBuf = '';
      let lineBuffer = '';
      let _pendingLines = Promise.resolve(); // chain of in-flight processLine calls

      // Capture stderr for diagnostics
      if (proc.stderr) {
        proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString('utf-8'); });
      }

      _shouldRetry = await new Promise((resolve, reject) => {
        let consecutiveTimeouts = 0;
        let lastDataTime = Date.now();
        let timeoutTimer = null;

        const resetTimeout = () => {
          consecutiveTimeouts = 0;
          lastDataTime = Date.now();
        };

        // 15-second idle timeout monitoring
        const startTimeoutMonitor = () => {
          timeoutTimer = setInterval(async () => {
            const elapsed = Date.now() - lastDataTime;
            if (elapsed >= 15000) {
              consecutiveTimeouts++;
              lastDataTime = Date.now(); // reset for next interval
              if (consecutiveTimeouts === 2) {
                try { await this.sendStatus(msgChannel, 'Compacting conversation...'); } catch {}
              }
              // Kill after 20 consecutive timeouts (~5 minutes of no output)
              if (consecutiveTimeouts >= 20) {
                this._log(`Process idle for ${consecutiveTimeouts * 15}s, killing...`);
                await this._stopProcess(proc);
              }
            }
          }, 15000);
        };
        startTimeoutMonitor();

        const processLine = async (line) => {
          line = line.trim();
          if (!line) return;
          resetTimeout();

          let event;
          try { event = JSON.parse(line); } catch { return; }

          const eventType = event.type;

          if (eventType === 'assistant') {
            const blocks = (event.message || {}).content || [];
            for (const block of blocks) {
              if (block.type === 'text' && block.text && block.text.trim()) {
                if (hasToolUseSinceLastText) {
                  lastResponseText.length = 0;
                  hasToolUseSinceLastText = false;
                }
                lastResponseText.push(block.text.trim());
                postedThinking = true;
                everPostedAnything = true;
                // Stream text in real-time as "thinking" (same as Python adapter)
                try { await this.sendThinking(msgChannel, block.text.trim()); } catch {}
              } else if (block.type === 'tool_use') {
                hasToolUseSinceLastText = true;
                postedThinking = false;
                lastResponseText.length = 0;
                const toolName = block.name || '';

                // Intercept TodoWrite: forward to workspace API so it emits a chat event
                if (toolName === 'TodoWrite' && block.input && block.input.todos) {
                  try {
                    const wsTodos = block.input.todos.map((t) => ({
                      content: t.content,
                      status: t.status || 'pending',
                      assignee: t.assignee,
                    }));
                    await this.sendTodos(msgChannel, wsTodos);
                  } catch {}
                }

                // Format tool input as readable text
                let inputPreview = '';
                if (block.input && typeof block.input === 'object') {
                  // Extract key fields for common tools
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
                await this.sendStatus(msgChannel, `${toolName} › ${inputPreview}`);
                everPostedAnything = true;
              }
            }
          } else if (eventType === 'result') {
            const sessionId = event.session_id;
            if (sessionId) {
              this._channelSessions[msgChannel] = sessionId;
              this._saveSessions();
            }
            if (event.is_error) {
              this._log(`Claude error: ${String(event.result || '').slice(0, 200)}`);
            }
          } else if (eventType === 'system') {
            const subtype = event.subtype || '';
            const message = event.message || '';
            if (subtype.includes('compact') || String(message).toLowerCase().includes('compact')) {
              await this.sendStatus(msgChannel, String(message) || 'Compacting conversation...');
            }
          } else if (eventType === 'rate_limit_event') {
            this._log(`Rate limited: ${JSON.stringify(event).slice(0, 200)}`);
          }
        };

        proc.on('exit', async (code) => {
          if (timeoutTimer) clearInterval(timeoutTimer);

          // Wait for all in-flight processLine calls to complete
          try { await _pendingLines; } catch {}

          // Process remaining buffer
          const lines = lineBuffer.split('\n');
          for (const line of lines) {
            try { await processLine(line); } catch {}
          }

          delete this._channelProcesses[msgChannel];

          const stoppedByUser = this._stoppingChannels.has(msgChannel);

          if (stoppedByUser) {
            // User explicitly stopped — cancel all remaining todos
            try { await this.cleanupTodos(msgChannel); } catch {}
          } else if (!msg._todoNudge) {
            // Normal exit (not already a nudge) — check for remaining pending todos
            try {
              const remaining = await this.getRemainingTodos(msgChannel);
              if (remaining.length > 0) {
                const items = remaining.map((t) => `- ${t.content}`).join('\n');
                const nudge = `You have ${remaining.length} remaining task(s) from your plan:\n${items}\n\nPlease continue working on them.`;
                if (!this._channelQueues[msgChannel]) this._channelQueues[msgChannel] = [];
                this._channelQueues[msgChannel].push({
                  content: nudge,
                  senderType: 'system',
                  senderName: 'system:todos',
                  sessionId: msgChannel,
                  messageType: 'chat',
                  _todoNudge: true,
                });
              }
            } catch {}
          } else {
            // Nudge response finished but todos still pending — cancel to avoid infinite loop
            try { await this.cleanupTodos(msgChannel); } catch {}
          }
          if (stoppedByUser) {
            this._stoppingChannels.delete(msgChannel);
            resolve(false);
            return;
          }

          this._log(`CLI exited: code=${code}, lastResponseText=${lastResponseText.length} items, everPosted=${everPostedAnything}, hasSession=${!!this._channelSessions[msgChannel]}`);
          if (code !== 0) {
            if (stderrBuf.trim()) {
              this._log(`stderr: ${stderrBuf.trim().slice(0, 500)}`);
            }
          }

          if (lastResponseText.length > 0) {
            const fullResponse = lastResponseText.join('\n').trim();
            // "Prompt is too long" means the resumed session's context
            // exceeded the model's limit. Clear the stale session and retry.
            if (/prompt is too long/i.test(fullResponse) && this._channelSessions[msgChannel]) {
              this._log(`Prompt too long with resumed session for ${msgChannel}, clearing and retrying`);
              delete this._channelSessions[msgChannel];
              this._saveSessions();
              resolve(true);
            } else if (fullResponse) {
              try { await this.sendResponse(msgChannel, fullResponse); } catch {}
              resolve(false);
            } else {
              resolve(false);
            }
          } else if (this._channelSessions[msgChannel] && !everPostedAnything) {
            // No output + had a resume session → likely stale session, retry fresh.
            // Covers both error exits (code !== 0) and silent success (code === 0)
            // where Claude produced no text output on a resumed conversation.
            this._log(`Stale session detected for ${msgChannel}, clearing and retrying without resume`);
            delete this._channelSessions[msgChannel];
            this._saveSessions();
            resolve(true); // retry=true
          } else {
            if (!everPostedAnything) {
              try { await this.sendResponse(msgChannel, 'No response generated. Please try again.'); } catch {}
            }
            resolve(false);
          }
        });

        proc.on('error', (err) => {
          if (timeoutTimer) clearInterval(timeoutTimer);
          reject(err);
        });

        // Process lines as they arrive (chained to preserve order)
        proc.stdout.on('data', (chunk) => {
          lineBuffer += chunk.toString('utf-8');
          resetTimeout();
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop(); // keep incomplete line
          for (const line of lines) {
            _pendingLines = _pendingLines.then(() => processLine(line)).catch(() => {});
          }
        });
      });
    } catch (e) {
      this._log(`Error handling message: ${e.message}`);
      await this.sendError(msgChannel, `Error processing message: ${e.message}`);
      break; // no retry on spawn error
    }
    if (!_shouldRetry) break; // exit loop if no retry needed
    } // end for attempt

    if (mcpConfigFile) {
      try { fs.unlinkSync(mcpConfigFile); } catch {}
    }
    delete this._channelProcesses[msgChannel];
  }
}

module.exports = ClaudeAdapter;

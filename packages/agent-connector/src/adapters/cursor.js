/**
 * Cursor CLI adapter for OpenAgents workspace.
 *
 * Bridges the Cursor Agent CLI to an OpenAgents workspace via:
 * - Polling loop for incoming messages
 * - Cursor CLI subprocess (stream-json) for task execution
 * - SKILL.md file for workspace tool access
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt, SESSION_DEFAULT_RE, generateSessionTitle } = require('./utils');
const { buildCursorSkillMd } = require('./workspace-prompt');
const { defaultAgentWorkdir, whichBinary, getEnhancedEnv } = require('../paths');

const IS_WINDOWS = process.platform === 'win32';

class CursorAdapter extends BaseAdapter {
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();
    this._channelSessions = {};
    this._channelProcesses = {};
    this._stoppingChannels = new Set();
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_cursor.json`
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
        this._stoppingChannels.add(channel);
        await this._stopProcess(this._channelProcesses[channel]);
        delete this._channelProcesses[channel];
        delete this._channelQueues[channel];
        try { await this.sendResponse(channel, 'Execution stopped.'); } catch {}
      } else {
        await this._stopAllProcesses('Execution stopped.');
      }
    } else if (action === 'restart') {
      const channel = (payload && typeof payload === 'object') ? payload.channel : null;
      if (channel) {
        if (this._channelProcesses[channel]) {
          this._stoppingChannels.add(channel);
          await this._stopProcess(this._channelProcesses[channel]);
          delete this._channelProcesses[channel];
          delete this._channelQueues[channel];
        }
        delete this._channelSessions[channel];
        this._saveSessions();
        try { await this.sendResponse(channel, 'Session cleared. Send a new message to start fresh.'); } catch {}
      }
    }
  }

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
        try { proc.kill('SIGINT'); } catch {}
        const exited = await new Promise((resolve) => {
          if (proc.exitCode !== null) { resolve(true); return; }
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
          const finish = () => { if (done) return; done = true; resolve(); };
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
      if (text === currentMessage) continue;
      const who = m.senderType === 'human'
        ? (m.senderName || 'user')
        : (m.senderName || 'agent');
      const truncated = text.length > 800 ? text.slice(0, 800) + '…' : text;
      lines.push(`[${who}] ${truncated}`);
    }
    if (lines.length === 0) return null;

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
      try { await this.sendResponse(channel, completionMessage); } catch {}
    }
  }

  // ── Binary resolution ──

  _findCursorBinary() {
    const home = os.homedir();
    const ext = IS_WINDOWS ? '.cmd' : '';
    const names = ['cursor-agent', 'agent'];

    // Tier 0: Isolated runtime prefix
    for (const name of names) {
      const runtimeCandidate = path.join(home, '.openagents', 'runtimes', 'cursor', 'node_modules', '.bin', `${name}${ext}`);
      if (fs.existsSync(runtimeCandidate)) return runtimeCandidate;
    }

    // Tier 0b: Legacy portable install
    for (const name of names) {
      const portableCandidate = path.join(home, '.openagents', 'nodejs', 'node_modules', '.bin', `${name}${ext}`);
      if (fs.existsSync(portableCandidate)) return portableCandidate;
    }

    // Tier 1: PATH search. Use the ENRICHED env so the lookup sees the dirs the
    // launcher adds — a freshly-run cursor installer updates the *user* PATH,
    // which the daemon's already-running process won't see, so `where` against
    // the daemon's own PATH comes up empty even though cursor-agent is installed.
    // windowsHide stops a console window from flashing.
    try {
      const env = getEnhancedEnv();
      if (IS_WINDOWS) {
        const r = execSync('where cursor-agent.cmd 2>nul || where cursor-agent.exe 2>nul || where cursor-agent 2>nul || where agent.cmd 2>nul || where agent.exe 2>nul || where agent 2>nul', {
          encoding: 'utf-8', timeout: 5000, windowsHide: true, env,
        });
        const hit = r.split(/\r?\n/)[0].trim();
        if (hit) return hit;
      } else {
        const hit = execSync('which cursor-agent || which agent', { encoding: 'utf-8', timeout: 5000, windowsHide: true, env }).trim();
        if (hit) return hit;
      }
    } catch {}

    // Tier 2: Next to current Node.js interpreter (npm global)
    const nodeBinDir = path.dirname(process.execPath);
    for (const name of names) {
      const nearNode = path.join(nodeBinDir, `${name}${ext}`);
      if (fs.existsSync(nearNode)) return nearNode;
    }

    // Tier 3: Common install locations
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const candidates = IS_WINDOWS ? [
      // The Windows installer (install?win32=true) drops cursor-agent under the
      // user home's .local/bin — the same place the Unix installer uses. This
      // was missing, so a successful install was invisible to the launcher.
      path.join(home, '.local', 'bin', 'cursor-agent.exe'),
      path.join(home, '.local', 'bin', 'cursor-agent.cmd'),
      path.join(home, '.local', 'bin', 'cursor-agent'),
      path.join(home, '.local', 'bin', 'agent.exe'),
      path.join(home, '.local', 'bin', 'agent.cmd'),
      // Older/alternate layout: %LOCALAPPDATA%\Programs\cursor-agent\.
      path.join(localAppData, 'Programs', 'cursor-agent', 'cursor-agent.exe'),
      path.join(localAppData, 'Programs', 'cursor-agent', 'agent.exe'),
      // Windows native installer (install?win32=true) drops the CLI here.
      path.join(localAppData, 'cursor-agent', 'cursor-agent.cmd'),
      path.join(localAppData, 'cursor-agent', 'cursor-agent.exe'),
      path.join(localAppData, 'cursor-agent', 'agent.cmd'),
      path.join(localAppData, 'cursor-agent', 'agent.exe'),
      path.join(home, '.cursor', 'bin', 'cursor-agent.cmd'),
      path.join(home, '.cursor', 'bin', 'cursor-agent.exe'),
      path.join(home, '.cursor', 'bin', 'cursor-agent'),
      path.join(home, '.cursor', 'bin', 'agent.cmd'),
      path.join(home, '.cursor', 'bin', 'agent.exe'),
      path.join(home, '.cursor', 'bin', 'agent'),
      path.join(process.env.APPDATA || '', 'npm', 'cursor-agent.cmd'),
      path.join(process.env.APPDATA || '', 'npm', 'agent.cmd'),
    ] : [
      path.join(home, '.local', 'bin', 'cursor-agent'),
      path.join(home, '.local', 'bin', 'agent'),
      path.join(home, '.npm-global', 'bin', 'cursor-agent'),
      path.join(home, '.npm-global', 'bin', 'agent'),
      path.join(home, '.cursor', 'bin', 'cursor-agent'),
      path.join(home, '.cursor', 'bin', 'agent'),
      '/opt/homebrew/bin/cursor-agent',
      '/opt/homebrew/bin/agent',
      '/usr/local/bin/cursor-agent',
      '/usr/local/bin/agent',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    // Tier 4: Deep scan of every known bin dir (nvm/fnm/volta, homebrew, …).
    for (const name of names) {
      const viaWhich = whichBinary(name);
      if (viaWhich) return viaWhich;
    }

    return null;
  }

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

  _resolveToNodeCmd(binPath) {
    const nodeBin = this._findNodeBin();
    if (IS_WINDOWS && binPath.toLowerCase().endsWith('.cmd')) {
      const cmdDir = path.dirname(path.resolve(binPath));
      const cmdContent = fs.readFileSync(binPath, 'utf-8');
      const jsMatch = cmdContent.match(/%dp0%\\([^\s"*?]+\.m?js)/i);
      if (jsMatch) {
        return [nodeBin, path.resolve(cmdDir, jsMatch[1])];
      }
      // .cmd shims that forward to a native .exe — resolve to the exe and spawn
      // it directly. Wrapping such a .cmd in `cmd.exe /c` caps the command line
      // at cmd.exe's 8191-char limit, truncating long args (e.g. system prompts).
      const exeMatch = cmdContent.match(/%dp0%\\([^\s"*?]+\.exe)/i);
      if (exeMatch) {
        return [path.resolve(cmdDir, exeMatch[1])];
      }
    } else {
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

  // ── Skill file writing ──

  _writeSkillFile(channelName) {
    // Never fall back to process.cwd() (C:\WINDOWS\system32 on a packaged
    // Windows daemon → EPERM); use a writable per-agent dir under ~/.openagents.
    const workDir = this.workingDir || defaultAgentWorkdir(this.agentName);
    const skillDir = path.join(workDir, '.cursor', 'skills');
    fs.mkdirSync(skillDir, { recursive: true });
    const skillFile = path.join(skillDir, 'openagents-workspace.md');

    const skillContent = buildCursorSkillMd({
      endpoint: this.endpoint,
      workspaceId: this.workspaceId,
      token: this.token,
      agentName: this.agentName,
      channelName,
      disabledModules: this.disabledModules,
    });
    fs.writeFileSync(skillFile, skillContent, 'utf-8');
    this._log(`Wrote workspace skill to ${skillFile}`);
  }

  // ── Command building ──

  _buildCursorCmd(prompt, channelName, { skipResume = false } = {}) {
    const agentBin = this._findCursorBinary();
    if (!agentBin) {
      throw new Error('Cursor CLI not found. Install with: curl https://cursor.com/install -fsSL | bash');
    }

    const cmd = [agentBin, '-p', prompt, '--output-format', 'stream-json', '--trust', '--force'];

    // Model selection
    const model = (this.agentEnv || process.env).CURSOR_MODEL;
    if (model) {
      cmd.push('--model', model);
    }

    // Working directory
    if (this.workingDir) {
      cmd.push('--workspace', this.workingDir);
    }

    // Resume existing conversation
    const sessionId = this._channelSessions[channelName];
    if (sessionId && !skipResume) {
      cmd.push('--resume', sessionId);
    }

    return cmd;
  }

  // ── Message handling ──

  async _handleMessage(msg) {
    let content = (msg.content || '').trim();
    const attachments = msg.attachments || [];

    const attText = formatAttachmentsForPrompt(attachments);
    if (attText) {
      content = content ? content + attText : attText.trim();
    }

    if (!content) return;

    const msgChannel = msg.sessionId || this.channelName;
    this._stoppingChannels.delete(msgChannel);
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing message from ${sender} in ${msgChannel}: ${content.slice(0, 80)}...`);

    // Auto-title on first encounter
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

    // Write workspace skill file before each spawn
    try {
      this._writeSkillFile(msgChannel);
    } catch (e) {
      this._log(`Warning: could not write skill file: ${e.message}`);
    }

    let cmd;
    let _shouldRetry = false;
    let effectiveContent = content;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        try {
          const recap = await this._buildChannelRecap(msgChannel, content);
          if (recap) effectiveContent = `${recap}\n\n---\n\n${content}`;
        } catch {}
      }

      try {
        cmd = this._buildCursorCmd(effectiveContent, msgChannel, { skipResume: attempt > 0 });
      } catch (e) {
        await this.sendError(msgChannel, e.message);
        return;
      }

    try {
      const resolved = this._resolveToNodeCmd(cmd[0]);
      if (resolved) {
        cmd = [...resolved, ...cmd.slice(1)];
      } else if (IS_WINDOWS && cmd[0].toLowerCase().endsWith('.cmd')) {
        cmd = ['cmd.exe', '/c', ...cmd];
      }

      const cleanEnv = { ...(this.agentEnv || process.env) };

      const proc = spawn(cmd[0], cmd.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: cleanEnv,
        cwd: this.workingDir,
        detached: !IS_WINDOWS,
        windowsHide: true,
      });
      this._channelProcesses[msgChannel] = proc;

      const lastResponseText = [];
      let hasToolUseSinceLastText = false;
      let postedThinking = false;
      let everPostedAnything = false;
      let stderrBuf = '';
      let lineBuffer = '';
      let _pendingLines = Promise.resolve();

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

        const startTimeoutMonitor = () => {
          timeoutTimer = setInterval(async () => {
            const elapsed = Date.now() - lastDataTime;
            if (elapsed >= 15000) {
              consecutiveTimeouts++;
              lastDataTime = Date.now();
              if (consecutiveTimeouts === 2) {
                try { await this.sendStatus(msgChannel, 'Compacting conversation...'); } catch {}
              }
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
                try { await this.sendThinking(msgChannel, block.text.trim()); } catch {}
              }
            }
          } else if (eventType === 'tool_call') {
            const subtype = event.subtype || '';
            if (subtype === 'started') {
              hasToolUseSinceLastText = true;
              postedThinking = false;
              lastResponseText.length = 0;
              const tc = event.tool_call || {};
              const toolName = _extractToolName(tc);
              const toolDetail = _extractToolDetail(tc);
              const label = toolDetail ? `${toolName} › ${toolDetail}` : toolName;
              await this.sendStatus(msgChannel, label);
              everPostedAnything = true;
            }
          } else if (eventType === 'result') {
            const sessionId = event.session_id;
            if (sessionId) {
              this._channelSessions[msgChannel] = sessionId;
              this._saveSessions();
            }
            if (event.is_error) {
              this._log(`Cursor error: ${String(event.result || '').slice(0, 200)}`);
            }
          } else if (eventType === 'system') {
            const sessionId = event.session_id;
            if (sessionId && !this._channelSessions[msgChannel]) {
              this._channelSessions[msgChannel] = sessionId;
              this._saveSessions();
            }
          }
        };

        proc.on('exit', async (code) => {
          if (timeoutTimer) clearInterval(timeoutTimer);

          try { await _pendingLines; } catch {}

          const lines = lineBuffer.split('\n');
          for (const line of lines) {
            try { await processLine(line); } catch {}
          }

          delete this._channelProcesses[msgChannel];

          const stoppedByUser = this._stoppingChannels.has(msgChannel);

          if (stoppedByUser) {
            try { await this.cleanupTodos(msgChannel); } catch {}
          } else if (!msg._todoNudge) {
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
            try { await this.cleanupTodos(msgChannel); } catch {}
          }

          if (stoppedByUser) {
            this._stoppingChannels.delete(msgChannel);
            resolve(false);
            return;
          }

          this._log(`CLI exited: code=${code}, lastResponseText=${lastResponseText.length} items, everPosted=${everPostedAnything}, hasSession=${!!this._channelSessions[msgChannel]}`);
          if (code !== 0 && stderrBuf.trim()) {
            this._log(`stderr: ${stderrBuf.trim().slice(0, 500)}`);
          }

          if (lastResponseText.length > 0) {
            const fullResponse = lastResponseText.join('\n').trim();
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
            this._log(`Stale session detected for ${msgChannel}, clearing and retrying without resume`);
            delete this._channelSessions[msgChannel];
            this._saveSessions();
            resolve(true);
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

        proc.stdout.on('data', (chunk) => {
          lineBuffer += chunk.toString('utf-8');
          resetTimeout();
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop();
          for (const line of lines) {
            _pendingLines = _pendingLines.then(() => processLine(line)).catch(() => {});
          }
        });
      });
    } catch (e) {
      this._log(`Error handling message: ${e.message}`);
      await this.sendError(msgChannel, `Error processing message: ${e.message}`);
      break;
    }
    if (!_shouldRetry) break;
    } // end for attempt

    delete this._channelProcesses[msgChannel];
  }
}

/**
 * Extract human-readable tool name from a Cursor stream-json tool_call object.
 * Cursor uses nested keys like readToolCall, writeToolCall, etc.
 */
function _extractToolName(tc) {
  if (tc.readToolCall) return 'Read';
  if (tc.writeToolCall) return 'Write';
  if (tc.editToolCall) return 'Edit';
  if (tc.bashToolCall || tc.terminalToolCall) return 'Bash';
  if (tc.globToolCall) return 'Glob';
  if (tc.grepToolCall) return 'Grep';
  if (tc.function) return tc.function.name || 'tool';
  const keys = Object.keys(tc).filter((k) => k.endsWith('ToolCall'));
  if (keys.length > 0) return keys[0].replace('ToolCall', '');
  return 'tool';
}

function _extractToolDetail(tc) {
  const call = tc.readToolCall || tc.writeToolCall || tc.editToolCall
    || tc.bashToolCall || tc.terminalToolCall || tc.globToolCall || tc.grepToolCall;
  if (!call || !call.args) return '';
  const args = call.args;
  return args.command || args.path || args.file_path || args.pattern || args.query || '';
}

module.exports = CursorAdapter;

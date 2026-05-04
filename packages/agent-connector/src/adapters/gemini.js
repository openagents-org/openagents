/**
 * Gemini CLI adapter for OpenAgents workspace.
 *
 * Bridges Gemini CLI to an OpenAgents workspace via:
 * - Polling loop for incoming messages
 * - Gemini CLI subprocess (stream-json) for task execution
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt, SESSION_DEFAULT_RE, generateSessionTitle } = require('./utils');
const { buildClaudeSystemPrompt } = require('./workspace-prompt');

const IS_WINDOWS = process.platform === 'win32';

class GeminiAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   * @param {string} [opts.workingDir]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();
    this._channelSessions = {}; // channel → Gemini CLI session_id
    this._channelProcesses = {}; // channel → child process
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_gemini.json`
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

  async _onControlAction(action, _payload) {
    if (action === 'stop') {
      await this._stopAllProcesses();
    }
  }

  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null) return;
    try {
      if (IS_WINDOWS) {
        try { execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 5000 }); } catch {}
      } else {
        try { process.kill(-proc.pid, 'SIGTERM'); } catch {
          proc.kill('SIGTERM');
        }
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            try { process.kill(-proc.pid, 'SIGKILL'); } catch {
              proc.kill('SIGKILL');
            }
            resolve();
          }, 5000);
          proc.on('exit', () => { clearTimeout(timeout); resolve(); });
        });
      }
    } catch {}
  }

  async _stopAllProcesses() {
    const entries = Object.entries(this._channelProcesses);
    if (!entries.length) return;
    this._log(`Stopping ${entries.length} running process(es)...`);
    for (const [channel, proc] of entries) {
      await this._stopProcess(proc);
      delete this._channelProcesses[channel];
      delete this._channelQueues[channel];
      try {
        await this.sendStatus(channel, 'Execution stopped by user');
      } catch {}
    }
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

  _findGeminiBinary() {
    const home = os.homedir();
    const ext = IS_WINDOWS ? '.cmd' : '';

    // Tier 0: Isolated runtime prefix
    const runtimeCandidate = path.join(home, '.openagents', 'runtimes', 'gemini', 'node_modules', '.bin', `gemini${ext}`);
    if (fs.existsSync(runtimeCandidate)) return runtimeCandidate;

    // Tier 1: PATH search
    try {
      if (IS_WINDOWS) {
        const r = execSync('where gemini.cmd 2>nul || where gemini.exe 2>nul || where gemini 2>nul', {
          encoding: 'utf-8', timeout: 5000,
        });
        return r.split(/\r?\n/)[0].trim();
      } else {
        return execSync('which gemini', { encoding: 'utf-8', timeout: 5000 }).trim();
      }
    } catch {}

    // Tier 2: Next to current Node.js interpreter
    const nodeBinDir = path.dirname(process.execPath);
    const nearNode = path.join(nodeBinDir, `gemini${ext}`);
    if (fs.existsSync(nearNode)) return nearNode;

    // Tier 3: Common install locations
    const candidates = IS_WINDOWS ? [
      path.join(process.env.APPDATA || '', 'npm', 'gemini.cmd'),
    ] : [
      path.join(home, '.local', 'bin', 'gemini'),
      path.join(home, '.npm-global', 'bin', 'gemini'),
      '/opt/homebrew/bin/gemini',
      '/usr/local/bin/gemini',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    return null;
  }

  _buildGeminiCmd(prompt, channelName, { skipResume = false } = {}) {
    const geminiBin = this._findGeminiBinary();
    if (!geminiBin) {
      throw new Error('gemini CLI not found. Install with: npm install -g @google/gemini-cli');
    }

    const systemPrompt = '\n' + buildClaudeSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName,
      mode: this._mode,
    });
    
    // For gemini, we combine system prompt with the user message since it doesn't have an append-system-prompt flag
    const fullPrompt = `${systemPrompt}\n\n---\n\nUser message:\n${prompt}`;

    const cmd = [geminiBin, '-p', fullPrompt, '-y', '-o', 'stream-json'];

    const sessionId = this._channelSessions[channelName];
    if (sessionId && !skipResume) {
      cmd.push('-r', sessionId);
    }

    return { cmd };
  }

  async _handleMessage(msg) {
    let content = (msg.content || '').trim();
    const attachments = msg.attachments || [];

    const attText = formatAttachmentsForPrompt(attachments);
    if (attText) {
      content = content ? content + attText : attText.trim();
    }

    if (!content) return;

    const msgChannel = msg.sessionId || this.channelName;
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing message from ${sender} in ${msgChannel}: ${content.slice(0, 80)}...`);

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

    let cmd;
    const cleanEnv = { ...(this.agentEnv || process.env) };

    let _shouldRetry = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const built = this._buildGeminiCmd(content, msgChannel, { skipResume: attempt > 0 });
        cmd = built.cmd;
      } catch (e) {
        await this.sendError(msgChannel, e.message);
        return;
      }

      try {
        const resolved = this._resolveToNodeCmd(cmd[0]);
        if (resolved) {
          cmd = [resolved[0], resolved[1], ...cmd.slice(1)];
        } else if (IS_WINDOWS && cmd[0].toLowerCase().endsWith('.cmd')) {
          cmd = ['cmd.exe', '/c', ...cmd];
        }

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
                  try { await this.sendStatus(msgChannel, 'Processing...'); } catch {}
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

            if (eventType === 'init' && event.session_id) {
              this._channelSessions[msgChannel] = event.session_id;
              this._saveSessions();
            } else if (eventType === 'message' && event.role === 'assistant') {
              const text = event.content || '';
              if (text) {
                if (hasToolUseSinceLastText) {
                  lastResponseText.length = 0;
                  hasToolUseSinceLastText = false;
                }
                lastResponseText.push(text);
                postedThinking = true;
                try { await this.sendThinking(msgChannel, text); } catch {}
              }
            } else if (eventType === 'tool_use') {
              hasToolUseSinceLastText = true;
              postedThinking = false;
              lastResponseText.length = 0;
              const toolName = event.tool_name || '';
              let inputPreview = '';
              if (event.parameters && typeof event.parameters === 'object') {
                const inp = event.parameters;
                if (inp.command) inputPreview = inp.command;
                else if (inp.file_path || inp.path) inputPreview = inp.file_path || inp.path;
                else if (inp.pattern) inputPreview = inp.pattern;
                else if (inp.query) inputPreview = inp.query;
                else inputPreview = JSON.stringify(inp).slice(0, 150);
              }
              await this.sendStatus(msgChannel, `${toolName} › ${inputPreview}`);
            } else if (eventType === 'result') {
               if (event.session_id) {
                 this._channelSessions[msgChannel] = event.session_id;
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

            if (code !== 0) {
              this._log(`CLI exited with code ${code}`);
              if (stderrBuf.trim()) {
                this._log(`stderr: ${stderrBuf.trim().slice(0, 500)}`);
              }
            }

            if (lastResponseText.length > 0) {
              const fullResponse = lastResponseText.join('').trim(); // Gemini deltas are partial strings, no newline needed between them usually, but wait, delta:true means it appends. If it's multiple blocks, we should join with empty string? Let's check `delta: true`.
              // Actually if delta: true, they are chunks. We pushed them to array. `lastResponseText.join('')` is correct.
              if (fullResponse) {
                try { await this.sendResponse(msgChannel, fullResponse); } catch {}
              }
              resolve(false);
            } else if (code !== 0 && this._channelSessions[msgChannel]) {
              this._log(`Stale session detected for ${msgChannel}, clearing and retrying without resume`);
              delete this._channelSessions[msgChannel];
              this._saveSessions();
              resolve(true);
            } else {
              if (!postedThinking) {
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
    }
  }
}

module.exports = GeminiAdapter;

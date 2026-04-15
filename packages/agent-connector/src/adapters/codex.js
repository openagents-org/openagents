/**
 * Codex adapter for OpenAgents workspace.
 *
 * Bridges OpenAI Codex CLI to an OpenAgents workspace via:
 * - Codex CLI subprocess (exec --json --full-auto) as primary mode
 * - Direct HTTP mode for OpenAI-compatible LLM APIs as fallback
 *
 * Similar to ClaudeAdapter: spawns the CLI per message, processes
 * structured JSON events, maintains session/thread IDs per channel,
 * and sends real-time status updates.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');
const http = require('http');
const https = require('https');

const BaseAdapter = require('./base');
const { buildOpenclawSystemPrompt } = require('./workspace-prompt');

const IS_WINDOWS = process.platform === 'win32';
const MAX_HISTORY_ENTRIES = 50;

class CodexAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();

    const env = this.agentEnv || process.env;
    this._directApiKey = env.OPENAI_API_KEY || '';
    this._directBaseUrl = (env.OPENAI_BASE_URL || '').replace(/\/+$/, '');
    this._directModel = env.CODEX_MODEL || env.OPENCLAW_MODEL || '';

    // Per-channel thread tracking (like Claude's session IDs)
    this._channelThreads = {};
    this._channelProcesses = {};
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_codex.json`
    );
    this._loadSessions();

    // Determine mode:
    // - CLI mode: only works with OpenAI's native Responses API (api.openai.com)
    // - Direct API mode: works with any OpenAI-compatible chat completions endpoint
    this._codexBin = this._findCodexBinary();
    this._directMode = false;
    this._useCliMode = false;

    // Check if base URL is OpenAI's native API (CLI requires Responses API)
    const isOpenAiNative = !this._directBaseUrl ||
      this._directBaseUrl.includes('api.openai.com');

    if (this._codexBin && isOpenAiNative) {
      this._useCliMode = true;
      this._log(`CLI mode: ${this._codexBin}`);
    } else if (this._directApiKey && this._directBaseUrl) {
      this._directMode = true;
      if (this._codexBin) {
        this._log(`Direct LLM mode (non-OpenAI endpoint, CLI requires Responses API): ${this._directBaseUrl} model=${this._directModel || 'gpt-4o'}`);
      } else {
        this._log(`Direct LLM mode: ${this._directBaseUrl} model=${this._directModel || 'gpt-4o'}`);
      }
    } else if (this._codexBin) {
      // CLI binary found, no custom base URL — assume OpenAI
      this._useCliMode = true;
      this._log(`CLI mode: ${this._codexBin}`);
    } else {
      this._log('Warning: No codex CLI binary found and no direct API configured');
    }

    // Conversation history (direct API mode only)
    this._conversationHistory = [];
  }

  // ------------------------------------------------------------------
  // Session persistence (per-channel thread IDs)
  // ------------------------------------------------------------------

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelThreads, data);
          this._log(`Loaded ${Object.keys(data).length} thread(s)`);
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
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelThreads));
    } catch {}
  }

  // ------------------------------------------------------------------
  // Find codex binary (multi-tier, like Claude adapter)
  // ------------------------------------------------------------------

  _findCodexBinary() {
    const home = os.homedir();
    const ext = IS_WINDOWS ? '.cmd' : '';

    // Tier 0: Isolated runtime prefix (~/.openagents/runtimes/codex/)
    const runtimeCandidate = path.join(home, '.openagents', 'runtimes', 'codex', 'node_modules', '.bin', `codex${ext}`);
    if (fs.existsSync(runtimeCandidate)) return runtimeCandidate;

    // Tier 0b: Legacy portable install
    const portableCandidate = path.join(home, '.openagents', 'nodejs', 'node_modules', '.bin', `codex${ext}`);
    if (fs.existsSync(portableCandidate)) return portableCandidate;

    // Tier 1: PATH search
    try {
      if (IS_WINDOWS) {
        const r = execSync('where codex.cmd 2>nul || where codex.exe 2>nul || where codex 2>nul', {
          encoding: 'utf-8', timeout: 5000,
        });
        return r.split(/\r?\n/)[0].trim();
      } else {
        return execSync('which codex', { encoding: 'utf-8', timeout: 5000 }).trim();
      }
    } catch {}

    // Tier 2: Next to current Node.js interpreter (npm global)
    const nodeBinDir = path.dirname(process.execPath);
    const nearNode = path.join(nodeBinDir, `codex${ext}`);
    if (fs.existsSync(nearNode)) return nearNode;

    // Tier 3: npm global prefix (handles custom npm prefix like D:\node\node_global)
    try {
      const npmPrefix = execSync('npm config get prefix', {
        encoding: 'utf-8', timeout: 5000, windowsHide: true,
      }).trim();
      if (npmPrefix) {
        const prefixCandidate = path.join(npmPrefix, `codex${ext}`);
        if (fs.existsSync(prefixCandidate)) return prefixCandidate;
      }
    } catch {}

    // Tier 4: Common install locations
    const candidates = IS_WINDOWS ? [
      path.join(process.env.APPDATA || '', 'npm', 'codex.cmd'),
    ] : [
      path.join(home, '.local', 'bin', 'codex'),
      path.join(home, '.npm-global', 'bin', 'codex'),
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    return null;
  }

  _buildSystemContext(channelName) {
    return buildOpenclawSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName,
      endpoint: this.endpoint,
      token: this.token,
      mode: this._mode,
      disabledModules: this.disabledModules,
    });
  }

  // ------------------------------------------------------------------
  // Process management
  // ------------------------------------------------------------------

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

  async _onControlAction(action, _payload) {
    if (action === 'stop') {
      for (const [channel, proc] of Object.entries(this._channelProcesses)) {
        await this._stopProcess(proc);
        delete this._channelProcesses[channel];
        try { await this.sendStatus(channel, 'Execution stopped by user'); } catch {}
      }
    }
  }

  // ------------------------------------------------------------------
  // Message handler
  // ------------------------------------------------------------------

  async _handleMessage(msg) {
    const content = (msg.content || '').trim();
    if (!content) return;

    const msgChannel = msg.sessionId || this.channelName;
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing message from ${sender} in ${msgChannel}: ${content.slice(0, 80)}...`);

    await this._autoTitleChannel(msgChannel, content);
    await this.sendStatus(msgChannel, 'thinking...');

    if (this._useCliMode) {
      await this._handleViaSubprocess(content, msgChannel);
    } else if (this._directMode) {
      await this._handleViaDirectApi(content, msgChannel);
    } else {
      await this.sendError(msgChannel, 'codex CLI not found. Install with: npm install -g @openai/codex');
    }
  }

  // ------------------------------------------------------------------
  // CLI subprocess mode (primary)
  // ------------------------------------------------------------------

  async _handleViaSubprocess(content, msgChannel) {
    const env = { ...(this.agentEnv || process.env) };

    // Set model via env if configured
    if (this._directModel) env.CODEX_MODEL = this._directModel;
    if (this._directApiKey) env.OPENAI_API_KEY = this._directApiKey;
    if (this._directBaseUrl) env.OPENAI_BASE_URL = this._directBaseUrl;

    const context = this._buildSystemContext(msgChannel);
    const fullPrompt = `${context}\n\n---\n\nUser message:\n${content}`;

    // Run up to 2 attempts: first with resume, then fresh if stale
    for (let attempt = 0; attempt < 2; attempt++) {
      const cmd = [this._codexBin, 'exec'];

      // Resume existing thread for this channel
      const threadId = this._channelThreads[msgChannel];
      if (threadId && attempt === 0) {
        cmd.push('resume', threadId);
      }

      cmd.push('--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check');

      // Model override
      if (this._directModel) {
        cmd.push('-m', this._directModel);
      }

      // Working directory
      if (this.workingDir) {
        cmd.push('-C', this.workingDir);
      }

      this._log(`Spawning: codex exec ${threadId && attempt === 0 ? `resume ${threadId} ` : ''}--json --full-auto -m ${this._directModel || 'default'}`);

      try {
        const result = await this._spawnCodex(cmd, env, msgChannel, fullPrompt);

        if (result.responseText) {
          await this.sendResponse(msgChannel, result.responseText);
          return;
        } else if (result.exitCode !== 0 && threadId && attempt === 0) {
          // Stale thread — clear and retry fresh
          this._log(`Stale thread detected for ${msgChannel}, clearing and retrying`);
          delete this._channelThreads[msgChannel];
          this._saveSessions();
          continue;
        } else {
          await this.sendResponse(msgChannel, 'No response generated. Please try again.');
          return;
        }
      } catch (e) {
        this._log(`Error in subprocess: ${e.message}`);
        await this.sendError(msgChannel, `Error: ${e.message}`);
        return;
      }
    }
  }

  async _spawnCodex(cmd, env, msgChannel, prompt) {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd[0], cmd.slice(1), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        cwd: this.workingDir,
        detached: !IS_WINDOWS,
        windowsHide: true,
        shell: IS_WINDOWS,
      });
      this._channelProcesses[msgChannel] = proc;

      const responseTexts = [];
      let hasToolUseSinceLastText = false;
      let lineBuffer = '';
      let stderrBuf = '';
      let _pendingLines = Promise.resolve();

      if (proc.stderr) {
        proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString('utf-8'); });
      }

      if (proc.stdin) {
        proc.stdin.write(prompt || '', 'utf-8');
        proc.stdin.end();
      }

      const processLine = async (line) => {
        line = line.trim();
        if (!line) return;

        let event;
        try { event = JSON.parse(line); } catch { return; }

        const eventType = event.type;

        if (eventType === 'thread.started') {
          if (event.thread_id) {
            this._channelThreads[msgChannel] = event.thread_id;
            this._saveSessions();
            this._log(`Thread started: ${event.thread_id}`);
          }
        } else if (eventType === 'item.completed') {
          const item = event.item || {};
          if (item.type === 'agent_message' && item.text) {
            if (hasToolUseSinceLastText) {
              responseTexts.length = 0;
              hasToolUseSinceLastText = false;
            }
            responseTexts.push(item.text);
            // Stream as thinking (like Claude adapter)
            try { await this.sendThinking(msgChannel, item.text); } catch {}
          } else if (item.type === 'command_execution') {
            hasToolUseSinceLastText = true;
            const cmdText = (item.command || '').slice(0, 200);
            const exitCode = item.exit_code;
            const output = (item.output || '').slice(0, 500);
            let status = `**Running:** \`${cmdText}\``;
            if (exitCode !== undefined && exitCode !== null) {
              status += ` (exit ${exitCode})`;
            }
            try { await this.sendStatus(msgChannel, status); } catch {}
            this._log(`Command: ${cmdText} → exit ${exitCode}`);
          } else if (item.type === 'file_change') {
            hasToolUseSinceLastText = true;
            const filename = item.filename || '';
            try { await this.sendStatus(msgChannel, `**Editing:** \`${filename}\``); } catch {}
            this._log(`File change: ${filename}`);
          }
        } else if (eventType === 'turn.failed') {
          const error = event.error || {};
          const errMsg = error.message || JSON.stringify(error);
          this._log(`Turn failed: ${errMsg}`);
        }
      };

      proc.stdout.on('data', (chunk) => {
        lineBuffer += chunk.toString('utf-8');
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop();
        for (const line of lines) {
          _pendingLines = _pendingLines.then(() => processLine(line)).catch(() => {});
        }
      });

      proc.on('exit', async (code) => {
        // Wait for all in-flight processLine calls
        try { await _pendingLines; } catch {}

        // Process remaining buffer
        for (const line of lineBuffer.split('\n')) {
          try { await processLine(line); } catch {}
        }

        delete this._channelProcesses[msgChannel];

        if (code !== 0) {
          this._log(`Codex CLI exited with code ${code}`);
          if (stderrBuf.trim()) {
            this._log(`stderr: ${stderrBuf.trim().slice(0, 500)}`);
          }
        }

        resolve({
          responseText: responseTexts.join('\n').trim(),
          exitCode: code,
          stderr: stderrBuf,
        });
      });

      proc.on('error', (err) => {
        delete this._channelProcesses[msgChannel];
        reject(err);
      });
    });
  }

  // ------------------------------------------------------------------
  // Direct HTTP mode (fallback when CLI not available)
  // ------------------------------------------------------------------

  async _handleViaDirectApi(content, msgChannel) {
    try {
      const responseText = await this._callCompletionApi(content, msgChannel);
      if (responseText) {
        this._conversationHistory.push({ role: 'user', content });
        this._conversationHistory.push({ role: 'assistant', content: responseText });
        if (this._conversationHistory.length > MAX_HISTORY_ENTRIES * 2) {
          this._conversationHistory = this._conversationHistory.slice(-MAX_HISTORY_ENTRIES * 2);
        }
        await this.sendResponse(msgChannel, responseText);
      } else {
        await this.sendResponse(msgChannel, 'No response generated. Please try again.');
      }
    } catch (e) {
      this._log(`Error in direct API: ${e.message}`);
      await this.sendError(msgChannel, `Error: ${e.message}`);
    }
  }

  async _callCompletionApi(userMessage, channel) {
    const systemPrompt = this._buildSystemContext(channel);
    const messages = [{ role: 'system', content: systemPrompt }];
    messages.push(...this._conversationHistory);
    messages.push({ role: 'user', content: userMessage });

    const url = `${this._directBaseUrl}/chat/completions`;
    const payload = JSON.stringify({
      model: this._directModel || 'gpt-4o',
      messages,
      stream: true,
    });

    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request(parsed, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this._directApiKey}`,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 300000,
      }, (res) => {
        if (res.statusCode !== 200) {
          let body = '';
          res.on('data', (d) => { body += d; });
          res.on('end', () => reject(new Error(`LLM API returned ${res.statusCode}: ${body.slice(0, 300)}`)));
          return;
        }

        let fullText = '';
        let toolCallText = '';
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const choices = parsed.choices || [];
              if (choices.length > 0) {
                const delta = choices[0].delta || {};
                if (delta.content) fullText += delta.content;
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    if (tc.function && tc.function.arguments) {
                      toolCallText += tc.function.arguments;
                    }
                  }
                }
              }
            } catch {}
          }
        });
        res.on('end', () => {
          if (!fullText && toolCallText) {
            try {
              const args = JSON.parse(toolCallText);
              fullText = args.command || args.input || args.content || args.text || toolCallText;
            } catch {
              fullText = toolCallText;
            }
          }
          resolve(fullText.trim());
        });
      });

      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }
}

module.exports = CodexAdapter;

/**
 * Antigravity CLI (agy) adapter for OpenAgents workspace.
 *
 * Successor to the Gemini CLI adapter: Google transitioned Gemini CLI into
 * Antigravity CLI in May 2026 and cut individual-account access to the old
 * CLI that June. agy is a closed-source Go binary — no npm runtime prefix and
 * no .cmd/.js shim resolution needed — driven headless via
 * `agy -p <prompt> --output-format stream-json`.
 *
 * Stream interpretation, argv building, and failure classification live in
 * ./antigravity-stream.js (pure, unit-tested); this file owns process
 * lifecycle and workspace I/O, structurally mirroring gemini.js.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');

const BaseAdapter = require('./base');
const { whereBinary } = require('../paths');
const { formatAttachmentsForPrompt, SESSION_DEFAULT_RE, generateSessionTitle } = require('./utils');
const { buildClaudeSystemPrompt } = require('./workspace-prompt');
const {
  buildAgyArgv,
  parseAgyEvent,
  AgyRunState,
  classifyAgyFailure,
  agyBinaryCandidates,
} = require('./antigravity-stream');

const IS_WINDOWS = process.platform === 'win32';

class AntigravityAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   * @param {string} [opts.workingDir]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();
    // Read-only pinned context, same as gemini: agy has no MCP bridge to the
    // workspace knowledge tools, so it can see the decision log but not write it.
    this._usesPinnedContext = true;
    this._channelConversations = {}; // channel → agy conversation_id
    this._channelProcesses = {}; // channel → child process
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_antigravity.json`
    );
    this._loadSessions();
  }

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelConversations, data);
          this._log(`Loaded ${Object.keys(data).length} conversation(s)`);
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
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelConversations));
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

  _findAgyBinary() {
    // PATH first (codepage-safe lookup, see whereBinary), then the install
    // script's fixed destinations.
    const viaWhere = whereBinary('agy');
    if (viaWhere) return viaWhere;
    const candidates = agyBinaryCandidates({
      home: os.homedir(),
      isWindows: IS_WINDOWS,
      localAppData: process.env.LOCALAPPDATA,
    });
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  /**
   * agy ignores a bare GEMINI_API_KEY unless the settings file also selects
   * the gemini provider — and, inversely, refuses to start when the provider
   * is selected but the key is missing. When the user configured a key for
   * this agent, select the provider for them; never touch the file otherwise
   * (a keyring/OAuth sign-in needs no provider entry and must not gain one,
   * or the CLI stops starting the day the key is removed).
   */
  _ensureAgyAuth() {
    if (this._agyAuthReady) return;
    this._agyAuthReady = true;
    try {
      const env = this.agentEnv || process.env;
      const apiKey = (env.GEMINI_API_KEY || '').trim();
      if (!apiKey) return; // OAuth / keyring — leave the user's setup alone.
      const dir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'settings.json');
      let settings = {};
      try { settings = JSON.parse(fs.readFileSync(file, 'utf-8')) || {}; } catch {}
      if (settings.modelProvider === 'gemini') return; // already selected.
      settings.modelProvider = 'gemini';
      fs.writeFileSync(file, JSON.stringify(settings, null, 2));
      this._log('Configured Antigravity CLI for API-key auth (~/.gemini/antigravity-cli/settings.json)');
    } catch (e) {
      this._log(`agy auth setup skipped: ${e.message}`);
    }
  }

  _buildAgyCmd(prompt, channelName, { skipResume = false } = {}) {
    this._ensureAgyAuth();
    const agyBin = this._findAgyBinary();
    if (!agyBin) {
      throw new Error(
        'agy CLI not found. Install with: curl -fsSL https://antigravity.google/cli/install.sh | bash'
      );
    }

    const pinned = this.pinnedPromptOpts(channelName);
    const systemPrompt = '\n' + buildClaudeSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName,
      mode: this._mode,
      decisionLog: pinned.decisionLog ? { ...pinned.decisionLog, writeAccess: false } : null,
      glossary: pinned.glossary ? { ...pinned.glossary, writeAccess: false } : null,
    });

    // No system-prompt flag in agy's print mode either — prepend it.
    const fullPrompt = `${systemPrompt}\n\n---\n\nUser message:\n${prompt}`;

    const env = this.agentEnv || process.env;
    const model = (env.ANTIGRAVITY_MODEL || env.AGY_MODEL || '').trim();

    const args = buildAgyArgv({
      prompt: fullPrompt,
      model,
      conversationId: this._channelConversations[channelName],
      skipResume,
    });
    return { cmd: [agyBin, ...args] };
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
        if (resumeFrom && !this._channelConversations[msgChannel]) {
          const sourceConversation = this._channelConversations[resumeFrom];
          if (sourceConversation) {
            this._channelConversations[msgChannel] = sourceConversation;
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
        const built = this._buildAgyCmd(content, msgChannel, { skipResume: attempt > 0 });
        cmd = built.cmd;
      } catch (e) {
        await this.sendError(msgChannel, e.message);
        return;
      }

      try {
        const proc = spawn(cmd[0], cmd.slice(1), {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: cleanEnv,
          cwd: this.workingDir,
          detached: !IS_WINDOWS,
          windowsHide: true,
        });
        this._channelProcesses[msgChannel] = proc;

        const run = new AgyRunState();
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
            const event = parseAgyEvent(line);
            if (!event) return;
            resetTimeout();
            for (const action of run.consume(event)) {
              if (action.type === 'conversation') {
                this._channelConversations[msgChannel] = action.id;
                this._saveSessions();
              } else if (action.type === 'thinking') {
                try { await this.sendThinking(msgChannel, action.text); } catch {}
              } else if (action.type === 'tool') {
                try { await this.sendStatus(msgChannel, `${action.name} › ${action.preview}`); } catch {}
              }
              // 'result' is read from `run` after exit.
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

            const response = run.finalResponse();
            const failed = code !== 0 || run.status === 'ERROR';

            if (response && !failed) {
              try { await this.sendResponse(msgChannel, response); } catch {}
              resolve(false);
            } else if (failed && this._channelConversations[msgChannel] && attempt === 0) {
              // A stored conversation id the CLI no longer knows fails the
              // whole run — clear it and retry once from scratch.
              this._log(`Stale conversation for ${msgChannel}, clearing and retrying without resume`);
              delete this._channelConversations[msgChannel];
              this._saveSessions();
              resolve(true);
            } else if (failed) {
              // Surface the real reason (auth, provider config, bad model)
              // instead of a generic retry prompt — the gemini adapter's
              // silent-stderr dead end is what this branch fixes.
              const { kind, message } = classifyAgyFailure({ code, stderr: stderrBuf, error: run.error });
              this._log(`run failed (${kind})`);
              try { await this.sendError(msgChannel, message); } catch {}
              resolve(false);
            } else {
              if (!run.sawText()) {
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

module.exports = AntigravityAdapter;

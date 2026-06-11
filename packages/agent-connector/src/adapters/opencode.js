/**
 * OpenCode adapter for OpenAgents workspace.
 *
 * Bridges OpenCode (opencode-ai) to an OpenAgents workspace by running
 * `opencode run --format json` as a subprocess. OpenCode handles its own
 * model configuration, provider selection, and tool chain.
 *
 * Port of Python PR #316: sdk/src/openagents/adapters/opencode.py
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt } = require('./utils');
const { buildOpenCodeSkillMd, buildOpenCodeSystemPrompt } = require('./workspace-prompt');
const { whichBinary, getEnhancedEnv } = require('../paths');

const IS_WINDOWS = process.platform === 'win32';

// Max wall-clock for a single `opencode run`. When it fires, Node kills the
// child with SIGTERM, the 'close' handler sees signal='SIGTERM' / code=null.
const TIMEOUT_MS = 300000; // 5 minutes

class OpenCodeAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   * @param {string} [opts.workingDir]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();

    // Agent home directory: ~/.openagents/agents/{agentName}/
    this.agentHome = path.join(os.homedir(), '.openagents', 'agents', this.agentName);
    fs.mkdirSync(this.agentHome, { recursive: true });

    this._channelSessions = {};
    this._sessionsFile = path.join(this.agentHome, 'sessions.json');
    this._migrateSessionsFile();
    this._loadSessions();

    // Process tracking for stop control
    this._channelProcesses = {}; // channel → child process
    this._stoppingChannels = new Set();

    this._opencodeBinary = this._findOpencodeBinary();
    if (this._opencodeBinary) {
      this._log(`Using OpenCode subprocess mode: ${this._opencodeBinary}`);
    } else {
      this._log('OpenCode binary not found. Install with: npm install -g opencode-ai@latest');
    }
  }

  /**
   * Migrate sessions file from old location to agent home.
   */
  _migrateSessionsFile() {
    const oldPath = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_opencode.json`
    );
    try {
      if (fs.existsSync(oldPath) && !fs.existsSync(this._sessionsFile)) {
        fs.copyFileSync(oldPath, this._sessionsFile);
        fs.unlinkSync(oldPath);
        this._log(`Migrated sessions file from ${oldPath}`);
      }
    } catch {}
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
      fs.mkdirSync(path.dirname(this._sessionsFile), { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions));
    } catch {}
  }

  async _onControlAction(action, payload) {
    if (action === 'stop') {
      const channel = (payload && typeof payload === 'object') ? payload.channel : null;
      if (channel) {
        const proc = this._channelProcesses[channel];
        const hadQueuedWork = !!this._channelQueues[channel]?.length;
        if (proc) {
          this._log(`Stopping process for channel=${channel}`);
          this._stoppingChannels.add(channel);
          await this._stopProcess(proc);
          delete this._channelProcesses[channel];
        }
        delete this._channelQueues[channel];
        if (proc || hadQueuedWork) {
          try {
            await this.sendResponse(channel, 'Execution stopped by user.');
          } catch {}
        }
      } else {
        await this._stopAllProcesses('Execution stopped by user.');
      }
      return;
    }
    await super._onControlAction(action, payload);
  }

  /**
   * Write workspace skill to OpenCode's skill directory for auto-discovery.
   */
  _ensureWorkspaceSkill(channelName) {
    const skillDir = path.join(this.agentHome, '.opencode', 'skills');
    const skillFile = path.join(skillDir, 'openagents-workspace.md');
    try {
      const content = buildOpenCodeSkillMd({
        endpoint: this.endpoint,
        workspaceId: this.workspaceId,
        token: this.token,
        agentName: this.agentName,
        channelName,
        disabledModules: this.disabledModules,
      });
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(skillFile, content, 'utf-8');
    } catch {}
  }

  _buildSystemContext(channelName) {
    return buildOpenCodeSystemPrompt({
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
  // Binary discovery
  // ------------------------------------------------------------------

  _findOpencodeBinary() {
    const home = os.homedir();
    const ext = IS_WINDOWS ? '.cmd' : '';

    // Tier 0: the actual native binary the opencode-ai package ships, NOT the
    // npm `.cmd`/`.bin` shim. opencode-ai's `bin` is a single self-contained
    // executable named `opencode.exe` on every platform (on macOS/Linux it's
    // the native Mach-O/ELF binary — the .exe suffix is just how the package
    // names it). Returning it directly lets us spawn it without going through
    // `cmd.exe /C opencode.cmd`, which on Windows is what flashed a console
    // window — and an attached console makes opencode drop into its interactive
    // TUI instead of non-interactive `run`, so it hung waiting for keypresses.
    const nativeExe = path.join(home, '.openagents', 'runtimes', 'opencode', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
    if (fs.existsSync(nativeExe)) return nativeExe;

    // Tier 0b: Isolated runtime prefix shim — where the launcher installs agents
    // (~/.openagents/runtimes/opencode/node_modules/.bin). Every other adapter
    // checks this first; opencode was the lone exception, so a launcher-managed
    // install was invisible unless its .bin happened to be on PATH — which is
    // exactly why the workspace failed with "opencode CLI not found" even though
    // the marketplace showed it installed.
    const runtimeBin = path.join(home, '.openagents', 'runtimes', 'opencode', 'node_modules', '.bin', `opencode${ext}`);
    if (fs.existsSync(runtimeBin)) return runtimeBin;

    // Tier 0b: Legacy shared portable prefix.
    const legacyBin = path.join(home, '.openagents', 'nodejs', 'node_modules', '.bin', `opencode${ext}`);
    if (fs.existsSync(legacyBin)) return legacyBin;

    // Tier 1: PATH. Use the ENRICHED env (node-version-manager/homebrew/npm
    // dirs the launcher adds) so the lookup matches a packaged daemon's real
    // reach; windowsHide stops a console window from flashing on Windows.
    try {
      const env = getEnhancedEnv();
      if (IS_WINDOWS) {
        const r = execSync('where opencode.exe 2>nul || where opencode.cmd 2>nul || where opencode 2>nul', {
          encoding: 'utf-8', timeout: 5000, windowsHide: true, env,
        });
        const hit = r.split(/\r?\n/)[0].trim();
        if (hit) return hit;
      } else {
        const hit = execSync('which opencode', { encoding: 'utf-8', timeout: 5000, windowsHide: true, env }).trim();
        if (hit) return hit;
      }
    } catch {}

    // Tier 2: Next to Node.js
    const nearNode = path.join(path.dirname(process.execPath), `opencode${ext}`);
    if (fs.existsSync(nearNode)) return nearNode;

    // Tier 3: Common locations
    const candidates = IS_WINDOWS ? [
      path.join(process.env.APPDATA || '', 'npm', 'opencode.cmd'),
    ] : [
      path.join(home, '.openagents', 'npm-global', 'bin', 'opencode'),
      path.join(home, '.npm-global', 'bin', 'opencode'),
      path.join(home, '.local', 'bin', 'opencode'),
      '/usr/local/bin/opencode',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    // Tier 4: Deep scan of every known bin dir (nvm/fnm/volta node-global,
    // homebrew, …) — catches an `opencode` installed as a global npm package
    // under a version-managed Node, which the fixed-PATH tiers above miss.
    const viaWhich = whichBinary('opencode');
    if (viaWhich) return viaWhich;

    return null;
  }

  // ------------------------------------------------------------------
  // Message handler
  // ------------------------------------------------------------------

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

    await this._autoTitleChannel(msgChannel, content);
    await this.sendStatus(msgChannel, 'thinking...');

    try {
      const responseText = await this._runOpencode(content, msgChannel);

      if (this._stoppingChannels.has(msgChannel)) {
        this._stoppingChannels.delete(msgChannel);
        return;
      }

      if (responseText) {
        await this.sendResponse(msgChannel, responseText);
      } else {
        // Exit 0 with no assistant text almost always means OpenCode has no
        // model/provider configured (it emits only step_start then stops).
        await this.sendResponse(
          msgChannel,
          'OpenCode ran but produced no response. This usually means no model/provider is configured — set one up (e.g. `opencode auth login` or configure a provider/API key) and try again.'
        );
      }
    } catch (e) {
      if (this._stoppingChannels.has(msgChannel)) {
        this._stoppingChannels.delete(msgChannel);
        return;
      }
      this._log(`Error handling message: ${e.message}`);
      await this.sendError(msgChannel, `Error processing message: ${e.message}`);
    }
  }

  // ------------------------------------------------------------------
  // JSON output parsing
  // ------------------------------------------------------------------

  /**
   * Split a string containing concatenated JSON objects.
   */
  static _splitJsonObjects(raw) {
    const objects = [];
    raw = raw.trim();
    let pos = 0;
    while (pos < raw.length) {
      if (' \t\r\n'.includes(raw[pos])) { pos++; continue; }
      if (raw[pos] !== '{') { pos++; continue; }
      // Find matching brace
      let depth = 0;
      let inStr = false;
      let escaped = false;
      let start = pos;
      for (let i = pos; i < raw.length; i++) {
        const ch = raw[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\' && inStr) { escaped = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              const obj = JSON.parse(raw.slice(start, i + 1));
              if (typeof obj === 'object' && obj !== null) objects.push(obj);
            } catch {}
            pos = i + 1;
            break;
          }
        }
        if (i === raw.length - 1) pos = raw.length; // no match, skip
      }
      if (depth !== 0) break; // unbalanced, stop
    }
    return objects;
  }

  /**
   * Extract user-visible text from a single opencode JSON event.
   */
  static _extractTextFromEvent(event) {
    const eventType = event.type || '';
    if (['step_start', 'step_finish', 'tool_use'].includes(eventType)) return null;

    const part = event.part;
    if (part && typeof part === 'object') {
      const text = part.text || part.content || '';
      if (text) return text;
    }

    const item = event.item || event;
    const text = item.text || item.content || '';
    return text || null;
  }

  /**
   * Extract human-readable text from opencode --format json output.
   */
  static _extractTextFromJson(raw) {
    const events = OpenCodeAdapter._splitJsonObjects(raw);
    if (!events.length) return raw.trim();

    const texts = [];
    for (const event of events) {
      const text = OpenCodeAdapter._extractTextFromEvent(event);
      if (text) texts.push(text);
    }
    return texts.length ? texts.join('\n').trim() : raw.trim();
  }

  /**
   * True when `raw` is opencode JSON that carries ONLY control events
   * (step_start / step_finish / tool_use) and no assistant text — which is what
   * opencode emits when no model/provider is configured. In that case
   * _extractTextFromJson falls back to returning the raw event JSON, which we
   * must NOT post to the channel as if it were a reply. Non-JSON output (real
   * plain text) returns false so it is kept.
   */
  static _isOnlyControlJson(raw) {
    const events = OpenCodeAdapter._splitJsonObjects(raw);
    if (!events.length) return false;
    for (const ev of events) {
      if (OpenCodeAdapter._extractTextFromEvent(ev)) return false;
    }
    return true;
  }

  /**
   * Extract and persist session_id from OpenCode JSON events.
   */
  _persistSessionId(channel, rawOutput) {
    const events = OpenCodeAdapter._splitJsonObjects(rawOutput);
    let sessionId = null;
    for (const event of events) {
      let sid = event.sessionID;
      if (!sid && event.session && typeof event.session === 'object') {
        sid = event.session.id;
      }
      if (!sid && event.part && typeof event.part === 'object') {
        sid = event.part.sessionID;
      }
      if (sid && typeof sid === 'string') sessionId = sid;
    }

    if (sessionId) {
      const prev = this._channelSessions[channel];
      this._channelSessions[channel] = sessionId;
      this._saveSessions();
      if (prev !== sessionId) {
        this._log(`OpenCode session for channel ${channel}: ${sessionId}`);
      }
    }
  }

  /**
   * Override BaseAdapter.stop so daemon shutdown also tears down in-flight
   * opencode subprocesses cleanly.
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

  async _stopAllProcesses(completionMessage = 'Execution stopped.') {
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

  // ------------------------------------------------------------------
  // Subprocess execution
  // ------------------------------------------------------------------

  /**
   * Build the `--model` value (provider/model) for `opencode run`.
   *
   * CRITICAL: opencode-ai does NOT read the OPENCODE_MODEL env var. When no
   * model is given on the command line AND none is set in opencode.json, the
   * non-interactive `run` command hangs forever waiting for interactive
   * provider/model selection — it emits zero output until the spawn timeout
   * kills it with SIGTERM (surfaced as the misleading "exited with code null").
   * Passing `--model` explicitly is what makes headless runs actually work.
   */
  _resolveModel() {
    const env = this.agentEnv || process.env;
    const model = (env.OPENCODE_MODEL || env.LLM_MODEL || '').trim();
    if (!model) return '';
    // Already provider-qualified (e.g. "openai/gpt-4o", "anthropic/claude-…").
    if (model.includes('/')) return model;
    // Infer the provider from which key/base URL the env resolved to. The
    // registry maps LLM_* → OPENAI_* for OpenAI-compatible endpoints, so
    // "openai" is the right default; only switch for an Anthropic endpoint.
    const baseUrl = (env.OPENAI_BASE_URL || env.LLM_BASE_URL || '').toLowerCase();
    const provider = (env.ANTHROPIC_API_KEY || baseUrl.includes('anthropic'))
      ? 'anthropic'
      : 'openai';
    return `${provider}/${model}`;
  }

  _runOpencode(content, msgChannel) {
    const binary = this._opencodeBinary || this._findOpencodeBinary();
    if (binary) this._opencodeBinary = binary;
    if (!binary) {
      return Promise.reject(new Error(
        'opencode CLI not found. Install with: npm install -g opencode-ai@latest'
      ));
    }

    const cmd = [binary, 'run', '--format', 'json', '--dir', this.agentHome];

    // Pin the model explicitly — without it opencode hangs waiting for
    // interactive selection (see _resolveModel). Harmless when resuming a
    // session (opencode keeps the session's model); essential for new ones.
    const model = this._resolveModel();
    if (model) {
      cmd.push('--model', model);
    } else {
      this._log(
        'WARNING: no model configured (set LLM_MODEL / OPENCODE_MODEL). ' +
        'opencode may hang or produce no response.'
      );
    }

    const sessionId = this._channelSessions[msgChannel];
    let fullPrompt;
    if (sessionId) {
      fullPrompt = content;
      cmd.push('--session', sessionId);
    } else {
      this._ensureWorkspaceSkill(msgChannel);
      const context = this._buildSystemContext(msgChannel);
      fullPrompt = `${context}\n\n---\n\n${content}`;
    }

    this._log(`CLI: ${binary} run --format json --dir … --model ${model || '(none)'}`);

    const spawnEnv = { ...(this.agentEnv || process.env) };

    let spawnBinary = cmd[0];
    let spawnArgs = cmd.slice(1);
    // Only the npm `.cmd` shim needs a cmd.exe host. The native opencode.exe
    // (preferred by _findOpencodeBinary) is spawned directly — no console host.
    if (IS_WINDOWS && spawnBinary.toLowerCase().endsWith('.cmd')) {
      spawnArgs = ['/C', spawnBinary, ...spawnArgs];
      spawnBinary = process.env.COMSPEC || 'cmd.exe';
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(spawnBinary, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: spawnEnv,
        cwd: this.agentHome,
        timeout: TIMEOUT_MS,
        detached: !IS_WINDOWS,
        // Never let a console window appear. Besides being ugly, an attached
        // console makes opencode start its interactive TUI and hang instead of
        // running headless — the root cause of "stuck on thinking…" on Windows.
        windowsHide: true,
      });

      this._channelProcesses[msgChannel] = proc;

      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        if (this._channelProcesses[msgChannel] === proc) {
          delete this._channelProcesses[msgChannel];
        }
        fn(arg);
      };

      if (proc.stdout) proc.stdout.on('data', (d) => { stdout += d; });
      if (proc.stderr) proc.stderr.on('data', (d) => { stderr += d; });

      // Send the prompt via stdin, then close it so opencode knows the message
      // is complete and never blocks waiting for more input. Guard the write:
      // if the child already died, writing to its stdin throws EPIPE.
      if (proc.stdin) {
        proc.stdin.on('error', () => {});
        try {
          proc.stdin.write(fullPrompt, 'utf-8');
          proc.stdin.end();
        } catch { /* child gone — the exit/error handler reports it */ }
      }

      proc.on('error', (err) => finish(reject, err));
      // 'close' (not 'exit') fires after stdout/stderr have fully drained, so we
      // never parse a truncated response. The handler receives (code, signal):
      // when the spawn timeout kills the child, code is null and signal is the
      // signal name — report that as a timeout rather than "exited with code null".
      proc.on('close', (code, signal) => {
        if (this._stoppingChannels.has(msgChannel)) {
          this._stoppingChannels.delete(msgChannel);
          return finish(resolve, '');
        }

        stdout = stdout.trim();
        stderr = stderr.trim();

        if (signal) {
          this._log(`opencode killed by signal ${signal} after ${TIMEOUT_MS / 1000}s (no output: ${!stdout})`);
          return finish(reject, new Error(
            stderr ? stderr.slice(0, 500)
              : `opencode timed out after ${TIMEOUT_MS / 1000}s with no response. ` +
                'This usually means no model/provider is configured — check LLM_MODEL / LLM_API_KEY.'
          ));
        }

        if (code !== 0) {
          this._log(`opencode exited with code ${code}: ${stderr.slice(0, 300)}`);
          // Surface the real failure instead of a generic "No response" so the
          // user can see (e.g.) a missing model/provider or auth error.
          return finish(reject, new Error(
            stderr ? stderr.slice(0, 500) : `opencode exited with code ${code}`
          ));
        }

        if (stdout) {
          this._persistSessionId(msgChannel, stdout);
          const text = OpenCodeAdapter._extractTextFromJson(stdout);
          // Exit 0 but no assistant text usually means no model/provider is
          // configured (opencode emits only step_start then stops). Tell the
          // user how to fix it rather than echoing raw event JSON.
          if (!text || OpenCodeAdapter._isOnlyControlJson(stdout)) {
            this._log(`opencode produced no assistant text. stdout head: ${stdout.slice(0, 300)}`);
            return finish(resolve, '');
          }
          return finish(resolve, text);
        }

        if (stderr) this._log(`opencode stderr: ${stderr.slice(0, 300)}`);
        finish(resolve, '');
      });
    });
  }
}

module.exports = OpenCodeAdapter;

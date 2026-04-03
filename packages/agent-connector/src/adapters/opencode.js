/**
 * OpenCode adapter for OpenAgents workspace.
 *
 * Bridges OpenCode (opencode-ai) to an OpenAgents workspace by running
 * `opencode run --format json` as a subprocess. OpenCode handles its own
 * model configuration, provider selection, and tool chain.
 *
 * Port of Python PR #316: src/openagents/adapters/opencode.py
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt } = require('./utils');
const { buildOpenCodeSkillMd, buildOpenCodeSystemPrompt } = require('./workspace-prompt');

const IS_WINDOWS = process.platform === 'win32';

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
    // Tier 1: PATH
    try {
      if (IS_WINDOWS) {
        const r = execSync('where opencode.cmd 2>nul || where opencode.exe 2>nul || where opencode 2>nul', {
          encoding: 'utf-8', timeout: 5000,
        });
        return r.split(/\r?\n/)[0].trim();
      } else {
        return execSync('which opencode', { encoding: 'utf-8', timeout: 5000 }).trim();
      }
    } catch {}

    // Tier 2: Next to Node.js
    const ext = IS_WINDOWS ? '.cmd' : '';
    const nearNode = path.join(path.dirname(process.execPath), `opencode${ext}`);
    if (fs.existsSync(nearNode)) return nearNode;

    // Tier 3: Common locations
    const home = os.homedir();
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

      if (responseText) {
        await this.sendResponse(msgChannel, responseText);
      } else {
        await this.sendResponse(msgChannel, 'No response generated. Please try again.');
      }
    } catch (e) {
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
      let escape = false;
      let start = pos;
      for (let i = pos; i < raw.length; i++) {
        const ch = raw[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inStr) { escape = true; continue; }
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

  // ------------------------------------------------------------------
  // Subprocess execution
  // ------------------------------------------------------------------

  _runOpencode(content, msgChannel) {
    const binary = this._opencodeBinary || this._findOpencodeBinary();
    if (binary) this._opencodeBinary = binary;
    if (!binary) {
      return Promise.reject(new Error(
        'opencode CLI not found. Install with: npm install -g opencode-ai@latest'
      ));
    }

    const cmd = [binary, 'run', '--format', 'json', '--dir', this.agentHome];

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

    this._log(`CLI: ${binary} ${cmd.slice(1, 5).join(' ')} ...`);

    const spawnEnv = { ...(this.agentEnv || process.env) };

    let spawnBinary = cmd[0];
    let spawnArgs = cmd.slice(1);
    if (IS_WINDOWS && spawnBinary.toLowerCase().endsWith('.cmd')) {
      spawnArgs = ['/C', spawnBinary, ...spawnArgs];
      spawnBinary = process.env.COMSPEC || 'cmd.exe';
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(spawnBinary, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: spawnEnv,
        cwd: this.agentHome,
        timeout: 300000, // 5 minutes
      });

      let stdout = '';
      let stderr = '';

      if (proc.stdout) proc.stdout.on('data', (d) => { stdout += d; });
      if (proc.stderr) proc.stderr.on('data', (d) => { stderr += d; });

      // Send the prompt via stdin
      if (proc.stdin) {
        proc.stdin.write(fullPrompt, 'utf-8');
        proc.stdin.end();
      }

      proc.on('error', (err) => reject(err));
      proc.on('exit', (code) => {
        stdout = stdout.trim();
        stderr = stderr.trim();

        if (code !== 0) {
          this._log(`opencode exited with code ${code}: ${stderr.slice(0, 300)}`);
        }

        if (stdout) {
          this._persistSessionId(msgChannel, stdout);
          resolve(OpenCodeAdapter._extractTextFromJson(stdout));
        } else {
          if (stderr) {
            this._log(`opencode stderr: ${stderr.slice(0, 300)}`);
          }
          resolve('');
        }
      });
    });
  }
}

module.exports = OpenCodeAdapter;

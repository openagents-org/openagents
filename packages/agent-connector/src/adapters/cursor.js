/**
 * Cursor CLI adapter for OpenAgents workspace.
 *
 * Bridges the official `cursor-agent` CLI to an OpenAgents workspace via:
 * - Polling loop for incoming messages
 * - Cursor CLI subprocess execution with JSON output
 * - OpenAgents MCP server exposed through Cursor's runtime mcp.json
 * - Per-channel session resume for conversation continuity
 */

'use strict';

const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BaseAdapter = require('./base');
const {
  buildWorkspaceMcpServer,
  ensureRuntimeEnvHome,
  findExecutable,
  firstText,
  formatAttachmentsForPrompt,
  writeJsonFile,
} = require('./utils');
const { buildOpenclawSystemPrompt } = require('./workspace-prompt');

const IS_WINDOWS = process.platform === 'win32';

class CursorAdapter extends BaseAdapter {
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();

    const env = this.agentEnv || process.env;
    this._cursorBinary = findExecutable('cursor-agent', 'cursor');
    this._cursorModel = (env.CURSOR_MODEL || '').trim();
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_cursor.json`
    );
    this._runtimeRoot = path.join(
      os.homedir(), '.openagents', 'runtime', 'cursor',
      `${this.workspaceId}_${this.agentName}`
    );
    this._channelSessions = {};
    this._loadSessions();
  }

  _loadSessions() {
    try {
      if (!require('fs').existsSync(this._sessionsFile)) return;
      const data = JSON.parse(require('fs').readFileSync(this._sessionsFile, 'utf-8'));
      if (!data || typeof data !== 'object') return;
      for (const [channel, sessionId] of Object.entries(data)) {
        if (sessionId) this._channelSessions[String(channel)] = String(sessionId);
      }
    } catch {
      this._log('Could not load Cursor session state');
    }
  }

  _saveSessions() {
    try {
      writeJsonFile(this._sessionsFile, this._channelSessions);
    } catch {
      this._log('Could not save Cursor session state');
    }
  }

  _buildSystemPrompt(channelName) {
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

  _cursorEnv(channelName) {
    const runtimeHome = path.join(this._runtimeRoot, 'home');
    const useSystemHome = process.platform === 'darwin';
    const env = useSystemHome
      ? { ...(this.agentEnv || process.env) }
      : ensureRuntimeEnvHome(this.agentEnv || process.env, runtimeHome);
    env.CURSOR_API_KEY = (this.agentEnv && this.agentEnv.CURSOR_API_KEY)
      || process.env.CURSOR_API_KEY
      || '';

    const mcpConfig = {
      mcpServers: buildWorkspaceMcpServer(
        this.workspaceId,
        channelName,
        this.agentName,
        this.endpoint,
        this.token,
        {
          disableFiles: this.disabledModules.has('files'),
          disableBrowser: this.disabledModules.has('browser'),
        }
      ),
    };
    const cursorHome = useSystemHome
      ? (env.HOME || os.homedir())
      : runtimeHome;
    writeJsonFile(path.join(cursorHome, '.cursor', 'mcp.json'), mcpConfig);
    return env;
  }

  _extractToolName(event) {
    for (const key of ['tool_name', 'toolName', 'name']) {
      if (typeof event[key] === 'string' && event[key]) return event[key];
    }
    for (const containerKey of ['tool_call', 'tool', 'call']) {
      const container = event[containerKey];
      if (!container || typeof container !== 'object') continue;
      for (const key of ['name', 'tool', 'toolName']) {
        if (typeof container[key] === 'string' && container[key]) return container[key];
      }
    }
    return '';
  }

  _extractSessionId(event) {
    for (const key of ['session_id', 'sessionId', 'conversation_id', 'conversationId']) {
      const value = event[key];
      if (typeof value === 'string' && value) return value;
    }
    const result = event.result;
    if (result && typeof result === 'object') {
      for (const key of ['session_id', 'sessionId', 'conversation_id', 'conversationId']) {
        const value = result[key];
        if (typeof value === 'string' && value) return value;
      }
    }
    return '';
  }

  _extractResultText(event) {
    for (const candidate of [
      event.result,
      event.message,
      event.content,
      event.text,
      event.output,
      event.assistant_message,
    ]) {
      const text = firstText(candidate).trim();
      if (text) return text;
    }
    return '';
  }

  _buildCursorCmd(prompt, channelName) {
    if (!this._cursorBinary) {
      throw new Error(
        "cursor-agent CLI not found. Install Cursor CLI and ensure 'cursor-agent' is on PATH."
      );
    }

    const fullPrompt = `${this._buildSystemPrompt(channelName)}\n\n---\n\n${prompt}`;
    const cmd = [
      this._cursorBinary,
      '-p',
      fullPrompt,
      '--print',
      '--output-format',
      'stream-json',
      '--trust',
    ];
    if (this._mode !== 'plan') cmd.push('--force');
    if (this._cursorModel) cmd.push('--model', this._cursorModel);
    if (this.workingDir) cmd.push('--workspace', this.workingDir);

    const sessionId = this._channelSessions[channelName];
    if (sessionId) cmd.push('--resume', sessionId);
    return cmd;
  }

  _runCursor(prompt, channelName) {
    const env = this._cursorEnv(channelName);
    const cmd = this._buildCursorCmd(prompt, channelName);

    let spawnBinary = cmd[0];
    let spawnArgs = cmd.slice(1);
    if (IS_WINDOWS && spawnBinary.toLowerCase().endsWith('.cmd')) {
      spawnArgs = ['/C', spawnBinary, ...spawnArgs];
      spawnBinary = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(spawnBinary, spawnArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        cwd: this.workingDir,
        timeout: 300000,
      });

      let lineBuffer = '';
      let stderrText = '';
      const finalChunks = [];
      let lastText = '';

      const processLine = (rawLine) => {
        const raw = rawLine.trim();
        if (!raw) return;

        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          return;
        }

        const sessionId = this._extractSessionId(event);
        if (sessionId) {
          this._channelSessions[channelName] = sessionId;
          this._saveSessions();
        }

        const eventType = event.type || '';
        if (eventType === 'tool_call_started') {
          const toolName = this._extractToolName(event) || 'tool';
          void this.sendStatus(channelName, `Using tool: \`${toolName}\``);
          return;
        }
        if (eventType === 'tool_call_completed' || eventType === 'tool_call_finished') {
          return;
        }

        const text = this._extractResultText(event);
        if (!text || text === lastText) return;
        lastText = text;

        if (eventType === 'result') {
          finalChunks.length = 0;
          finalChunks.push(text);
        } else {
          finalChunks.push(text);
        }
      };

      if (proc.stdout) {
        proc.stdout.on('data', (chunk) => {
          lineBuffer += chunk.toString('utf-8');
          const lines = lineBuffer.split(/\r?\n/);
          lineBuffer = lines.pop() || '';
          for (const line of lines) processLine(line);
        });
      }

      if (proc.stderr) {
        proc.stderr.on('data', (chunk) => {
          stderrText += chunk.toString('utf-8');
        });
      }

      proc.on('error', reject);
      proc.on('close', (code) => {
        if (lineBuffer.trim()) processLine(lineBuffer);
        const stderr = stderrText.trim();
        if (code !== 0) {
          reject(new Error(stderr || 'cursor-agent exited with an error'));
          return;
        }

        const response = finalChunks.filter(Boolean).join('\n').trim() || stderr;
        resolve(response);
      });
    });
  }

  async _handleMessage(msg) {
    let content = (msg.content || '').trim();
    const attachments = msg.attachments || [];
    const attText = formatAttachmentsForPrompt(attachments);
    if (attText) content = content ? content + attText : attText.trim();
    if (!content) return;

    const env = this.agentEnv || process.env;
    const msgChannel = msg.sessionId || this.channelName;
    if (!env.CURSOR_API_KEY) {
      await this.sendError(
        msgChannel,
        'Cursor is not configured. Set CURSOR_API_KEY and restart the agent.'
      );
      return;
    }

    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing Cursor message from ${sender} in channel ${msgChannel}: ${content.slice(0, 80)}...`);
    await this._autoTitleChannel(msgChannel, content);
    await this.sendStatus(msgChannel, 'thinking...');

    try {
      const response = await this._runCursor(content, msgChannel);
      await this.sendResponse(msgChannel, response || 'No response generated. Please try again.');
    } catch (e) {
      await this.sendError(msgChannel, (e.message || String(e)).slice(0, 1200));
    }
  }
}

module.exports = CursorAdapter;

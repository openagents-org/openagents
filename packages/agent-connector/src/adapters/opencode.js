/**
 * OpenCode CLI adapter for OpenAgents workspace.
 *
 * Bridges the official `opencode` CLI to an OpenAgents workspace via:
 * - Polling loop for incoming messages
 * - `opencode run --format json` subprocess execution
 * - Runtime-injected OpenCode config for model/provider/MCP settings
 * - Per-channel session resume for conversation continuity
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');

const BaseAdapter = require('./base');
const {
  ensureRuntimeEnvHome,
  findExecutable,
  firstText,
  formatAttachmentsForPrompt,
  getCliInvocation,
} = require('./utils');
const { buildOpenCodeSystemPrompt } = require('./workspace-prompt');

const IS_WINDOWS = process.platform === 'win32';

class OpenCodeAdapter extends BaseAdapter {
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();
    this._opencodeBinary = findExecutable('opencode') || this._findOpencodeBinary();
    this._runtimeRoot = path.join(
      os.homedir(), '.openagents', 'runtime', 'opencode',
      `${this.workspaceId}_${this.agentName}`
    );
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_opencode.json`
    );
    this._channelSessions = {};
    this._migrateSessionsFile();
    this._loadSessions();

    if (this._opencodeBinary) {
      this._log(`Using OpenCode subprocess mode: ${this._opencodeBinary}`);
    } else {
      this._log('OpenCode binary not found. Install with: npm install -g opencode-ai@latest');
    }
  }

  _migrateSessionsFile() {
    const oldPath = path.join(
      os.homedir(), '.openagents', 'agents', this.agentName, 'sessions.json'
    );
    try {
      if (fs.existsSync(oldPath) && !fs.existsSync(this._sessionsFile)) {
        fs.mkdirSync(path.dirname(this._sessionsFile), { recursive: true });
        fs.copyFileSync(oldPath, this._sessionsFile);
        this._log(`Migrated sessions file from ${oldPath}`);
      }
    } catch {}
  }

  _loadSessions() {
    try {
      if (!fs.existsSync(this._sessionsFile)) return;
      const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
      if (!data || typeof data !== 'object') return;
      for (const [channel, sessionId] of Object.entries(data)) {
        if (sessionId) this._channelSessions[String(channel)] = String(sessionId);
      }
    } catch {
      this._log('Could not load OpenCode session state');
    }
  }

  _saveSessions() {
    try {
      fs.mkdirSync(path.dirname(this._sessionsFile), { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions, null, 2));
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

  _resolveProviderConfig() {
    const env = this.agentEnv || process.env;
    let modelName = (
      env.OPENCODE_MODEL ||
      env.LLM_MODEL ||
      env.OPENCLAW_MODEL ||
      ''
    ).trim();
    const llmBaseUrl = (env.LLM_BASE_URL || env.OPENAI_BASE_URL || '').trim();
    const llmApiKey = (env.LLM_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || '').trim();

    if (llmBaseUrl) {
      modelName = modelName || 'gpt-5.4';
      const providerId = 'openagents-openai-compatible';
      return {
        modelRef: `${providerId}/${modelName}`,
        provider: {
          [providerId]: {
            npm: '@ai-sdk/openai-compatible',
            name: 'OpenAgents OpenAI-compatible',
            options: {
              baseURL: llmBaseUrl,
              apiKey: llmApiKey,
            },
            models: {
              [modelName]: {
                name: modelName,
              },
            },
          },
        },
      };
    }

    if (env.ANTHROPIC_API_KEY && (modelName.startsWith('claude') || !modelName)) {
      modelName = modelName || 'claude-sonnet-4-5';
      return {
        modelRef: `anthropic/${modelName}`,
        provider: {
          anthropic: {
            options: {
              apiKey: env.ANTHROPIC_API_KEY,
            },
          },
        },
      };
    }

    modelName = modelName || 'gpt-5.4';
    return {
      modelRef: `openai/${modelName}`,
      provider: {
        openai: {
          options: {
            apiKey: env.OPENAI_API_KEY || llmApiKey,
          },
        },
      },
    };
  }

  _runtimeEnv(channelName) {
    const { modelRef, provider } = this._resolveProviderConfig();
    fs.mkdirSync(this._runtimeRoot, { recursive: true });

    const cli = getCliInvocation();
    const command = [
      cli.command,
      ...cli.args,
      'mcp-server',
      '--workspace-id',
      this.workspaceId,
      '--channel-name',
      channelName,
      '--agent-name',
      this.agentName,
      '--endpoint',
      this.endpoint,
    ];
    if (this.disabledModules.has('files')) command.push('--disable-files');
    if (this.disabledModules.has('browser')) command.push('--disable-browser');

    const config = {
      $schema: 'https://opencode.ai/config.json',
      model: modelRef,
      provider,
      permission: this._mode !== 'plan'
        ? { '*': 'allow' }
        : { '*': 'allow', edit: 'deny', bash: 'deny', task: 'deny' },
      mcp: {
        'openagents-workspace': {
          type: 'local',
          command,
          enabled: true,
          environment: {
            OA_WORKSPACE_TOKEN: this.token,
          },
        },
      },
    };

    const env = ensureRuntimeEnvHome(this.agentEnv || process.env, path.join(this._runtimeRoot, 'home'));
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
    env.XDG_CONFIG_HOME = path.join(this._runtimeRoot, 'config');
    env.XDG_DATA_HOME = path.join(this._runtimeRoot, 'data');
    env.XDG_STATE_HOME = path.join(this._runtimeRoot, 'state');
    return { env, modelRef };
  }

  _findOpencodeBinary() {
    try {
      if (IS_WINDOWS) {
        const result = execSync('where opencode.cmd 2>nul || where opencode.exe 2>nul || where opencode 2>nul', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        return result.split(/\r?\n/)[0].trim();
      }
      return execSync('which opencode', { encoding: 'utf-8', timeout: 5000 }).trim();
    } catch {}

    const ext = IS_WINDOWS ? '.cmd' : '';
    const nearNode = path.join(path.dirname(process.execPath), `opencode${ext}`);
    if (fs.existsSync(nearNode)) return nearNode;

    const home = os.homedir();
    const candidates = IS_WINDOWS
      ? [path.join(process.env.APPDATA || '', 'npm', 'opencode.cmd')]
      : [
          path.join(home, '.openagents', 'npm-global', 'bin', 'opencode'),
          path.join(home, '.npm-global', 'bin', 'opencode'),
          path.join(home, '.local', 'bin', 'opencode'),
          '/usr/local/bin/opencode',
        ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  _extractSessionId(event) {
    const properties = event.properties;
    if (properties && typeof properties === 'object') {
      if (typeof properties.sessionID === 'string' && properties.sessionID) {
        return properties.sessionID;
      }
      const info = properties.info;
      if (info && typeof info === 'object' && typeof info.id === 'string' && info.id) {
        return info.id;
      }
    }
    return '';
  }

  _toolStatusText(part) {
    const toolName = part.tool || 'tool';
    const state = part.state || {};
    const status = state.status;
    const title = firstText(state.title || state.metadata || '').trim();
    if (status === 'running') return title || `Using tool: \`${toolName}\``;
    if (status === 'completed') return title || `Completed tool: \`${toolName}\``;
    if (status === 'error') {
      const error = firstText(state.error).trim();
      return error || `Tool failed: \`${toolName}\``;
    }
    return `Using tool: \`${toolName}\``;
  }

  _buildOpencodeCmd(prompt, channelName, modelRef) {
    if (!this._opencodeBinary) {
      throw new Error(
        "opencode CLI not found. Install it with 'openagents install opencode' or ensure 'opencode' is on PATH."
      );
    }

    const cmd = [
      this._opencodeBinary,
      'run',
      '--format',
      'json',
      '--model',
      modelRef,
    ];
    const sessionId = this._channelSessions[channelName];
    if (sessionId) cmd.push('--session', sessionId);
    cmd.push(`${this._buildSystemContext(channelName)}\n\n---\n\n${prompt}`);
    return cmd;
  }

  _runOpencode(prompt, channelName) {
    const { env, modelRef } = this._runtimeEnv(channelName);
    const cmd = this._buildOpencodeCmd(prompt, channelName, modelRef);

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
      let stderr = '';
      const assistantMessageIds = new Set();
      const assistantParts = {};
      let lastStatus = '';

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
        const properties = event.properties || {};

        if (eventType === 'message.updated') {
          const info = properties.info || {};
          if (info.role === 'assistant' && info.id) assistantMessageIds.add(info.id);
          return;
        }

        if (eventType === 'message.part.updated') {
          const part = properties.part || {};
          const partType = part.type;
          const messageId = part.messageID;

          if (partType === 'tool') {
            const statusText = this._toolStatusText(part);
            if (statusText && statusText !== lastStatus) {
              lastStatus = statusText;
              void this.sendStatus(channelName, statusText);
            }
            return;
          }

          if (partType === 'patch') {
            const files = part.files || [];
            if (files.length > 0) {
              const summary = files.slice(0, 5).map((name) => `\`${name}\``).join(', ');
              void this.sendStatus(channelName, `Editing: ${summary}`);
            }
            return;
          }

          if (partType === 'text' && (assistantMessageIds.has(messageId) || assistantMessageIds.size === 0)) {
            let text = properties.delta || part.text || '';
            if (!text && part.id && assistantParts[part.id]) {
              text = assistantParts[part.id];
            }
            if (text) {
              if (properties.delta && part.id && assistantParts[part.id]) {
                assistantParts[part.id] += String(text);
              } else if (part.id) {
                assistantParts[part.id] = String(text);
              }
            }
            return;
          }
        }

        if (eventType === 'command.executed') {
          const name = properties.name || 'command';
          const argumentsText = String(properties.arguments || '').trim();
          void this.sendStatus(channelName, `Running: \`${`${name} ${argumentsText}`.trim()}\``);
          return;
        }

        if (eventType === 'file.edited') {
          const fileName = properties.file || '';
          if (fileName) void this.sendStatus(channelName, `Edited: \`${fileName}\``);
          return;
        }

        if (eventType === 'session.compacted') {
          void this.sendStatus(channelName, 'Compacting conversation...');
          return;
        }

        if (eventType === 'session.error') {
          const error = firstText(properties.error).trim();
          if (error) void this.sendError(channelName, error.slice(0, 1200));
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
          stderr += chunk.toString('utf-8');
        });
      }

      proc.on('error', reject);
      proc.on('close', (code) => {
        if (lineBuffer.trim()) processLine(lineBuffer);
        const stderrText = stderr.trim();
        if (code !== 0) {
          reject(new Error(stderrText || 'opencode exited with an error'));
          return;
        }

        const response = Object.values(assistantParts)
          .map((text) => text.trim())
          .filter(Boolean)
          .join('\n')
          .trim() || stderrText;
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
    if (!(env.LLM_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY)) {
      await this.sendError(
        msgChannel,
        'OpenCode is not configured. Set LLM_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY and restart the agent.'
      );
      return;
    }

    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing message from ${sender} in ${msgChannel}: ${content.slice(0, 80)}...`);
    await this._autoTitleChannel(msgChannel, content);
    await this.sendStatus(msgChannel, 'thinking...');

    try {
      const responseText = await this._runOpencode(content, msgChannel);
      await this.sendResponse(msgChannel, responseText || 'No response generated. Please try again.');
    } catch (e) {
      this._log(`Error handling message: ${e.message}`);
      await this.sendError(msgChannel, `Error processing message: ${e.message}`);
    }
  }
}

module.exports = OpenCodeAdapter;

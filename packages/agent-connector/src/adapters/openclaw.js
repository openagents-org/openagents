/**
 * OpenClaw adapter for OpenAgents workspace.
 *
 * Bridges OpenClaw to an OpenAgents workspace via:
 * - CLI mode: `openclaw agent --local --json` (preferred)
 * - Workspace context injected via SKILL.md auto-discovery
 *
 * Direct port of Python: src/openagents/adapters/openclaw.py
 * (CLI mode only — gateway WS and direct HTTP modes are not yet ported)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt } = require('./utils');
const { buildOpenclawSkillMd, buildOpenclawSystemPrompt } = require('./workspace-prompt');
const { getRuntimePrefix } = require('../paths');

const IS_WINDOWS = process.platform === 'win32';
const OPENCLAW_STATE_DIR = path.join(
  IS_WINDOWS ? (process.env.USERPROFILE || '') : (process.env.HOME || ''),
  '.openclaw'
);

class OpenClawAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {string} [opts.openclawAgentId='main']
   * @param {Set} [opts.disabledModules]
   */
  constructor(opts) {
    super(opts);
    this.openclawAgentId = opts.openclawAgentId || 'main';
    this.disabledModules = opts.disabledModules || new Set();

    // Find the openclaw binary — always use CLI/gateway mode for full tool support
    this._openclawBinary = this._findOpenclawBinary();

    if (this._openclawBinary) {
      this._log(`Using OpenClaw CLI mode (${this._openclawBinary})`);
    } else {
      this._log('OpenClaw binary not found — agent will not be able to process messages');
    }

    // Install workspace skill
    this._installWorkspaceSkill();
  }

  // ------------------------------------------------------------------
  // Binary resolution
  // ------------------------------------------------------------------

  _findOpenclawBinary() {
    const home = process.env.USERPROFILE || process.env.HOME || '';

    // Tier 0: Isolated runtime prefix (~/.openagents/runtimes/openclaw/)
    const runtimeMjs = path.join(getRuntimePrefix('openclaw'), 'node_modules', 'openclaw', 'openclaw.mjs');
    if (fs.existsSync(runtimeMjs)) return runtimeMjs;

    // Tier 0b: Legacy shared prefix
    const portableDir = path.join(home, '.openagents', 'nodejs');
    const mjs = path.join(portableDir, 'node_modules', 'openclaw', 'openclaw.mjs');
    if (fs.existsSync(mjs)) return mjs;

    // Fallback: check if openclaw is on PATH (system install)
    // On Windows, resolve .cmd shim to actual .mjs path to avoid spawn issues
    try {
      const cmd = IS_WINDOWS ? 'where openclaw.cmd' : 'which openclaw';
      const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] })
        .split(/\r?\n/)[0].trim();
      if (result) {
        const resolved = this._resolveShimToMjs(result);
        if (resolved) return resolved;
        // On Unix, which returns the actual binary/symlink
        if (!IS_WINDOWS) return result;
      }
    } catch {}
    // Windows: also try without .cmd extension (for system installs on PATH)
    if (IS_WINDOWS) {
      try {
        const result = execSync('where openclaw', { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] })
          .split(/\r?\n/)[0].trim();
        if (result) {
          // Try the .cmd variant of this path
          const cmdPath = result.replace(/(?:\.cmd)?$/i, '.cmd');
          const resolved = this._resolveShimToMjs(cmdPath);
          if (resolved) return resolved;
        }
      } catch {}
    }
    return null;
  }

  /**
   * Resolve a .cmd shim or Unix symlink to the actual openclaw.mjs path.
   * On Windows: parses the .cmd shim to extract %dp0%\..\openclaw\openclaw.mjs
   * On Unix: follows symlink to the .mjs file
   */
  _resolveShimToMjs(binPath) {
    if (IS_WINDOWS) {
      try {
        if (!binPath.toLowerCase().endsWith('.cmd')) return null;
        const cmdContent = fs.readFileSync(binPath, 'utf-8');
        const match = cmdContent.match(/%dp0%\\([^\s"*?]+\.mjs)/i)
          || cmdContent.match(/%dp0%\\([^\s"*?]+\.js)/i);
        if (match) {
          const cmdDir = path.dirname(path.resolve(binPath));
          return path.resolve(cmdDir, match[1]);
        }
      } catch {}
    } else {
      try {
        let target = binPath;
        if (fs.lstatSync(binPath).isSymbolicLink()) {
          target = path.resolve(path.dirname(binPath), fs.readlinkSync(binPath));
        }
        if (target.endsWith('.mjs') || target.endsWith('.js')) return target;
      } catch {}
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Workspace skill installation
  // ------------------------------------------------------------------

  _resolveOpenclawWorkspace() {
    const agentId = this.openclawAgentId;
    const wsDir = agentId && agentId !== 'main'
      ? path.join(OPENCLAW_STATE_DIR, `workspace-${agentId}`)
      : path.join(OPENCLAW_STATE_DIR, 'workspace');

    if (fs.existsSync(wsDir)) return wsDir;

    // Fall back to default workspace
    const fallback = path.join(OPENCLAW_STATE_DIR, 'workspace');
    if (fs.existsSync(fallback)) return fallback;

    return null;
  }

  _installWorkspaceSkill() {
    const wsDir = this._resolveOpenclawWorkspace();
    if (!wsDir) {
      this._log('OpenClaw workspace not found, skipping skill install');
      return;
    }

    const skillName = `openagents-workspace-${this.agentName}`;
    const skillDir = path.join(wsDir, 'skills', skillName);
    fs.mkdirSync(skillDir, { recursive: true });

    const content = buildOpenclawSkillMd({
      endpoint: this.endpoint,
      workspaceId: this.workspaceId,
      token: this.token,
      agentName: this.agentName,
      channelName: this.channelName,
      disabledModules: this.disabledModules,
    });

    const skillPath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(skillPath, content, 'utf-8');
    this._log(`Installed workspace skill at ${skillPath}`);
  }

  // ------------------------------------------------------------------
  // Message handling
  // ------------------------------------------------------------------

  async _handleMessage(msg) {
    let content = (msg.content || '').trim();
    const attachments = msg.attachments || [];

    // Append attachment info
    const attText = formatAttachmentsForPrompt(attachments);
    if (attText) {
      content = content ? content + attText : attText.trim();
    }

    if (!content) return;

    // msg.sessionId may be a channel name (from workspace UI) or an agent target
    // (from API). Only use it if it looks like a channel, otherwise use channelName.
    let msgChannel = this.channelName || 'general';
    if (msg.sessionId && !msg.sessionId.startsWith('openagents:') && !msg.sessionId.startsWith('agent:')) {
      msgChannel = msg.sessionId;
    }
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing message from ${sender} in ${msgChannel}: ${content.slice(0, 80)}...`);

    await this._autoTitleChannel(msgChannel, content);
    await this.sendStatus(msgChannel, 'thinking...');

    try {
      const responseText = await this._runCliAgent(content, msgChannel);

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
  // CLI mode (openclaw agent --local)
  // ------------------------------------------------------------------

  _runCliAgent(userMessage, channel) {
    return new Promise((resolve, reject) => {
      // Re-check binary if not found at construction time (installed after daemon started)
      if (!this._openclawBinary) {
        this._openclawBinary = this._findOpenclawBinary();
        if (this._openclawBinary) {
          this._log(`OpenClaw binary found (late): ${this._openclawBinary}`);
        }
      }
      const binary = this._openclawBinary;
      if (!binary) {
        reject(new Error('OpenClaw binary not found'));
        return;
      }

      const channelSuffix = (channel || 'general').replace(/[^a-zA-Z0-9-]/g, '').slice(-8) || 'general';
      const sessionKey = `openagents-${this.workspaceId.slice(0, 8)}-${channelSuffix}`;

      const args = [
        '--log-level', 'trace',
        'agent', '--local',
        '--agent', this.openclawAgentId,
        '--session-id', sessionKey,
        '--message', userMessage,
        '--json',
      ];

      this._log(`CLI: ${binary} ${args.slice(0, 5).join(' ')} ...`);

      const spawnEnv = { ...(this.agentEnv || process.env) };
      if (IS_WINDOWS) {
        const nodeBinDir = path.dirname(process.execPath);
        const npmBin = path.join(process.env.APPDATA || '', 'npm');
        const portableDir2 = path.join(os.homedir(), '.openagents', 'nodejs');
        const runtimeBin = path.join(getRuntimePrefix('openclaw'), 'node_modules', '.bin');
        for (const p of [runtimeBin, nodeBinDir, npmBin, portableDir2]) {
          if (p && !(spawnEnv.PATH || '').includes(p)) {
            spawnEnv.PATH = p + path.delimiter + (spawnEnv.PATH || '');
          }
        }
      }

      // Tool name → human-readable status
      const toolLabels = {
        exec: 'Running command...',
        read: 'Reading file...',
        write: 'Writing file...',
        edit: 'Editing file...',
        browser: 'Using browser...',
        web_search: 'Searching the web...',
        web_fetch: 'Fetching webpage...',
        process: 'Running process...',
        image_generate: 'Generating image...',
        memory_search: 'Searching memory...',
      };

      let output = '';
      let lineBuffer = '';

      const processLine = (line) => {
        const toolStart = line.match(/embedded run tool start:.*tool=(\w+)/);
        if (toolStart) {
          const label = toolLabels[toolStart[1]] || `Using ${toolStart[1]}...`;
          this._log(`Tool: ${label}`);
          this.sendStatus(channel, label).catch(() => {});
        }
        if (line.match(/embedded run agent start/)) {
          this.sendStatus(channel, 'thinking...').catch(() => {});
        }
      };

      // Redirect stderr to temp file for real-time tool status polling.
      // --log-level trace makes OpenClaw write diagnostic events to stderr
      // even in non-TTY mode. We poll the temp file for new lines every 500ms.
      const stderrFile = path.join(os.tmpdir(), `openclaw-stderr-${Date.now()}.log`);
      const stderrFd = fs.openSync(stderrFile, 'w');
      this._log('Spawn: stderr → ' + stderrFile);

      // Always spawn node + openclaw.mjs directly (no shims, no cmd.exe, cross-platform)
      // This avoids Windows .cmd shim issues and Unicode path encoding problems.
      const portableDir = path.join(os.homedir(), '.openagents', 'nodejs');
      // Unified path first (symlink on Unix), then legacy bin/ fallback, then system node
      const nodeUnified = path.join(portableDir, IS_WINDOWS ? 'node.exe' : 'node');
      let nodeBin = fs.existsSync(nodeUnified) ? nodeUnified : path.join(portableDir, 'bin', 'node');
      if (!fs.existsSync(nodeBin)) {
        try {
          const cmd = IS_WINDOWS ? 'where node.exe' : 'which node';
          nodeBin = execSync(cmd, { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] })
            .split(/\r?\n/)[0].trim();
        } catch { nodeBin = 'node'; }
      }

      // binary from _findOpenclawBinary() is already resolved to .mjs when possible
      let spawnBin, spawnArgs;
      if (binary && binary.endsWith('.mjs')) {
        // Direct node + .mjs invocation (works for managed, legacy, AND global installs)
        spawnBin = nodeBin;
        spawnArgs = [binary, ...args];
      } else {
        // Check managed locations explicitly
        const runtimeMjs = path.join(getRuntimePrefix('openclaw'), 'node_modules', 'openclaw', 'openclaw.mjs');
        const legacyMjs = path.join(portableDir, 'node_modules', 'openclaw', 'openclaw.mjs');
        const openclawMjs = fs.existsSync(runtimeMjs) ? runtimeMjs : (fs.existsSync(legacyMjs) ? legacyMjs : null);
        if (openclawMjs) {
          spawnBin = nodeBin;
          spawnArgs = [openclawMjs, ...args];
        } else {
          // Last resort: spawn binary directly with shell (handles .cmd on Windows)
          spawnBin = binary;
          spawnArgs = args;
        }
      }
      const proc = spawn(spawnBin, spawnArgs, {
        stdio: ['ignore', 'pipe', stderrFd],
        env: spawnEnv,
        cwd: this.workingDir || process.env.HOME || '/',
        timeout: 600000,
        windowsHide: true,
      });
      if (proc.stdout) proc.stdout.on('data', (d) => { output += d; });

      // Poll stderr file every 500ms for tool events
      let stderrOffset = 0;
      const pollInterval = setInterval(() => {
        try {
          const stat = fs.statSync(stderrFile);
          if (stat.size > stderrOffset) {
            const fd = fs.openSync(stderrFile, 'r');
            const buf = Buffer.alloc(stat.size - stderrOffset);
            fs.readSync(fd, buf, 0, buf.length, stderrOffset);
            fs.closeSync(fd);
            stderrOffset = stat.size;
            const chunk = buf.toString('utf-8');
            const lines = chunk.split('\n');
            for (const line of lines) processLine(line);
          }
        } catch {}
      }, 500);

      const killTimeout = setTimeout(() => {
        proc.kill();
        reject(new Error('CLI timed out after 600 seconds'));
      }, 600000);

      proc.on('error', (err) => {
        clearInterval(pollInterval);
        clearTimeout(killTimeout);
        fs.closeSync(stderrFd);
        try { fs.unlinkSync(stderrFile); } catch {}
        reject(err);
      });
      proc.on('exit', (code) => {
        clearInterval(pollInterval);
        clearTimeout(killTimeout);
        fs.closeSync(stderrFd);
        // Read full stderr content (contains JSON output + trace lines)
        let stderrContent = '';
        try {
          stderrContent = fs.readFileSync(stderrFile, 'utf-8');
          this._log(`CLI exit code=${code}, stdout=${output.length}b, stderr=${stderrContent.length}b`);
          // Process any remaining lines for tool events
          const remaining = stderrContent.slice(stderrOffset);
          if (remaining) {
            for (const line of remaining.split('\n')) processLine(line);
          }
        } catch (e) {
          this._log(`CLI stderr read error: ${e.message}`);
        }
        try { fs.unlinkSync(stderrFile); } catch {}

        // OpenClaw --json writes JSON to stderr, so combine stdout + stderr
        const allOutput = output + '\n' + stderrContent;
        const hasPayloads = allOutput.includes('"payloads"');
        this._log(`CLI parse: hasPayloads=${hasPayloads}, total=${allOutput.length}b`);

        if (code !== 0) {
          reject(new Error(`CLI exited ${code}: ${allOutput.slice(-300)}`));
          return;
        }
        this._parseCliOutput(allOutput, resolve);
      });
    });
  }

  _parseCliOutput(output, resolve) {
    const text = output.trim();
    if (!text) { resolve(''); return; }

    // OpenClaw --json outputs a JSON blob with {"payloads":[...]} structure.
    // With --log-level trace, stderr also contains diagnostic lines.
    // Find the JSON by looking for '{"payloads"' or the last complete JSON object.
    let jsonStr = null;

    // Strategy 1: find {"payloads" or { "payloads" (with whitespace)
    let payloadsIdx = text.indexOf('{"payloads"');
    if (payloadsIdx < 0) {
      // Try with whitespace after {
      const match = text.match(/\{\s*"payloads"/);
      if (match) payloadsIdx = match.index;
    }
    if (payloadsIdx >= 0) {
      // Find the matching closing brace by counting braces
      let depth = 0;
      for (let i = payloadsIdx; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') { depth--; if (depth === 0) { jsonStr = text.slice(payloadsIdx, i + 1); break; } }
      }
    }

    // Strategy 2: find last '{' that starts a valid JSON with "payloads"
    if (!jsonStr) {
      for (let i = text.length - 1; i >= 0; i--) {
        if (text[i] === '{') {
          const candidate = text.slice(i);
          try {
            const d = JSON.parse(candidate);
            if (d.payloads) { jsonStr = candidate; break; }
          } catch {}
        }
      }
    }

    // Strategy 3: try each line that starts with '{'
    if (!jsonStr) {
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{')) {
          try {
            const d = JSON.parse(trimmed);
            if (d.payloads) { jsonStr = trimmed; break; }
          } catch {}
        }
      }
    }

    if (jsonStr) {
      try {
        const data = JSON.parse(jsonStr);
        const payloads = data.payloads || [];
        this._log(`CLI parsed: ${payloads.length} payloads, keys=${payloads.map(p=>Object.keys(p).join('/')).join(', ')}, text=${payloads.map(p=>(p.text||'').slice(0,50)).join('|')}`);
        if (payloads.length > 0) {
          const texts = payloads.filter(p => p.text).map(p => p.text);
          if (texts.length > 0) {
            resolve(texts.join('\n\n'));
            return;
          }
        }
      } catch (e) {
        this._log(`CLI JSON parse error: ${e.message}`);
      }
    }

    // Fallback: return non-diagnostic text
    const cleanLines = text.split('\n').filter(l =>
      !l.includes('[diagnostic]') && !l.includes('[agent/embedded]') && !l.includes('Registered plugin')
    ).map(l => l.trim()).filter(Boolean);
    resolve(cleanLines.join('\n') || '');
  }
  // ------------------------------------------------------------------
  // Static: configure OpenClaw's native auth from LLM env vars
  // ------------------------------------------------------------------

  /**
   * Configure OpenClaw's native auth and model from user-provided
   * LLM_API_KEY / LLM_BASE_URL / LLM_MODEL values.
   * Called by the Launcher's saveAgentEnv when type === 'openclaw'.
   *
   * For standard providers (OpenAI, Anthropic), uses auth-profiles.json.
   * For custom endpoints, uses models.providers in openclaw.json which
   * gives full tool support via the CLI gateway mode.
   */
  static configureNativeAuth(env) {
    const apiKey = env.LLM_API_KEY;
    // Strip /chat/completions suffix — OpenClaw appends it internally
    const rawUrl = env.LLM_BASE_URL || 'https://api.openai.com/v1';
    const baseUrl = rawUrl.replace(/\/chat\/completions\/?$/, '');
    const model = env.LLM_MODEL || 'gpt-4o';
    if (!apiKey) return;

    const isOpenAI = baseUrl.includes('api.openai.com');
    const isAnthropic = baseUrl.includes('api.anthropic.com');
    const configFile = path.join(OPENCLAW_STATE_DIR, 'openclaw.json');

    if (isOpenAI || isAnthropic) {
      // Standard provider — use auth-profiles.json
      const provider = isAnthropic ? 'anthropic' : 'openai';
      const profileId = `${provider}:manual`;
      const agentDir = path.join(OPENCLAW_STATE_DIR, 'agents', 'main', 'agent');

      try {
        fs.mkdirSync(agentDir, { recursive: true });
        const authFile = path.join(agentDir, 'auth-profiles.json');
        let authData = { version: 1, profiles: {} };
        try { authData = JSON.parse(fs.readFileSync(authFile, 'utf-8')); } catch {}
        authData.profiles = authData.profiles || {};
        authData.profiles[profileId] = { type: 'token', provider, token: apiKey };
        authData.lastGood = authData.lastGood || {};
        authData.lastGood[provider] = profileId;
        fs.writeFileSync(authFile, JSON.stringify(authData, null, 2), 'utf-8');
      } catch {}

      // Set model
      try {
        let config = {};
        try { config = JSON.parse(fs.readFileSync(configFile, 'utf-8')); } catch {}
        config.agents = config.agents || {};
        config.agents.defaults = config.agents.defaults || {};
        config.agents.defaults.model = { primary: `${provider}/${model}` };
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
      } catch {}
    } else {
      // Custom endpoint — use models.providers for full gateway/tool support
      // This is the proper way to add custom LLM endpoints to OpenClaw.
      // See: https://docs.openclaw.ai/concepts/model-providers
      try {
        fs.mkdirSync(OPENCLAW_STATE_DIR, { recursive: true });
        let config = {};
        try { config = JSON.parse(fs.readFileSync(configFile, 'utf-8')); } catch {}

        config.models = config.models || {};
        config.models.providers = config.models.providers || {};
        config.models.providers.custom = {
          baseUrl: baseUrl.replace(/\/+$/, ''),
          apiKey,
          api: 'openai-completions',
          models: [{ id: model, name: model }],
        };

        config.agents = config.agents || {};
        config.agents.defaults = config.agents.defaults || {};
        config.agents.defaults.model = { primary: `custom/${model}` };

        fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
      } catch {}

      // Also write auth-profiles.json for the custom provider
      try {
        const agentDir = path.join(OPENCLAW_STATE_DIR, 'agents', 'main', 'agent');
        fs.mkdirSync(agentDir, { recursive: true });
        const authFile = path.join(agentDir, 'auth-profiles.json');
        let authData = { version: 1, profiles: {} };
        try { authData = JSON.parse(fs.readFileSync(authFile, 'utf-8')); } catch {}
        authData.profiles = authData.profiles || {};
        authData.profiles['custom:manual'] = { type: 'token', provider: 'custom', token: apiKey };
        authData.lastGood = authData.lastGood || {};
        authData.lastGood.custom = 'custom:manual';
        fs.writeFileSync(authFile, JSON.stringify(authData, null, 2), 'utf-8');
      } catch {}
    }
  }
}

module.exports = OpenClawAdapter;

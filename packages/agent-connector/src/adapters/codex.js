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
const { execSync } = require('child_process');
// spawn() here is the WSL bridge from ../wsl: same signature as
// child_process.spawn, and a straight pass-through unless the resolved CLI
// lives on the other side of the Windows/WSL boundary.
const { spawn, resolveWslBinary } = require('../wsl');
const http = require('http');
const https = require('https');

const { whereBinary } = require('../paths');
const BaseAdapter = require('./base');
const { redactSecrets, formatAttachmentsForPrompt } = require('./utils');
const { buildOpenclawSystemPrompt } = require('./workspace-prompt');

const IS_WINDOWS = process.platform === 'win32';
const MAX_HISTORY_ENTRIES = 50;
// Direct API mode has no tools, so an attached file reaches the model only as
// text inside the message. This caps how much goes in: a spec fits, and a log
// dump doesn't push the rest of the conversation out of the context window.
const MAX_INLINE_ATTACHMENT_CHARS = 50000;
// A completions request needs its own deadlines. Node's `timeout` option only
// emits an event, it never aborts, so a relay that accepted the request and
// then went quiet left the run hanging forever with nothing in the log.
// Overridable per instance (_directIdleTimeoutMs / _directTotalTimeoutMs).
const DIRECT_IDLE_TIMEOUT_MS = 120000;
const DIRECT_TOTAL_TIMEOUT_MS = 300000;
const TEXT_FILE_RE = /\.(md|markdown|txt|text|csv|tsv|json|jsonl|ya?ml|toml|ini|xml|html?|log|sql|sh|py|js|mjs|cjs|ts|tsx|jsx|java|go|rs|rb|php|c|h|cc|cpp|hpp|cs|swift|kt)$/i;

class CodexAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();
    // Pin the channel's decision log + glossary into the system prompt.
    this._usesPinnedContext = true;

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
    // - CLI mode: works with OpenAI's native Responses API (api.openai.com)
    //   OR with subscription-based auth via 'codex login'
    // - Direct API mode: works with any OpenAI-compatible chat completions endpoint
    this._codexBin = this._findCodexBinary();
    this._directMode = false;
    this._useCliMode = false;

    // Check if base URL is OpenAI's native API (CLI requires Responses API)
    const isOpenAiNative = !this._directBaseUrl ||
      this._directBaseUrl.includes('api.openai.com');

    if (this._codexBin && (isOpenAiNative || !this._directApiKey)) {
      // CLI mode: either OpenAI native API or subscription auth (no API key)
      this._useCliMode = true;
      this._log(`CLI mode: ${this._codexBin}${!this._directApiKey ? ' (subscription auth)' : ''}`);
    } else if (this._directApiKey && this._directBaseUrl) {
      this._directMode = true;
      if (this._codexBin) {
        this._log(`Direct LLM mode (non-OpenAI endpoint, CLI requires Responses API): ${this._directBaseUrl} model=${this._directModel || 'gpt-4o'}`);
      } else {
        this._log(`Direct LLM mode: ${this._directBaseUrl} model=${this._directModel || 'gpt-4o'}`);
      }
    } else if (this._codexBin) {
      // CLI binary found, no custom base URL — assume OpenAI or subscription auth
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

    // Tier 1: PATH search via a codepage-safe lookup (whereBinary forces UTF-8
    // output + verifies existence so a non-ASCII/Chinese username isn't mangled
    // into an ENOENT; it also no longer returns an empty string on a miss, which
    // used to short-circuit the Node-derived fallback tiers below).
    const viaWhere = whereBinary('codex');
    if (viaWhere) return viaWhere;

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

    // Nothing native anywhere. Last of all, look inside WSL: a CLI the user
    // installed in their distro is a real install, and the marked path it comes
    // back as is what the spawn bridge in ../wsl turns into a wsl.exe run.
    return resolveWslBinary('codex');
  }

  _buildSystemContext(channelName) {
    const base = buildOpenclawSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName,
      endpoint: this.endpoint,
      token: this.token,
      mode: this._mode,
      model: this.modelLabel(),
      disabledModules: this.disabledModules,
      ...this.pinnedPromptOpts(channelName),
    });
    const skillsSection = this._buildInstalledSkillsSection();
    return skillsSection ? `${base}\n\n${skillsSection}` : base;
  }

  /**
   * Codex has no native skills-directory discovery (unlike Claude Code), so
   * we inject installed Skill Hub skills directly into its context. Each
   * skill's SKILL.md lives at <workingDir>/.codex/skills/<id>/SKILL.md and
   * Codex (running with cwd=workingDir, full file access) can read it.
   */
  _buildInstalledSkillsSection() {
    let skills = [];
    try {
      const installer = require('../skill-installer');
      skills = installer.listInstalledSkills({
        agentType: this.agentType || 'codex',
        workingDir: this.workingDir,
      });
    } catch {
      return '';
    }
    if (!skills.length) return '';
    const lines = skills.map((s) => {
      const desc = s.description ? ` — ${s.description}` : '';
      return `- **${s.name}** (\`${s.id}\`)${desc}\n  Read its instructions: \`cat ${s.skillMd}\``;
    });
    return (
      '## Installed Skills\n' +
      'You have the following skills installed. When a task matches a skill, ' +
      'read its `SKILL.md` (via the `cat` command shown) and follow it:\n' +
      lines.join('\n')
    );
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

  // ------------------------------------------------------------------
  // Message handler
  // ------------------------------------------------------------------

  async _handleMessage(msg) {
    const content = (msg.content || '').trim();
    const attachments = msg.attachments || [];
    // A file sent with no text is still a message. The web UI fills content
    // with the filename, but a task or API caller may leave it empty.
    if (!content && attachments.length === 0) return;

    const msgChannel = msg.sessionId || this.channelName;
    const sender = msg.senderName || msg.senderType || 'user';
    const summary = content || attachments.map((a) => a.filename).join(', ');
    this._log(`Processing message from ${sender} in ${msgChannel}: ${summary.slice(0, 80)}...`);

    await this._autoTitleChannel(msgChannel, summary);
    await this.sendStatus(msgChannel, 'thinking...');

    if (this._useCliMode) {
      await this._handleViaSubprocess(content, msgChannel, attachments);
    } else if (this._directMode) {
      await this._handleViaDirectApi(content, msgChannel, attachments);
    } else {
      await this.sendError(msgChannel, 'codex CLI not found. Install with: npm install -g @openai/codex\n\nOr configure OPENAI_API_KEY + OPENAI_BASE_URL for direct API mode.');
    }
  }

  // ------------------------------------------------------------------
  // CLI subprocess mode (primary)
  // ------------------------------------------------------------------

  async _handleViaSubprocess(content, msgChannel, attachments = []) {
    const env = { ...(this.agentEnv || process.env) };

    // Set model via env if configured
    if (this._directModel) env.CODEX_MODEL = this._directModel;
    if (this._directApiKey) env.OPENAI_API_KEY = this._directApiKey;
    if (this._directBaseUrl) env.OPENAI_BASE_URL = this._directBaseUrl;

    const context = this._buildSystemContext(msgChannel);
    const fullPrompt = `${context}\n\n---\n\nUser message:\n${content}${this._attachmentInstructions(attachments)}`;

    // Run up to 2 attempts: first with resume, then fresh if stale
    for (let attempt = 0; attempt < 2; attempt++) {
      const cmd = [this._codexBin, 'exec'];

      cmd.push('--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check');

      // Model override
      if (this._directModel) {
        cmd.push('-m', this._directModel);
      }

      // Working directory
      if (this.workingDir) {
        cmd.push('-C', this.workingDir);
      }

      // Resume goes LAST, after the exec options. `codex exec resume` takes
      // -m, --json, --skip-git-repo-check and the bypass flags, but not -C,
      // so the old order died with "unexpected argument '-C'" on every
      // follow-up. That read as a stale thread, the id was dropped and the
      // turn reran fresh, which is why a CLI-mode agent never remembered
      // anything past its first message. Verified against codex-cli 0.154.0.
      const threadId = this._channelThreads[msgChannel];
      if (threadId && attempt === 0) {
        cmd.push('resume', threadId);
      }

      this._log(`Spawning: codex ${cmd.slice(1).join(' ')}`);

      try {
        const result = await this._spawnCodex(cmd, env, msgChannel, fullPrompt);
        if (result.stopped) return;

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
          // Surface the actual reason (turn.failed message, stderr, exit code)
          // instead of a generic "no response" — mirrors the OpenCode adapter
          // so auth/model/network problems are actionable from the chat.
          await this._sendRunFailure(msgChannel, result);
          return;
        }
      } catch (e) {
        this._log(`Error in subprocess: ${e.message}`);
        await this.sendError(msgChannel, `⚠️ **Codex couldn't run** — ${CodexAdapter._redact(e.message)}`);
        return;
      }
    }
  }

  async _spawnCodex(cmd, env, msgChannel, prompt) {
    // Stopped while this turn was being prepared: start nothing (no tokens).
    if (this._stoppedBeforeStart(msgChannel)) return { stopped: true, responseText: '', exitCode: null };
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
      let lastErrorMessage = '';
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
          lastErrorMessage = errMsg;
          this._log(`Turn failed: ${errMsg}`);
        } else if (eventType === 'error') {
          const errMsg = event.message || JSON.stringify(event);
          lastErrorMessage = errMsg;
          this._log(`Error event: ${errMsg}`);
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
          errorMessage: lastErrorMessage,
        });
      });

      proc.on('error', (err) => {
        delete this._channelProcesses[msgChannel];
        reject(err);
      });
    });
  }

  // ------------------------------------------------------------------
  // Attachments
  // ------------------------------------------------------------------

  /**
   * How the CLI fetches each attached file. Without this it saw only the
   * filename and went looking for it on local disk.
   *
   * The curl form, not the MCP one: Codex runs with no MCP config, so
   * `workspace_read_file` names a tool it doesn't have. The token goes in
   * literally, as it already does in the system prompt, because `$TOKEN` is
   * unset in Codex's shell and every download would 401. The URL is rebuilt
   * from this agent's endpoint: the one the browser attached points at the
   * browser's API origin and carries the viewer's token.
   */
  _attachmentInstructions(attachments) {
    const forAgent = (attachments || []).map((att) => ({ ...att, url: undefined }));
    return formatAttachmentsForPrompt(forAgent, 'skills', IS_WINDOWS, {
      tokenExpr: this.token, endpoint: this.endpoint,
    }) || '';
  }

  /**
   * Direct API mode has no tools, so a file reaches the model only if its text
   * is in the message. Text files are inlined up to MAX_INLINE_ATTACHMENT_CHARS.
   * Anything else is named, so the model says it can't open the file rather
   * than answering as if it had read it.
   */
  async _inlineAttachments(attachments) {
    if (!attachments || attachments.length === 0) return '';
    const parts = [];
    let budget = MAX_INLINE_ATTACHMENT_CHARS;
    for (const att of attachments) {
      const name = att.filename || att.fileId || 'file';
      if (!CodexAdapter._looksLikeText(att)) {
        parts.push(`[Attached file: ${name} (${att.contentType || 'unknown type'}) — its contents can't be read in this mode]`);
        continue;
      }
      if (budget <= 0) {
        parts.push(`[Attached file: ${name} — left out, the attachments already reached the size limit]`);
        continue;
      }
      let buf;
      try {
        buf = await this.client.readFile(this.workspaceId, this.token, att.fileId);
      } catch (e) {
        parts.push(`[Attached file: ${name} — download failed: ${CodexAdapter._redact(e.message).slice(0, 200)}]`);
        continue;
      }
      if (buf.includes(0)) {
        parts.push(`[Attached file: ${name} — binary content, can't be read in this mode]`);
        continue;
      }
      const text = buf.toString('utf-8');
      const body = text.slice(0, budget);
      budget -= body.length;
      const note = body.length < text.length ? ` — only the first ${body.length} characters` : '';
      parts.push(`[Attached file: ${name}${note}]\n${body}\n[End of ${name}]`);
    }
    return `\n\n${parts.join('\n\n')}`;
  }

  /** Whether an attachment is worth decoding as text. Browsers upload .md as octet-stream. */
  static _looksLikeText({ contentType, filename } = {}) {
    const type = String(contentType || '').split(';')[0].trim().toLowerCase();
    if (type.startsWith('text/')) return true;
    if (/^application\/(json|xml|yaml|x-yaml|toml|javascript|x-sh|sql)$/.test(type)) return true;
    return TEXT_FILE_RE.test(String(filename || ''));
  }

  // ------------------------------------------------------------------
  // Failure reporting
  // ------------------------------------------------------------------

  /**
   * Post a user-visible failure carrying the actual reason a run produced no
   * reply, instead of a generic "No response generated".
   */
  async _sendRunFailure(msgChannel, result) {
    const detail = CodexAdapter._failureDetail(result);
    const body = detail
      ? `Codex failed to complete this run.\n\n> ${detail}`
      : 'Codex finished without producing a reply. Please try again.';
    await this.sendError(msgChannel, `⚠️ **Codex couldn't run** — ${body}`);
  }

  /**
   * Pick the most informative failure detail from a run result:
   * turn.failed / error event message → stderr tail → exit code. Redacted.
   */
  static _failureDetail({ errorMessage, stderr, exitCode } = {}) {
    const stderrTail = String(stderr || '').trim().split('\n').slice(-5).join('\n').trim();
    const raw = String(errorMessage || '').trim()
      || stderrTail
      || (exitCode ? `codex exited with code ${exitCode}` : '');
    const detail = CodexAdapter._explain(CodexAdapter._unwrap(raw));
    return CodexAdapter._redact(detail).slice(0, 500).trim();
  }

  /**
   * Unwrap the API's JSON error envelope so the user reads the sentence, not
   * the transport. The backend rejects a run with a body like
   * `{"detail":"The 'gpt-5.6-sol' model requires a newer version of Codex."}`
   * and it was surfaced verbatim, braces and all (#649).
   */
  static _unwrap(raw) {
    const text = String(raw || '').trim();
    if (!text.startsWith('{') && !text.startsWith('[')) return text;
    try {
      const parsed = JSON.parse(text);
      for (const key of ['detail', 'message', 'error']) {
        const v = parsed && parsed[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
        // OpenAI also nests as { error: { message } }.
        if (v && typeof v.message === 'string' && v.message.trim()) return v.message.trim();
      }
    } catch {}
    return text;
  }

  /**
   * Add the missing half of a backend rejection: what to actually do about it.
   *
   * "Please upgrade to the latest app or CLI" is true but unactionable inside a
   * workspace chat — the user is not at a terminal and does not necessarily
   * know the CLI is theirs to update. Name where the update button lives. The
   * match is on the backend's own wording, so an unrelated failure is passed
   * through untouched.
   */
  static _explain(detail) {
    if (!/requires a newer version|upgrade to the latest (app|version)/i.test(detail)) {
      return detail;
    }
    return `${detail}\n\nUpdate the Codex CLI from OpenAgents Launcher ` +
      '(Agents → Codex → Update), or run `npm install -g @openai/codex@latest`, ' +
      'then try again. Picking an older model also works around it for now.';
  }

  /** Redact secrets (keys, tokens, bearer/authorization, query secrets) from diagnostics. */
  static _redact(s) {
    return redactSecrets(s);
  }

  // ------------------------------------------------------------------
  // Direct HTTP mode (fallback when CLI not available)
  // ------------------------------------------------------------------

  async _handleViaDirectApi(content, msgChannel, attachments = []) {
    try {
      const userMessage = (content + await this._inlineAttachments(attachments)).trim();
      // Resolves with text or rejects with the reason there is none.
      const responseText = await this._callCompletionApi(userMessage, msgChannel);
      // The file text stays in history so a follow-up question about it still has it.
      this._conversationHistory.push({ role: 'user', content: userMessage });
      this._conversationHistory.push({ role: 'assistant', content: responseText });
      if (this._conversationHistory.length > MAX_HISTORY_ENTRIES * 2) {
        this._conversationHistory = this._conversationHistory.slice(-MAX_HISTORY_ENTRIES * 2);
      }
      await this.sendResponse(msgChannel, responseText);
    } catch (e) {
      this._log(`Error in direct API: ${e.message}`);
      await this._sendRunFailure(msgChannel, { errorMessage: e.message });
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
      const idleMs = this._directIdleTimeoutMs || DIRECT_IDLE_TIMEOUT_MS;
      const totalMs = this._directTotalTimeoutMs || DIRECT_TOTAL_TIMEOUT_MS;
      const started = Date.now();
      // What arrived before things stopped, so a stalled relay can be told
      // apart from one that answered in a shape we don't read.
      const progress = { status: 0, bytes: 0, events: 0 };
      const seconds = () => Math.round((Date.now() - started) / 1000);
      const note = () => `HTTP ${progress.status || 'no response'}, ${progress.bytes} bytes, `
        + `${progress.events} events, ${seconds()}s`;

      let settled = false;
      let deadline = null;
      const finish = (err, text) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (!err) { resolve(text); return; }
        this._log(`Direct API failed after ${seconds()}s, ${err.message}`);
        reject(err);
      };

      this._log(`Direct API request started, model ${this._directModel || 'gpt-4o'} to ${parsed.host}${parsed.pathname}`);
      const req = mod.request(parsed, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this._directApiKey}`,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: idleMs,
      }, (res) => {
        progress.status = res.statusCode;
        this._log(`Direct API response ${res.statusCode} after ${seconds()}s`);
        // Decode across chunk boundaries: a CJK character split between two
        // chunks came out as replacement characters when each was decoded alone.
        res.setEncoding('utf8');
        if (res.statusCode !== 200) {
          let body = '';
          res.on('data', (d) => { body += d; });
          res.on('end', () => finish(new Error(`LLM API returned ${res.statusCode}: ${body.slice(0, 300)}`)));
          return;
        }

        const reply = { text: '', reasoning: '', toolArgs: '', error: '', finishReason: '' };
        let streamed = false;
        let body = ''; // the raw response, kept until it turns out to be an SSE stream
        let buffer = '';
        const takeLine = (line) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) return;
          streamed = true;
          progress.events += 1;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') return;
          try { CodexAdapter._collectCompletion(reply, JSON.parse(data), 'delta'); } catch {}
        };
        res.on('data', (chunk) => {
          progress.bytes += chunk.length;
          if (!streamed) body += chunk;
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) takeLine(line);
        });
        res.on('end', () => {
          takeLine(buffer); // a stream whose last event has no trailing newline
          if (!streamed) {
            // Some relays ignore stream:true and answer with one JSON body.
            try { CodexAdapter._collectCompletion(reply, JSON.parse(body), 'message'); } catch {}
          }
          const text = CodexAdapter._completionText(reply);
          if (text) finish(null, text);
          else finish(new Error(CodexAdapter._emptyCompletionReason(reply, { streamed, body })));
        });
        res.on('aborted', () => finish(new Error(
          `The LLM API closed the connection mid-response (${note()})`)));
        res.on('error', (err) => finish(new Error(
          `The LLM API connection failed, ${err.message} (${note()})`)));
      });

      // Settle first, then destroy: the abort that follows would otherwise
      // report itself as a dropped connection and hide the real reason.
      req.on('timeout', () => {
        finish(new Error(
          `The LLM API stopped responding, no data for ${Math.round(idleMs / 1000)}s (${note()})`));
        req.destroy();
      });
      deadline = setTimeout(() => {
        finish(new Error(
          `The LLM API request went past ${Math.round(totalMs / 1000)}s with no usable reply (${note()})`));
        req.destroy();
      }, totalMs);
      if (deadline.unref) deadline.unref();

      req.on('error', (err) => finish(err));
      req.write(payload);
      req.end();
    });
  }

  /** Fold one streamed chunk (`delta`) or one whole response (`message`) into `reply`. */
  static _collectCompletion(reply, parsed, key) {
    if (!parsed || typeof parsed !== 'object') return;
    if (parsed.error) reply.error = CodexAdapter._unwrap(JSON.stringify(parsed));
    const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
    if (!choice) return;
    const part = choice[key] || {};
    if (typeof part.content === 'string') reply.text += part.content;
    const reasoning = part.reasoning_content || part.reasoning;
    if (typeof reasoning === 'string') reply.reasoning += reasoning;
    for (const tc of part.tool_calls || []) {
      if (tc.function && tc.function.arguments) reply.toolArgs += tc.function.arguments;
    }
    if (choice.finish_reason) reply.finishReason = choice.finish_reason;
  }

  /** The reply text, falling back to a tool call's arguments when the model answered with one. */
  static _completionText({ text, toolArgs }) {
    if (text.trim()) return text.trim();
    if (!toolArgs) return '';
    try {
      const args = JSON.parse(toolArgs);
      return String(args.command || args.input || args.content || args.text || toolArgs).trim();
    } catch {
      return toolArgs.trim();
    }
  }

  /**
   * Why a 200 from the completions endpoint carried no reply. Each of these
   * used to resolve to '' and reach the user as "finished without producing a
   * reply", which is what a relay's in-band error looked like.
   */
  static _emptyCompletionReason({ error, reasoning, finishReason }, { streamed, body } = {}) {
    if (error) return error;
    if (reasoning) {
      return finishReason === 'length'
        ? 'The model ran out of output tokens while still reasoning, before it wrote an answer.'
        : 'The model returned reasoning but no answer.';
    }
    if (finishReason) return `The model returned no text (finish_reason: ${finishReason}).`;
    if (streamed) return 'The LLM API stream ended without any reply text.';
    const snippet = String(body || '').trim().slice(0, 200);
    return snippet
      ? `The LLM API response had no reply in it: ${snippet}`
      : 'The LLM API returned an empty response.';
  }
}

module.exports = CodexAdapter;

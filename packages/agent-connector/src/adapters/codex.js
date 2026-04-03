/**
 * Codex adapter for OpenAgents workspace.
 *
 * Bridges OpenAI Codex CLI to an OpenAgents workspace via:
 * - Direct HTTP mode for OpenAI-compatible LLM APIs (when OPENAI_API_KEY set)
 * - Codex CLI subprocess (exec --json --full-auto) as fallback
 *
 * Direct port of Python: src/openagents/adapters/codex.py
 */

'use strict';

const fs = require('fs');
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
    this._codexThreadId = null;

    // Direct LLM API mode
    this._directApiKey = process.env.OPENAI_API_KEY || '';
    this._directBaseUrl = (process.env.OPENAI_BASE_URL || '').replace(/\/+$/, '');
    this._directModel = process.env.CODEX_MODEL || process.env.OPENCLAW_MODEL || '';
    this._directMode = !!(this._directApiKey && this._directBaseUrl);

    if (this._directMode) {
      this._log(`Direct LLM mode: ${this._directBaseUrl} model=${this._directModel || 'gpt-4o'}`);
    }

    // Conversation history
    this._conversationHistory = [];
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

    try {
      let responseText;
      if (this._directMode) {
        responseText = await this._callCompletionApi(content, msgChannel);
      } else {
        responseText = await this._runCodexSubprocess(content, msgChannel);
      }

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
      this._log(`Error handling message: ${e.message}`);
      await this.sendError(msgChannel, `Error processing message: ${e.message}`);
    }
  }

  // ------------------------------------------------------------------
  // Direct HTTP mode (OpenAI chat completions API)
  // ------------------------------------------------------------------

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
              }
            } catch {}
          }
        });
        res.on('end', () => resolve(fullText.trim()));
      });

      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  // ------------------------------------------------------------------
  // Subprocess mode (codex exec --json --full-auto)
  // ------------------------------------------------------------------

  _findCodexBinary() {
    try {
      if (IS_WINDOWS) {
        const r = execSync('where codex.cmd 2>nul || where codex.exe 2>nul || where codex 2>nul', {
          encoding: 'utf-8', timeout: 5000,
        });
        return r.split(/\r?\n/)[0].trim();
      } else {
        return execSync('which codex', { encoding: 'utf-8', timeout: 5000 }).trim();
      }
    } catch {
      return null;
    }
  }

  async _runCodexSubprocess(content, msgChannel) {
    const codexBin = this._findCodexBinary();
    if (!codexBin) {
      await this.sendError(msgChannel, 'codex CLI not found. Install with: npm install -g @openai/codex');
      return '';
    }

    const context = this._buildSystemContext(msgChannel);
    const fullPrompt = `${context}\n\n---\n\n${content}`;

    let cmd = [codexBin, 'exec'];
    if (this._codexThreadId) {
      cmd.push('resume', this._codexThreadId);
    }
    cmd.push('--json', '--full-auto', fullPrompt);

    if (IS_WINDOWS && cmd[0].toLowerCase().endsWith('.cmd')) {
      cmd = ['cmd.exe', '/c', ...cmd];
    }

    return new Promise((resolve) => {
      const proc = spawn(cmd[0], cmd.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const responseTexts = [];
      let lineBuffer = '';

      proc.stdout.on('data', async (chunk) => {
        lineBuffer += chunk.toString('utf-8');
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event;
          try { event = JSON.parse(trimmed); } catch { continue; }

          const eventType = event.type;

          if (eventType === 'thread.started') {
            if (event.thread_id) this._codexThreadId = event.thread_id;
          } else if (eventType === 'item.completed') {
            const item = event.item || {};
            if (item.type === 'agent_message' && item.text) {
              responseTexts.push(item.text);
            } else if (item.type === 'command_execution') {
              const cmdText = (item.command || '').slice(0, 200);
              try { await this.sendStatus(msgChannel, `**Running:** \`${cmdText}\``); } catch {}
            } else if (item.type === 'file_change') {
              try { await this.sendStatus(msgChannel, `**Editing:** \`${item.filename || ''}\``); } catch {}
            }
          } else if (eventType === 'turn.failed') {
            const error = event.error || {};
            this._log(`Codex turn failed: ${error.message || JSON.stringify(error)}`);
          }
        }
      });

      proc.on('exit', (code) => {
        if (code !== 0) {
          this._log(`Codex CLI exited with code ${code}`);
        }
        resolve(responseTexts.join('\n').trim());
      });

      proc.on('error', (err) => {
        this._log(`Codex spawn error: ${err.message}`);
        resolve('');
      });
    });
  }
}

module.exports = CodexAdapter;

/**
 * Direct LLM API adapter — shared base for NanoClaw and Cursor.
 *
 * Calls OpenAI-compatible chat completions API directly with SSE streaming.
 * No CLI binary needed — just OPENAI_API_KEY + OPENAI_BASE_URL.
 *
 * Port of Python: sdk/src/openagents/adapters/nanoclaw.py & cursor.py
 */

'use strict';

const https = require('https');
const http = require('http');

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt } = require('./utils');
const { buildOpenclawSystemPrompt } = require('./workspace-prompt');

const MAX_HISTORY = 50;

class LlmDirectAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   * @param {string} opts.adapterLabel - e.g. "NanoClaw" or "Cursor"
   * @param {string} opts.modelEnvVar - e.g. "NANOCLAW_MODEL" or "CURSOR_MODEL"
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();
    this._adapterLabel = opts.adapterLabel || 'LLM';
    this._modelEnvVar = opts.modelEnvVar || '';

    const env = this.agentEnv || process.env;
    this._apiKey = env.OPENAI_API_KEY || '';
    this._baseUrl = (env.OPENAI_BASE_URL || '').replace(/\/$/, '');
    this._model = env[this._modelEnvVar] || env.OPENCLAW_MODEL || '';
    this._directMode = !!(this._apiKey && this._baseUrl);

    if (this._directMode) {
      this._log(`Direct LLM mode: ${this._baseUrl} model=${this._model || 'gpt-4o'}`);
    } else {
      this._log(
        `${this._adapterLabel} adapter started without direct API config. ` +
        'Set OPENAI_API_KEY + OPENAI_BASE_URL for direct mode.'
      );
    }

    this._conversationHistory = [];
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

  async _handleMessage(msg) {
    let content = (msg.content || '').trim();
    const attachments = msg.attachments || [];

    const attText = formatAttachmentsForPrompt(attachments);
    if (attText) content = content ? content + attText : attText.trim();
    if (!content) return;

    const msgChannel = msg.sessionId || this.channelName;
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing message from ${sender} in ${msgChannel}: ${content.slice(0, 80)}...`);

    await this._autoTitleChannel(msgChannel, content);
    await this.sendStatus(msgChannel, 'thinking...');

    try {
      if (!this._directMode) {
        await this.sendError(
          msgChannel,
          `${this._adapterLabel} direct API mode not configured. Set OPENAI_API_KEY + OPENAI_BASE_URL.`
        );
        return;
      }

      const responseText = await this._callCompletionApi(content, msgChannel);

      if (responseText) {
        this._conversationHistory.push({ role: 'user', content });
        this._conversationHistory.push({ role: 'assistant', content: responseText });
        if (this._conversationHistory.length > MAX_HISTORY * 2) {
          this._conversationHistory = this._conversationHistory.slice(-MAX_HISTORY * 2);
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

  /**
   * Call OpenAI-compatible chat completions API with SSE streaming.
   */
  _callCompletionApi(userMessage, channel) {
    const systemPrompt = this._buildSystemPrompt(channel);

    const messages = [{ role: 'system', content: systemPrompt }];
    messages.push(...this._conversationHistory);
    messages.push({ role: 'user', content: userMessage });

    const url = `${this._baseUrl}/chat/completions`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this._apiKey}`,
    };
    const payload = JSON.stringify({
      model: this._model || 'gpt-4o',
      messages,
      stream: true,
    });

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const req = transport.request(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(payload) },
        timeout: 300000,
      }, (res) => {
        if (res.statusCode !== 200) {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => reject(new Error(`LLM API returned ${res.statusCode}: ${body.slice(0, 300)}`)));
          return;
        }

        let fullText = '';
        let lineBuf = '';

        res.on('data', (chunk) => {
          lineBuf += chunk.toString('utf-8');
          const lines = lineBuf.split('\n');
          lineBuf = lines.pop(); // keep incomplete line

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
      req.on('timeout', () => { req.destroy(); reject(new Error('LLM API request timed out')); });
      req.write(payload);
      req.end();
    });
  }
}

module.exports = LlmDirectAdapter;

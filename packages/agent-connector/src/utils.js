'use strict';

/**
 * Test an LLM connection by sending a minimal inference request.
 *
 * Supports OpenAI-compatible and Anthropic APIs.
 *
 * @param {object} env - Env vars (LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, etc.)
 * @returns {Promise<{success: boolean, model?: string, response?: string, error?: string}>}
 */
function testLLMConnection(env) {
  const https = require('https');
  const http = require('http');

  const hasKimiConfig = !!(env.KIMI_API_KEY || env.MOONSHOT_API_KEY || env.KIMI_BASE_URL || env.KIMI_MODEL);
  const apiKey = env.KIMI_API_KEY || env.MOONSHOT_API_KEY || env.LLM_API_KEY || env.OPENAI_API_KEY
    || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return Promise.resolve({ success: false, error: 'No API key provided' });

  let baseUrl = (env.KIMI_BASE_URL || env.LLM_BASE_URL || env.OPENAI_BASE_URL || (hasKimiConfig ? 'https://api.moonshot.ai/v1' : 'https://api.openai.com/v1')).replace(/\/$/, '');
  const model = env.KIMI_MODEL || env.LLM_MODEL || env.OPENCLAW_MODEL || '';
  // An agent configured the Anthropic way is Anthropic-shaped wherever it
  // points. Reading only the URL missed every relay whose host says nothing
  // about the protocol it speaks — the common case for Claude Code, which is
  // configured entirely through ANTHROPIC_* — and sent the test to OpenAI's
  // default endpoint with an Anthropic key.
  const hasAnthropicConfig = !hasKimiConfig && !env.LLM_API_KEY && !env.OPENAI_API_KEY
    && !!(env.ANTHROPIC_BASE_URL || env.ANTHROPIC_MODEL || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY);
  const isAnthropic = hasAnthropicConfig || baseUrl.includes('anthropic');

  if (!isAnthropic && !baseUrl.endsWith('/v1')) {
    baseUrl += '/v1';
  }

  return new Promise((resolve) => {
    let url, headers, body;

    if (isAnthropic) {
      // The configured endpoint, not the official one: a relay IS the API as
      // far as this agent is concerned, and testing api.anthropic.com would
      // report on a service the agent never talks to.
      const base = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
      url = /\/v1$/.test(base) ? `${base}/messages` : `${base}/v1/messages`;
      const token = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || apiKey;
      headers = {
        'x-api-key': token,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      };
      // Relays are split on which header they read, and Claude Code itself
      // sends the bearer when pointed at one. Only off the official host: the
      // real API has no use for it.
      if (!/api\.anthropic\.com$/.test(new URL(url).hostname)) {
        headers['authorization'] = `Bearer ${token}`;
      }
      body = JSON.stringify({
        model: env.ANTHROPIC_MODEL || model || 'claude-sonnet-4-20250514',
        max_tokens: 32,
        messages: [{ role: 'user', content: 'Say hi in 5 words.' }],
      });
    } else {
      url = baseUrl + '/chat/completions';
      headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };
      const requestBody = {
        model: model || (hasKimiConfig ? 'kimi-k2.6' : 'gpt-4o-mini'),
        messages: [{ role: 'user', content: 'Say hi in 5 words.' }],
      };
      if (hasKimiConfig) requestBody.max_tokens = 32;
      else requestBody.max_completion_tokens = 32;
      body = JSON.stringify(requestBody);
    }

    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === 'https:' ? https : http;

    const req = transport.request(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          let text, usedModel;
          if (isAnthropic) {
            text = (parsed.content || [{}])[0].text || '';
            usedModel = parsed.model || model || '?';
          } else {
            text = (parsed.choices || [{}])[0]?.message?.content || '';
            usedModel = parsed.model || model || '?';
          }
          if (res.statusCode >= 400) {
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${data.slice(0, 200)}` });
          } else {
            resolve({ success: true, model: usedModel, response: text.slice(0, 80) });
          }
        } catch {
          resolve({ success: false, error: `Invalid response: ${data.slice(0, 200)}` });
        }
      });
    });

    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Request timed out' }); });
    req.write(body);
    req.end();
  });
}

module.exports = { testLLMConnection };

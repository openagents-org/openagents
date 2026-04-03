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

  const apiKey = env.LLM_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return Promise.resolve({ success: false, error: 'No API key provided' });

  let baseUrl = (env.LLM_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = env.LLM_MODEL || env.OPENCLAW_MODEL || '';
  const isAnthropic = baseUrl.includes('anthropic');

  if (!isAnthropic && !baseUrl.endsWith('/v1')) {
    baseUrl += '/v1';
  }

  return new Promise((resolve) => {
    let url, headers, body;

    if (isAnthropic) {
      url = 'https://api.anthropic.com/v1/messages';
      headers = {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      };
      body = JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: 32,
        messages: [{ role: 'user', content: 'Say hi in 5 words.' }],
      });
    } else {
      url = baseUrl + '/chat/completions';
      headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };
      body = JSON.stringify({
        model: model || 'gpt-4o-mini',
        max_completion_tokens: 32,
        messages: [{ role: 'user', content: 'Say hi in 5 words.' }],
      });
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

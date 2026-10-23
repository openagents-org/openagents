'use strict';

/**
 * How many advertised models to try before giving up on an endpoint's list.
 * More than one because a gateway's list and what its backend actually serves
 * are not the same set — same rule as the launcher's LLM test.
 */
const MODEL_CANDIDATES = 4;

/** Catalogue entries that cannot answer a chat completion. */
const NON_CHAT_MODEL =
  /embed|whisper|tts|audio|dall-e|image|moderation|rerank|guard|transcribe|realtime|search|vision-preview/i;

/**
 * Vendors whose own default model is known-good, and whose `/models` list is
 * long, arbitrarily ordered and full of non-chat entries. Everything else (a
 * relay, a self-hosted gateway, the OpenAgents gateway) is asked what it serves.
 */
const VENDOR_HOSTS = /(^|\.)(openai\.com|moonshot\.ai|deepseek\.com|anthropic\.com|x\.ai|mistral\.ai)$/i;

/** An endpoint saying "I don't serve that model", in any of its dialects. */
const MODEL_REJECTED =
  /model.{0,60}?(is not available|does not exist|not found|unknown model|invalid model|no such model|not supported)|model_not_found/is;

/** One HTTP request. Resolves { status, data } or { error }; never rejects. */
function request(url, { method = 'POST', headers = {}, body = null, timeout = 15000 } = {}) {
  const https = require('https');
  const http = require('http');
  return new Promise((resolve) => {
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch (e) { resolve({ error: e.message }); return; }
    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const allHeaders = body ? { ...headers, 'Content-Length': Buffer.byteLength(body) } : headers;
    const req = transport.request(url, { method, headers: allHeaders, timeout }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Request timed out' }); });
    if (body) req.write(body);
    req.end();
  });
}

/**
 * The chat models an OpenAI-compatible endpoint says it serves, or [] when it
 * publishes no readable list. A list we cannot read is not a test failure —
 * the caller still has its default model to fall back on.
 */
async function servedModels(apiBase, headers) {
  const res = await request(`${apiBase}/models`, { method: 'GET', headers, timeout: 10000 });
  if (res.error || res.status >= 400) return [];
  try {
    const data = JSON.parse(res.data).data;
    if (!Array.isArray(data)) return [];
    const ids = [];
    for (const m of data) {
      const id = m && typeof m.id === 'string' ? m.id.trim() : '';
      if (id && !NON_CHAT_MODEL.test(id) && !ids.includes(id)) ids.push(id);
      if (ids.length >= MODEL_CANDIDATES) break;
    }
    return ids;
  } catch {
    return [];
  }
}

/** Read one completion response into the result shape. */
function completionResult(res, { isAnthropic, model }) {
  if (res.error) return { success: false, error: res.error };
  const { status, data } = res;
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
    if (status >= 400) return { success: false, error: `HTTP ${status}: ${data.slice(0, 200)}` };
    return { success: true, model: usedModel, response: text.slice(0, 80) };
  } catch {
    if (status >= 400) return { success: false, error: `HTTP ${status}: ${data.slice(0, 200)}` };
    return { success: false, error: `Invalid response: ${data.slice(0, 200)}` };
  }
}

/**
 * Test an LLM connection by sending a minimal inference request.
 *
 * Supports OpenAI-compatible and Anthropic APIs.
 *
 * @param {object} env - Env vars (LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, etc.)
 * @returns {Promise<{success: boolean, model?: string, response?: string, error?: string}>}
 */
async function testLLMConnection(env) {
  const hasKimiConfig = !!(env.KIMI_API_KEY || env.MOONSHOT_API_KEY || env.KIMI_BASE_URL || env.KIMI_MODEL);
  const apiKey = env.KIMI_API_KEY || env.MOONSHOT_API_KEY || env.LLM_API_KEY || env.OPENAI_API_KEY
    || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return { success: false, error: 'No API key provided' };

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

  if (isAnthropic) {
    // The configured endpoint, not the official one: a relay IS the API as
    // far as this agent is concerned, and testing api.anthropic.com would
    // report on a service the agent never talks to.
    const base = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
    const url = /\/v1$/.test(base) ? `${base}/messages` : `${base}/v1/messages`;
    const token = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || apiKey;
    const headers = {
      'x-api-key': token,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };
    // Relays are split on which header they read, and Claude Code itself
    // sends the bearer when pointed at one. Only off the official host: the
    // real API has no use for it.
    try {
      if (!/api\.anthropic\.com$/.test(new URL(url).hostname)) {
        headers['authorization'] = `Bearer ${token}`;
      }
    } catch {}
    const body = JSON.stringify({
      model: env.ANTHROPIC_MODEL || model || 'claude-sonnet-4-20250514',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'Say hi in 5 words.' }],
    });
    const res = await request(url, { headers, body });
    return completionResult(res, { isAnthropic: true, model });
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  // A blank model used to mean a hardcoded `gpt-4o-mini`, which exists only on
  // OpenAI itself: on a relay or the OpenAgents gateway the smoke test then
  // failed with "Model 'gpt-4o-mini' is not available" for an agent that
  // works. Ask a non-vendor endpoint what it serves first.
  const fallback = hasKimiConfig ? 'kimi-k2.6' : 'gpt-4o-mini';
  let candidates = [model];
  if (!model) {
    let host = '';
    try { host = new URL(baseUrl).hostname; } catch {}
    const listed = VENDOR_HOSTS.test(host) ? [] : await servedModels(baseUrl, headers);
    candidates = listed.includes(fallback) ? listed : listed.concat(fallback);
  }

  let last = null;
  for (const candidate of candidates) {
    const requestBody = {
      model: candidate,
      messages: [{ role: 'user', content: 'Say hi in 5 words.' }],
    };
    if (hasKimiConfig) requestBody.max_tokens = 32;
    else requestBody.max_completion_tokens = 32;
    const res = await request(`${baseUrl}/chat/completions`, { headers, body: JSON.stringify(requestBody) });
    last = completionResult(res, { isAnthropic: false, model: candidate });
    if (last.success) return last;
    // Only a model WE picked moves on to the next one. A configured model is
    // sent as configured and its rejection reported as-is.
    if (model || res.error || !MODEL_REJECTED.test(res.data || '')) return last;
  }
  return last;
}

module.exports = { testLLMConnection };

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

const crypto = require('crypto');
const { networkErrorText } = require('./adapters/utils');

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
    req.on('error', (e) => resolve({ error: networkErrorText(e) }));
    // Name the host and the deadline: a bare "Request timed out" on the
    // device card did not say whether the provider or the network was slow.
    req.on('timeout', () => { req.destroy(); resolve({ error: `Request to ${parsedUrl.host} timed out after ${Math.round(timeout / 1000)}s` }); });
    if (body) req.write(body);
    req.end();
  });
}

/**
 * The test completion. 15s read as broken a slow relay that answers in 20, and
 * a dropped connection failed the whole test: give it 30s and one more try on
 * a timeout or reset. A host that does not resolve is not retried.
 */
const COMPLETION_TIMEOUT_MS = 30000;
const RETRYABLE = /timed out|econnreset|socket hang up|eai_again/i;

async function requestCompletion(url, opts) {
  const res = await request(url, { ...opts, timeout: COMPLETION_TIMEOUT_MS });
  if (!res.error || !RETRYABLE.test(res.error)) return res;
  return request(url, { ...opts, timeout: COMPLETION_TIMEOUT_MS });
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

/**
 * The test asks for a few tokens to stay cheap. A reasoning model can spend
 * them all thinking, and OpenAI then refuses with "Could not finish the message
 * because max_tokens or model output limit was reached". The key and the model
 * were both accepted, which is everything this test checks, and reporting it as
 * a failure marked an agent that works as broken.
 */
const OUTPUT_LIMIT_REACHED = /max_tokens or model output limit was reached/i;

/** Read one completion response into the result shape. */
function completionResult(res, { isAnthropic, model }) {
  if (res.error) return { success: false, error: res.error };
  const status = res.status;
  const data = String(res.data == null ? '' : res.data);
  if (status >= 400 && OUTPUT_LIMIT_REACHED.test(data || '')) {
    return { success: true, model: model || '?', response: '' };
  }
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
 * The one field the Responses test adds that the Codex CLI does not send
 * (codex-api's ResponsesApiRequest has no such field): it caps what the test
 * costs. An endpoint refusing it says nothing about the agent, so the test
 * asks again without it.
 */
const PROBE_ONLY_FIELD = 'max_output_tokens';

/**
 * The Responses API test, sent the way the Codex CLI sends every turn:
 * streamed, `store: false`, `client_metadata`, the input as message items. A
 * relay that refuses one of those ("Unsupported Responses request
 * parameter", param client_metadata) passed a plain chat/completions test
 * and then failed every message; one that only streams failed a non-streamed
 * test and then chatted fine.
 *
 * @returns {Promise<{ res: object, result: object }>} the last raw response and its reading
 */
async function requestResponses(url, headers, model) {
  const body = {
    model,
    stream: true,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Say hi in 5 words.' }] }],
    store: false,
    client_metadata: { session_id: crypto.randomUUID() },
    [PROBE_ONLY_FIELD]: 16,
  };
  const send = () => requestCompletion(url, {
    headers: { ...headers, Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  const res = await send();
  const { result, refusal } = readResponses(res, model);
  // The field the refusal names, or — when it names none — its text.
  const refused = refusal && (refusal.param ? refusal.param === PROBE_ONLY_FIELD : refusal.text.includes(PROBE_ONLY_FIELD));
  if (!refused) return { res, result };
  delete body[PROBE_ONLY_FIELD];
  const again = await send();
  return { res: again, result: readResponses(again, model).result };
}

/**
 * Read a streamed Responses reply the way the Codex CLI reads it: good once
 * `response.completed` arrives — or `response.incomplete`, the cap this test
 * sets — bad on `response.failed` or an `error` event. A stream that ends
 * before either fails the CLI's turn too ("stream closed before
 * response.completed"), and so does a single JSON body in place of a stream.
 *
 * @returns {{ result: object, refusal: { param: string, text: string } | null }}
 *   the reading, and — only for an HTTP error or a failed/error event — what
 *   the endpoint refused, whole: the field it names (`param`, '' when it
 *   names none) and its full text. Never read off anything else: a stream's
 *   response.created event, and a JSON body, echo the request's own fields.
 */
function readResponses(res, model) {
  if (res.error) return { result: { success: false, error: res.error }, refusal: null };
  const data = String(res.data == null ? '' : res.data);
  if (res.status >= 400) {
    let param = '';
    try {
      const parsed = JSON.parse(data);
      param = String((parsed.error && parsed.error.param) || parsed.param || '');
    } catch {}
    return { result: { success: false, error: `HTTP ${res.status}: ${data.slice(0, 200)}` }, refusal: { param, text: data } };
  }
  let text = '';
  for (const line of data.split(/\r?\n/)) {
    const m = /^data:\s?(.*)$/.exec(line);
    if (!m) continue;
    let evt;
    try { evt = JSON.parse(m[1]); } catch { continue; }
    const type = evt && evt.type;
    if (type === 'response.output_text.delta' && typeof evt.delta === 'string') {
      text += evt.delta;
    } else if (type === 'response.completed' || type === 'response.incomplete') {
      const result = { success: true, model: (evt.response && evt.response.model) || model || '?', response: text.slice(0, 80) };
      return { result, refusal: null };
    } else if (type === 'response.failed' || type === 'error') {
      const err = (evt.response && evt.response.error) || evt.error || evt;
      // param and code first, so a long message is what the cut drops: the
      // probe reads the refused field off this text (probe.js refusedParam).
      const shown = JSON.stringify({ param: err.param, code: err.code, ...err }).slice(0, 200);
      return {
        result: { success: false, error: `${type}: ${shown}` },
        refusal: { param: String(err.param || ''), text: JSON.stringify(err) },
      };
    }
  }
  if (/^\s*[{[]/.test(data)) {
    return { result: { success: false, error: `Answered with a JSON body, not the event stream the Codex CLI reads: ${data.slice(0, 200)}` }, refusal: null };
  }
  return { result: { success: false, error: `Stream ended before response.completed: ${data.slice(0, 200)}` }, refusal: null };
}

/**
 * Test an LLM connection by sending a minimal inference request.
 *
 * Supports OpenAI-compatible and Anthropic APIs.
 *
 * @param {object} env - Env vars (LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, etc.)
 * @param {object} [opts]
 * @param {string} [opts.model] - The model the agent runs on, when the caller
 *   knows it. Each type keeps it under its own variable (CODEX_MODEL,
 *   ANTHROPIC_MODEL), which `env` alone does not say; see agent-model.js.
 * @param {string} [opts.baseUrl] - The endpoint, when the caller knows it from
 *   a variable of the agent's own (DEEPSEEK_BASE_URL); see probe.js.
 * @param {'anthropic'|'openai'|'responses'} [opts.protocol] - The API to speak,
 *   when the agent's config names it (Pi's PI_API_FORMAT, Codex's
 *   CODEX_WIRE_API) rather than its env shape. 'responses' is OpenAI's
 *   Responses API, asked the way the Codex CLI asks it (see below).
 * @returns {Promise<{success: boolean, model?: string, response?: string, error?: string}>}
 */
async function testLLMConnection(env, opts = {}) {
  const hasKimiConfig = !!(env.KIMI_API_KEY || env.MOONSHOT_API_KEY || env.KIMI_BASE_URL || env.KIMI_MODEL);
  const apiKey = env.KIMI_API_KEY || env.MOONSHOT_API_KEY || env.LLM_API_KEY || env.OPENAI_API_KEY
    || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return { success: false, error: 'No API key provided' };

  let baseUrl = (opts.baseUrl || env.KIMI_BASE_URL || env.LLM_BASE_URL || env.OPENAI_BASE_URL || (hasKimiConfig ? 'https://api.moonshot.ai/v1' : 'https://api.openai.com/v1')).replace(/\/$/, '');
  const model = String(opts.model || env.KIMI_MODEL || env.LLM_MODEL || env.OPENCLAW_MODEL || '').trim();
  // An agent configured the Anthropic way is Anthropic-shaped wherever it
  // points. Reading only the URL missed every relay whose host says nothing
  // about the protocol it speaks — the common case for Claude Code, which is
  // configured entirely through ANTHROPIC_* — and sent the test to OpenAI's
  // default endpoint with an Anthropic key.
  const hasAnthropicConfig = !hasKimiConfig && !env.LLM_API_KEY && !env.OPENAI_API_KEY
    && !!(env.ANTHROPIC_BASE_URL || env.ANTHROPIC_MODEL || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY);
  const isAnthropic = opts.protocol
    ? opts.protocol === 'anthropic'
    : hasAnthropicConfig || baseUrl.includes('anthropic');

  const isResponses = opts.protocol === 'responses';
  // The Codex CLI calls <base_url>/responses on the URL as configured
  // (adapters/codex.js): an endpoint at /codex answered /codex/responses and
  // 404'd the /codex/v1/responses this used to test.
  if (isResponses) baseUrl = baseUrl.replace(/\/+$/, '');
  else if (!isAnthropic && !baseUrl.endsWith('/v1')) {
    baseUrl += '/v1';
  }

  if (isAnthropic) {
    // The configured endpoint, not the official one: a relay IS the API as
    // far as this agent is concerned, and testing api.anthropic.com would
    // report on a service the agent never talks to.
    // The caller's endpoint first, then the generic one: a relay named only
    // in LLM_BASE_URL was skipped for the official host.
    const base = (opts.baseUrl || env.ANTHROPIC_BASE_URL || env.LLM_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
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
      // Only for an agent with no model set. claude-sonnet-4-20250514 was the
      // default here and Anthropic retired it on 2026-06-15: the test then
      // failed with a 404 "not_found_error" for a key that works. Any 200 is
      // a pass, so a reply that is all thinking within 32 tokens still counts.
      model: env.ANTHROPIC_MODEL || model || 'claude-sonnet-5-5',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'Say hi in 5 words.' }],
    });
    const res = await requestCompletion(url, { headers, body });
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
    let res;
    if (isResponses) {
      ({ res, result: last } = await requestResponses(`${baseUrl}/responses`, headers, candidate));
    } else {
      const requestBody = {
        model: candidate,
        messages: [{ role: 'user', content: 'Say hi in 5 words.' }],
      };
      if (hasKimiConfig) requestBody.max_tokens = 32;
      else requestBody.max_completion_tokens = 32;
      res = await requestCompletion(`${baseUrl}/chat/completions`, { headers, body: JSON.stringify(requestBody) });
      last = completionResult(res, { isAnthropic: false, model: candidate });
    }
    if (last.success) return last;
    // Only a model WE picked moves on to the next one. A configured model is
    // sent as configured and its rejection reported as-is.
    if (model || res.error || !MODEL_REJECTED.test(res.data || '')) return last;
  }
  return last;
}

module.exports = { testLLMConnection };

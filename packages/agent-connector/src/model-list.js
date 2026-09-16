'use strict';

/**
 * Ask an OpenAI- or Anthropic-compatible endpoint which models it serves.
 *
 * The daemon answers the workspace's `list_models` command with this, so the
 * model picker offers what the agent's relay actually has, and the key the
 * request needs never leaves the device. Mirrors the launcher's
 * model-catalog listOpenAiModels / listAnthropicModels.
 */

const MAX_MODELS = 300;

/** The one line worth showing from an error body (relays nest it in JSON). */
function briefError(text) {
  try {
    const j = JSON.parse(text);
    const msg = typeof j.error === 'string' ? j.error : j.error && j.error.message;
    const line = String(msg || j.message || '').trim();
    if (line) return line.slice(0, 160);
  } catch {}
  return String(text || '').trim().slice(0, 160);
}

function isOfficialAnthropic(url) {
  return url.hostname.toLowerCase() === 'api.anthropic.com';
}

/** `{data: [...]}`, a bare array, or a relay's `{models: [...]}`; ids deduped and sorted. */
function parseModels(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return []; }
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed && (parsed.data || parsed.models)) || [];
  if (!Array.isArray(list)) return [];
  const seen = new Map();
  for (const entry of list) {
    const id = String(typeof entry === 'string' ? entry : (entry && entry.id) || '').trim();
    if (!id || seen.has(id)) continue;
    const label = entry && typeof entry === 'object' && typeof entry.display_name === 'string'
      ? entry.display_name.trim()
      : '';
    seen.set(id, { id, label: label || id });
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_MODELS);
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl   The base URL the agent's CLI is pointed at.
 * @param {string} opts.apiKey
 * @param {string} [opts.protocol] 'anthropic', or OpenAI-compatible (default).
 * @returns {Promise<{models: {id: string, label: string}[], error?: string}>}
 */
async function listEndpointModels({ baseUrl, apiKey, protocol = 'openai', fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl) ? baseUrl : `http://${baseUrl}`);
  } catch {
    return { models: [], error: 'The configured base URL is not a valid URL.' };
  }
  if (!apiKey) return { models: [], error: 'No API key is configured for this agent.' };

  const headers = { Accept: 'application/json' };
  let path = url.pathname.replace(/\/+$/, '');
  if (protocol === 'anthropic') {
    // Official takes x-api-key; relays only ever honor a bearer token.
    if (isOfficialAnthropic(url)) headers['x-api-key'] = apiKey;
    else headers.Authorization = `Bearer ${apiKey}`;
    headers['anthropic-version'] = '2023-06-01';
    path = `${path.replace(/\/v1$/, '')}/v1/models`;
    url.search = '?limit=100';
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
    // A bare host means the /v1 API; a path (…/v1, …/v1beta/openai) is used as given.
    path = `${path || '/v1'}/models`;
    url.search = '';
  }
  url.pathname = path;
  url.username = '';
  url.password = '';

  let res;
  let text;
  try {
    res = await fetchImpl(url.toString(), { headers, signal: AbortSignal.timeout(timeoutMs) });
    text = await res.text();
  } catch (e) {
    const reason = e && e.name === 'TimeoutError' ? 'the endpoint did not answer in time' : (e && e.message) || String(e);
    return { models: [], error: `Could not reach ${url.host}: ${reason}` };
  }
  if (res.status >= 400) {
    return { models: [], error: `HTTP ${res.status}: ${briefError(text)}` };
  }
  const models = parseModels(text);
  return models.length ? { models } : { models: [], error: 'The endpoint listed no models.' };
}

module.exports = { listEndpointModels, parseModels };

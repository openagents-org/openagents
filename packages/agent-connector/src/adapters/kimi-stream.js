/**
 * Pure, side-effect-free helpers for the Kimi Code CLI adapter.
 *
 * Everything here is I/O-free and deterministic so it can be unit-tested
 * without spawning the `kimi` binary or touching the network: the JSONL
 * stream parser, the message interpreter, secret redaction, error/version
 * classification, the argument builder, and the env mapping that turns the
 * launcher's KIMI_* fields into the CLI's KIMI_MODEL_* provider variables.
 *
 * Verified against Kimi Code CLI v0.39.1 (`kimi -p --output-format
 * stream-json`). The stream is JSONL on stdout where each line is a message:
 *   {role:"assistant", content, tool_calls?:[{type:"function",id,function:{name,arguments}}]}
 *   {role:"tool", tool_call_id, content}
 *   {role:"meta", type:"system.version", version}
 *   {role:"meta", type:"session.resume_hint", session_id, command, content}
 *   {role:"meta", type:"turn.step.retrying", failed_attempt, next_attempt,
 *                 max_attempts, delay_ms, error_name, error_message}
 * Fatal errors arrive on stderr as `error: ...` lines. Exit codes: 0 success,
 * 1 permanent failure (config/auth/quota), 75 transient (retryable).
 *
 * IMPORTANT product distinction: two Moonshot products install a `kimi`
 * binary. Kimi Code CLI (npm `@moonshot-ai/kimi-code`) versions are 0.x;
 * the legacy Python `kimi-cli` (PyPI) is 1.x and has a DIFFERENT headless
 * interface. A 1.x `kimi --version` therefore means the WRONG product.
 */

'use strict';

// ---------------------------------------------------------------------------
// Version / product classification
// ---------------------------------------------------------------------------

/** Pull a dotted version (e.g. "0.39.1") out of `kimi --version` output. */
function parseKimiVersion(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)(?:[-.][0-9A-Za-z.]+)?/);
  return m ? m[0] : null;
}

/**
 * Classify `kimi --version` output into a product identity.
 * @returns {{version: string|null, product: 'kimi-code'|'legacy'|null}}
 *   'kimi-code' → the real Kimi Code CLI (0.x) this adapter drives
 *   'legacy'    → the wound-down Python kimi-cli (1.x) — incompatible
 *   null        → undetermined (unparseable output); proceed leniently
 */
function classifyKimiVersion(rawVersion) {
  const version = parseKimiVersion(rawVersion);
  if (!version) return { version: null, product: null };
  const major = parseInt(version.split('.')[0], 10);
  return { version, product: major === 0 ? 'kimi-code' : 'legacy' };
}

// ---------------------------------------------------------------------------
// Secret redaction (same patterns as the other CLI adapters)
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9._-]{8,}\b/g,
  /\b(?:or|rk|gsk|ghp|gho|ghu|ghs|github_pat)[-_][A-Za-z0-9._-]{12,}\b/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

/** Redact obvious secret material from a free-text string. */
function redactSecrets(text) {
  if (text == null) return text;
  let out = String(text);
  for (const re of SECRET_PATTERNS) out = out.replace(re, '«redacted»');
  return out;
}

/** Redact an argv array for logging. The prompt (arg after -p) is elided. */
function redactArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-p' || a === '--prompt') {
      out.push(a, '«prompt»');
      i++;
      continue;
    }
    out.push(redactSecrets(a));
  }
  return out;
}

// ---------------------------------------------------------------------------
// JSONL stream parser
// ---------------------------------------------------------------------------

/** Line-buffered JSONL parser. push() returns complete parsed messages. */
class KimiStreamParser {
  constructor() {
    this._buf = '';
  }

  /** @param {Buffer|string} chunk @returns {object[]} parsed messages */
  push(chunk) {
    this._buf += chunk.toString('utf-8');
    const lines = this._buf.split('\n');
    this._buf = lines.pop();
    return parseLines(lines);
  }

  /** Flush any trailing partial line. */
  flush() {
    const rest = this._buf;
    this._buf = '';
    return parseLines([rest]);
  }
}

function parseLines(lines) {
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj === 'object') out.push(obj);
    } catch {
      // Partial or non-JSON diagnostic line — skip.
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Message interpretation
// ---------------------------------------------------------------------------

/** Flatten a message `content` (string or array of text blocks) to a string. */
function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && typeof b.text === 'string' ? b.text : ''))
      .join('');
  }
  return '';
}

// Argument keys worth surfacing in a tool-status preview, best first.
const PREVIEW_KEYS = ['command', 'path', 'file_path', 'pattern', 'url', 'query', 'prompt', 'description'];

/** A short, redacted human preview for a tool call's JSON arguments. */
function toolPreview(argsJson) {
  let args;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return '';
  }
  if (!args || typeof args !== 'object') return '';
  for (const key of PREVIEW_KEYS) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) {
      const one = redactSecrets(v.replace(/\s+/g, ' ').trim());
      return one.length > 80 ? one.slice(0, 80) + '…' : one;
    }
  }
  return '';
}

/**
 * Map one parsed stream message to zero or more adapter events:
 *   {kind:'text', text}                       assistant prose
 *   {kind:'tool_start', name, preview}        a tool call was issued
 *   {kind:'tool_result', id, text}            a tool finished
 *   {kind:'session', sessionId}               resume hint (inline session id)
 *   {kind:'retrying', attempt, maxAttempts, message}  provider retry
 *   {kind:'version', version}                 stream preamble
 */
function interpretKimiMessage(msg) {
  if (!msg || typeof msg !== 'object') return [];
  const events = [];

  if (msg.role === 'assistant') {
    const text = contentText(msg.content).trim();
    if (text) events.push({ kind: 'text', text });
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const fn = tc && typeof tc === 'object' ? tc.function : null;
        const name = fn && typeof fn.name === 'string' ? fn.name : 'tool';
        events.push({ kind: 'tool_start', name, preview: toolPreview(fn && fn.arguments) });
      }
    }
    return events;
  }

  if (msg.role === 'tool') {
    events.push({
      kind: 'tool_result',
      id: typeof msg.tool_call_id === 'string' ? msg.tool_call_id : '',
      text: contentText(msg.content),
    });
    return events;
  }

  if (msg.role === 'meta') {
    if (msg.type === 'session.resume_hint' && typeof msg.session_id === 'string' && msg.session_id) {
      events.push({ kind: 'session', sessionId: msg.session_id });
    } else if (msg.type === 'turn.step.retrying') {
      events.push({
        kind: 'retrying',
        attempt: typeof msg.failed_attempt === 'number' ? msg.failed_attempt : 0,
        maxAttempts: typeof msg.max_attempts === 'number' ? msg.max_attempts : 0,
        message: typeof msg.error_message === 'string' ? redactSecrets(msg.error_message) : '',
      });
    } else if (msg.type === 'system.version') {
      events.push({ kind: 'version', version: typeof msg.version === 'string' ? msg.version : '' });
    }
    return events;
  }

  return events;
}

// ---------------------------------------------------------------------------
// Argument + environment builders
// ---------------------------------------------------------------------------

/**
 * Build the argv for one non-interactive run. Print mode (`-p`) already
 * auto-approves tools — the CLI REJECTS combining it with --yolo/--auto/--plan
 * (verified v0.39.1), so permission/plan flags must never be added here.
 */
function buildKimiArgs({ prompt, sessionId }) {
  const args = [];
  if (sessionId) args.push('-S', sessionId);
  args.push('-p', prompt, '--output-format', 'stream-json');
  return args;
}

const DEFAULT_KIMI_MODEL = 'kimi-k2.6';
// The CLI defaults max_completion_tokens to the model's full context size
// (262144), which OpenAI-compatible gateways reject (input+output > context).
// A fixed, generous output budget works against both Moonshot and gateways.
const DEFAULT_MAX_COMPLETION_TOKENS = '32768';

/**
 * Map the launcher's saved KIMI_* fields onto the env-var provider contract of
 * Kimi Code CLI: setting KIMI_MODEL_NAME synthesizes an in-memory provider
 * from KIMI_MODEL_API_KEY (required) + KIMI_MODEL_BASE_URL +
 * KIMI_MODEL_PROVIDER_TYPE, bypassing `kimi login`.
 *
 * With no API key configured, the env is passed through untouched so the
 * CLI's own `kimi login` credentials / config.toml apply.
 *
 * @returns {{env: object, viaEnvProvider: boolean}}
 */
function buildKimiEnv(agentEnv) {
  const env = { ...(agentEnv || {}) };
  const apiKey =
    env.KIMI_MODEL_API_KEY ||
    env.KIMI_API_KEY ||
    env.MOONSHOT_API_KEY ||
    '';
  if (!apiKey) return { env, viaEnvProvider: false };

  env.KIMI_MODEL_API_KEY = apiKey;
  if (!env.KIMI_MODEL_NAME) env.KIMI_MODEL_NAME = env.KIMI_MODEL || DEFAULT_KIMI_MODEL;
  const baseUrl = env.KIMI_MODEL_BASE_URL || env.KIMI_BASE_URL;
  if (baseUrl) env.KIMI_MODEL_BASE_URL = baseUrl.replace(/\/$/, '');
  if (!env.KIMI_MODEL_PROVIDER_TYPE) env.KIMI_MODEL_PROVIDER_TYPE = 'kimi';
  if (!env.KIMI_MODEL_MAX_COMPLETION_TOKENS) {
    env.KIMI_MODEL_MAX_COMPLETION_TOKENS = DEFAULT_MAX_COMPLETION_TOKENS;
  }
  return { env, viaEnvProvider: true };
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

// Kimi Code CLI's documented exit codes.
const EXIT_PERMANENT = 1;
const EXIT_TRANSIENT = 75;

/** Extract the message from `error: ...` lines on stderr (last one wins). */
function extractStderrError(stderrText) {
  if (!stderrText) return '';
  let last = '';
  for (const line of String(stderrText).split('\n')) {
    const m = line.match(/^\s*error:\s*(.+)$/i);
    if (m) last = m[1].trim();
  }
  // Strip the CLI's wrapper prefix so the user sees the actual cause.
  return redactSecrets(last.replace(/^failed to run prompt:\s*/i, ''));
}

/**
 * Classify a failed run into a user-facing message.
 * @param {{code: number|null, signal: string|null, stderrText: string, retryMessage: string}} info
 * @returns {{kind: string, userMessage: string}}
 */
function classifyKimiError(info) {
  const { code, signal, stderrText, retryMessage } = info || {};
  const detail = extractStderrError(stderrText) || redactSecrets(retryMessage || '');

  if (/auth_error|401|unauthorized|invalid.{0,20}(api.?key|token)|credential/i.test(detail)) {
    return {
      kind: 'auth',
      userMessage:
        'Kimi authentication failed. Check KIMI_API_KEY in the launcher, or run `kimi login` in a terminal.' +
        (detail ? `\n\nDetails: ${detail}` : ''),
    };
  }
  if (/no model configured|llm not set|kimi_model_api_key is missing/i.test(detail)) {
    return {
      kind: 'config',
      userMessage:
        'Kimi Code CLI is not configured. Set KIMI_API_KEY (plus optional KIMI_BASE_URL / KIMI_MODEL) ' +
        'in the launcher, or run `kimi login` in a terminal.',
    };
  }
  if (/rate.?limit|429|quota|insufficient.{0,20}balance/i.test(detail)) {
    return {
      kind: 'rate_limit',
      userMessage: `Kimi hit a rate/quota limit. Please retry shortly.${detail ? `\n\nDetails: ${detail}` : ''}`,
    };
  }
  if (/context length|maximum context|too many tokens/i.test(detail)) {
    return {
      kind: 'context',
      userMessage: `The request exceeded the model's context limits.${detail ? `\n\nDetails: ${detail}` : ''}`,
    };
  }
  if (code === EXIT_TRANSIENT) {
    return {
      kind: 'transient',
      userMessage: `Kimi hit a temporary provider error — please try again.${detail ? `\n\nDetails: ${detail}` : ''}`,
    };
  }
  if (detail) {
    return { kind: 'error', userMessage: `Kimi failed: ${detail}` };
  }
  const why = signal ? `terminated by signal ${signal}` : `exited with code ${code}`;
  return { kind: 'error', userMessage: `Kimi Code CLI ${why}.` };
}

module.exports = {
  parseKimiVersion,
  classifyKimiVersion,
  redactSecrets,
  redactArgs,
  KimiStreamParser,
  interpretKimiMessage,
  contentText,
  toolPreview,
  buildKimiArgs,
  buildKimiEnv,
  extractStderrError,
  classifyKimiError,
  DEFAULT_KIMI_MODEL,
  DEFAULT_MAX_COMPLETION_TOKENS,
  EXIT_PERMANENT,
  EXIT_TRANSIENT,
};

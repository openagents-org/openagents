'use strict';

/**
 * Pure helpers for the Antigravity CLI (agy) adapter — argv construction,
 * stream-json event interpretation, and failure classification. No I/O and no
 * process state, so every branch is unit-testable (see
 * test/antigravity-stream.test.js).
 *
 * agy's headless protocol (`--output-format stream-json`) is NDJSON with an
 * `event` field per line: exactly one `init`, any number of `step_update`,
 * exactly one `result`. That differs from the old Gemini CLI stream (`type`
 * field, `message`/`tool_use` events), which is why this is a new module
 * rather than a tweak to the gemini adapter.
 */

/** Build the argv tail (everything after the binary) for one headless run. */
function buildAgyArgv({ prompt, model, conversationId, skipResume = false } = {}) {
  const args = [
    '-p', prompt || '',
    // Counterpart of gemini's `-y`: headless runs have no interactive
    // approval prompt, and a soft-denied tool call silently degrades the
    // answer. The daemon is the approval boundary here, same as every other
    // CLI adapter.
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
  ];
  if (model) args.push('--model', model);
  if (conversationId && !skipResume) args.push('--conversation', conversationId);
  return args;
}

/** Parse one NDJSON line. Returns the event object, or null for non-events. */
function parseAgyEvent(line) {
  const trimmed = (line || '').trim();
  if (!trimmed) return null;
  let obj;
  try { obj = JSON.parse(trimmed); } catch { return null; }
  if (!obj || typeof obj !== 'object' || typeof obj.event !== 'string') return null;
  return obj;
}

/** One-line preview of a tool call's parameters for the status ticker. */
function toolPreview(parameters) {
  if (!parameters || typeof parameters !== 'object') return '';
  // agy uses PascalCase parameter names (e.g. CommandLine); check both.
  const pick = (...names) => {
    for (const n of names) {
      const v = parameters[n];
      if (typeof v === 'string' && v) return v;
    }
    return null;
  };
  return (
    pick('CommandLine', 'command') ||
    pick('AbsolutePath', 'file_path', 'path') ||
    pick('Query', 'query', 'pattern') ||
    JSON.stringify(parameters).slice(0, 150)
  );
}

/**
 * Reducer over one run's event stream. `consume(event)` returns display
 * actions for the adapter to translate into workspace calls:
 *
 *   {type:'conversation', id}          — persist for --conversation resume
 *   {type:'thinking', text}            — a finished agent_response block
 *   {type:'tool', name, preview}       — a tool step began
 *   {type:'result', status, response, error}
 *
 * `finalResponse()` afterwards yields the text to post: the result envelope's
 * `response` when present (authoritative), else the last completed
 * agent_response block — mirroring the gemini adapter's "text after the last
 * tool use" semantics for streams that die before their result event.
 */
class AgyRunState {
  constructor() {
    this.conversationId = null;
    this.status = null;
    this.error = null;
    this._resultResponse = '';
    this._blocks = [];       // completed agent_response texts since last tool
    this._pending = '';      // text_delta accumulator for the ACTIVE block
    this._toolSteps = new Set(); // step_index values already announced
  }

  consume(event) {
    if (!event || typeof event !== 'object') return [];
    const actions = [];

    if (event.event === 'init') {
      if (event.conversation_id) {
        this.conversationId = event.conversation_id;
        actions.push({ type: 'conversation', id: event.conversation_id });
      }
      return actions;
    }

    if (event.event === 'step_update') {
      const step = event.step_update || {};
      if (step.step_type === 'agent_response') {
        if (typeof step.text_delta === 'string') this._pending += step.text_delta;
        if (step.state === 'DONE') {
          const text = this._pending.trim();
          this._pending = '';
          if (text) {
            this._blocks.push(text);
            actions.push({ type: 'thinking', text });
          }
        }
      } else if (step.step_type === 'tool') {
        // Announce each tool step once, on first sight — agy repeats the step
        // across ACTIVE/DONE updates.
        const key = step.step_index != null ? step.step_index : `t${this._toolSteps.size}`;
        if (!this._toolSteps.has(key)) {
          this._toolSteps.add(key);
          const info = step.tool_info || {};
          const name = info.name || step.tool_name || 'tool';
          actions.push({ type: 'tool', name, preview: toolPreview(info.parameters) });
          // A tool ran: any text before it was narration, not the answer.
          this._blocks = [];
        }
      }
      return actions;
    }

    if (event.event === 'result') {
      const result = event.result || {};
      if (result.conversation_id && !this.conversationId) {
        this.conversationId = result.conversation_id;
        actions.push({ type: 'conversation', id: result.conversation_id });
      }
      this.status = result.status || null;
      this.error = result.error || null;
      if (typeof result.response === 'string') this._resultResponse = result.response;
      actions.push({
        type: 'result',
        status: this.status,
        response: this._resultResponse,
        error: this.error,
      });
      return actions;
    }

    return actions;
  }

  /** True once the stream produced any user-visible text. */
  sawText() {
    return this._blocks.length > 0 || !!this._resultResponse.trim();
  }

  finalResponse() {
    const fromResult = this._resultResponse.trim();
    if (fromResult) return fromResult;
    // Stream died before its result event — fall back to the accumulated
    // agent_response text (plus any half-flushed delta).
    return [...this._blocks, this._pending.trim()].filter(Boolean).join('\n\n').trim();
  }
}

const AUTH_RE = /authentication (required|failed)|not authenticated|sign[ -]?in|log[ -]?in required|no valid credentials|GEMINI_API_KEY/i;
const PROVIDER_RE = /modelProvider|model provider/i;
const MODEL_RE = /unknown model|invalid model/i;
const TIMEOUT_RE = /print-timeout|timed? ?out/i;

/**
 * Turn a failed run (non-zero exit, or a result event with status ERROR) into
 * a { kind, message } the adapter can post verbatim. This is the fix for the
 * "No response generated. Please try again." dead end: the real reason was in
 * stderr all along, so surface it.
 */
function classifyAgyFailure({ code, stderr, error } = {}) {
  // The docs describe `result.error` as {type, message}; agy 1.1.17 actually
  // emits a plain string ("authentication failed or timed out"). Take both.
  const err = error && typeof error === 'object' ? error : {};
  const errText =
    typeof error === 'string' ? error : [err.type, err.message].filter(Boolean).join(' ');
  const text = [errText, stderr].filter(Boolean).join('\n');

  if (AUTH_RE.test(text)) {
    return {
      kind: 'auth',
      message:
        'Antigravity CLI needs authentication. Run `agy` once in a terminal to ' +
        'sign in with Google, or set GEMINI_API_KEY for this agent (the ' +
        'connector configures the provider automatically).',
    };
  }
  if (PROVIDER_RE.test(text)) {
    return {
      kind: 'config',
      message:
        'Antigravity CLI is configured for API-key auth but no key is set. ' +
        'Set GEMINI_API_KEY for this agent, or remove "modelProvider" from ' +
        '~/.gemini/antigravity-cli/settings.json to use Google sign-in.',
    };
  }
  if (MODEL_RE.test(text)) {
    return {
      kind: 'model',
      message:
        'Antigravity CLI rejected the configured model. Check ANTIGRAVITY_MODEL ' +
        '(list valid slugs with `agy models`).',
    };
  }
  if (TIMEOUT_RE.test(text)) {
    return { kind: 'timeout', message: 'Antigravity CLI timed out before producing a response.' };
  }
  const detail = (errText || (stderr || '').trim().split('\n').pop() || '').slice(0, 200);
  return {
    kind: 'unknown',
    message: detail
      ? `Antigravity CLI failed (exit ${code ?? '?'}): ${detail}`
      : `Antigravity CLI exited with code ${code ?? '?'} without a response.`,
  };
}

/**
 * Filesystem candidates for the agy binary, beyond a PATH lookup. The install
 * script targets ~/.local/bin on macOS/Linux and %LOCALAPPDATA%\agy\bin on
 * Windows. Pure: the adapter applies fs.existsSync.
 */
function agyBinaryCandidates({ home, isWindows, localAppData } = {}) {
  if (isWindows) {
    const base = localAppData || '';
    return base ? [`${base}\\agy\\bin\\agy.exe`] : [];
  }
  return [
    `${home}/.local/bin/agy`,
    '/opt/homebrew/bin/agy',
    '/usr/local/bin/agy',
  ];
}

module.exports = {
  buildAgyArgv,
  parseAgyEvent,
  toolPreview,
  AgyRunState,
  classifyAgyFailure,
  agyBinaryCandidates,
};

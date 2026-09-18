'use strict';

/**
 * One place for "this CLI run failed — why, and what does the channel get
 * told". Pure: no process, network or adapter state, so every branch is
 * unit-testable (see test/run-failure.test.js).
 *
 * Every CLI adapter hit the same dead end — a failed run reached the user as
 * "No response generated. Please try again.", with the real reason (bad key,
 * blocked network, exhausted quota) only in the daemon log. Each adapter that
 * fixed it grew its own copy of the same regexes and the same
 * "guidance + Details:" shape. This module is that copy, once.
 *
 * Two things stay per-adapter, and are passed in:
 *   - `cli`, the name to use in the fallback wording;
 *   - `guidance`, the sentence to lead with per kind, because what a user
 *     should DO about a bad key differs per CLI (env var, `x login`, the
 *     launcher). Kinds without a sentence fall back to generic wording.
 *
 * What the CLI actually said is always appended, redacted, as "Details: …" —
 * that is the part that makes a report actionable when the guidance guessed
 * wrong.
 */

const { redactSecrets } = require('./utils');

/** How much of the CLI's own words to quote back. */
const DETAIL_CAP = 300;

/**
 * Failure kinds, in the order they are tested. Earlier wins, so the more
 * specific causes come first: "authentication failed or timed out" is an auth
 * failure, not a timeout.
 */
const PATTERNS = [
  ['session', /Error resuming session|Invalid session identifier|No previous sessions found/i],
  ['auth', /authentication (?:required|failed)|not authenticated|no valid credentials|sign[ -]?in|log[ -]?in required|Please set an Auth method|API key not valid|API[_ ]?KEY[_ ]?INVALID|UNAUTHENTICATED|PERMISSION_DENIED|invalid_grant|re-?authenticate|IneligibleTier|not eligible|\bunauthorized\b|\bforbidden\b|invalid[^\n]{0,20}(?:api.?key|token|credential)|api[_ -]?key (?:is )?(?:missing|required|not set|unset)|\bstatus:? 40[13]\b|GEMINI_API_KEY/i],
  ['quota', /RESOURCE_EXHAUSTED|\bquota\b|exhausted your capacity|rate.?limit|too many requests|\b429\b|overloaded/i],
  ['network', /fetch failed|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|socket hang up|getaddrinfo|network error|self[- ]signed certificate|unable to verify the first certificate/i],
  ['model', /ModelNotFound|models?\b[^\n]{0,60}\bnot (?:found|supported)|unknown model|invalid model|unsupported model|no such model|model[^\n]{0,30}(?:unavailable|does not exist)|\bstatus:? 404\b/i],
  ['provider', /modelProvider|model provider|unknown provider|no provider configured|provider[^\n]{0,30}(?:not|un)(?:available|configured|supported|known)/i],
  ['config', /settings\.json|providers\.json|config(?:uration)? (?:error|is invalid|invalid|malformed)|invalid json|malformed/i],
  ['timeout', /print-timeout|timed? ?out|deadline exceeded/i],
];

/**
 * Generic wording for a kind the adapter gave no sentence for. Deliberately
 * vague about the fix — an adapter that knows better passes `guidance`.
 */
function defaultGuidance(kind, cli) {
  switch (kind) {
    case 'session':
      return `${cli} could not resume this channel's previous session.`;
    case 'auth':
      return `${cli} could not authenticate. Check this agent's API key or sign-in.`;
    case 'quota':
      return 'The provider is rate-limiting this agent, or its quota is exhausted. Wait and try again.';
    case 'network':
      return `${cli} could not reach its provider from this device. Check the device's network, or its proxy.`;
    case 'model':
      return `The provider rejected the requested model. Check the model configured for this agent.`;
    case 'provider':
      return `${cli} has no usable provider configured.`;
    case 'config':
      return `${cli}'s configuration looks invalid.`;
    case 'timeout':
      return `${cli} timed out before producing a response.`;
    default:
      return '';
  }
}

/** The message text of a `{type, message}` error, a bare string, or nothing. */
function errorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'object') return String(error.message || error.type || '');
  return String(error);
}

const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const cap = (s, max = DETAIL_CAP) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// stderr lines that say something about the failure, as opposed to the
// "Loaded cached credentials." / "YOLO mode is enabled." chatter around it.
const TELLING_RE = /error|fail|invalid|denied|not |please|unable|cannot|refused/i;

/**
 * Did the run fail? A success result settles it whatever the exit code;
 * otherwise an error result, an error-severity event, or a non-zero exit
 * (a signal leaves code null) does.
 */
function isFailedRun({ code, resultStatus, errorMessages = [] } = {}) {
  if (String(resultStatus || '').toLowerCase() === 'error' || errorMessages.length > 0) return true;
  if (String(resultStatus || '').toLowerCase() === 'success') return false;
  return code !== 0;
}

/**
 * The most useful part of what the CLI said, secrets stripped. A structured
 * error wins over stderr, which is mostly startup chatter. Redaction runs over
 * the whole text BEFORE it is cut, so a key split across the cut cannot
 * survive as a fragment.
 */
function failureDetail({ stderr, error, errorMessages = [], max = DETAIL_CAP } = {}) {
  const structured = [errorMessage(error), ...errorMessages].filter(Boolean).join(' | ');
  if (structured) return cap(oneLine(redactSecrets(structured)), max);
  const lines = redactSecrets(stderr || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  const telling = lines.filter((l) => TELLING_RE.test(l));
  return cap(oneLine((telling.length ? telling : lines).slice(-2).join(' ')), max);
}

/**
 * Which kind of failure the text describes, or null. Matched against the RAW
 * text, never the redacted one: redaction rewrites the very words ("api_key",
 * "token") some patterns key on.
 */
function classifyFailureText(text, { skip = [] } = {}) {
  const s = String(text || '');
  if (!s.trim()) return null;
  for (const [kind, re] of PATTERNS) {
    if (skip.includes(kind)) continue;
    if (re.test(s)) return kind;
  }
  return null;
}

/**
 * Turn a failed run into `{ kind, message, detail }`, where `message` is what
 * the channel should read: guidance for a recognised cause, then the CLI's own
 * words. An unrecognised failure quotes those words with the exit code, which
 * still beats "No response generated".
 *
 * @param {object} info
 * @param {number|null} info.code     process exit code (null when signalled)
 * @param {string}      info.stderr   everything the process wrote to stderr
 * @param {object|string} info.error  a structured error from the CLI's stream
 * @param {string[]} info.errorMessages error-severity events from the stream
 * @param {string}   info.cli         the CLI's name, for the fallback wording
 * @param {object}   info.guidance    kind → the sentence to lead with
 * @param {string[]} info.skip        kinds this CLI can never produce
 * @param {string}   info.codeLabel   how to name `code` when it is not an exit
 *   code — "HTTP 429" for an adapter that talks to an API rather than a CLI.
 */
function classifyRunFailure({
  code, stderr, error, errorMessages = [], cli = 'The CLI', guidance = {}, skip = [],
  codeLabel = '',
} = {}) {
  const errType = error && typeof error === 'object' ? String(error.type || '') : '';
  const structured = [errType, errorMessage(error), ...errorMessages].filter(Boolean).join('\n');
  const detail = failureDetail({ stderr, error, errorMessages });
  const kind = classifyFailureText([structured, stderr].filter(Boolean).join('\n'), { skip });

  if (kind) {
    const lead = guidance[kind] || defaultGuidance(kind, cli);
    return { kind, detail, message: detail ? `${lead}\n\nDetails: ${detail}` : lead };
  }
  return {
    kind: 'unknown',
    detail,
    message: detail
      ? `${cli} failed (${codeLabel || `exit ${code ?? '?'}`}): ${detail}`
      : (codeLabel
        ? `${cli} failed (${codeLabel}) without a response.`
        : `${cli} exited with code ${code ?? '?'} without a response.`),
  };
}

/**
 * An Error whose message is already the sentence the channel should read.
 * Adapters that report a failure by throwing (rather than posting inline) mark
 * it this way so their catch can post it as-is instead of wrapping it in
 * "Error processing message: …", which reads like an adapter bug.
 */
function classifiedError(message) {
  const err = new Error(message);
  err.classified = true;
  return err;
}

/** True for an error carrying a message meant for the channel verbatim. */
function isClassifiedError(e) {
  return !!(e && e.classified);
}

module.exports = {
  DETAIL_CAP,
  classifiedError,
  isClassifiedError,
  PATTERNS,
  isFailedRun,
  errorMessage,
  failureDetail,
  classifyFailureText,
  classifyRunFailure,
  defaultGuidance,
};

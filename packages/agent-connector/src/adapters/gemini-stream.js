'use strict';

/**
 * Pure helpers for GeminiAdapter: whether a headless run failed, why, and what
 * to tell the channel. No process or network state, so the rules can be
 * unit-tested against the CLI's real failure output.
 *
 * Gemini CLI (checked against @google/gemini-cli 0.59.0) reports a failed
 * `-o stream-json` run in three places, and the adapter used to read none of
 * them — every failure reached the user as "No response generated":
 *   - a `result` event with status "error" and `error: {type, message}`, for
 *     API failures once the CLI's own retries are spent (bad key, quota,
 *     network, model);
 *   - `error` events with severity "error" (blocked response, turn limit);
 *   - stderr plus the exit code, for what fails before the run starts: no
 *     usable auth method (exit 41), or a --resume id the CLI cannot find
 *     (exit 42, "Error resuming session: ...").
 */

const { redactSecrets } = require('./utils');

const EXIT_AUTH = 41; // ExitCodes.FATAL_AUTHENTICATION_ERROR
const DETAIL_CAP = 300;

const SESSION_RE = /Error resuming session|Invalid session identifier|No previous sessions found/i;
const AUTH_RE = /Please set an Auth method|API key not valid|API_KEY_INVALID|UNAUTHENTICATED|PERMISSION_DENIED|invalid_grant|re-?authenticate|IneligibleTier|not eligible|\bstatus:? 40[13]\b/i;
const QUOTA_RE = /RESOURCE_EXHAUSTED|quota|exhausted your capacity|rate limit|Too Many Requests|\bstatus:? 429\b/i;
const NETWORK_RE = /fetch failed|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|socket hang up/i;
const MODEL_RE = /ModelNotFound|models?\b[^\n]{0,60}\bnot (?:found|supported)|unknown model|invalid model|\bstatus:? 404\b/i;
// stderr lines that say something about the failure, as opposed to the
// "Loaded cached credentials." / YOLO-mode chatter around it.
const TELLING_RE = /error|fail|invalid|denied|not |please|unable|cannot|refused/i;

function errorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'object') return String(error.message || error.type || '');
  return String(error);
}

const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const cap = (s) => (s.length > DETAIL_CAP ? `${s.slice(0, DETAIL_CAP - 1)}…` : s);

/**
 * Did the run fail? A success result settles it whatever the exit code;
 * otherwise an error result, an error-severity event, or a non-zero exit
 * (a signal leaves code null) does.
 */
function isFailedRun({ code, resultStatus, errorMessages = [] } = {}) {
  if (resultStatus === 'error' || errorMessages.length > 0) return true;
  if (resultStatus === 'success') return false;
  return code !== 0;
}

/**
 * The most useful part of what the CLI said, secrets stripped. The structured
 * error wins over stderr. Redaction runs over the whole text before it is cut,
 * so a key split across the cut cannot survive as a fragment.
 */
function failureDetail({ stderr, error, errorMessages = [] } = {}) {
  const structured = [errorMessage(error), ...errorMessages].filter(Boolean).join(' | ');
  if (structured) return cap(oneLine(redactSecrets(structured)));
  const lines = redactSecrets(stderr || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  const telling = lines.filter((l) => TELLING_RE.test(l));
  return cap(oneLine((telling.length ? telling : lines).slice(-2).join(' ')));
}

/**
 * Turn a failed run into { kind, message }, where message is what the channel
 * should read: guidance for the failures a user can act on, followed by the
 * CLI's own words.
 */
function classifyGeminiFailure({ code, stderr, error, errorMessages = [] } = {}) {
  const errType = error && typeof error === 'object' ? String(error.type || '') : '';
  const structured = [errType, errorMessage(error), ...errorMessages].filter(Boolean).join('\n');
  const text = structured || String(stderr || '');
  const detail = failureDetail({ stderr, error, errorMessages });
  const withDetail = (message) => (detail ? `${message}\n\nDetails: ${detail}` : message);

  // A failed --resume exits before any API call, so stderr is all there is.
  if (SESSION_RE.test(String(stderr || ''))) {
    return {
      kind: 'session',
      message: withDetail("Gemini CLI could not resume this channel's previous session."),
    };
  }
  if (code === EXIT_AUTH || AUTH_RE.test(text)) {
    return {
      kind: 'auth',
      message: withDetail(
        'Gemini CLI could not authenticate on this device. Set GEMINI_API_KEY for ' +
          'this agent (Google ended Gemini CLI access for individual Google accounts ' +
          'in June 2026), or switch to the Antigravity CLI agent. With a Gemini Code ' +
          'Assist license, run `gemini` on the device to sign in again.',
      ),
    };
  }
  if (QUOTA_RE.test(text)) {
    return {
      kind: 'quota',
      message: withDetail(
        'Gemini API quota or rate limit reached. Wait and try again, or use an API ' +
          'key or project with more quota.',
      ),
    };
  }
  if (NETWORK_RE.test(text)) {
    return {
      kind: 'network',
      message: withDetail(
        "Gemini CLI could not reach Google's API from this device, even after " +
          'retrying. Check that the device\'s network, or its proxy, can reach Google.',
      ),
    };
  }
  if (MODEL_RE.test(text)) {
    return {
      kind: 'model',
      message: withDetail(
        'Gemini rejected the requested model. Check GEMINI_MODEL for this agent, or ' +
          'clear it to use the CLI default.',
      ),
    };
  }
  return {
    kind: 'unknown',
    message: detail
      ? `Gemini CLI failed (exit ${code ?? '?'}): ${detail}`
      : `Gemini CLI exited with code ${code ?? '?'} without a response.`,
  };
}

/**
 * Whether a failed resumed run earns one retry from a fresh session: only when
 * the resume itself failed, or when nothing says why. Retrying an auth, quota,
 * network or model failure repeats the same wait for the same error, and
 * throws away the channel's conversation history on the way.
 */
function retriesWithoutResume(kind) {
  return kind === 'session' || kind === 'unknown';
}

module.exports = {
  isFailedRun,
  failureDetail,
  classifyGeminiFailure,
  retriesWithoutResume,
};

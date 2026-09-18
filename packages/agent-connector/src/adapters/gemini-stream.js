'use strict';

/**
 * Gemini-specific failure rules for GeminiAdapter. The matching and the
 * "guidance + Details:" shape are shared with every other adapter in
 * run-failure.js; what lives here is what only Gemini knows — the wording of
 * its guidance, and which failures earn a retry from a fresh session.
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

const { isFailedRun, failureDetail, classifyRunFailure } = require('./run-failure');

const CLI = 'Gemini CLI';

const GUIDANCE = {
  session: "Gemini CLI could not resume this channel's previous session.",
  auth:
    'Gemini CLI could not authenticate on this device. Set GEMINI_API_KEY for ' +
    'this agent (Google ended Gemini CLI access for individual Google accounts ' +
    'in June 2026), or switch to the Antigravity CLI agent. With a Gemini Code ' +
    'Assist license, run `gemini` on the device to sign in again.',
  quota:
    'Gemini API quota or rate limit reached. Wait and try again, or use an API ' +
    'key or project with more quota.',
  network:
    "Gemini CLI could not reach Google's API from this device, even after " +
    "retrying. Check that the device's network, or its proxy, can reach Google.",
  model:
    'Gemini rejected the requested model. Check GEMINI_MODEL for this agent, or ' +
    'clear it to use the CLI default.',
};

/**
 * Turn a failed run into { kind, message }, where message is what the channel
 * should read: guidance for the failures a user can act on, followed by the
 * CLI's own words.
 */
function classifyGeminiFailure({ code, stderr, error, errorMessages = [] } = {}) {
  return classifyRunFailure({
    code, stderr, error, errorMessages, cli: CLI, guidance: GUIDANCE,
  });
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

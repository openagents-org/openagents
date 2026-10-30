'use strict';

/**
 * The shared failure classifier every CLI adapter posts its errors through.
 * The per-adapter wrappers have their own tests (gemini-stream, antigravity-
 * stream); these cover the rules themselves — what each kind matches, what
 * order they are tested in, and that nothing secret survives into the message.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isFailedRun,
  failureDetail,
  classifyFailureText,
  classifyRunFailure,
} = require('../src/adapters/run-failure');

describe('isFailedRun', () => {
  it('a success result settles it whatever the exit code', () => {
    assert.equal(isFailedRun({ code: 7, resultStatus: 'success' }), false);
    assert.equal(isFailedRun({ code: 0, resultStatus: 'SUCCESS' }), false);
  });

  it('an error result or an error event is a failure on a clean exit', () => {
    assert.equal(isFailedRun({ code: 0, resultStatus: 'error' }), true);
    assert.equal(isFailedRun({ code: 0, errorMessages: ['blocked'] }), true);
  });

  it('a non-zero exit or a signal without a result is a failure', () => {
    assert.equal(isFailedRun({ code: 1 }), true);
    assert.equal(isFailedRun({ code: null }), true);
    assert.equal(isFailedRun({ code: 0 }), false);
  });

  it('a success result settles it over error events the run recovered from', () => {
    // Otherwise the channel gets the reply and then a failure notice under it.
    assert.equal(isFailedRun({ code: 0, resultStatus: 'success', errorMessages: ['tool call failed'] }), false);
    assert.equal(isFailedRun({ code: 1, resultStatus: 'success', errorMessages: ['tool call failed'] }), false);
  });
});

describe('classifyFailureText', () => {
  const cases = [
    ['auth', 'Error: 401 Unauthorized'],
    ['auth', 'invalid api key provided'],
    ['auth', 'Please sign in to continue'],
    ['quota', 'You exceeded your current quota (RESOURCE_EXHAUSTED)'],
    ['quota', 'HTTP 429 Too Many Requests'],
    ['network', 'getaddrinfo ENOTFOUND api.example.com'],
    ['network', 'TypeError: fetch failed'],
    ['model', 'unknown model "g9-ultra"'],
    ['model', 'models/x is not found for API version v1beta'],
    ['provider', 'unknown provider "acme"'],
    ['config', 'could not parse providers.json — invalid json'],
    ['timeout', 'the request timed out after 600s'],
    ['session', 'Error resuming session: Invalid session identifier "abc"'],
  ];
  for (const [kind, text] of cases) {
    it(`${kind}: ${text.slice(0, 40)}`, () => {
      assert.equal(classifyFailureText(text), kind);
    });
  }

  it('the more specific cause wins over a word it happens to contain', () => {
    // agy 1.1.17's real payload: an auth failure that mentions a timeout.
    assert.equal(classifyFailureText('authentication failed or timed out'), 'auth');
  });

  it('a skipped kind falls through to the next match', () => {
    const text = 'Error resuming session: Invalid session identifier "abc"';
    assert.equal(classifyFailureText(text, { skip: ['session'] }), null);
  });

  it('says nothing about text that describes no known failure', () => {
    assert.equal(classifyFailureText('something odd happened'), null);
    assert.equal(classifyFailureText(''), null);
    assert.equal(classifyFailureText(null), null);
  });

  // A word that sits near a failure is not the failure. Each of these is a
  // tool reporting on its own work, and used to be labelled with a cause.
  const unrelated = [
    'TypeError: cannot read properties of undefined — sign-in page rendered',
    'navigated to /login and filled the sign in form',
    'write to /etc/hosts is forbidden by the sandbox policy',
    'ENOENT: settings.json not found',
    'reading settings from C:\\Users\\a\\.gemini\\antigravity-cli\\settings.json',
    'tool call skipped: file is not eligible for indexing',
    'upstream returned a malformed response body',
  ];
  for (const text of unrelated) {
    it(`does not put a cause on: ${text.slice(0, 44)}`, () => {
      assert.equal(classifyFailureText(text), null);
    });
  }

  const stillRecognised = [
    ['auth', 'Sign-in required'],
    ['auth', 'Error: you are not logged in'],
    ['auth', 'Please log in to continue'],
    ['auth', 'HTTP 403 Forbidden'],
    ['auth', '{"error":"Forbidden"}'],
    ['auth', 'Error: HTTP 401: Incorrect API key provided'],
    ['auth', 'Your current account is not eligible for this service'],
    ['config', 'settings.json is malformed'],
    ['config', 'failed to parse /home/u/.hermes/config.yaml'],
    ['provider', 'No inference provider configured'],
  ];
  for (const [kind, text] of stillRecognised) {
    it(`still ${kind}: ${text.slice(0, 44)}`, () => {
      assert.equal(classifyFailureText(text), kind);
    });
  }
});

describe('failureDetail', () => {
  it('prefers the structured error over stderr chatter', () => {
    const d = failureDetail({
      stderr: 'Loaded cached credentials.\nError: some unrelated warning\n',
      error: { type: 'Error', message: 'quota exhausted' },
    });
    assert.equal(d, 'quota exhausted');
  });

  it('keeps the telling stderr lines and drops the rest', () => {
    const d = failureDetail({
      stderr: 'Loaded cached credentials.\nYOLO mode is enabled.\nError: getaddrinfo ENOTFOUND\n',
    });
    assert.equal(d, 'Error: getaddrinfo ENOTFOUND');
  });

  it('falls back to the last lines when none of them look telling', () => {
    assert.match(failureDetail({ stderr: 'boom\nsomething odd happened\n' }), /something odd happened/);
  });

  it('joins error-severity events with the structured error', () => {
    const d = failureDetail({ error: 'first', errorMessages: ['second'] });
    assert.equal(d, 'first | second');
  });

  it('caps a long message and collapses it to one line', () => {
    // Real words, not one long token: the catch-all in redactSecrets treats a
    // 40-char unbroken string as a secret and would replace it before the cut.
    const d = failureDetail({ error: { message: `${'the model refused this call. '.repeat(20)}\nmore` } });
    assert.equal(d.length, 300);
    assert.ok(d.endsWith('…'));
  });

  it('is empty when there is nothing to quote', () => {
    assert.equal(failureDetail({}), '');
    assert.equal(failureDetail({ stderr: '  \n ' }), '');
  });

  it('masks the values the caller knows are secret, in either source', () => {
    const secrets = ['kz-91Ab_x7'];
    assert.equal(
      failureDetail({ error: { message: 'credential kz-91Ab_x7 is disabled' }, secrets }),
      'credential [REDACTED] is disabled',
    );
    assert.equal(
      failureDetail({ stderr: 'Error: credential kz-91Ab_x7 is disabled\n', secrets }),
      'Error: credential [REDACTED] is disabled',
    );
  });
});

describe('classifyRunFailure', () => {
  it('leads with the adapter guidance and appends what the CLI said', () => {
    const r = classifyRunFailure({
      code: 1,
      error: 'API key not valid',
      cli: 'Acme CLI',
      guidance: { auth: 'Set ACME_API_KEY for this agent.' },
    });
    assert.equal(r.kind, 'auth');
    assert.equal(r.message, 'Set ACME_API_KEY for this agent.\n\nDetails: API key not valid');
  });

  it('falls back to generic wording for a kind the adapter did not cover', () => {
    const r = classifyRunFailure({ code: 1, stderr: 'fetch failed', cli: 'Acme CLI' });
    assert.equal(r.kind, 'network');
    assert.match(r.message, /Acme CLI could not reach its provider/);
    assert.match(r.message, /Details: fetch failed/);
  });

  it('quotes the exit code and the CLI output when nothing explains the failure', () => {
    const r = classifyRunFailure({ code: 7, stderr: 'boom\nsomething odd happened', cli: 'Acme CLI' });
    assert.equal(r.kind, 'unknown');
    assert.equal(r.message, 'Acme CLI failed (exit 7): boom something odd happened');
  });

  it('says so plainly when the CLI said nothing at all', () => {
    assert.equal(
      classifyRunFailure({ code: null, cli: 'Acme CLI' }).message,
      'Acme CLI exited with code ? without a response.',
    );
  });

  it('matches on the raw text but never puts a secret in the message', () => {
    const key = 'AIzaSyD4k9Xq2LmN8pR7tVwY1bC3dE5fG6hJ0kL9m';
    const r = classifyRunFailure({
      code: 1,
      stderr: `Error: request to https://api.example.com/v1?key=${key} failed, reason: getaddrinfo ENOTFOUND`,
      cli: 'Acme CLI',
    });
    assert.equal(r.kind, 'network');
    assert.ok(!r.message.includes(key), r.message);
    assert.ok(!r.message.includes('AIzaSyD4k9Xq'), r.message);
  });

  it('redacts a bearer token quoted back from stderr', () => {
    const r = classifyRunFailure({
      code: 1,
      stderr: 'Error: 401 Unauthorized (authorization: Bearer sk-live-abcdef1234567890)',
      cli: 'Acme CLI',
    });
    assert.equal(r.kind, 'auth');
    assert.ok(!r.message.includes('sk-live-abcdef1234567890'), r.message);
  });

  it('redacts a bearer token that has no recognisable prefix', () => {
    const r = classifyRunFailure({
      code: 1,
      stderr: 'Error: 401 Unauthorized — sent Authorization: Bearer abcDEF1234567890xyz',
      cli: 'Acme CLI',
    });
    assert.equal(r.kind, 'auth');
    assert.ok(!r.message.includes('abcDEF1234567890xyz'), r.message);
  });

  it('masks the agent\'s own key by value, and still classifies on the raw text', () => {
    // Nothing about this key's shape gives it away; only knowing it does.
    const key = 'kz-91Ab_x7';
    const r = classifyRunFailure({
      code: 1,
      stderr: `Error: invalid api key ${key}`,
      cli: 'Acme CLI',
      secrets: [key],
    });
    assert.equal(r.kind, 'auth');
    assert.match(r.message, /Details: Error: invalid api key \[REDACTED\]$/);
    assert.equal(r.detail, 'Error: invalid api key [REDACTED]');
  });

  it('masks it in a failure nothing explains, too', () => {
    const r = classifyRunFailure({
      code: 3, stderr: 'boom: kz-91Ab_x7', cli: 'Acme CLI', secrets: ['kz-91Ab_x7'],
    });
    assert.equal(r.message, 'Acme CLI failed (exit 3): boom: [REDACTED]');
  });
});

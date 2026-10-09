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
});

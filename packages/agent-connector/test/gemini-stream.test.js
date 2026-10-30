'use strict';

/**
 * GeminiAdapter's failure helpers, fed the shapes Gemini CLI 0.59.0 actually
 * produces: the `result` error event once its retries are spent, `error`
 * events, and the stderr + exit code of a run that never started. Before
 * these, every one of them reached the channel as "No response generated".
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isFailedRun,
  failureDetail,
  classifyGeminiFailure,
  retriesWithoutResume,
} = require('../src/adapters/gemini-stream');
const { redactSecrets } = require('../src/adapters/utils');

// A Google API key shape: "AIza" + 35 chars. At 39 chars it slips under
// redactSecrets' 40-char catch-all, so it needs its own rule.
const GOOGLE_KEY = 'AIzaSyD4k9Xq2mN7pR1sT5vW8yZ0aB3cE6fGh-J';

describe('isFailedRun', () => {
  it('a success result with a clean exit is not a failure', () => {
    assert.equal(isFailedRun({ code: 0, resultStatus: 'success' }), false);
  });

  it('a clean exit without any result is not a failure', () => {
    assert.equal(isFailedRun({ code: 0 }), false);
  });

  it('an error result is a failure whatever the exit code', () => {
    assert.equal(isFailedRun({ code: 0, resultStatus: 'error' }), true);
    assert.equal(isFailedRun({ code: 1, resultStatus: 'error' }), true);
  });

  it('an error-severity event is a failure', () => {
    assert.equal(isFailedRun({ code: 0, errorMessages: ['Maximum session turns exceeded'] }), true);
  });

  it('a non-zero exit or a signal without a result is a failure', () => {
    assert.equal(isFailedRun({ code: 41 }), true);
    assert.equal(isFailedRun({ code: null }), true);
  });

  it('a success result settles an odd exit code', () => {
    assert.equal(isFailedRun({ code: 1, resultStatus: 'success' }), false);
  });
});

describe('classifyGeminiFailure', () => {
  it('no auth method: exit 41 with only stderr, before the run starts', () => {
    const r = classifyGeminiFailure({
      code: 41,
      stderr:
        'Please set an Auth method in your /home/u/.gemini/settings.json or specify one of the ' +
        'following environment variables before running: GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, ' +
        'GOOGLE_GENAI_USE_GCA\n',
    });
    assert.equal(r.kind, 'auth');
    assert.match(r.message, /GEMINI_API_KEY/);
    assert.match(r.message, /Antigravity/);
    assert.match(r.message, /Details: Please set an Auth method/);
  });

  it('an invalid API key reported in the result event', () => {
    const r = classifyGeminiFailure({
      code: 1,
      error: {
        type: 'Error',
        message: '[API Error: API key not valid. Please pass a valid API key. (Status: INVALID_ARGUMENT)]',
      },
    });
    assert.equal(r.kind, 'auth');
    assert.match(r.message, /Details: \[API Error: API key not valid/);
  });

  it('an account the Code Assist backend refuses, recognised by the error type alone', () => {
    const r = classifyGeminiFailure({
      code: 1,
      error: { type: 'IneligibleTierError', message: 'This account type is no longer supported.' },
    });
    assert.equal(r.kind, 'auth');
    assert.match(r.message, /no longer supported/);
  });

  it('quota exhausted after the retries', () => {
    const r = classifyGeminiFailure({
      code: 1,
      error: {
        type: 'Error',
        message:
          '[API Error: You exceeded your current quota, please check your plan and billing details. ' +
          '(Status: RESOURCE_EXHAUSTED)]\nPlease wait and try again later. To increase your limits, ' +
          'request a quota increase through AI Studio, or switch to another /auth method',
      },
    });
    assert.equal(r.kind, 'quota');
    assert.ok(!r.message.split('Details: ')[1].includes('\n'), 'detail is one line');
  });

  it('network failure reported in the result event', () => {
    const r = classifyGeminiFailure({
      code: 1,
      error: { type: 'Error', message: '[API Error: exception TypeError: fetch failed sending request]' },
    });
    assert.equal(r.kind, 'network');
  });

  it('network failure with only stderr, skipping the chatter around it', () => {
    const r = classifyGeminiFailure({
      code: 1,
      stderr: 'Loaded cached credentials.\nError: getaddrinfo ENOTFOUND generativelanguage.googleapis.com\n',
    });
    assert.equal(r.kind, 'network');
    assert.match(r.message, /Details: Error: getaddrinfo ENOTFOUND/);
    assert.ok(!r.message.includes('Loaded cached credentials'), r.message);
  });

  it('a model the API does not know', () => {
    const r = classifyGeminiFailure({
      code: 1,
      error: {
        type: 'Error',
        message:
          '[API Error: models/gemini-9-pro is not found for API version v1beta, or is not supported ' +
          'for generateContent. (Status: NOT_FOUND)]',
      },
    });
    assert.equal(r.kind, 'model');
    assert.match(r.message, /GEMINI_MODEL/);
  });

  it('a --resume id the CLI cannot find (exit 42)', () => {
    const r = classifyGeminiFailure({
      code: 42,
      stderr:
        'Error resuming session: Invalid session identifier "5f1c2b7e-0000-4000-8000-000000000000".\n' +
        '  Searched for sessions in /home/u/.gemini/tmp/proj/chats.\n' +
        '  Use --list-sessions to see available sessions, then use --resume {number}, --resume {uuid}, or --resume latest.\n',
    });
    assert.equal(r.kind, 'session');
  });

  it('an error-severity event with nothing more specific is reported verbatim', () => {
    const r = classifyGeminiFailure({
      code: 0,
      errorMessages: ['The model response was blocked due to safety settings.'],
    });
    assert.equal(r.kind, 'unknown');
    assert.equal(r.message, 'Gemini CLI failed (exit 0): The model response was blocked due to safety settings.');
  });

  it('an unrecognised failure quotes the end of stderr', () => {
    const r = classifyGeminiFailure({ code: 1, stderr: 'YOLO mode is enabled.\nsomething odd happened\n' });
    assert.equal(r.kind, 'unknown');
    assert.match(r.message, /^Gemini CLI failed \(exit 1\): .*something odd happened$/);
  });

  it('says so plainly when the CLI said nothing at all', () => {
    assert.equal(
      classifyGeminiFailure({ code: 1 }).message,
      'Gemini CLI exited with code 1 without a response.',
    );
    assert.equal(
      classifyGeminiFailure({ code: null, stderr: '  \n' }).message,
      'Gemini CLI exited with code ? without a response.',
    );
  });

  it('the structured error wins over stderr noise', () => {
    const r = classifyGeminiFailure({
      code: 1,
      stderr: 'Error: some unrelated warning\n',
      error: { type: 'Error', message: '[API Error: exception TypeError: fetch failed sending request]' },
    });
    assert.ok(!r.message.includes('unrelated warning'), r.message);
  });

  it('never repeats a Google API key, in stderr or in the result error', () => {
    assert.equal(GOOGLE_KEY.length, 39);
    const fromStderr = classifyGeminiFailure({
      code: 1,
      stderr:
        'Error: request to https://generativelanguage.googleapis.com/v1beta/models/x:generate?key=' +
        `${GOOGLE_KEY} failed, reason: getaddrinfo ENOTFOUND\n`,
    });
    assert.ok(!fromStderr.message.includes(GOOGLE_KEY), fromStderr.message);
    const fromResult = classifyGeminiFailure({
      code: 1,
      error: { type: 'Error', message: `API key not valid: ${GOOGLE_KEY}` },
    });
    assert.ok(!fromResult.message.includes('AIzaSyD4k9Xq'), fromResult.message);
  });
});

describe('failureDetail', () => {
  it('caps a long message', () => {
    const d = failureDetail({ error: { message: `[API Error: ${'x '.repeat(600)}]` } });
    assert.ok(d.length <= 300, String(d.length));
  });

  it('is empty when there is nothing to quote', () => {
    assert.equal(failureDetail({}), '');
    assert.equal(failureDetail({ stderr: '\n  \n' }), '');
  });
});

describe('retriesWithoutResume', () => {
  it('retries only a failed resume, or a failure nothing explains', () => {
    assert.equal(retriesWithoutResume('session'), true);
    assert.equal(retriesWithoutResume('unknown'), true);
  });

  it('keeps the session for failures a fresh session cannot fix', () => {
    for (const kind of ['auth', 'quota', 'network', 'model']) {
      assert.equal(retriesWithoutResume(kind), false, kind);
    }
  });
});

describe('redactSecrets — Google credential shapes', () => {
  it('redacts a bare Google API key', () => {
    const out = redactSecrets(`using key ${GOOGLE_KEY} for this run`);
    assert.ok(!out.includes(GOOGLE_KEY), out);
    assert.match(out, /\[REDACTED_KEY\]/);
  });

  it('redacts a Google OAuth access token', () => {
    const token = 'ya29.a0AfB_byC1d2E3f4G5h6I7j8K9';
    const out = redactSecrets(`Authorization failed for ${token}`);
    assert.ok(!out.includes(token), out);
  });
});

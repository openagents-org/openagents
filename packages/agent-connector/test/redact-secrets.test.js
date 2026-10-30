'use strict';

/**
 * redactSecrets is the last thing between a CLI's output and a workspace
 * channel every member can read. Two protections, tested separately: the
 * shapes a credential turns up in, and the values we already know are secret.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { redactSecrets, maskSecretValues, secretValues } = require('../src/adapters/utils');

describe('redactSecrets — credential shapes', () => {
  // Each of these reached the channel intact: the key/value rule took the
  // scheme word for the value and masked that instead.
  const BEARER = 'abcDEF1234567890xyz';
  const BASIC = 'dXNlcjpwYXNzd29yZDEyMw==';

  it('masks the token of an Authorization header, not its scheme word', () => {
    assert.equal(redactSecrets(`Authorization: Bearer ${BEARER}`), 'Authorization: [REDACTED]');
    assert.equal(redactSecrets(`Authorization=Basic ${BASIC}`), 'Authorization=[REDACTED]');
    assert.equal(redactSecrets(`proxy-authorization: basic ${BASIC}`), 'proxy-authorization: [REDACTED]');
  });

  it('masks it in a JSON dump of the request headers', () => {
    const out = redactSecrets(`{"headers":{"Authorization":"Bearer ${BEARER}","Accept":"*/*"}}`);
    assert.ok(!out.includes(BEARER), out);
    assert.match(out, /"Accept":"\*\/\*"/);
  });

  it('masks a scheme and credential quoted without the header name', () => {
    assert.equal(redactSecrets(`rejected Bearer ${BEARER} from 10.0.0.1`), 'rejected Bearer [REDACTED] from 10.0.0.1');
    assert.equal(redactSecrets(`got Basic ${BASIC} from the proxy`), 'got Basic [REDACTED] from the proxy');
  });

  it('leaves "Basic" alone when what follows is a word, not a credential', () => {
    assert.equal(redactSecrets('Basic authentication required'), 'Basic authentication required');
  });

  it('masks credentials embedded in a URL', () => {
    assert.equal(
      redactSecrets('POST https://bob:hunter2pass@relay.example/v1 failed'),
      'POST https://[REDACTED]@relay.example/v1 failed',
    );
    assert.equal(
      redactSecrets('fatal: could not read from https://x9Tq2LmB@git.example/org/repo.git'),
      'fatal: could not read from https://[REDACTED]@git.example/org/repo.git',
    );
  });

  it('leaves a URL without credentials as it was', () => {
    for (const url of [
      'https://relay.example/v1/chat/completions',
      'http://localhost:8080/users/a@b.example',
      'https://docs.example/search?q=who@where',
    ]) {
      assert.equal(redactSecrets(`see ${url}`), `see ${url}`);
    }
  });

  it('masks a key with no prefix to know it by', () => {
    const hex = '0123456789abcdef0123456789abcdef';
    assert.equal(redactSecrets(`invalid key ${hex}`), 'invalid key [REDACTED]');
    // Zhipu: <32 hex>.<secret>
    assert.equal(redactSecrets(`Incorrect API key provided: ${hex}.AbCdEfGh12345678`), 'Incorrect API key provided: [REDACTED]');
  });

  it('masks a long token whole, not just the hex run inside it', () => {
    const out = redactSecrets('key ak-0123456789abcdef0123456789abcdef-suffix12 rejected');
    assert.equal(out, 'key [REDACTED] rejected');
  });

  it('still masks the shapes it always did', () => {
    const cases = [
      'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
      'sk-ant-api03-abcdefghijklmnop',
      'AIzaSyD4k9Xq2mN7pR1sT5vW8yZ0aB3cE6fGh-J',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36',
      'ghp_abcdefghijklmnopqrstuvwxyz012345',
    ];
    for (const secret of cases) {
      assert.ok(!redactSecrets(`failed with ${secret} in the request`).includes(secret), secret);
    }
    assert.equal(redactSecrets('GET /v1/models?key=abc123&alt=json'), 'GET /v1/models?key=[REDACTED]&alt=json');
  });

  it('never throws on a non-string', () => {
    assert.equal(redactSecrets(null), '');
    assert.equal(redactSecrets(undefined), '');
    assert.equal(redactSecrets(404), '404');
  });
});

describe('secretValues — what an agent already knows is secret', () => {
  it('takes the values of variables named like a credential', () => {
    const values = secretValues({
      LLM_API_KEY: 'relay-key-7f3a9c2e',
      ANTHROPIC_AUTH_TOKEN: 'cr_live_5b1e0d44',
      DB_PASSWORD: 'correct-horse',
      WEBHOOK_SECRET: 'whsec-91c2aa07',
      LLM_BASE_URL: 'https://relay.example/v1',
      LLM_MODEL: 'some-long-model-name',
      HOME: '/home/somebody',
    });
    assert.deepEqual(
      [...values].sort(),
      ['correct-horse', 'cr_live_5b1e0d44', 'relay-key-7f3a9c2e', 'whsec-91c2aa07'],
    );
  });

  it('skips values too short to be anything but a flag', () => {
    assert.deepEqual(secretValues({ USE_API_KEY: '1', AUTH_ENABLED: 'true', MAX_TOKENS: '128000' }), []);
  });

  it('adds what the caller knows — the workspace token — and ignores blanks', () => {
    assert.deepEqual(
      secretValues({}, ['ws-token-51d0e8', '', null, undefined, 'tok']),
      ['ws-token-51d0e8'],
    );
  });

  it('trims, drops duplicates, and puts the longest first', () => {
    const values = secretValues(
      { A_KEY: '  relay-key-7f3a9c2e  ', B_KEY: 'relay-key-7f3a9c2e', C_TOKEN: 'relay-key-7f3a9c2e-rotated' },
    );
    assert.deepEqual(values, ['relay-key-7f3a9c2e-rotated', 'relay-key-7f3a9c2e']);
  });

  it('copes with no environment at all', () => {
    assert.deepEqual(secretValues(null), []);
    assert.deepEqual(secretValues(undefined, null), []);
  });
});

describe('redactSecrets — known values', () => {
  // Formats no pattern recognises: too short for the catch-all, no prefix,
  // not hex, and not sitting behind a "key:" a rule could anchor on.
  const SHORT = 'kz-91Ab_x7';
  const DOTTED = 'a1B2c3D4.e5F6g7H8';

  it('masks a key whatever its format', () => {
    const text = `provider said: credential ${SHORT} is disabled; retry used ${DOTTED}`;
    assert.equal(redactSecrets(text), text, 'no pattern knows these — that is the point');
    assert.equal(
      redactSecrets(text, [SHORT, DOTTED]),
      'provider said: credential [REDACTED] is disabled; retry used [REDACTED]',
    );
  });

  it('masks every occurrence', () => {
    assert.equal(redactSecrets(`${SHORT} then ${SHORT}`, [SHORT]), '[REDACTED] then [REDACTED]');
  });

  it('runs before the shape rules, so no half of a key is left behind', () => {
    // The shape rules alone take "sk-…" and stop at the dot.
    const key = 'sk-abcdef123456.tail-part-9';
    assert.match(redactSecrets(`bad key ${key}`), /tail-part-9/);
    assert.equal(redactSecrets(`bad key ${key}`, [key]), 'bad key [REDACTED]');
  });

  it('with the longest first, a key that contains another is masked whole', () => {
    const secrets = secretValues({ A_KEY: 'relay-key-7f3a9c2e', B_KEY: 'relay-key-7f3a9c2e-rotated' });
    assert.equal(redactSecrets('used relay-key-7f3a9c2e-rotated', secrets), 'used [REDACTED]');
  });

  it('ignores a "secret" too short to mask safely', () => {
    assert.equal(redactSecrets('the model is gpt', ['gpt', '', null]), 'the model is gpt');
  });
});

describe('maskSecretValues — for text that is prose, not CLI output', () => {
  it('masks the known values and rewrites nothing else', () => {
    const reply = 'The token limit was reached. Set `password: string` and call relay-key-7f3a9c2e.';
    assert.equal(
      maskSecretValues(reply, ['relay-key-7f3a9c2e']),
      'The token limit was reached. Set `password: string` and call [REDACTED].',
    );
  });
});

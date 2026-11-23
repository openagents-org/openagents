/**
 * When the provider explains a failure in words (a JSON error body), that
 * sentence is the message, in full and as plain text, instead of a generic
 * line quoted above raw JSON cut off at 200 characters.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const OpenCodeAdapter = require('../src/adapters/opencode');

const ACENTA = 'This Agent Box has used its 130M included tokens for this billing period. To keep it working now, allow extra usage from your Acenta balance on its page, or model access resumes on December 8.';

function makeAdapter() {
  const adapter = new OpenCodeAdapter({ workspaceId: 'ws', channelName: 'thread', token: 'token', agentName: 'opencode-test' });
  adapter._log = () => {};
  const sent = [];
  adapter.client = { sendMessage: async (_ws, _ch, _tok, content) => { sent.push(content); } };
  return { adapter, sent };
}

describe('OpenCode — the provider\'s own explanation', () => {
  it('reads the sentence out of common JSON error bodies', () => {
    assert.equal(OpenCodeAdapter._providerExplanation(`Payment Required: {"detail":"${ACENTA}"}`), ACENTA);
    assert.equal(OpenCodeAdapter._providerExplanation('{"error":{"message":"You exceeded your current quota, please check your plan."}}'),
      'You exceeded your current quota, please check your plan.');
    assert.equal(OpenCodeAdapter._providerExplanation('{"message":"Insufficient account balance for this request"}'), 'Insufficient account balance for this request');
    assert.equal(OpenCodeAdapter._providerExplanation('Bad Gateway'), null);
    assert.equal(OpenCodeAdapter._providerExplanation('{"detail":"no"}'), null);  // too short to be an explanation
    assert.equal(OpenCodeAdapter._providerExplanation('{not json'), null);
  });

  it('classifies a 402 with an explanation and keeps the whole sentence', () => {
    const cls = OpenCodeAdapter._classifyFailure({ code: 1, stdoutErr: { name: 'APICallError', status: 402, message: `Payment Required: {"detail":"${ACENTA}"}` } });
    assert.equal(cls.category, 'quota_exhausted');
    assert.equal(cls.explained, true);
    assert.equal(cls.detail, ACENTA);
    assert.match(cls.detail, /resumes on December 8\.$/);
  });

  it('posts the explanation as the message, without the generic "key with credit" line or raw JSON', async () => {
    const { adapter, sent } = makeAdapter();
    await adapter._sendClassifiedError('thread', 'quota_exhausted', ACENTA, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /couldn't run\*\* — This Agent Box has used its 130M included tokens/);
    assert.match(sent[0], /resumes on December 8\./);
    assert.doesNotMatch(sent[0], /key with credit|\{"detail"/);
  });

  it('keeps our action hint after the explanation for other kinds', async () => {
    const { adapter, sent } = makeAdapter();
    await adapter._sendClassifiedError('thread', 'request_too_large', "This model's maximum context length is 262144 tokens.", true);
    assert.match(sent[0], /maximum context length is 262144 tokens\.\n\n.*Start a new thread/);
  });

  it('without an explanation the message is unchanged (generic line, quoted detail)', async () => {
    const { adapter, sent } = makeAdapter();
    await adapter._sendClassifiedError('thread', 'quota_exhausted', 'Payment Required', false);
    assert.match(sent[0], /run out of balance or credit[\s\S]*\n\n> Payment Required/);
  });
});

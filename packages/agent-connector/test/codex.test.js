'use strict';

/**
 * Codex adapter failure-surfacing tests.
 *
 * Covers the fix for the generic "No response generated. Please try again."
 * reply: turn.failed / error event messages, stderr, and exit codes are now
 * surfaced to the user (redacted), mirroring the OpenCode adapter. All
 * fixtures are synthetic — no network, no CLI.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const CodexAdapter = require('../src/adapters/codex');

// ---------------------------------------------------------------------------
// _redact
// ---------------------------------------------------------------------------

describe('Codex — secret redaction', () => {
  it('redacts OpenAI-style keys', () => {
    const out = CodexAdapter._redact('Incorrect API key provided: sk-Mzax7abcdef123456');
    assert.ok(!out.includes('sk-Mzax7'));
    assert.ok(out.includes('sk-[REDACTED]'));
  });

  it('redacts bearer tokens', () => {
    const out = CodexAdapter._redact('bearer abc123def456');
    assert.ok(!out.includes('abc123def456'));
  });

  it('passes plain text through', () => {
    assert.strictEqual(CodexAdapter._redact('model not found'), 'model not found');
  });
});

// ---------------------------------------------------------------------------
// _failureDetail
// ---------------------------------------------------------------------------

describe('Codex — failure detail selection', () => {
  it('prefers the turn.failed / error event message', () => {
    const detail = CodexAdapter._failureDetail({
      errorMessage: 'Incorrect API key provided: sk-Mzax7abcdef123456',
      stderr: 'some stderr noise',
      exitCode: 1,
    });
    assert.ok(detail.startsWith('Incorrect API key provided'));
    assert.ok(detail.includes('sk-[REDACTED]'));
  });

  it('falls back to the stderr tail', () => {
    const stderr = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    const detail = CodexAdapter._failureDetail({ errorMessage: '', stderr, exitCode: 1 });
    assert.ok(detail.includes('line 9'));
    assert.ok(!detail.includes('line 0'), 'only the tail should be kept');
  });

  it('falls back to the exit code', () => {
    assert.strictEqual(
      CodexAdapter._failureDetail({ errorMessage: '', stderr: '', exitCode: 2 }),
      'codex exited with code 2',
    );
  });

  it('is empty for a clean run with no diagnostics', () => {
    assert.strictEqual(CodexAdapter._failureDetail({ exitCode: 0 }), '');
    assert.strictEqual(CodexAdapter._failureDetail({}), '');
  });

  it('caps detail length', () => {
    const detail = CodexAdapter._failureDetail({ errorMessage: 'x'.repeat(2000) });
    assert.ok(detail.length <= 500);
  });
});

// ---------------------------------------------------------------------------
// _sendRunFailure
// ---------------------------------------------------------------------------

describe('Codex — user-visible failure message', () => {
  async function capture(result) {
    const sent = [];
    const fake = { sendError: async (channel, content) => { sent.push({ channel, content }); } };
    await CodexAdapter.prototype._sendRunFailure.call(fake, 'chan', result);
    return sent[0];
  }

  it('includes the failure reason as a quoted detail', async () => {
    const msg = await capture({ errorMessage: 'stream error: 401 Unauthorized', exitCode: 1 });
    assert.ok(msg.content.includes("Codex couldn't run"));
    assert.ok(msg.content.includes('> stream error: 401 Unauthorized'));
  });

  it('falls back to a retry message when there is nothing to report', async () => {
    const msg = await capture({ exitCode: 0 });
    assert.ok(msg.content.includes("Codex couldn't run"));
    assert.ok(msg.content.includes('without producing a reply'));
    assert.ok(!msg.content.includes('>'), 'no empty quote block');
  });
});

/**
 * #649: a run died with the API's raw envelope —
 * {"detail":"The 'gpt-5.6-sol' model requires a newer version of Codex..."} —
 * posted into workspace chat braces and all, with no hint about what to do.
 */
describe('CodexAdapter._failureDetail — backend rejections', () => {
  it('unwraps the JSON envelope and names the remedy', () => {
    const out = CodexAdapter._failureDetail({
      errorMessage: JSON.stringify({
        detail: "The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
      }),
    });
    assert.ok(!out.includes('{'), 'no JSON braces reach the user');
    assert.ok(out.includes("requires a newer version of Codex"), 'keeps the backend sentence');
    assert.ok(/Agents → Codex → Update/.test(out), 'says where the update button is');
    assert.ok(/@openai\/codex@latest/.test(out), 'gives the CLI escape hatch');
  });

  it('unwraps the nested { error: { message } } shape', () => {
    const out = CodexAdapter._failureDetail({
      errorMessage: JSON.stringify({ error: { message: 'rate limit exceeded' } }),
    });
    assert.equal(out, 'rate limit exceeded');
  });

  it('leaves an unrelated failure exactly as it was', () => {
    assert.equal(
      CodexAdapter._failureDetail({ errorMessage: 'connection reset by peer' }),
      'connection reset by peer',
    );
    assert.equal(CodexAdapter._failureDetail({ exitCode: 2 }), 'codex exited with code 2');
  });

  it('still redacts secrets after unwrapping', () => {
    const out = CodexAdapter._failureDetail({
      errorMessage: JSON.stringify({ detail: 'bad key sk-abcdef123456789' }),
    });
    assert.ok(!out.includes('sk-abcdef123456789'));
  });
});

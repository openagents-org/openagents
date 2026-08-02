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
    const fake = { sendFinalError: async (trigger, channel, content) => { sent.push({ channel, content }); } };
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

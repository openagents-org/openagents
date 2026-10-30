const { test, describe } = require('node:test');
const assert = require('node:assert');

const ClaudeAdapter = require('../src/adapters/claude');

// `stderrBuf` used to be collected and never read: a CLI that died — or hung —
// before emitting its first JSON event left the only account of why in a string
// no code path looked at, and the channel got "No response generated". These
// pin the two properties that make it reportable: it comes back at all, and it
// comes back with credentials stripped, since a CLI failing on auth tends to
// echo the key it was handed.

// The tail is redacted with the agent's own secrets, so it needs an agent.
const adapter = Object.assign(Object.create(ClaudeAdapter.prototype), {
  agentEnv: { ANTHROPIC_API_KEY: 'relay-key-7f3a9c2e' },
  token: 'ws-token-51d0e8',
});
const tail = (stderrBuf) => adapter._stderrTail({ stderrBuf });

describe('ClaudeAdapter._stderrTail', () => {
  test('returns the process stderr so a silent failure has something to report', () => {
    assert.strictEqual(
      tail('  error: --input-format requires --output-format stream-json\n'),
      'error: --input-format requires --output-format stream-json',
    );
  });

  test('redacts credentials the CLI echoed back', () => {
    const out = tail('Invalid API key: sk-Mzax7abcdef123456');
    assert.ok(!out.includes('sk-Mzax7abcdef123456'), out);
    assert.match(out, /sk-\[REDACTED\]/);
  });

  test('leaves out Claude Code\'s notice about a model it does not know', () => {
    // A relay model (glm, kimi, …) makes Claude Code print this on every run;
    // as "the" error it was all a failed message ever showed.
    const notice = 'Claude Code doesn\'t recognize the model "glm-5", so it assumes a context window of 200000 tokens. '
      + 'Until then auto-compact keeps this session within 200k tokens (the context window it assumes).';
    assert.strictEqual(tail(`${notice}\nAPI Error: 403 insufficient_quota\n`), 'API Error: 403 insufficient_quota');
    assert.strictEqual(tail(notice), '');
  });

  test('redacts the key this agent was given, whatever its format', () => {
    // No prefix, no length a pattern could key on — only its value gives it away.
    const out = tail('relay rejected relay-key-7f3a9c2e for workspace ws-token-51d0e8');
    assert.strictEqual(out, 'relay rejected [REDACTED] for workspace [REDACTED]');
  });

  test('reads as empty when the process said nothing, rather than as a blank error', () => {
    assert.strictEqual(tail(''), '');
    assert.strictEqual(tail('   \n  '), '');
    assert.strictEqual(tail(undefined), '');
    assert.strictEqual(adapter._stderrTail(null), '');
  });

  test('keeps the END of a long stream — the failure is the last thing said', () => {
    const noise = Array.from({ length: 200 }, (_, i) => `warn ${i}: deprecated flag`).join('\n');
    const out = tail(`${noise}\nfatal: could not connect to the model endpoint`);
    assert.ok(out.endsWith('fatal: could not connect to the model endpoint'), out.slice(-60));
    assert.ok(out.length <= 800, String(out.length));
  });

  // Redaction runs over the WHOLE buffer before the tail is cut: slicing first
  // could split a key so the pattern no longer matches and a fragment survives.
  test('redacts across the part that gets cut away, not just the tail', () => {
    const out = tail(`Authorization: Bearer sk-Mzax7abcdef123456\n${'filler line\n'.repeat(200)}done`);
    assert.ok(!out.includes('Mzax7abcdef'), out);
  });
});

// A `result` error is the provider's own message, posted to the channel through
// _formatClaudeError — which used to quote it as it came.
describe('ClaudeAdapter._formatClaudeError', () => {
  test('redacts what the provider echoed, by shape and by value', () => {
    const out = adapter._formatClaudeError(
      'API Error: 401 {"error":"invalid token","sent":"Authorization: Bearer abcDEF1234567890xyz"} key relay-key-7f3a9c2e',
    );
    assert.ok(!out.includes('abcDEF1234567890xyz'), out);
    assert.ok(!out.includes('relay-key-7f3a9c2e'), out);
  });

  test('still recognises an auth failure, on the text as the provider wrote it', () => {
    // Redaction rewrites "invalid token <value>"; the hint must not depend on
    // what is left afterwards.
    const out = adapter._formatClaudeError('invalid token relay-key-7f3a9c2e');
    assert.match(out, /^Claude authentication failed: /);
    assert.match(out, /Check this agent's API key and Base URL/);
    assert.ok(!out.includes('relay-key-7f3a9c2e'), out);
  });

  test('leaves an ordinary error readable', () => {
    assert.strictEqual(
      adapter._formatClaudeError('The model is overloaded. Try again shortly.'),
      'Claude error: The model is overloaded. Try again shortly.',
    );
    assert.strictEqual(adapter._formatClaudeError(''), 'Claude error: Claude returned an error.');
  });
});

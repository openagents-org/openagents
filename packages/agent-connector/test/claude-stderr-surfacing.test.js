const { test, describe } = require('node:test');
const assert = require('node:assert');

const ClaudeAdapter = require('../src/adapters/claude');

// `stderrBuf` used to be collected and never read: a CLI that died — or hung —
// before emitting its first JSON event left the only account of why in a string
// no code path looked at, and the channel got "No response generated". These
// pin the two properties that make it reportable: it comes back at all, and it
// comes back with credentials stripped, since a CLI failing on auth tends to
// echo the key it was handed.

const tail = (stderrBuf) =>
  ClaudeAdapter.prototype._stderrTail.call(null, { stderrBuf });

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

  test('reads as empty when the process said nothing, rather than as a blank error', () => {
    assert.strictEqual(tail(''), '');
    assert.strictEqual(tail('   \n  '), '');
    assert.strictEqual(tail(undefined), '');
    assert.strictEqual(ClaudeAdapter.prototype._stderrTail.call(null, null), '');
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

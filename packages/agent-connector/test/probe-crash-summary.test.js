'use strict';

// Daily errors dashboard, 2026-11-24: a probe child that died without a word
// was reported as "probe failed".
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { probeCrashSummary, parseProbeOutput } = require('../src/daemon');

describe('probeCrashSummary', () => {
  it('keeps the line that names the error', () => {
    const stderr = "node:internal/modules/cjs/loader:1433\n  throw err;\n  ^\n\nError: Cannot find module 'yaml'\n    at Module._resolveFilename";
    assert.equal(probeCrashSummary(stderr, { code: 1 }), "Error: Cannot find module 'yaml'");
  });

  it('says it was stopped even next to a stray warning', () => {
    assert.equal(
      probeCrashSummary('(node:1234) ExperimentalWarning: something', { code: null, signal: 'SIGKILL' }),
      'The test process was stopped (SIGKILL) before it reported a result: (node:1234) ExperimentalWarning: something',
    );
  });

  it('names the exit code or signal when nothing was said', () => {
    assert.equal(probeCrashSummary('', { code: 3 }), 'The test process exited with code 3 before it reported a result');
    assert.equal(probeCrashSummary('', { code: null, signal: 'SIGKILL' }), 'The test process was stopped (SIGKILL) before it reported a result');
    assert.equal(probeCrashSummary(''), 'The test process ended before it reported a result');
  });
});

describe('parseProbeOutput', () => {
  it('reads the verdict on the last line after other output', () => {
    const out = '(node:1) DeprecationWarning: punycode\n{"ok":false,"code":"invalid_api_key"}\n';
    assert.deepEqual(parseProbeOutput(out), { ok: false, code: 'invalid_api_key' });
  });

  it('reads a verdict printed across several lines', () => {
    assert.deepEqual(parseProbeOutput('{\n  "ok": true\n}'), { ok: true });
  });

  it('is null when there is no verdict', () => {
    assert.equal(parseProbeOutput(''), null);
    assert.equal(parseProbeOutput('Segmentation fault'), null);
  });
});

'use strict';

// OpenClaw CLI output parsing: the {"payloads":[...]} envelope is an internal
// wire format. Text payloads become the chat reply; an envelope WITHOUT text
// must resolve empty (the caller posts a clean "no response" notice) — never
// leak the raw JSON (sessionFile, usage, contextBudgetStatus…) into chat,
// which is exactly what users saw when a run produced no reply payload.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const OpenClawAdapter = require('../src/adapters/openclaw');

function parse(output) {
  let result;
  OpenClawAdapter.prototype._parseCliOutput.call(
    { _log: () => {} },
    output,
    (r) => { result = r; },
  );
  return result;
}

describe('OpenClawAdapter._parseCliOutput', () => {
  it('extracts text payloads', () => {
    const out = 'trace line\n' + JSON.stringify({ payloads: [{ text: '42' }], meta: { durationMs: 5 } });
    assert.equal(parse(out), '42');
  });

  it('joins multiple text payloads', () => {
    const out = JSON.stringify({ payloads: [{ text: 'a' }, { text: 'b' }] });
    assert.equal(parse(out), 'a\n\nb');
  });

  it('resolves empty for an envelope with no text payloads — never the raw JSON', () => {
    const envelope = JSON.stringify({
      payloads: [],
      meta: { durationMs: 9235, agentMeta: { sessionFile: 'C:/x.jsonl', model: 'deepseek-4-flash' } },
    }, null, 1);
    const result = parse('noise\n' + envelope);
    assert.equal(result, '');
  });

  it('treats a NO_REPLY payload as silence, not as an answer', () => {
    const out = JSON.stringify({ payloads: [{ text: 'NO_REPLY' }], meta: {} });
    assert.equal(parse(out), '');
  });

  it('suppresses an unparseable envelope instead of dumping it into chat', () => {
    const broken = '{"payloads": [ THIS IS NOT JSON';
    assert.equal(parse(broken), '');
  });

  it('still returns plain non-envelope output via the fallback', () => {
    assert.equal(parse('plain answer\n[diagnostic] noise'), 'plain answer');
  });
});

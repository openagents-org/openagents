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

// Braces in the reply text are not JSON structure. Counted as structure, a
// lone "}" ended the envelope early, the cut-off JSON failed to parse, and a
// reply OpenClaw had produced was posted as "No response generated"
// (daily report 2026-11-06, OpenClaw on Linux, core 0.2.217).
describe('OpenClawAdapter._parseCliOutput — braces inside the reply', () => {
  // How `openclaw agent --json` leaves it: trace lines, the envelope, more trace.
  function run(text, { pretty = true } = {}) {
    const envelope = { payloads: [{ text, mediaUrl: null }], meta: { durationMs: 4200, agentMeta: { model: 'deepseek-flash' } } };
    return '[diagnostic] lane task done\n'
      + JSON.stringify(envelope, null, pretty ? 2 : 0)
      + '\n[agent/embedded] run finished {status=ok}\n';
  }

  const replies = {
    'a lone closing brace': 'The output ends with `}`, so the JSON was cut off.',
    'a lone opening brace': 'The function body starts with `{`.',
    'the end of a code block': '```js\n  return x;\n}\n```',
    'escaped quotes and backslashes next to braces': 'Run "echo \\"}\\"" in C:\\tmp\\{dir}\\',
  };

  for (const [name, text] of Object.entries(replies)) {
    it(`keeps a reply with ${name} (pretty-printed envelope)`, () => {
      assert.equal(parse(run(text)), text);
    });
    it(`keeps a reply with ${name} (one-line envelope)`, () => {
      assert.equal(parse(run(text, { pretty: false })), text);
    });
  }

  it('skips a cut-off envelope quoted in a trace line and reads the real one', () => {
    const out = '[trace] previous result {"payloads":[{"text":"half\n'
      + JSON.stringify({ payloads: [{ text: 'the answer }' }], meta: {} }, null, 2) + '\n';
    assert.equal(parse(out), 'the answer }');
  });
});

describe('OpenClawAdapter._traceOnly', () => {
  it('takes out the whole envelope even when the reply has a lone brace', () => {
    const reply = JSON.stringify({ payloads: [{ text: 'settings.json ends with } and the key is invalid' }] }, null, 2);
    const trace = OpenClawAdapter._traceOnly('[trace] start\n' + reply + '\n[trace] end\n');
    assert.equal(trace, '[trace] start\n\n[trace] end\n');
  });
});

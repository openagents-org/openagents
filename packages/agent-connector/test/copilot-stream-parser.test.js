'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  CopilotStreamParser,
  frameChunk,
  parseLine,
  classifyEvent,
  redactSensitive,
  diagnosticForUnknown,
} = require('../src/adapters/copilot-stream-parser');

// Collect all events produced by feeding `chunks` then flushing.
function run(chunks) {
  const p = new CopilotStreamParser();
  const out = [];
  for (const c of chunks) out.push(...p.push(c));
  out.push(...p.flush());
  return out;
}

describe('copilot framing (schema-agnostic)', () => {
  it('frames a single complete line', () => {
    const { lines, rest } = frameChunk('', '{"a":1}\n');
    assert.deepEqual(lines, ['{"a":1}']);
    assert.equal(rest, '');
  });

  it('carries a partial line across chunks (JSON split mid-object)', () => {
    const p = new CopilotStreamParser();
    assert.deepEqual(p.push('{"type":"text","te'), []);
    const ev = p.push('xt":"hi"}\n');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].kind, 'text');
    assert.equal(ev[0].text, 'hi');
  });

  it('splits multiple JSON objects in one chunk', () => {
    const evs = run(['{"type":"reasoning","text":"a"}\n{"type":"text","text":"b"}\n']);
    assert.equal(evs.length, 2);
    assert.equal(evs[0].kind, 'reasoning');
    assert.equal(evs[1].kind, 'text');
  });

  it('handles CRLF line endings', () => {
    const evs = run(['{"type":"text","text":"x"}\r\n{"type":"done"}\r\n']);
    assert.deepEqual(evs.map((e) => e.kind), ['text', 'done']);
    assert.equal(evs[0].text, 'x');
  });

  it('skips blank lines and whitespace-only lines', () => {
    const evs = run(['\n   \n{"type":"text","text":"y"}\n\n']);
    assert.equal(evs.length, 1);
    assert.equal(evs[0].text, 'y');
  });

  it('skips non-JSON noise/banner lines without throwing', () => {
    const evs = run(['Copilot CLI v1.2.3\nLogging in...\n{"type":"text","text":"z"}\n']);
    assert.equal(evs.length, 1);
    assert.equal(evs[0].text, 'z');
  });

  it('does not drop the whole task on one corrupt JSON line', () => {
    const evs = run(['{"type":"text","text":"a"}\n{ broken json \n{"type":"text","text":"b"}\n']);
    assert.deepEqual(evs.map((e) => e.text), ['a', 'b']);
  });

  it('flushes a trailing line with no terminating newline (process exit)', () => {
    const p = new CopilotStreamParser();
    assert.deepEqual(p.push('{"type":"done"}'), []); // no newline yet
    const tail = p.flush();
    assert.equal(tail.length, 1);
    assert.equal(tail[0].kind, 'done');
  });

  it('flush is idempotent and empty when nothing buffered', () => {
    const p = new CopilotStreamParser();
    assert.deepEqual(p.flush(), []);
    assert.deepEqual(p.flush(), []);
  });

  it('accepts Buffer chunks', () => {
    const evs = run([Buffer.from('{"type":"text","text":"buf"}\n', 'utf-8')]);
    assert.equal(evs[0].text, 'buf');
  });

  it('parseLine returns null for blank / noise / array-less primitives', () => {
    assert.equal(parseLine(''), null);
    assert.equal(parseLine('   '), null);
    assert.equal(parseLine('hello'), null);
    assert.equal(parseLine('42'), null);
    assert.equal(parseLine('null'), null);
    assert.deepEqual(parseLine('{"a":1}'), { a: 1 });
  });
});

describe('copilot classification (schema mapping)', () => {
  it('maps a session id from several aliases', () => {
    assert.equal(classifyEvent({ type: 'session', session_id: 'abc' }).sessionId, 'abc');
    assert.equal(classifyEvent({ type: 'thread.started', thread_id: 't1' }).sessionId, 't1');
    assert.equal(classifyEvent({ type: 'session.created', id: 's9' }).sessionId, 's9');
  });

  it('session event without any id degrades to unknown (no guessing)', () => {
    assert.equal(classifyEvent({ type: 'session' }).kind, 'unknown');
  });

  it('streaming text vs final text are distinct kinds', () => {
    assert.equal(classifyEvent({ type: 'text.delta', delta: 'he' }).kind, 'text_delta');
    assert.equal(classifyEvent({ type: 'text.delta', delta: 'he' }).text, 'he');
    assert.equal(classifyEvent({ type: 'message.completed', text: 'done' }).kind, 'text');
  });

  it('extracts text from nested content blocks', () => {
    const ev = classifyEvent({ type: 'assistant', message: { content: [{ text: 'a' }, { text: 'b' }] } });
    assert.equal(ev.kind, 'text');
    assert.equal(ev.text, 'ab');
  });

  it('reasoning is its own kind (never treated as final text)', () => {
    const ev = classifyEvent({ type: 'thinking', text: 'pondering' });
    assert.equal(ev.kind, 'reasoning');
    assert.equal(ev.text, 'pondering');
  });

  it('classifies tool start with input under multiple field names', () => {
    const a = classifyEvent({ type: 'tool_call', name: 'grep', arguments: { pattern: 'x' } });
    assert.equal(a.kind, 'tool_start');
    assert.equal(a.tool, 'grep');
    assert.deepEqual(a.input, { pattern: 'x' });
    const b = classifyEvent({ type: 'function_call', function: 'edit', params: { p: 1 } });
    assert.equal(b.tool, 'edit');
  });

  it('classifies tool result and flags errors (incl. nonzero exit code)', () => {
    assert.equal(classifyEvent({ type: 'tool_result', output: 'ok' }).isError, false);
    assert.equal(classifyEvent({ type: 'tool_result', is_error: true }).isError, true);
    assert.equal(classifyEvent({ type: 'tool_result', exit_code: 2 }).isError, true);
  });

  it('classifies file change with path and action', () => {
    const ev = classifyEvent({ type: 'file_change', path: 'a/b.ts', action: 'write' });
    assert.equal(ev.kind, 'file_change');
    assert.equal(ev.path, 'a/b.ts');
    assert.equal(ev.action, 'write');
    assert.equal(classifyEvent({ type: 'file_read', file: 'x.md' }).action, 'read');
  });

  it('classifies shell execution with exit code', () => {
    const ev = classifyEvent({ type: 'command_execution', command: 'ls -la', exit_code: 0, output: 'files' });
    assert.equal(ev.kind, 'shell');
    assert.equal(ev.command, 'ls -la');
    assert.equal(ev.exitCode, 0);
  });

  it('handles the nested item.* wrapping shape', () => {
    const ev = classifyEvent({ type: 'item.completed', item: { type: 'command_execution', command: 'pwd', exit_code: 0 } });
    assert.equal(ev.kind, 'shell');
    assert.equal(ev.command, 'pwd');
  });

  it('classifies permission and ask_user', () => {
    assert.equal(classifyEvent({ type: 'permission_denied', tool: 'write' }).kind, 'permission');
    assert.equal(classifyEvent({ type: 'permission', granted: true }).granted, true);
    assert.equal(classifyEvent({ type: 'ask_user', question: 'Proceed?' }).question, 'Proceed?');
  });

  it('classifies usage with model + token info', () => {
    const ev = classifyEvent({ type: 'usage', model: 'gpt-x', usage: { input: 10, output: 5 } });
    assert.equal(ev.kind, 'usage');
    assert.equal(ev.model, 'gpt-x');
    assert.deepEqual(ev.usage, { input: 10, output: 5 });
  });

  it('classifies terminal done and error', () => {
    assert.equal(classifyEvent({ type: 'turn.completed' }).kind, 'done');
    const err = classifyEvent({ type: 'error', error: { message: 'boom', code: 'E1' } });
    assert.equal(err.kind, 'error');
    assert.equal(err.message, 'boom');
    assert.equal(err.code, 'E1');
  });

  it('unrecognized type degrades to unknown with a redacted diagnostic', () => {
    const ev = classifyEvent({ type: 'totally_new_event_v9', detail: 'whatever' });
    assert.equal(ev.kind, 'unknown');
    assert.equal(typeof ev.raw, 'string');
    assert.ok(ev.raw.includes('totally_new_event_v9'));
  });
});

describe('copilot redaction', () => {
  it('redacts GitHub tokens (classic + fine-grained)', () => {
    assert.ok(!redactSensitive('token ghp_' + 'A'.repeat(36)).includes('ghp_'));
    assert.ok(!redactSensitive('github_pat_' + 'B'.repeat(30)).includes('github_pat_'));
  });

  it('redacts secret env assignments but keeps the key name', () => {
    const out = redactSensitive('COPILOT_GITHUB_TOKEN=ghs_' + 'C'.repeat(36));
    assert.ok(out.includes('COPILOT_GITHUB_TOKEN'));
    assert.ok(!out.includes('ghs_'));
    assert.ok(out.includes('***'));
  });

  it('redacts Authorization / x-api-key headers', () => {
    const out = redactSensitive('Authorization: Bearer ' + 'd'.repeat(40));
    assert.ok(out.toLowerCase().includes('authorization'));
    assert.ok(!out.includes('d'.repeat(40)));
  });

  it('redacts inside error events flowing through classifyEvent', () => {
    const ev = classifyEvent({ type: 'error', message: 'auth failed token=ghp_' + 'E'.repeat(36) });
    assert.ok(!ev.message.includes('ghp_'));
  });

  it('diagnosticForUnknown truncates and redacts', () => {
    const big = { type: 'x', blob: 'gho_' + 'F'.repeat(50), pad: 'y'.repeat(500) };
    const d = diagnosticForUnknown(big);
    assert.ok(d.length <= 301);
    assert.ok(!d.includes('gho_'));
  });

  it('never throws on circular / weird input', () => {
    const circ = {}; circ.self = circ;
    assert.doesNotThrow(() => redactSensitive(circ));
    assert.doesNotThrow(() => classifyEvent(circ));
    assert.doesNotThrow(() => classifyEvent(null));
    assert.doesNotThrow(() => classifyEvent(42));
  });
});

describe('copilot end-to-end stream (no duplicate final text)', () => {
  it('a realistic turn yields session, deltas, final, done', () => {
    const evs = run([
      '{"type":"session","session_id":"sess-1"}\n',
      '{"type":"text.delta","delta":"Hel"}\n{"type":"text.delta","delta":"lo"}\n',
      '{"type":"tool_call","name":"shell","arguments":{"command":"ls"}}\n',
      '{"type":"tool_result","output":"a.txt","exit_code":0}\n',
      '{"type":"message.completed","text":"Hello, done."}\n',
      '{"type":"usage","model":"m","usage":{"input":1}}\n',
      '{"type":"done","status":"completed"}',
    ]);
    const kinds = evs.map((e) => e.kind);
    assert.deepEqual(kinds, [
      'session', 'text_delta', 'text_delta', 'tool_start', 'tool_result', 'text', 'usage', 'done',
    ]);
    assert.equal(evs[0].sessionId, 'sess-1');
    // Exactly one terminal 'done' and one final 'text' — adapter relies on this
    // to avoid double-posting completion / final answer.
    assert.equal(kinds.filter((k) => k === 'done').length, 1);
    assert.equal(kinds.filter((k) => k === 'text').length, 1);
  });
});

describe('copilot real stream (captured from CLI v1.0.83)', () => {
  /**
   * Verbatim lines from a live authenticated turn, de-identified only in the
   * uuids. This is the schema the guessed table missed completely: every real
   * type is `namespace.verb`, and every payload sits under `data` — so the
   * answer parsed as nothing and the user got "No response generated" for a
   * turn the CLI had in fact completed (`outcome":"success"`, exit 0).
   */
  const REAL = [
    '{"type":"assistant.turn_start","data":{"turnId":"0"},"id":"a1"}\n',
    '{"type":"model.call_start","data":{"turnId":"0","model":"gpt-5.6-luna"},"ephemeral":true,"id":"a2"}\n',
    '{"type":"assistant.reasoning_delta","data":{"reasoningId":"r1","deltaContent":"Th"},"ephemeral":true,"id":"a3a"}\n',
    '{"type":"assistant.reasoning_delta","data":{"reasoningId":"r1","deltaContent":"ink"},"ephemeral":true,"id":"a3b"}\n',
    '{"type":"assistant.reasoning_delta","data":{"reasoningId":"r1","deltaContent":"ing"},"ephemeral":true,"id":"a3c"}\n',
    '{"type":"assistant.message_start","data":{"messageId":"m1","phase":"final_answer"},"ephemeral":true,"id":"a4"}\n',
    '{"type":"assistant.message_delta","data":{"messageId":"m1","deltaContent":"Hello"},"ephemeral":true,"id":"a5"}\n',
    '{"type":"assistant.message_delta","data":{"messageId":"m1","deltaContent":"!"},"ephemeral":true,"id":"a6"}\n',
    '{"type":"model.call_finished","data":{"turnId":"0","outcome":"success"},"ephemeral":true,"id":"a7"}\n',
    '{"type":"assistant.reasoning","data":{"reasoningId":"r1","content":"Thinking, whole block"},"id":"a8"}\n',
    '{"type":"assistant.turn_end","data":{"turnId":"0"},"id":"a9"}\n',
    '{"type":"result","timestamp":"2026-09-10T15:09:52.383Z","sessionId":"00f9c63e-2446-420d-8986-cf0bdca8d9bd","exitCode":0,"usage":{"premiumRequests":1}}',
  ];

  it('reads the answer out of assistant.message_delta', () => {
    const text = run(REAL)
      .filter((e) => e.kind === 'text_delta')
      .map((e) => e.text)
      .join('');
    assert.equal(text, 'Hello!');
  });

  it('unwraps `data` rather than reading the envelope', () => {
    // The whole bug in one assertion: without the unwrap the delta events
    // classify but carry an empty string, which reaches the user as
    // "No response generated" instead of the answer.
    const deltas = run(REAL).filter((e) => e.kind === 'text_delta');
    assert.equal(deltas.length, 2);
    assert.ok(deltas.every((d) => d.text.length > 0));
  });

  it('takes the session id off the terminal result frame', () => {
    // There is no session event anywhere earlier in a real stream; without
    // this the next turn can never resume.
    const done = run(REAL).filter((e) => e.kind === 'done');
    assert.equal(done.length, 1);
    assert.equal(done[0].sessionId, '00f9c63e-2446-420d-8986-cf0bdca8d9bd');
  });

  it('narrates thinking as ONE block, not one message per token', () => {
    // The regression this guards: Copilot streams reasoning a token at a time
    // (81 deltas for one short thought on the real run). Mapping the deltas
    // posted a chat message each — a column of one-word bullets — so only the
    // whole `assistant.reasoning` block is narrated.
    const reasoning = run(REAL).filter((e) => e.kind === 'reasoning');
    assert.equal(reasoning.length, 1);
    assert.equal(reasoning[0].text, 'Thinking, whole block');
  });

  it('never turns an answer token into its own event', () => {
    // Same shape of bug on the answer side: message_delta IS the final answer
    // arriving piecewise, so it must accumulate silently and never be narrated.
    const evs = run(REAL);
    const deltas = evs.filter((e) => e.kind === 'text_delta');
    assert.equal(deltas.length, 2);
    // No 'text' event — nothing re-publishes the answer mid-stream.
    assert.equal(evs.filter((e) => e.kind === 'text').length, 0);
  });

  it('leaves lifecycle bookkeeping unrendered', () => {
    // turn_start / message_start / turn_end / call_start carry nothing a user
    // should see. They must not become text, reasoning, or a premature done.
    const kinds = run(REAL).map((e) => e.kind);
    assert.equal(kinds.filter((k) => k === 'done').length, 1);
    assert.equal(kinds.filter((k) => k === 'text').length, 0);
    assert.ok(kinds.includes('unknown'));
  });
});

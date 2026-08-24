'use strict';

/**
 * Unit tests for the pure Pi RPC framing / classification module.
 *
 * Everything here runs without a Pi CLI, an API key or a network: the module
 * under test has no I/O at all. The wire shapes asserted below are the ones
 * documented in @earendil-works/pi-coding-agent v0.83.0's docs/rpc.md and
 * captured from a live `pi --mode rpc` session.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  PiJsonlFramer,
  PiStreamParser,
  PiAssistantAccumulator,
  classifyPiEvent,
  parseLine,
  buildPiArgs,
  classifyPiError,
  classifyPiVersion,
  classifyNodeVersion,
  compareVersions,
  isValidSessionId,
  normalizeThinking,
  parseTrustProject,
  parseWindowsCmdShim,
  redactSecrets,
  redactArgs,
  summarizeToolArgs,
  MIN_PI_VERSION,
  MIN_NODE_VERSION,
} = require('../src/adapters/pi-stream');

const enc = (s) => Buffer.from(s, 'utf-8');

// ---------------------------------------------------------------------------
// 1–7: framing
// ---------------------------------------------------------------------------

describe('PiJsonlFramer / PiStreamParser framing', () => {
  it('reassembles one JSON record split across many chunks', () => {
    const parser = new PiStreamParser();
    const record = JSON.stringify({ type: 'agent_start' }) + '\n';
    let events = [];
    for (const byte of record.split('')) events = events.concat(parser.push(enc(byte)));
    assert.deepEqual(events, [{ kind: 'agent_start' }]);
  });

  it('splits many JSON records carried by a single chunk', () => {
    const parser = new PiStreamParser();
    const chunk =
      JSON.stringify({ type: 'agent_start' }) + '\n' +
      JSON.stringify({ type: 'turn_start' }) + '\n' +
      JSON.stringify({ type: 'agent_settled' }) + '\n';
    const events = parser.push(enc(chunk));
    assert.deepEqual(events.map((e) => e.kind), ['agent_start', 'turn_start', 'agent_settled']);
  });

  it('reassembles multi-byte UTF-8 split mid-character (CJK + emoji)', () => {
    const parser = new PiStreamParser();
    const text = '你好，世界 — 修复这个 bug 🚀🇯🇵';
    const buf = enc(JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: text },
    }) + '\n');

    // Feed one byte at a time: every multi-byte sequence is split.
    let events = [];
    for (let i = 0; i < buf.length; i++) events = events.concat(parser.push(buf.subarray(i, i + 1)));

    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'message_update');
    assert.equal(events[0].delta.content, text);
    assert.ok(!events[0].delta.content.includes('�'), 'no replacement characters');
  });

  it('never treats U+2028 / U+2029 as a record separator', () => {
    const parser = new PiStreamParser();
    // Both separators live INSIDE a JSON string, exactly the case that makes
    // Node's readline non-compliant for this protocol.
    const text = 'line one\u2028line two\u2029line three';
    const events = parser.push(enc(JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: text },
    }) + '\n'));
    assert.equal(events.length, 1, 'one record, not three');
    assert.equal(events[0].delta.content, text);
  });

  it('strips a trailing CR from \\r\\n line endings', () => {
    const framer = new PiJsonlFramer();
    const lines = framer.push(enc('{"type":"agent_start"}\r\n{"type":"agent_settled"}\r\n'));
    assert.deepEqual(lines, ['{"type":"agent_start"}', '{"type":"agent_settled"}']);
  });

  it('degrades a single invalid JSON line to `unknown` without throwing', () => {
    const parser = new PiStreamParser();
    const events = parser.push(enc(
      'not json at all\n' +
      '{"type":"agent_start"}\n' +
      '{"type": broken\n' +
      '{"type":"agent_settled"}\n',
    ));
    assert.deepEqual(events.map((e) => e.kind), ['unknown', 'agent_start', 'unknown', 'agent_settled']);
    assert.match(events[0].raw, /not json at all/);
  });

  it('drops an over-long unterminated record and resynchronizes on the next LF', () => {
    const parser = new PiStreamParser({ maxLineBytes: 64 });
    // A record far beyond the cap, never terminated within this chunk.
    const huge = parser.push(enc('{"type":"agent_start","pad":"' + 'x'.repeat(500)));
    assert.deepEqual(huge.map((e) => e.kind), ['oversize']);
    assert.ok(huge[0].bytes > 64);

    // The tail of the dropped record plus a good record after it.
    const after = parser.push(enc('"}\n{"type":"agent_settled"}\n'));
    assert.deepEqual(after.map((e) => e.kind), ['agent_settled']);
  });

  it('flushes a trailing record that arrived without a final newline', () => {
    const parser = new PiStreamParser();
    assert.deepEqual(parser.push(enc('{"type":"agent_settled"}')), []);
    assert.deepEqual(parser.flush().map((e) => e.kind), ['agent_settled']);
  });

  it('ignores blank lines entirely', () => {
    const parser = new PiStreamParser();
    assert.deepEqual(parser.push(enc('\n\n   \n')), []);
  });

  it('parseLine rejects non-objects and blank input', () => {
    assert.equal(parseLine(''), null);
    assert.equal(parseLine('   '), null);
    assert.equal(parseLine('[1,2]'), null);
    assert.equal(parseLine('"a string"'), null);
    assert.deepEqual(parseLine('{"a":1}'), { a: 1 });
  });
});

// ---------------------------------------------------------------------------
// 8: RPC response correlation
// ---------------------------------------------------------------------------

describe('RPC response correlation', () => {
  it('carries the request id, command and success flag through', () => {
    const ev = classifyPiEvent({
      id: 'oa-7', type: 'response', command: 'prompt', success: true,
    });
    assert.deepEqual(ev, {
      kind: 'response', id: 'oa-7', command: 'prompt', success: true, data: null, error: null,
    });
  });

  it('surfaces a failed response with its error string', () => {
    const ev = classifyPiEvent({
      id: 'oa-8', type: 'response', command: 'set_model', success: false,
      error: 'Model not found: invalid/model',
    });
    assert.equal(ev.success, false);
    assert.equal(ev.error, 'Model not found: invalid/model');
  });

  it('classifies an id-less response (Pi parse errors) without throwing', () => {
    const ev = classifyPiEvent({ type: 'response', command: 'parse', success: false, error: 'bad' });
    assert.equal(ev.kind, 'response');
    assert.equal(ev.id, null);
  });

  it('an unknown id is still a well-formed response the caller can ignore', () => {
    // The adapter drops responses whose id is not in its pending map; the
    // parser's job is only to never throw and to preserve the id verbatim.
    const ev = classifyPiEvent({ id: 'someone-elses-id', type: 'response', command: 'abort', success: true });
    assert.equal(ev.id, 'someone-elses-id');
    assert.equal(ev.success, true);
  });
});

// ---------------------------------------------------------------------------
// 9: message_update / message_end deduplication
// ---------------------------------------------------------------------------

describe('PiAssistantAccumulator (message_update vs message_end dedup)', () => {
  it('releases a streamed block once and does not repeat it at message_end', () => {
    const acc = new PiAssistantAccumulator();
    acc.startMessage();
    assert.deepEqual(acc.pushDelta({ type: 'text_start', contentIndex: 0 }), []);
    assert.deepEqual(acc.pushDelta({ type: 'text_delta', contentIndex: 0, delta: 'Hello' }), []);
    assert.deepEqual(acc.pushDelta({ type: 'text_delta', contentIndex: 0, delta: ' world' }), []);
    const streamed = acc.pushDelta({ type: 'text_end', contentIndex: 0, content: 'Hello world' });
    assert.deepEqual(streamed, [{ type: 'text', text: 'Hello world' }]);

    const end = acc.endMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello world' }],
      stopReason: 'stop',
    });
    assert.deepEqual(end.blocks, [], 'message_end must not re-emit an already streamed block');
    assert.deepEqual(end.texts, ['Hello world'], 'but it is still part of the final answer');
  });

  it('emits a block at message_end when its streaming *_end never arrived', () => {
    const acc = new PiAssistantAccumulator();
    acc.startMessage();
    const end = acc.endMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'Non-streaming answer' }],
      stopReason: 'stop',
    });
    assert.deepEqual(end.blocks, [{ type: 'text', text: 'Non-streaming answer' }]);
    assert.deepEqual(end.texts, ['Non-streaming answer']);
  });

  it('keeps thinking blocks out of the answer text', () => {
    const acc = new PiAssistantAccumulator();
    acc.startMessage();
    acc.pushDelta({ type: 'thinking_end', contentIndex: 0, content: 'internal reasoning' });
    acc.pushDelta({ type: 'text_end', contentIndex: 1, content: 'The answer.' });
    const end = acc.endMessage({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'internal reasoning' },
        { type: 'text', text: 'The answer.' },
      ],
      stopReason: 'stop',
    });
    assert.deepEqual(end.blocks, []);
    assert.deepEqual(end.texts, ['The answer.']);
    assert.deepEqual(end.thinking, ['internal reasoning']);
  });

  it('scopes released blocks per message so a tool loop keeps only the last answer', () => {
    const acc = new PiAssistantAccumulator();
    // First assistant message: narration before a tool call, same contentIndex.
    acc.startMessage();
    acc.pushDelta({ type: 'text_end', contentIndex: 0, content: 'Let me look at the file.' });
    const first = acc.endMessage({ role: 'assistant', content: [{ type: 'text', text: 'Let me look at the file.' }] });
    assert.deepEqual(first.texts, ['Let me look at the file.']);

    // Second assistant message reuses contentIndex 0 — it must NOT be deduped
    // against the previous message's block.
    acc.startMessage();
    const streamed = acc.pushDelta({ type: 'text_end', contentIndex: 0, content: 'Done — fixed it.' });
    assert.deepEqual(streamed, [{ type: 'text', text: 'Done — fixed it.' }]);
    const second = acc.endMessage({ role: 'assistant', content: [{ type: 'text', text: 'Done — fixed it.' }] });
    assert.deepEqual(second.texts, ['Done — fixed it.'], 'the final message alone is the answer');
  });

  it('reports a message-level provider error, redacted', () => {
    const acc = new PiAssistantAccumulator();
    acc.startMessage();
    const end = acc.endMessage({
      role: 'assistant',
      content: [],
      stopReason: 'error',
      errorMessage: '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    });
    assert.equal(end.stopReason, 'error');
    assert.match(end.errorMessage, /authentication_error/);
  });

  it('drops empty and whitespace-only blocks', () => {
    const acc = new PiAssistantAccumulator();
    acc.startMessage();
    assert.deepEqual(acc.pushDelta({ type: 'text_end', contentIndex: 0, content: '   ' }), []);
    const end = acc.endMessage({ role: 'assistant', content: [{ type: 'text', text: '   ' }] });
    assert.deepEqual(end.blocks, []);
    assert.deepEqual(end.texts, []);
  });
});

// ---------------------------------------------------------------------------
// 10: Pi event → OpenAgents mapping, asserted event by event
// ---------------------------------------------------------------------------

describe('classifyPiEvent — Pi event → normalized kind', () => {
  const CASES = [
    [{ type: 'agent_start' }, 'agent_start'],
    [{ type: 'agent_end', messages: [], willRetry: false }, 'agent_end'],
    [{ type: 'agent_settled' }, 'agent_settled'],
    [{ type: 'turn_start' }, 'turn_start'],
    [{ type: 'turn_end', message: {}, toolResults: [] }, 'turn_end'],
    [{ type: 'message_start', message: { role: 'assistant' } }, 'message_start'],
    [{ type: 'message_update', assistantMessageEvent: { type: 'text_delta' } }, 'message_update'],
    [{ type: 'message_end', message: { role: 'assistant' } }, 'message_end'],
    [{ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: {} }, 'tool_start'],
    [{ type: 'tool_execution_update', toolCallId: 'c1', toolName: 'bash' }, 'tool_update'],
    [{ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', result: {}, isError: false }, 'tool_end'],
    [{ type: 'bash_execution_update', id: 'r1', delta: 'out' }, 'bash_output'],
    [{ type: 'queue_update', steering: [], followUp: [] }, 'queue_update'],
    [{ type: 'compaction_start', reason: 'threshold' }, 'compaction_start'],
    [{ type: 'compaction_end', reason: 'threshold', aborted: false }, 'compaction_end'],
    [{ type: 'auto_retry_start', attempt: 1, maxAttempts: 3 }, 'retry_start'],
    [{ type: 'auto_retry_end', success: true, attempt: 2 }, 'retry_end'],
    [{ type: 'summarization_retry_scheduled', attempt: 1 }, 'retry_start'],
    [{ type: 'summarization_retry_finished' }, 'retry_end'],
    [{ type: 'extension_error', extensionPath: '/x.ts', error: 'boom' }, 'extension_error'],
    [{ type: 'extension_ui_request', id: 'u1', method: 'confirm' }, 'ui_request'],
    [{ type: 'response', command: 'prompt', success: true }, 'response'],
    [{ type: 'a_type_pi_has_not_invented_yet' }, 'unknown'],
    [{ noTypeAtAll: 1 }, 'unknown'],
  ];

  for (const [raw, kind] of CASES) {
    it(`maps ${raw.type || '(untyped)'} → ${kind}`, () => {
      assert.equal(classifyPiEvent(raw).kind, kind);
    });
  }

  it('extracts a redacted tool preview from tool_execution_start', () => {
    const ev = classifyPiEvent({
      type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash',
      args: { command: 'curl -H "authorization: Bearer sk-live-abcdefghijklmnop" https://x' },
    });
    assert.equal(ev.toolName, 'bash');
    assert.ok(!ev.preview.includes('sk-live-abcdefghijklmnop'), 'the bearer token must be masked');
  });

  it('truncates a very long tool preview', () => {
    const ev = classifyPiEvent({
      type: 'tool_execution_start', toolName: 'bash', args: { command: 'a'.repeat(1000) },
    });
    assert.ok(ev.preview.length <= 161, `preview was ${ev.preview.length} chars`);
    assert.ok(ev.preview.endsWith('…'));
  });

  it('flags a tool failure', () => {
    const ev = classifyPiEvent({
      type: 'tool_execution_end', toolName: 'edit', isError: true,
      result: { content: [{ type: 'text', text: 'file not found' }] },
    });
    assert.equal(ev.isError, true);
    assert.equal(ev.preview, 'file not found');
  });

  it('marks only the four blocking extension UI methods as needing a reply', () => {
    for (const method of ['select', 'confirm', 'input', 'editor']) {
      assert.equal(classifyPiEvent({ type: 'extension_ui_request', id: 'u', method }).needsResponse, true, method);
    }
    for (const method of ['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text']) {
      assert.equal(classifyPiEvent({ type: 'extension_ui_request', id: 'u', method }).needsResponse, false, method);
    }
  });

  it('summarizeToolArgs falls back to key names when no known field is present', () => {
    assert.equal(summarizeToolArgs('mystery', { alpha: 1, beta: 2 }), 'alpha, beta');
    assert.equal(summarizeToolArgs('mystery', null), '');
  });
});

// ---------------------------------------------------------------------------
// 11: redaction on the log / error paths
// ---------------------------------------------------------------------------

describe('redaction', () => {
  it('masks an exact known secret anywhere it appears', () => {
    const key = 'sk-ant-api03-SUPERSECRETVALUE01234';
    const out = redactSecrets(`failed with ${key} in header`, [key]);
    assert.ok(!out.includes(key));
    assert.match(out, /\*\*\*/);
  });

  it('masks key=value, bearer tokens, provider key shapes and URL credentials', () => {
    const samples = [
      ['api_key=abcdefghijklmnop', 'abcdefghijklmnop'],
      ['Authorization: Bearer abcdefghijklmnopqrst', 'abcdefghijklmnopqrst'],
      ['token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'],
      ['using sk-proj-abcdefghijkl now', 'sk-proj-abcdefghijkl'],
      ['https://user:hunter2@relay.example.com/v1', 'hunter2'],
    ];
    for (const [input, secret] of samples) {
      const out = redactSecrets(input);
      assert.ok(!out.includes(secret), `${input} → ${out}`);
    }
  });

  it('leaves ordinary prose untouched', () => {
    assert.equal(redactSecrets('Edited src/index.js and ran the tests.'),
      'Edited src/index.js and ran the tests.');
  });

  it('never throws on non-strings', () => {
    assert.equal(redactSecrets(null), '');
    assert.equal(redactSecrets(undefined), '');
    assert.equal(redactSecrets(42), '42');
  });

  it('redactArgs elides the system prompt instead of printing it', () => {
    const argv = ['pi', '--mode', 'rpc', '--append-system-prompt', 'x'.repeat(5000), '--no-approve'];
    const out = redactArgs(argv);
    assert.deepEqual(out, ['pi', '--mode', 'rpc', '--append-system-prompt', '<5000 chars>', '--no-approve']);
  });

  it('a message-level provider error keeps its meaning but not its credential', () => {
    const key = 'sk-ant-REALKEYVALUE0123456789';
    const { userMessage } = classifyPiError(`401 invalid x-api-key (${key})`);
    const masked = redactSecrets(userMessage, [key]);
    assert.ok(!masked.includes(key));
    assert.match(masked, /authentication failed/i);
  });
});

// ---------------------------------------------------------------------------
// Error classification → the shared vocabulary
// ---------------------------------------------------------------------------

describe('classifyPiError', () => {
  const CASES = [
    ['401 {"type":"error","error":{"type":"authentication_error"}}', 'auth'],
    ['Error: 429 rate limit exceeded', 'rate_limit'],
    ['prompt is too long: maximum context length is 200000 tokens', 'context'],
    ['No model matching "gpt-9000"', 'model'],
    ['unknown provider: notaprovider', 'provider'],
    ['fetch failed: getaddrinfo ENOTFOUND api.anthropic.com', 'network'],
    ['EACCES: permission denied, open \'/root/x\'', 'filesystem'],
    ['something entirely novel', null],
  ];
  for (const [raw, kind] of CASES) {
    it(`classifies "${raw.slice(0, 40)}" as ${kind}`, () => {
      assert.equal(classifyPiError(raw).kind, kind);
    });
  }

  it('always returns a non-empty user message', () => {
    for (const input of ['', null, undefined, 'x']) {
      assert.ok(classifyPiError(input).userMessage.length > 0);
    }
  });

  it('points a missing DeepSeek key at the unified Launcher field', () => {
    const message = classifyPiError('No API key found for deepseek').userMessage;
    assert.match(message, /PI_API_KEY/);
    assert.match(message, /DEEPSEEK_API_KEY/);
  });
});

// ---------------------------------------------------------------------------
// Version gates + argv construction
// ---------------------------------------------------------------------------

describe('version helpers', () => {
  it('compares dotted versions', () => {
    assert.equal(compareVersions('0.83.0', '0.83.0'), 0);
    assert.equal(compareVersions('0.84.0', '0.83.0'), 1);
    assert.equal(compareVersions('0.82.9', '0.83.0'), -1);
    assert.equal(compareVersions('22.22.3', '22.19.0'), 1);
    assert.equal(compareVersions('22.9.0', '22.19.0'), -1, 'numeric, not lexical');
  });

  it('takes its floor from the caller (the registry), not only the module default', () => {
    // The registry's install.min_version is authoritative; the module constant
    // is a fallback. A registry bump must move the runtime gate with it.
    assert.deepEqual(classifyPiVersion('0.83.0', '0.90.0'), { version: '0.83.0', supported: false });
    assert.deepEqual(classifyPiVersion('0.91.0', '0.90.0'), { version: '0.91.0', supported: true });
    // An unusable floor degrades to the module default rather than throwing.
    assert.equal(classifyPiVersion('0.83.0', undefined).supported, true);
    assert.equal(classifyPiVersion('0.83.0', 'not-a-version').supported, true);
  });

  it('classifies `pi --version` output', () => {
    assert.deepEqual(classifyPiVersion('0.83.0'), { version: '0.83.0', supported: true });
    assert.deepEqual(classifyPiVersion('pi 0.90.1\n'), { version: '0.90.1', supported: true });
    assert.deepEqual(classifyPiVersion('0.50.0'), { version: '0.50.0', supported: false });
    assert.deepEqual(classifyPiVersion('command not found'), { version: null, supported: null });
    assert.equal(MIN_PI_VERSION, '0.83.0');
  });

  it("classifies a Node runtime against Pi's engine floor", () => {
    assert.equal(MIN_NODE_VERSION, '22.19.0');
    assert.deepEqual(classifyNodeVersion('v22.22.3'), { version: '22.22.3', supported: true });
    assert.deepEqual(classifyNodeVersion('v22.19.0'), { version: '22.19.0', supported: true });
    assert.deepEqual(classifyNodeVersion('v20.11.1'), { version: '20.11.1', supported: false });
    assert.deepEqual(classifyNodeVersion('v22.18.9'), { version: '22.18.9', supported: false });
    assert.deepEqual(classifyNodeVersion(''), { version: null, supported: null });
  });

  it('validates session ids', () => {
    assert.equal(isValidSessionId('019fd680-2c4c-7093-a69e-a71e5b407cce'), true);
    assert.equal(isValidSessionId('not-a-uuid'), false);
    assert.equal(isValidSessionId(''), false);
    assert.equal(isValidSessionId(null), false);
    assert.equal(isValidSessionId({ sessionId: 'x' }), false);
  });

  it('normalizes the thinking level and drops junk', () => {
    assert.equal(normalizeThinking('HIGH'), 'high');
    assert.equal(normalizeThinking('  max '), 'max');
    assert.equal(normalizeThinking('turbo'), null);
    assert.equal(normalizeThinking(''), null);
    assert.equal(normalizeThinking(undefined), null);
  });

  it('defaults project trust to false for anything but an explicit opt-in', () => {
    for (const on of ['1', 'true', 'TRUE', 'yes', 'on']) assert.equal(parseTrustProject(on), true, on);
    for (const off of ['0', 'false', '', 'maybe', undefined, null]) {
      assert.equal(parseTrustProject(off), false, String(off));
    }
  });
});

describe('parseWindowsCmdShim', () => {
  // .cmd shims are Windows-only, but the parser is pure and resolved with
  // win32 path semantics, so every dialect is covered on every OS. Matching
  // only `%dp0%` (as the older sibling adapters do) silently drops the
  // `%~dp0` dialect into the `cmd.exe /c` fallback, where the ~14 KB
  // --append-system-prompt exceeds cmd.exe's 8191-character command line.
  const MODERN_NPM = [
    '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b',
    ':start', 'SETLOCAL', 'CALL :find_dp0', '',
    'IF EXIST "%dp0%\\node.exe" (',
    '  "%dp0%\\node.exe"  "%dp0%\\..\\@earendil-works\\pi-coding-agent\\dist\\cli.js" %*',
    ') ELSE (',
    '  node  "%dp0%\\..\\@earendil-works\\pi-coding-agent\\dist\\cli.js" %*',
    ')',
  ].join('\r\n');

  it('parses the modern npm dialect (SET dp0=%~dp0 … "%dp0%\\…")', () => {
    assert.deepEqual(parseWindowsCmdShim(MODERN_NPM, 'C:\\bin'), {
      kind: 'script',
      target: 'C:\\@earendil-works\\pi-coding-agent\\dist\\cli.js',
    });
  });

  it('parses the %~dp0 dialect with a separator', () => {
    assert.deepEqual(parseWindowsCmdShim('@echo off\r\nnode "%~dp0\\cli.js" %*\r\n', 'C:\\bin'), {
      kind: 'script', target: 'C:\\bin\\cli.js',
    });
  });

  it('parses %~dp0 with no separator (it already ends in a backslash)', () => {
    assert.deepEqual(parseWindowsCmdShim('@echo off\r\nnode "%~dp0cli.js" %*\r\n', 'C:\\bin'), {
      kind: 'script', target: 'C:\\bin\\cli.js',
    });
  });

  it('prefers the script over node.exe on the same line', () => {
    const shim = 'SET dp0=%~dp0\r\n"%dp0%\\node.exe" "%dp0%\\cli.mjs" %*\r\n';
    assert.deepEqual(parseWindowsCmdShim(shim, 'C:\\bin'), {
      kind: 'script', target: 'C:\\bin\\cli.mjs',
    });
  });

  it('falls back to a native .exe target when there is no script', () => {
    assert.deepEqual(parseWindowsCmdShim('SET dp0=%~dp0\r\n"%dp0%\\pi.exe" %*\r\n', 'C:\\bin'), {
      kind: 'exe', target: 'C:\\bin\\pi.exe',
    });
  });

  it('returns null for an unrecognizable or empty shim', () => {
    assert.equal(parseWindowsCmdShim('@echo off\r\nrem nothing here\r\n', 'C:\\bin'), null);
    assert.equal(parseWindowsCmdShim('', 'C:\\bin'), null);
    assert.equal(parseWindowsCmdShim(null, 'C:\\bin'), null);
  });
});

describe('buildPiArgs', () => {
  const base = { sessionDir: '/data/sess', sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };

  it('always requests RPC mode with an OpenAgents-managed session directory', () => {
    const args = buildPiArgs(base);
    assert.deepEqual(args.slice(0, 6), [
      '--mode', 'rpc', '--session-dir', '/data/sess',
      '--session-id', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    ]);
  });

  it('defaults to --no-approve and never emits --approve implicitly', () => {
    const args = buildPiArgs(base);
    assert.ok(args.includes('--no-approve'));
    assert.ok(!args.includes('--approve'));
  });

  it('emits --approve only on an explicit opt-in', () => {
    const args = buildPiArgs({ ...base, trustProject: true });
    assert.ok(args.includes('--approve'));
    assert.ok(!args.includes('--no-approve'));
  });

  it('appends the system prompt and never replaces Pi\'s own', () => {
    const args = buildPiArgs({ ...base, appendSystemPrompt: 'workspace context' });
    assert.ok(args.includes('--append-system-prompt'));
    assert.equal(args[args.indexOf('--append-system-prompt') + 1], 'workspace context');
    assert.ok(!args.includes('--system-prompt'), '--system-prompt would drop Pi\'s coding prompt');
  });

  it('passes provider / model / thinking through as separate argv entries', () => {
    const args = buildPiArgs({ ...base, provider: 'anthropic', model: 'claude-sonnet-4-6', thinking: 'high' });
    assert.equal(args[args.indexOf('--provider') + 1], 'anthropic');
    assert.equal(args[args.indexOf('--model') + 1], 'claude-sonnet-4-6');
    assert.equal(args[args.indexOf('--thinking') + 1], 'high');
  });

  it('loads explicit managed extensions without putting credentials in argv', () => {
    const args = buildPiArgs({ ...base, extensions: ['/managed/pi-provider.mjs'] });
    assert.equal(args[args.indexOf('--extension') + 1], '/managed/pi-provider.mjs');
    assert.ok(!args.includes('--api-key'));
  });

  it('omits every optional flag when nothing is configured', () => {
    const args = buildPiArgs(base);
    for (const flag of ['--provider', '--model', '--thinking', '--extension', '--name', '--append-system-prompt']) {
      assert.ok(!args.includes(flag), `${flag} must not appear`);
    }
  });

  it('NEVER emits --api-key — credentials go through the environment only', () => {
    const args = buildPiArgs({ ...base, provider: 'anthropic', model: 'm', apiKey: 'sk-should-be-ignored' });
    assert.ok(!args.includes('--api-key'));
    assert.ok(!args.some((a) => String(a).includes('sk-should-be-ignored')));
  });
});

describe('inferLauncherProvider', () => {
  const { inferLauncherProvider } = require('../src/adapters/pi-stream');

  it('infers openai + chat-completions for a generic relay base URL', () => {
    const r = inferLauncherProvider({ PI_BASE_URL: 'https://api-gateway.openagents.org/v1' });
    assert.deepEqual(r, { provider: 'openai', apiFormat: 'openai-completions' });
  });

  it('infers anthropic + anthropic-messages for anthropic-looking hosts', () => {
    const r = inferLauncherProvider({ PI_BASE_URL: 'https://api.anthropic.com' });
    assert.deepEqual(r, { provider: 'anthropic', apiFormat: 'anthropic-messages' });
  });

  it('defers to an explicit PI_PROVIDER', () => {
    assert.equal(inferLauncherProvider({ PI_PROVIDER: 'deepseek', PI_BASE_URL: 'https://x.example/v1' }), null);
  });

  it('does nothing without a base URL', () => {
    assert.equal(inferLauncherProvider({}), null);
    assert.equal(inferLauncherProvider({ PI_API_KEY: 'sk-x' }), null);
  });

  it('tolerates an unparseable base URL', () => {
    const r = inferLauncherProvider({ PI_BASE_URL: 'not a url' });
    assert.deepEqual(r, { provider: 'openai', apiFormat: 'openai-completions' });
  });
});

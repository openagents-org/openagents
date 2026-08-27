'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  COMMANDCODE_MIN_VERSION,
  buildCommandCodeArgs,
  parseFrame,
  interpretCommandCodeFrame,
  classifyCommandCodeExit,
  classifyCommandCodeVersion,
  friendlyToolLabel,
  redactSecrets,
  redactArgs,
} = require('../src/adapters/commandcode-stream');

describe('buildCommandCodeArgs', () => {
  it('always requests the JSON stream and non-interactive behavior', () => {
    const args = buildCommandCodeArgs();
    assert.ok(args.includes('-p'));
    assert.deepEqual(
      [args[args.indexOf('--output-format')], args[args.indexOf('--output-format') + 1]],
      ['--output-format', 'json'],
    );
    // Each of these removes a way for a headless run to block on a human.
    for (const flag of ['--skip-onboarding', '--trust', '--no-auto-update', '--verbose']) {
      assert.ok(args.includes(flag), `missing ${flag}`);
    }
  });

  it('never puts the prompt in argv', () => {
    // The prompt is piped over stdin. `-p` must stay valueless: a prompt in
    // argv would hit the OS length limit and need Windows quoting.
    const args = buildCommandCodeArgs({ model: 'm' });
    assert.equal(args[args.indexOf('-p') + 1], '--output-format');
  });

  it('grants write/shell access in execute mode only', () => {
    const exec = buildCommandCodeArgs();
    assert.ok(exec.includes('--yolo'));
    assert.ok(!exec.includes('--plan'));

    const plan = buildCommandCodeArgs({ planMode: true });
    assert.ok(plan.includes('--plan'));
    // --yolo alongside --plan would defeat read-only exploration.
    assert.ok(!plan.includes('--yolo'));
  });

  it('passes optional model, effort, turn limit and resume id', () => {
    const args = buildCommandCodeArgs({
      model: 'claude-sonnet-4-6',
      effort: 'high',
      maxTurns: 40,
      resumeSessionId: 'sess-1',
    });
    assert.equal(args[args.indexOf('--model') + 1], 'claude-sonnet-4-6');
    assert.equal(args[args.indexOf('--effort') + 1], 'high');
    assert.equal(args[args.indexOf('--max-turns') + 1], '40');
    assert.equal(args[args.indexOf('--resume') + 1], 'sess-1');
  });

  it('omits blank and non-positive optionals rather than passing empties', () => {
    const args = buildCommandCodeArgs({ model: '  ', effort: '', maxTurns: 0, resumeSessionId: '' });
    for (const flag of ['--model', '--effort', '--max-turns', '--resume']) {
      assert.ok(!args.includes(flag), `${flag} should be absent`);
    }
  });
});

describe('parseFrame', () => {
  it('returns null for blanks, prose and malformed JSON', () => {
    for (const line of ['', '   ', 'not json', '{"a":', '[1,2]', 'null']) {
      assert.equal(parseFrame(line), null, `expected null for ${JSON.stringify(line)}`);
    }
  });

  it('parses a well-formed object line', () => {
    assert.deepEqual(parseFrame('  {"type":"result"}  '), { type: 'result' });
  });
});

describe('interpretCommandCodeFrame', () => {
  it('reads the reply from the result line', () => {
    const r = interpretCommandCodeFrame({
      type: 'result',
      subtype: 'success',
      sessionId: 'abc',
      stopReason: 'end_turn',
      finalText: 'the answer',
      usage: { inputTokens: 10 },
      durationMs: 1200,
    });
    assert.equal(r.kind, 'result');
    assert.equal(r.finalText, 'the answer');
    assert.equal(r.sessionId, 'abc');
    assert.equal(r.stopReason, 'end_turn');
  });

  it('tolerates an early-failure result with no sessionId or stopReason', () => {
    // Documented as the shape a run takes when it dies before a session exists
    // — exactly the case a consumer that indexes those fields would break on.
    const r = interpretCommandCodeFrame({ type: 'result', subtype: 'error', error: 'auth failed' });
    assert.equal(r.kind, 'result');
    assert.equal(r.subtype, 'error');
    assert.equal(r.sessionId, null);
    assert.equal(r.stopReason, null);
    assert.equal(r.finalText, '');
    assert.equal(r.error, 'auth failed');
  });

  it('maps tool lifecycle events to a state and a friendly label', () => {
    const running = interpretCommandCodeFrame({
      type: 'event',
      event: { type: 'tool_running', toolCallId: 't1', toolName: 'edit_file', description: 'src/a.js' },
    });
    assert.equal(running.kind, 'tool');
    assert.equal(running.state, 'running');
    assert.equal(running.label, 'editing');

    for (const [type, state] of [['tool_completed', 'completed'], ['tool_errored', 'errored'], ['tool_denied', 'denied']]) {
      const got = interpretCommandCodeFrame({ type: 'event', event: { type, toolName: 'glob' } });
      assert.equal(got.state, state);
    }
  });

  it('ignores known progress noise and degrades unknown events instead of throwing', () => {
    assert.equal(interpretCommandCodeFrame({ type: 'event', event: { type: 'text_delta', text: 'x' } }).kind, 'ignored');
    assert.equal(interpretCommandCodeFrame({ type: 'event', event: { type: 'turn_start' } }).kind, 'ignored');

    // The docs ask consumers to treat unknown event types as forward
    // compatible; a new upstream event must not break a run.
    const unknown = interpretCommandCodeFrame({ type: 'event', event: { type: 'brand_new_thing' } });
    assert.equal(unknown.kind, 'unknown');

    for (const junk of [null, undefined, 42, { type: 'event' }, { type: 'event', event: {} }]) {
      assert.doesNotThrow(() => interpretCommandCodeFrame(junk));
    }
  });

  it('surfaces run errors and the run_end stop reason', () => {
    const err = interpretCommandCodeFrame({ type: 'event', event: { type: 'run_error', error: 'boom' } });
    assert.equal(err.kind, 'error');
    assert.equal(err.message, 'boom');

    const end = interpretCommandCodeFrame({ type: 'event', event: { type: 'run_end', result: { stopReason: 'max_turns' } } });
    assert.equal(end.kind, 'run_end');
    assert.equal(end.stopReason, 'max_turns');
  });

  it('redacts secrets carried in event text', () => {
    const r = interpretCommandCodeFrame({
      type: 'event',
      event: { type: 'tool_running', toolName: 'shell_command', description: 'curl -H "Bearer sk-ant-abcdefgh12345"' },
    });
    assert.ok(!r.description.includes('sk-ant-abcdefgh12345'), r.description);
  });
});

describe('classifyCommandCodeExit', () => {
  it('treats 0 as success', () => {
    const v = classifyCommandCodeExit({ code: 0 });
    assert.equal(v.ok, true);
    assert.equal(v.userMessage, null);
  });

  it('maps documented failure codes to distinct kinds', () => {
    const expected = {
      1: 'cli_error',
      3: 'auth_required',
      4: 'permission_denied',
      5: 'rate_limited',
      6: 'network_error',
      7: 'server_error',
      8: 'max_turns',
      9: 'no_response',
      10: 'insufficient_credits',
      130: 'interrupted',
    };
    for (const [code, kind] of Object.entries(expected)) {
      const v = classifyCommandCodeExit({ code: Number(code) });
      assert.equal(v.kind, kind, `exit ${code}`);
      assert.equal(v.ok, false);
      assert.ok(v.userMessage, `exit ${code} needs a message`);
    }
  });

  it('marks a max-turns run as partial so its answer is still delivered', () => {
    assert.equal(classifyCommandCodeExit({ code: 8 }).partial, true);
    assert.equal(classifyCommandCodeExit({ code: 3 }).partial, false);
  });

  it('reports a signal kill as an interruption', () => {
    const v = classifyCommandCodeExit({ code: null, signal: 'SIGTERM' });
    assert.equal(v.kind, 'interrupted');
    assert.equal(v.ok, false);
  });

  it('never reports an undocumented code as success', () => {
    const v = classifyCommandCodeExit({ code: 42 });
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'cli_error');
    assert.match(v.userMessage, /42/);
  });

  it('prefers the CLI error text over the generic per-code line', () => {
    const v = classifyCommandCodeExit({ code: 1, result: { error: 'model xyz is not available' } });
    assert.equal(v.userMessage, 'model xyz is not available');
  });
});

describe('classifyCommandCodeVersion', () => {
  it('blocks a version below the JSON-contract floor', () => {
    const v = classifyCommandCodeVersion('0.37.0');
    assert.equal(v.supported, false);
    assert.equal(v.version, '0.37.0');
  });

  it('accepts the floor and anything newer', () => {
    assert.equal(classifyCommandCodeVersion(COMMANDCODE_MIN_VERSION).supported, true);
    assert.equal(classifyCommandCodeVersion('command-code/1.36.0 darwin-arm64').supported, true);
  });

  it('proceeds leniently when the version cannot be read', () => {
    // Unreadable must not mean blocked: a CLI that answers oddly is probably
    // fine, and refusing to start would be the worse failure.
    assert.equal(classifyCommandCodeVersion('').supported, null);
    assert.equal(classifyCommandCodeVersion('unknown').supported, null);
  });
});

describe('redaction', () => {
  it('scrubs api keys and bearer tokens from free text', () => {
    assert.ok(!redactSecrets('use sk-ant-api03-abcdefgh').includes('sk-ant-api03-abcdefgh'));
    assert.ok(!redactSecrets('Authorization: Bearer abcdefgh12345').includes('abcdefgh12345'));
    assert.equal(redactSecrets(null), null);
  });

  it('hides a resumed session id from logged argv', () => {
    assert.deepEqual(
      redactArgs(['-p', '--resume', 'secret-session', '--yolo']),
      ['-p', '--resume', '<session-id>', '--yolo'],
    );
  });
});

describe('friendlyToolLabel', () => {
  it('translates documented tools and passes unknown names through', () => {
    assert.equal(friendlyToolLabel('read_file'), 'reading');
    assert.equal(friendlyToolLabel('shell_command'), 'running');
    assert.equal(friendlyToolLabel('brand_new_tool'), 'brand_new_tool');
    assert.equal(friendlyToolLabel(''), 'working');
  });
});

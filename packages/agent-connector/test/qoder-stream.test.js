'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  QODER_MIN_VERSION,
  DISALLOWED_TOOLS,
  REGIONS,
  buildQoderArgs,
  classifyQoderRun,
  classifyQoderVersion,
  compareVersions,
  interpretQoderFrame,
  normalizeQoderRegion,
  parseFrame,
  qoderBinaryNames,
  rankQoderRegions,
  redactArgs,
  redactSecrets,
  regionForBinary,
  toolInputPreview,
} = require('../src/adapters/qoder-stream');

describe('buildQoderArgs', () => {
  it('requests the streamed JSON contract without Claude\'s --verbose', () => {
    const args = buildQoderArgs();
    assert.ok(args.includes('-p'));
    assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
    // Unlike Claude Code / CodeBuddy, Qoder rejects --verbose outright; the
    // stream is already incremental.
    assert.ok(!args.includes('--verbose'));
  });

  it('never puts the prompt in argv', () => {
    // `-p` is a boolean for Qoder and the prompt is piped over stdin, so the
    // flag must be followed by the next flag, never by a value.
    const args = buildQoderArgs({ model: 'auto' });
    assert.equal(args[args.indexOf('-p') + 1], '--output-format');
  });

  it('uses Qoder\'s own permission modes', () => {
    const exec = buildQoderArgs();
    assert.equal(exec[exec.indexOf('--permission-mode') + 1], 'bypass_permissions');
    assert.ok(!exec.includes('--dangerously-skip-permissions'));

    const plan = buildQoderArgs({ planMode: true });
    assert.equal(plan[plan.indexOf('--permission-mode') + 1], 'plan');
  });

  it('repeats --disallowed-tools once per tool, in kebab case', () => {
    const args = buildQoderArgs();
    const occurrences = args.filter((a) => a === '--disallowed-tools').length;
    assert.equal(occurrences, DISALLOWED_TOOLS.length);
    for (const tool of DISALLOWED_TOOLS) {
      const i = args.indexOf(tool);
      assert.ok(i > 0 && args[i - 1] === '--disallowed-tools', `${tool} must follow its own flag`);
    }
    assert.ok(!args.includes('--disallowedTools'));
  });

  it('passes the system prompt, model, effort, turn limit, MCP config and resume id', () => {
    const args = buildQoderArgs({
      appendSystemPrompt: 'you are in a workspace',
      model: 'auto',
      effort: 'high',
      maxTurns: 40,
      mcpConfigPath: '/tmp/mcp.json',
      resumeSessionId: 'sess-1',
    });
    assert.equal(args[args.indexOf('--append-system-prompt') + 1], 'you are in a workspace');
    assert.equal(args[args.indexOf('--model') + 1], 'auto');
    assert.equal(args[args.indexOf('--reasoning-effort') + 1], 'high');
    assert.equal(args[args.indexOf('--max-turns') + 1], '40');
    assert.equal(args[args.indexOf('--mcp-config') + 1], '/tmp/mcp.json');
    assert.equal(args[args.indexOf('--resume') + 1], 'sess-1');
  });

  it('omits every optional flag when nothing is configured', () => {
    const args = buildQoderArgs({ model: '  ', effort: '', maxTurns: 0, resumeSessionId: '' });
    for (const flag of ['--model', '--reasoning-effort', '--max-turns', '--resume', '--mcp-config', '--append-system-prompt']) {
      assert.ok(!args.includes(flag), `${flag} should be absent`);
    }
  });
});

describe('region resolution', () => {
  it('accepts the spellings a user is likely to type', () => {
    assert.equal(normalizeQoderRegion('China'), 'china');
    assert.equal(normalizeQoderRegion(' cn '), 'china');
    assert.equal(normalizeQoderRegion('international'), 'international');
    assert.equal(normalizeQoderRegion('global'), 'international');
    assert.equal(normalizeQoderRegion('mars'), null);
    assert.equal(normalizeQoderRegion(''), null);
  });

  it('puts an explicit region first and the other second', () => {
    assert.deepEqual(rankQoderRegions('china', {}), ['china', 'international']);
    assert.deepEqual(rankQoderRegions('international', {}), ['international', 'china']);
  });

  it('prefers the signed-in edition when no region is configured', () => {
    assert.deepEqual(rankQoderRegions(undefined, { china: true }), ['china', 'international']);
    assert.deepEqual(rankQoderRegions(undefined, { international: false, china: false }), ['international', 'china']);
  });

  it('maps each edition to its binaries and back', () => {
    assert.deepEqual(qoderBinaryNames('international'), ['qodercli', 'qoder']);
    assert.deepEqual(qoderBinaryNames('china'), ['qoderclicn', 'qodercn']);
    assert.equal(regionForBinary('qoderclicn'), 'china');
    assert.equal(regionForBinary('qodercn'), 'china');
    assert.equal(regionForBinary('qoder'), 'international');
    assert.equal(regionForBinary('something-else'), null);
    assert.deepEqual(qoderBinaryNames('mars'), []);
    assert.equal(REGIONS.china.home, '.qoder-cn');
  });

  it('compares dotted versions numerically', () => {
    assert.equal(compareVersions('1.1.9', '1.1.52') < 0, true);
    assert.equal(compareVersions('1.2.0', '1.1.52') > 0, true);
    assert.equal(compareVersions('1.1.52', '1.1.52'), 0);
  });
});

describe('interpretQoderFrame', () => {
  it('reads the session id off the init frame', () => {
    const ev = interpretQoderFrame({
      type: 'system', subtype: 'init', session_id: 's-1', model: 'Auto',
      permissionMode: 'bypass_permissions', mcp_servers: [{ name: 'openagents-workspace' }],
    });
    assert.equal(ev.kind, 'init');
    assert.equal(ev.sessionId, 's-1');
    assert.equal(ev.model, 'Auto');
  });

  it('splits assistant frames into text and tool calls', () => {
    const ev = interpretQoderFrame({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '  Looking at the config.  ' },
          { type: 'tool_use', name: 'Read', input: { file_path: 'src/app.js' } },
        ],
      },
    });
    assert.equal(ev.kind, 'assistant');
    assert.deepEqual(ev.texts, ['Looking at the config.']);
    assert.equal(ev.tools[0].name, 'Read');
    assert.equal(ev.tools[0].preview, 'src/app.js');
  });

  it('surfaces a todo list so the channel can mirror it', () => {
    const ev = interpretQoderFrame({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'TaskCreate', input: { todos: [{ content: 'a' }] } }] },
    });
    assert.deepEqual(ev.tools[0].todos, [{ content: 'a' }]);
  });

  it('carries the answer and the error detail off the result frame', () => {
    const ok = interpretQoderFrame({
      type: 'result', subtype: 'success', is_error: false, result: 'PONG',
      session_id: 's-2', num_turns: 1, duration_ms: 120,
    });
    assert.equal(ok.kind, 'result');
    assert.equal(ok.isError, false);
    assert.equal(ok.text, 'PONG');
    assert.equal(ok.sessionId, 's-2');

    const bad = interpretQoderFrame({
      type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's-3',
      errors: ['The request could not be completed. Please try again.'], error_code: 500,
    });
    assert.equal(bad.isError, true);
    assert.equal(bad.text, '');
    assert.equal(bad.errorCode, 500);
    assert.equal(bad.errors.length, 1);
  });

  it('ignores Qoder plugin-hook lifecycle frames', () => {
    for (const subtype of ['hook_started', 'hook_progress', 'hook_response']) {
      assert.equal(interpretQoderFrame({ type: 'system', subtype }).kind, 'ignored');
    }
    assert.equal(interpretQoderFrame({ type: 'artifacts_update' }).kind, 'ignored');
  });

  it('shows compaction, which is slow enough to read as a hang', () => {
    const ev = interpretQoderFrame({ type: 'system', subtype: 'compact_boundary', message: 'Compacting…' });
    assert.equal(ev.kind, 'status');
    assert.equal(ev.text, 'Compacting…');
  });

  it('ignores the frames that carry no progress, and logs genuinely new ones', () => {
    for (const type of ['file-history-snapshot', 'user', 'stream_event']) {
      assert.equal(interpretQoderFrame({ type }).kind, 'ignored');
    }
    assert.equal(interpretQoderFrame({ type: 'brand_new_frame' }).kind, 'unknown');
  });

  it('survives malformed input instead of throwing mid-stream', () => {
    assert.equal(parseFrame('not json'), null);
    assert.equal(parseFrame(''), null);
    assert.equal(interpretQoderFrame(null).kind, 'ignored');
    assert.equal(interpretQoderFrame({ type: 'assistant', message: {} }).kind, 'ignored');
  });
});

describe('toolInputPreview', () => {
  it('prefers the field that says what the tool is doing', () => {
    assert.equal(toolInputPreview({ command: 'ls -la' }), 'ls -la');
    assert.equal(toolInputPreview({ pattern: '*.ts' }), '*.ts');
    assert.equal(toolInputPreview({ unknown_shape: 1 }), '{"unknown_shape":1}');
    assert.equal(toolInputPreview(null), '');
  });

  it('redacts secrets that ride in a tool argument', () => {
    assert.ok(!toolInputPreview({ command: 'curl -H "Authorization: Bearer sk-abcdefghijkl"' }).includes('sk-abcdefghijkl'));
  });
});

describe('classifyQoderRun', () => {
  it('trusts a failed result frame over a clean exit code', () => {
    const verdict = classifyQoderRun({
      code: 0,
      result: {
        isError: true, text: '', errors: ['network unreachable'],
        errorsInfo: [{ status: 503, category: 'network' }], errorCode: 503,
      },
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.kind, 'network');
  });

  it('classifies a Qoder error that carries no structured category', () => {
    // Qoder 1.1.x reports failures as `errors` + `error_code`, not the
    // CodeBuddy `errors_info[].category`, so the text pass has to work.
    const auth = classifyQoderRun({
      code: 1,
      result: { isError: true, text: '', errors: ['401 Unauthorized'], errorsInfo: [], errorCode: 401 },
    });
    assert.equal(auth.kind, 'auth');
    assert.match(auth.userMessage, /sign in/i);

    const server = classifyQoderRun({
      code: 1,
      result: {
        isError: true, text: '', errorsInfo: [], errorCode: 500,
        errors: ['The request could not be completed. Please try again.'],
      },
    });
    assert.equal(server.kind, 'model_service');
  });

  it('passes through a detail it cannot categorize', () => {
    const verdict = classifyQoderRun({
      code: 1,
      result: { isError: true, text: '', errors: ['模型服务返回异常'], errorsInfo: [], errorCode: 9 },
    });
    assert.equal(verdict.kind, 'run_error');
    assert.match(verdict.userMessage, /模型服务返回异常/);
    assert.match(verdict.userMessage, /code 9/);
  });

  it('treats a clean result frame as success', () => {
    const verdict = classifyQoderRun({ code: 0, result: { isError: false, text: 'ok', errors: [], errorsInfo: [] } });
    assert.deepEqual(verdict, { kind: 'success', ok: true, userMessage: null });
  });

  it('reads stderr only when no result frame arrived', () => {
    const verdict = classifyQoderRun({ code: 1, result: null, stderr: '502 connection refused\nmore detail' });
    assert.equal(verdict.kind, 'startup_error');
    assert.match(verdict.userMessage, /502 connection refused/);
    assert.ok(!verdict.userMessage.includes('more detail'));
  });

  it('reports a signal kill as an interruption, not a failure to explain', () => {
    const verdict = classifyQoderRun({ code: null, signal: 'SIGINT', result: null });
    assert.equal(verdict.kind, 'interrupted');
  });

  it('has a verdict for a silent exit with nothing at all', () => {
    const verdict = classifyQoderRun({ code: 1, result: null, stderr: '' });
    assert.equal(verdict.kind, 'no_result');
    assert.match(verdict.userMessage, /code 1/);
  });
});

describe('version gate', () => {
  it('blocks only a version it positively read as too old', () => {
    assert.equal(classifyQoderVersion('0.9.0').supported, false);
    assert.equal(classifyQoderVersion(QODER_MIN_VERSION).supported, true);
    assert.equal(classifyQoderVersion('1.1.52 (Qoder CLI)').supported, true);
    // Unreadable → proceed leniently rather than block a CLI that is fine.
    assert.equal(classifyQoderVersion('nonsense').supported, null);
    assert.equal(classifyQoderVersion('').supported, null);
  });

  it('flags a version newer than the one behavior was verified against', () => {
    assert.equal(classifyQoderVersion('1.1.52').tested, true);
    assert.equal(classifyQoderVersion('1.2.0').tested, false);
  });
});

describe('redaction', () => {
  it('scrubs keys, bearer tokens and JWTs from anything logged', () => {
    const text = 'key=sk-abcdefghijklmn Bearer sk-zyxwvutsrqpon eyJhbGciOiJIUzI1NiJ9abcdefghij';
    const out = redactSecrets(text);
    assert.ok(!out.includes('sk-abcdefghijklmn'));
    assert.ok(!out.includes('sk-zyxwvutsrqpon'));
    assert.ok(!out.includes('eyJhbGciOiJIUzI1NiJ9abcdefghij'));
  });

  it('hides the session id and the system prompt from a logged argv', () => {
    const args = buildQoderArgs({ appendSystemPrompt: 'secret identity', resumeSessionId: 's-9' });
    const shown = redactArgs(args).join(' ');
    assert.ok(!shown.includes('secret identity'));
    assert.ok(!shown.includes('s-9'));
    assert.ok(shown.includes('<system-prompt>'));
    assert.ok(shown.includes('<session-id>'));
  });
});

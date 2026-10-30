'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  CODEBUDDY_MIN_VERSION,
  DISALLOWED_TOOLS,
  buildCodeBuddyArgs,
  classifyCodeBuddyRun,
  classifyCodeBuddyVersion,
  interpretCodeBuddyFrame,
  parseFrame,
  redactArgs,
  redactSecrets,
  resolveCodeBuddyEnv,
  toolInputPreview,
} = require('../src/adapters/codebuddy-stream');

describe('buildCodeBuddyArgs', () => {
  it('always requests the streamed JSON contract', () => {
    const args = buildCodeBuddyArgs();
    assert.ok(args.includes('-p'));
    assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
    // stream-json only streams with --verbose; without it the whole run
    // arrives at the end and the channel shows no progress.
    assert.ok(args.includes('--verbose'));
  });

  it('never puts the prompt in argv', () => {
    // The prompt is piped over stdin. `-p` must stay valueless: the turn can
    // run to kilobytes, and a quote in a user message would need quoting.
    const args = buildCodeBuddyArgs({ model: 'm' });
    assert.equal(args[args.indexOf('-p') + 1], '--output-format');
  });

  it('bypasses permission prompts in execute mode and stays read-only in plan mode', () => {
    const exec = buildCodeBuddyArgs();
    assert.ok(exec.includes('-y'));
    assert.ok(!exec.includes('--permission-mode'));

    const plan = buildCodeBuddyArgs({ planMode: true });
    assert.equal(plan[plan.indexOf('--permission-mode') + 1], 'plan');
    // -y alongside plan mode would defeat read-only investigation.
    assert.ok(!plan.includes('-y'));
  });

  it('bans the tools that would stall a headless run or reach a real person', () => {
    const args = buildCodeBuddyArgs();
    const banned = args.slice(args.indexOf('--disallowedTools') + 1);
    for (const tool of ['AskUserQuestion', 'AskUserForStructuredInput']) {
      assert.ok(banned.includes(tool), `${tool} must be banned: nobody can answer it`);
    }
    for (const tool of ['WeChatReply', 'WeComReply', 'PushNotification']) {
      assert.ok(banned.includes(tool), `${tool} must be banned: it messages the user's own accounts`);
    }
    assert.deepEqual(banned.slice(0, DISALLOWED_TOOLS.length), DISALLOWED_TOOLS);
  });

  it('passes the system prompt, model, effort, turn limit, MCP config and resume id', () => {
    const args = buildCodeBuddyArgs({
      appendSystemPrompt: 'you are in a workspace',
      model: 'gpt-5.6-sol',
      effort: 'high',
      maxTurns: 40,
      mcpConfigPath: '/tmp/mcp.json',
      resumeSessionId: 'sess-1',
    });
    assert.equal(args[args.indexOf('--append-system-prompt') + 1], 'you are in a workspace');
    assert.equal(args[args.indexOf('--model') + 1], 'gpt-5.6-sol');
    assert.equal(args[args.indexOf('--effort') + 1], 'high');
    assert.equal(args[args.indexOf('--max-turns') + 1], '40');
    assert.equal(args[args.indexOf('--mcp-config') + 1], '/tmp/mcp.json');
    assert.equal(args[args.indexOf('--resume') + 1], 'sess-1');
  });

  it('omits every optional flag when nothing is configured', () => {
    const args = buildCodeBuddyArgs({ model: '  ', effort: '', maxTurns: 0, resumeSessionId: '' });
    for (const flag of ['--model', '--effort', '--max-turns', '--resume', '--mcp-config', '--append-system-prompt']) {
      assert.ok(!args.includes(flag), `${flag} should be absent`);
    }
  });
});

describe('resolveCodeBuddyEnv', () => {
  it('silences self-update and telemetry for an unattended run', () => {
    // A background self-update would swap the CLI — and the stream contract
    // this module parses — under a daemon that is mid-run.
    const env = resolveCodeBuddyEnv({});
    assert.equal(env.DISABLE_AUTOUPDATER, '1');
    assert.equal(env.DISABLE_TELEMETRY, '1');
  });

  it('routes to the China site only when that region is selected', () => {
    assert.equal(resolveCodeBuddyEnv({}).CODEBUDDY_INTERNET_ENVIRONMENT, undefined);
    assert.equal(
      resolveCodeBuddyEnv({ CODEBUDDY_REGION: 'international' }).CODEBUDDY_INTERNET_ENVIRONMENT,
      undefined,
    );
    assert.equal(
      resolveCodeBuddyEnv({ CODEBUDDY_REGION: ' China ' }).CODEBUDDY_INTERNET_ENVIRONMENT,
      'internal',
    );
    // An unrecognized region must not invent a routing decision.
    assert.equal(resolveCodeBuddyEnv({ CODEBUDDY_REGION: 'mars' }).CODEBUDDY_INTERNET_ENVIRONMENT, undefined);
  });

  it('strips a pasted "Bearer " prefix from the auth token', () => {
    const env = resolveCodeBuddyEnv({ CODEBUDDY_AUTH_TOKEN: 'Bearer abc.def.ghi' });
    assert.equal(env.CODEBUDDY_AUTH_TOKEN, 'abc.def.ghi');
  });

  it('never invents a credential the user did not configure', () => {
    const env = resolveCodeBuddyEnv({});
    assert.ok(!('CODEBUDDY_API_KEY' in env));
    assert.ok(!('CODEBUDDY_AUTH_TOKEN' in env));
  });
});

describe('interpretCodeBuddyFrame', () => {
  it('reads the session id off the init frame', () => {
    // The init frame lands BEFORE any model call, which is what keeps a
    // channel resumable even when the turn itself fails.
    const ev = interpretCodeBuddyFrame({
      type: 'system', subtype: 'init', session_id: 's-1', model: 'default-model',
      permissionMode: 'bypassPermissions', mcp_servers: [{ name: 'openagents-workspace' }],
    });
    assert.equal(ev.kind, 'init');
    assert.equal(ev.sessionId, 's-1');
    assert.equal(ev.model, 'default-model');
  });

  it('splits assistant frames into text and tool calls', () => {
    const ev = interpretCodeBuddyFrame({
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
    const ev = interpretCodeBuddyFrame({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'TaskCreate', input: { todos: [{ content: 'a' }] } }] },
    });
    assert.deepEqual(ev.tools[0].todos, [{ content: 'a' }]);
  });

  it('carries the answer and the structured error info off the result frame', () => {
    const ok = interpretCodeBuddyFrame({
      type: 'result', subtype: 'success', is_error: false, result: 'Done.',
      session_id: 's-2', num_turns: 3, duration_ms: 120,
    });
    assert.equal(ok.kind, 'result');
    assert.equal(ok.isError, false);
    assert.equal(ok.text, 'Done.');
    assert.equal(ok.sessionId, 's-2');

    const bad = interpretCodeBuddyFrame({
      type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's-3',
      errors: ['504 service_unavailable'],
      errors_info: [{ status: 504, code: 504, category: 'network', details: '504' }],
    });
    assert.equal(bad.isError, true);
    assert.equal(bad.text, '');
    assert.equal(bad.errorsInfo[0].category, 'network');
  });

  it('shows compaction, which is slow enough to read as a hang', () => {
    const ev = interpretCodeBuddyFrame({ type: 'system', subtype: 'compact_boundary', message: 'Compacting…' });
    assert.equal(ev.kind, 'status');
    assert.equal(ev.text, 'Compacting…');
  });

  it('ignores the frames that carry no progress, and logs genuinely new ones', () => {
    for (const type of ['file-history-snapshot', 'user', 'stream_event']) {
      assert.equal(interpretCodeBuddyFrame({ type }).kind, 'ignored');
    }
    assert.equal(interpretCodeBuddyFrame({ type: 'system', subtype: 'status' }).kind, 'ignored');
    assert.equal(interpretCodeBuddyFrame({ type: 'brand_new_frame' }).kind, 'unknown');
  });

  it('survives malformed input instead of throwing mid-stream', () => {
    assert.equal(parseFrame('not json'), null);
    assert.equal(parseFrame(''), null);
    assert.equal(interpretCodeBuddyFrame(null).kind, 'ignored');
    assert.equal(interpretCodeBuddyFrame({ type: 'assistant', message: {} }).kind, 'ignored');
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

describe('classifyCodeBuddyRun', () => {
  it('trusts the result frame over the exit code', () => {
    // THE case this adapter exists to get right: CodeBuddy exits 0 on a run
    // whose model call failed. Reading the exit code would post an empty
    // answer over a provider outage.
    const verdict = classifyCodeBuddyRun({
      code: 0,
      result: {
        isError: true, text: '', errors: ['504 service_unavailable'],
        errorsInfo: [{ status: 504, category: 'network' }],
      },
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.kind, 'network');
  });

  it('names both sign-in paths on an auth failure', () => {
    // A bad key and a signed-out CLI are indistinguishable from out here, so
    // the message must not send the user down only one of them.
    const verdict = classifyCodeBuddyRun({
      code: 0,
      result: { isError: true, text: '', errors: [], errorsInfo: [{ status: 401, category: 'auth' }] },
    });
    assert.equal(verdict.kind, 'auth');
    assert.match(verdict.userMessage, /CODEBUDDY_API_KEY/);
    assert.match(verdict.userMessage, /login/i);
  });

  it('reports quota and model-service failures distinctly', () => {
    const quota = classifyCodeBuddyRun({
      code: 0, result: { isError: true, text: '', errors: [], errorsInfo: [{ status: 429, category: 'quota' }] },
    });
    assert.equal(quota.kind, 'quota');
    const server = classifyCodeBuddyRun({
      code: 0, result: { isError: true, text: '', errors: [], errorsInfo: [{ status: 500, category: 'model_service' }] },
    });
    assert.equal(server.kind, 'model_service');
  });

  it("falls back to the CLI's own text when it could not categorize the failure", () => {
    // That text is localized — a China-site account gets Chinese prose — so it
    // is passed through rather than matched against English patterns.
    const verdict = classifyCodeBuddyRun({
      code: 0,
      result: { isError: true, text: '', errors: ['模型服务返回异常'], errorsInfo: [] },
    });
    assert.equal(verdict.kind, 'run_error');
    assert.match(verdict.userMessage, /模型服务返回异常/);
  });

  it('treats a clean result frame as success', () => {
    const verdict = classifyCodeBuddyRun({ code: 0, result: { isError: false, text: 'ok', errors: [], errorsInfo: [] } });
    assert.deepEqual(verdict, { kind: 'success', ok: true, userMessage: null });
  });

  it('reads stderr only when no result frame arrived', () => {
    // A hard startup failure prints to stderr and STILL exits 0, so this is
    // the one path with nothing structured to read.
    const verdict = classifyCodeBuddyRun({ code: 0, result: null, stderr: '502 connection refused\nmore detail' });
    assert.equal(verdict.kind, 'startup_error');
    assert.match(verdict.userMessage, /502 connection refused/);
    assert.ok(!verdict.userMessage.includes('more detail'));
  });

  it('reports a signal kill as an interruption, not a failure to explain', () => {
    const verdict = classifyCodeBuddyRun({ code: null, signal: 'SIGINT', result: null });
    assert.equal(verdict.kind, 'interrupted');
  });

  it('has a verdict for a silent exit with nothing at all', () => {
    const verdict = classifyCodeBuddyRun({ code: 1, result: null, stderr: '' });
    assert.equal(verdict.kind, 'no_result');
    assert.match(verdict.userMessage, /code 1/);
  });
});

describe('version gate', () => {
  it('blocks only a version it positively read as too old', () => {
    assert.equal(classifyCodeBuddyVersion('1.9.0').supported, false);
    assert.equal(classifyCodeBuddyVersion(`${CODEBUDDY_MIN_VERSION}`).supported, true);
    assert.equal(classifyCodeBuddyVersion('2.142.0 (CodeBuddy Code)').supported, true);
    // Unreadable → proceed leniently rather than block a CLI that is fine.
    assert.equal(classifyCodeBuddyVersion('nonsense').supported, null);
    assert.equal(classifyCodeBuddyVersion('').supported, null);
  });

  it('flags a version newer than the one behavior was verified against', () => {
    assert.equal(classifyCodeBuddyVersion('2.142.0').tested, true);
    assert.equal(classifyCodeBuddyVersion('3.0.0').tested, false);
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
    const args = buildCodeBuddyArgs({ appendSystemPrompt: 'secret identity', resumeSessionId: 's-9' });
    const shown = redactArgs(args).join(' ');
    assert.ok(!shown.includes('secret identity'));
    assert.ok(!shown.includes('s-9'));
    assert.ok(shown.includes('<system-prompt>'));
    assert.ok(shown.includes('<session-id>'));
  });
});

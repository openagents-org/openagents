'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  EDITIONS,
  QODER_DISALLOWED_TOOLS,
  buildQoderArgs,
  buildQoderChildEnv,
  classifyQoderRun,
  classifyQoderVersion,
  descendantsOf,
  editionVar,
  installHint,
  interpretQoderFrame,
  parseFrame,
  parseProcessTable,
  qoderErrorLine,
  redactArgs,
  redactSecrets,
  resolveQoderAuth,
} = require('../src/adapters/qoder-runtime');

const argAfter = (args, flag) => args[args.indexOf(flag) + 1];

// Frames as qodercli 1.1.72 printed them (trimmed to the fields read here).
const INIT = {
  type: 'system', subtype: 'init', apiKeySource: 'none', qodercli_version: '1.1.72', protocol_version: '1.5.0',
  cwd: '/tmp/proj', tools: ['Bash', 'Edit', 'Read'], mcp_servers: [{ name: 'openagents-workspace', status: 'connected' }],
  model: 'auto', permissionMode: 'bypassPermissions', session_id: 'cf2786a2-4660-4b23-8344-266e449e94dd',
};
const SIGNED_OUT_ASSISTANT = {
  type: 'assistant',
  message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] },
  session_id: 'cf2786a2-4660-4b23-8344-266e449e94dd',
  error: 'authentication_failed',
};
const SIGNED_OUT_RESULT = {
  type: 'result', subtype: 'success', is_error: true, num_turns: 1, result: 'Not logged in · Please run /login',
  session_id: 'cf2786a2-4660-4b23-8344-266e449e94dd', terminal_reason: 'completed',
};
const PAT_REJECTED_STDERR = [
  'An unexpected critical error occurred:QoderAuthError: The QODER_PERSONAL_ACCESS_TOKEN environment variable contains a token that was rejected. It overrides any saved login, so unset it or set a valid token, then restart.',
  '    at FD (/$bunfs/root/chunk-xpxkr8ps.js:348:12583)',
  '    at initAuthWithOptions (/$bunfs/root/chunk-xpxkr8ps.js:348:21774)',
].join('\n');

describe('qoder editions', () => {
  it('keeps every edition-specific name in one table', () => {
    assert.equal(EDITIONS.global.bin, 'qodercli');
    assert.equal(EDITIONS.cn.bin, 'qoderclicn');
    assert.equal(editionVar(EDITIONS.global, 'PERSONAL_ACCESS_TOKEN'), 'QODER_PERSONAL_ACCESS_TOKEN');
    assert.equal(editionVar(EDITIONS.cn, 'PERSONAL_ACCESS_TOKEN'), 'QODERCN_PERSONAL_ACCESS_TOKEN');
    assert.equal(installHint(EDITIONS.cn, 'win32'), 'irm https://qoder.com.cn/install.ps1 | iex');
    assert.equal(installHint(EDITIONS.global, 'linux'), 'curl -fsSL https://qoder.com/install | bash');
  });

  it('agrees with the registry on binary, install route and env names', () => {
    const registry = require('../registry.json');
    for (const edition of Object.values(EDITIONS)) {
      const entry = registry.find((e) => e.name === edition.type);
      assert.ok(entry, `registry.json must carry ${edition.type}`);
      assert.equal(entry.install.binary, edition.bin);
      assert.equal(entry.install.linux, edition.installUnix);
      assert.equal(entry.install.windows, edition.installWindows);
      const rules = Object.fromEntries(entry.resolve_env.rules.map((r) => [r.from, r.to]));
      assert.deepEqual(rules, {
        LLM_API_KEY: editionVar(edition, 'PERSONAL_ACCESS_TOKEN'),
        LLM_MODEL: editionVar(edition, 'MODEL'),
      });
      assert.equal(entry.check_ready.login_command, `${edition.bin} login`);
      assert.equal(entry.provider_locked, true);
    }
  });
});

describe('qoder version gate', () => {
  it('reads the bare version qodercli prints', () => {
    assert.deepEqual(classifyQoderVersion('1.1.72\n'), { version: '1.1.72', supported: true, tested: true });
  });
  it('refuses a release older than the floor', () => {
    assert.equal(classifyQoderVersion('1.0.44').supported, false);
    assert.equal(classifyQoderVersion('0.9.0').supported, false);
  });
  it('lets a newer, untested release through', () => {
    assert.deepEqual(classifyQoderVersion('1.2.0'), { version: '1.2.0', supported: true, tested: false });
  });
  it('proceeds when the version cannot be read', () => {
    assert.equal(classifyQoderVersion('').supported, null);
  });
});

describe('qoder credentials and environment', () => {
  it('reads the edition token first, then the generic key', () => {
    assert.equal(resolveQoderAuth({ QODER_PERSONAL_ACCESS_TOKEN: 'pat-a', LLM_API_KEY: 'pat-b' }).pat, 'pat-a');
    assert.equal(resolveQoderAuth({ LLM_API_KEY: 'pat-b' }).pat, 'pat-b');
    assert.equal(resolveQoderAuth({ QODER_PERSONAL_ACCESS_TOKEN: 'intl' }, EDITIONS.cn).pat, '');
    assert.equal(resolveQoderAuth({ QODERCN_PERSONAL_ACCESS_TOKEN: 'cn' }, EDITIONS.cn).pat, 'cn');
  });

  it('takes the workspace model over the form', () => {
    assert.equal(resolveQoderAuth({ QODER_MODEL: 'lite' }, EDITIONS.global, 'performance').model, 'performance');
    assert.equal(resolveQoderAuth({ LLM_MODEL: 'lite' }).model, 'lite');
    assert.equal(resolveQoderAuth({}).model, '');
  });

  it('puts the token in the edition variable and turns rc edits off', () => {
    const env = buildQoderChildEnv({ PATH: '/bin', LLM_API_KEY: 'pat-x', LLM_MODEL: 'm' }, { pat: 'pat-x' });
    assert.equal(env.QODER_PERSONAL_ACCESS_TOKEN, 'pat-x');
    assert.equal(env.QODER_NO_RC, '1');
    assert.equal(env.LLM_API_KEY, undefined, 'the key must not ride along under a second name');
    assert.equal(env.LLM_MODEL, undefined);
    assert.equal(env.PATH, '/bin');
  });

  it("leaves a signed-in agent's env token-free", () => {
    const env = buildQoderChildEnv({ PATH: '/bin' }, { edition: EDITIONS.cn });
    assert.equal(env.QODERCN_PERSONAL_ACCESS_TOKEN, undefined);
    assert.equal(env.QODERCN_NO_RC, '1');
  });
});

describe('qoder argv', () => {
  it('runs headless with stream-json and no prompt in argv', () => {
    const args = buildQoderArgs({ appendSystemPrompt: 'brief' });
    assert.deepEqual(args.slice(0, 3), ['-p', '-o', 'stream-json']);
    assert.equal(argAfter(args, '--append-system-prompt'), 'brief');
    assert.ok(args.includes('--yolo'));
  });

  it('denies the scheduling and worktree tools as ONE comma-separated value', () => {
    const args = buildQoderArgs({ extraDisallowedTools: ['WebFetch'] });
    assert.equal(args.filter((a) => a === '--disallowed-tools').length, 1);
    assert.equal(argAfter(args, '--disallowed-tools'), [...QODER_DISALLOWED_TOOLS, 'WebFetch'].join(','));
  });

  it('isolates MCP to the workspace server', () => {
    const args = buildQoderArgs({ mcpConfigPath: '/tmp/m.json' });
    assert.equal(argAfter(args, '--mcp-config'), '/tmp/m.json');
    assert.ok(args.includes('--strict-mcp-config'));
    assert.ok(!buildQoderArgs({}).includes('--strict-mcp-config'));
  });

  it('turns the auto-updater off in the flag settings layer', () => {
    const args = buildQoderArgs({});
    assert.deepEqual(JSON.parse(argAfter(args, '--settings')), { general: { enableAutoUpdate: false } });
  });

  it('passes the model only when there is one', () => {
    assert.equal(argAfter(buildQoderArgs({ model: 'performance' }), '-m'), 'performance');
    assert.ok(!buildQoderArgs({ model: '  ' }).includes('-m'));
  });

  it('resumes or names a session, never both', () => {
    const resumed = buildQoderArgs({ resumeSessionId: 'abc', newSessionId: 'def' });
    assert.equal(argAfter(resumed, '-r'), 'abc');
    assert.ok(!resumed.includes('--session-id'));
    const fresh = buildQoderArgs({ newSessionId: 'def' });
    assert.equal(argAfter(fresh, '--session-id'), 'def');
    assert.ok(!fresh.includes('-r'));
  });

  it('plans without bypassing permissions', () => {
    const args = buildQoderArgs({ planMode: true });
    assert.equal(argAfter(args, '--agent'), 'Plan');
    assert.ok(!args.includes('--yolo'));
  });

  it('hides the session id and the briefing from the log', () => {
    const shown = redactArgs(buildQoderArgs({ appendSystemPrompt: 'secret briefing', resumeSessionId: 'sid-1' }));
    assert.ok(!shown.includes('secret briefing'));
    assert.ok(!shown.includes('sid-1'));
  });
});

describe('qoder stream-json frames', () => {
  it('reads the init frame', () => {
    const ev = interpretQoderFrame(INIT);
    assert.equal(ev.kind, 'init');
    assert.equal(ev.sessionId, INIT.session_id);
    assert.equal(ev.version, '1.1.72');
    assert.deepEqual(ev.mcpServers, INIT.mcp_servers);
  });

  it('treats a synthetic error message as an error, not an answer', () => {
    const ev = interpretQoderFrame(SIGNED_OUT_ASSISTANT);
    assert.equal(ev.apiError, 'authentication_failed');
    assert.deepEqual(ev.texts, []);
  });

  it('collects text and tool calls from an assistant frame', () => {
    const ev = interpretQoderFrame({
      type: 'assistant',
      message: { content: [
        { type: 'thinking', thinking: 'hm' },
        { type: 'text', text: 'Looking.' },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } },
      ] },
    });
    assert.deepEqual(ev.texts, ['Looking.']);
    assert.deepEqual(ev.tools.map((t) => [t.name, t.preview]), [['Bash', 'ls -la']]);
  });

  it('reads is_error, not the subtype', () => {
    const ev = interpretQoderFrame(SIGNED_OUT_RESULT);
    assert.equal(ev.subtype, 'success');
    assert.equal(ev.isError, true);
  });

  it('ignores frames with nothing for the channel and flags new ones', () => {
    assert.equal(interpretQoderFrame({ type: 'user' }).kind, 'ignored');
    assert.equal(interpretQoderFrame({ type: 'brand_new' }).kind, 'unknown');
    assert.equal(parseFrame('not json'), null);
    assert.equal(parseFrame(''), null);
  });
});

describe('qoder run classification', () => {
  const run = (o) => classifyQoderRun(o, EDITIONS.global);
  const result = (o) => interpretQoderFrame({ type: 'result', ...o });

  it('passes a clean result', () => {
    assert.equal(run({ result: result({ subtype: 'success', is_error: false, result: 'hi' }) }).ok, true);
  });

  it('names both ways in for a signed-out CLI', () => {
    const v = run({ result: interpretQoderFrame(SIGNED_OUT_RESULT), apiErrors: ['authentication_failed'], code: 1 });
    assert.equal(v.kind, 'auth');
    assert.match(v.userMessage, /qodercli login/);
    assert.match(v.userMessage, /qoder\.com\/account\/integrations/);
  });

  it('reads a rejected token off stderr, where it is the only trace', () => {
    const v = run({ code: 1, stderr: PAT_REJECTED_STDERR });
    assert.equal(v.kind, 'auth');
    assert.match(v.userMessage, /rejected the personal access token/);
  });

  it('reads the older wording of a rejected token too', () => {
    const v = run({ code: 1, stderr: 'An unexpected critical error occurred:QoderAuthError: auth.exchangeJobToken failed: Bad request\n    at openApiJsonRequest (/$bunfs/root/index.js:1:1)' });
    assert.equal(v.kind, 'auth');
    assert.match(v.userMessage, /rejected the personal access token/);
  });

  it('spots a resume the CLI could not find', () => {
    const v = run({ code: 42, stderr: 'Error resuming session: Invalid session identifier "x".\n  Searched current project' });
    assert.equal(v.kind, 'stale_session');
  });

  it('maps the quota error codes and categories', () => {
    assert.equal(run({ result: result({ is_error: true, error_code: 118, errors: ['credits'] }) }).kind, 'quota');
    assert.equal(run({ result: result({ is_error: true, errors: ['x'] }), apiErrors: ['rate_limit'] }).kind, 'quota');
  });

  it('says the sign-in expired for error code 105', () => {
    assert.match(run({ result: result({ is_error: true, error_code: 105 }) }).userMessage, /expired/);
  });

  it("falls back to the CLI's own words, redacted", () => {
    const v = run({ result: result({ is_error: true, errors: ['boom with sk-abcdefghijklmnop'] }) });
    assert.equal(v.kind, 'run_error');
    assert.match(v.userMessage, /boom/);
    assert.ok(!v.userMessage.includes('sk-abcdefghijklmnop'));
  });

  it('reports a signal with no result as interrupted', () => {
    assert.equal(run({ signal: 'SIGTERM' }).kind, 'interrupted');
  });

  it('uses the China edition names', () => {
    const v = classifyQoderRun({ result: interpretQoderFrame(SIGNED_OUT_RESULT) }, EDITIONS.cn);
    assert.match(v.userMessage, /qoderclicn login/);
    assert.match(v.userMessage, /qoder\.cn\/account\/integrations/);
  });

  it('picks the error line out of a stack trace', () => {
    assert.match(qoderErrorLine(PAT_REJECTED_STDERR), /^The QODER_PERSONAL_ACCESS_TOKEN environment variable/);
    assert.equal(qoderErrorLine(''), '');
  });
});

describe('qoder redaction', () => {
  it('redacts the exact token whatever its format', () => {
    const out = redactSecrets('failed for token qd_8f7e6d5c4b3a2910 today', ['qd_8f7e6d5c4b3a2910']);
    assert.ok(!out.includes('qd_8f7e6d5c4b3a2910'));
  });
});

describe('qoder process tree', () => {
  it('walks every descendant, nearest first', () => {
    const rows = parseProcessTable([
      '  100     1   100',
      '  200   100   100', // MCP server, in the CLI's group
      '  300   100   300', // shell tool, a session of its own
      '  301   300   300',
      '  999     1   999',
    ].join('\n'));
    assert.deepEqual(descendantsOf(rows, 100).map((r) => r.pid), [200, 300, 301]);
  });

  it('survives a cycle in a malformed table', () => {
    const rows = [{ pid: 2, ppid: 3, pgid: 2 }, { pid: 3, ppid: 2, pgid: 3 }];
    assert.deepEqual(descendantsOf(rows, 2).map((r) => r.pid), [3]);
  });
});

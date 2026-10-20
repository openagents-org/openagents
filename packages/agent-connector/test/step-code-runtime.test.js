'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  STEP_MIN_VERSION,
  STEP_MCP_SERVER_NAME,
  STEP_ROUTING_VARS,
  classifyStepVersion,
  parseStepVersion,
  redactSecrets,
  redactFrame,
  secretValuesIn,
  redactArgs,
  resolveStepAuth,
  stepRegionOf,
  stepModelsUrl,
  userStepPaths,
  readUserStepConfig,
  buildStepConfigToml,
  buildStepChildEnv,
  buildStepArgs,
  interpretStepFrame,
  classifyStepRun,
  summarizeModelsProbe,
  descendantsOf,
  parseProcessTable,
  stepErrorLines,
} = require('../src/adapters/step-code-runtime');

describe('step-code-runtime — version and identity', () => {
  it('reads the bare version Step Code prints', () => {
    assert.equal(parseStepVersion('0.1.5\n'), '0.1.5');
    assert.equal(parseStepVersion('v0.2.0'), '0.2.0');
  });

  it("never takes Smallstep's `step` for a supported Step Code", () => {
    const identify = require('../../../registry/step-code.json').install.identify;
    const v = classifyStepVersion('Smallstep CLI/0.28.7 (linux/amd64)\nRelease Date: 2025-07-14 22:01 UTC\n', identify);
    assert.equal(v.foreign, true);
    assert.equal(v.supported, false);
    assert.equal(v.version, null);
    assert.equal(classifyStepVersion('0.1.5\n', identify).foreign, false);
  });

  it('gates on the minimum, and stays lenient on unreadable output', () => {
    assert.equal(classifyStepVersion('0.1.3').supported, false);
    assert.equal(classifyStepVersion(STEP_MIN_VERSION).supported, true);
    assert.equal(classifyStepVersion('0.9.0').tested, false);
    const blank = classifyStepVersion('');
    assert.equal(blank.supported, null);
    assert.equal(blank.foreign, false);
  });
});

describe('step-code-runtime — redaction', () => {
  it('redacts exact values in every string of a frame, keys included', () => {
    const key = 'sk-step-secret-0123456789';
    const frame = {
      type: 'tool_execution_end',
      args: { command: `export STEP_API_KEY=${key} && env` },
      result: { content: [{ type: 'text', text: `STEP_API_KEY=${key}` }] },
      [key]: 'as a key',
    };
    const out = JSON.stringify(redactFrame(frame, [key]));
    assert.ok(!out.includes(key));
    assert.ok(out.includes('[redacted]'));
  });

  it('collects credential-named values from an env, and nothing else', () => {
    const values = secretValuesIn({ OPENAI_API_KEY: 'sk-other-123456789', PATH: '/usr/bin:/bin:/x/y', SHORT_API_KEY: 'abc' });
    assert.deepEqual(values, ['sk-other-123456789']);
  });

  it('masks key-shaped text and hides the briefing in a logged argv', () => {
    assert.ok(!redactSecrets('Bearer abcdefghijklmnop').includes('abcdefghijklmnop'));
    const logged = redactArgs(['-p', '--session-id', 'abc', '--append-system-prompt', 'long brief', '--model', 'm']);
    assert.deepEqual(logged, ['-p', '--session-id', '<session-id>', '--append-system-prompt', '<system-prompt>', '--model', 'm']);
  });
});

describe('step-code-runtime — credentials and regions', () => {
  it('takes the key from STEP_API_KEY or the generic LLM_API_KEY, with a mainland base by default', () => {
    assert.deepEqual(resolveStepAuth({ LLM_API_KEY: 'k1', LLM_MODEL: 'm1' }),
      { mode: 'key', key: 'k1', baseUrl: 'https://api.stepfun.com/v1', model: 'm1' });
    assert.equal(resolveStepAuth({ STEP_API_KEY: 'k2', LLM_API_KEY: 'k1' }).key, 'k2');
    assert.equal(resolveStepAuth({ STEP_API_KEY: 'k', STEP_BASE_URL: 'https://api.stepfun.ai/v1' }).baseUrl, 'https://api.stepfun.ai/v1');
  });

  it('runs on the sign-in without a key, ignoring a prefilled base URL', () => {
    const auth = resolveStepAuth({ STEP_BASE_URL: 'https://api.stepfun.com/v1' });
    assert.equal(auth.mode, 'login');
    assert.equal(auth.baseUrl, '');
  });

  it('prefers the workspace model', () => {
    assert.equal(resolveStepAuth({ STEP_MODEL: 'a', LLM_MODEL: 'b' }, 'c').model, 'c');
    assert.equal(resolveStepAuth({ STEP_MODEL: 'a', LLM_MODEL: 'b' }).model, 'a');
  });

  it('knows the two StepFun hosts and nothing else', () => {
    assert.equal(stepRegionOf('https://api.stepfun.com/v1'), 'cn');
    assert.equal(stepRegionOf('https://api.stepfun.ai'), 'global');
    assert.equal(stepRegionOf('https://relay.example.com/v1'), null);
    assert.equal(stepRegionOf('not a url'), null);
  });

  it('lists models where the CLI does, whatever /v1 spelling the base has', () => {
    for (const base of ['https://api.stepfun.com', 'https://api.stepfun.com/v1', 'https://api.stepfun.com/v1/', 'https://api.stepfun.com/v1/messages']) {
      assert.equal(stepModelsUrl(base), 'https://api.stepfun.com/v1/models', base);
    }
    assert.equal(stepModelsUrl('https://relay.example.com/openai/v1'), 'https://relay.example.com/openai/v1/models');
    assert.equal(stepModelsUrl('nope'), null);
  });

  it("finds the user's own Step files the way the CLI does", () => {
    const home = path.resolve('/home/u');
    const p = userStepPaths({ HOME: home }, '/ignored');
    assert.equal(p.authPath, path.join(home, '.stepcode', 'auth.json'));
    assert.equal(p.toolsDir, path.join(home, '.stepcode', 'agent', 'bin'));
    const moved = userStepPaths({ HOME: home, STEP_CODING_AGENT_DIR: path.resolve('/data/step/agent') });
    assert.equal(moved.authPath, path.join(path.resolve('/data/step'), 'auth.json'));
    assert.equal(userStepPaths({ HOME: home, STEPCODE_AUTH_PATH: '/x/auth.json' }).authPath, '/x/auth.json');
  });

  it("carries the user's telemetry opt-out and shell path, nothing else", () => {
    const cfg = readUserStepConfig([
      '# StepCode configuration',
      'theme = "step-blue"',
      'shellPath = "C:\\\\Program Files\\\\Git\\\\bin\\\\bash.exe"',
      'defaultModel = "theirs"',
      '[telemetry]',
      'enabled = false # off',
      '[mcp_servers.x]',
      'enabled = true',
    ].join('\n'));
    assert.equal(cfg.telemetryDisabled, true);
    assert.equal(cfg.shellPath, 'C:\\Program Files\\Git\\bin\\bash.exe');
    assert.deepEqual(readUserStepConfig(''), { telemetryDisabled: false, shellPath: null });
  });
});

describe('step-code-runtime — the run config', () => {
  it('declares only the workspace server, disables the built-in plugin server and sets the tier', () => {
    const toml = buildStepConfigToml({
      mcp: { command: 'C:\\node\\node.exe', args: ['C:\\oa\\bin.js', 'mcp-server', '--channel-name', 'a "b"'], env: { OA_WORKSPACE_TOKEN: 'tok' } },
    });
    assert.ok(toml.includes(`[mcp_servers.${STEP_MCP_SERVER_NAME}]`));
    assert.ok(toml.includes('command = "C:\\\\node\\\\node.exe"'));
    assert.ok(toml.includes('"a \\"b\\""'));
    assert.ok(toml.includes('env = { OA_WORKSPACE_TOKEN = "tok" }'));
    assert.ok(/\[mcp_servers\.steppage__steppage\]\nenabled = false/.test(toml));
    assert.ok(!toml.includes('[telemetry]'));
  });

  it('runs execute mode on Full Access, acknowledged in this file, and plan mode on Approve for Me', () => {
    assert.ok(/\[tools\.approval\]\npreset = "full-access"\nfullAccessAcknowledged = true/.test(buildStepConfigToml({})));
    const plan = buildStepConfigToml({ planMode: true });
    assert.ok(/\[tools\.approval\]\npreset = "approve-for-me"/.test(plan));
    assert.ok(!plan.includes('fullAccessAcknowledged'));
  });

  it('still disables the plugin server when no workspace server could be located', () => {
    const toml = buildStepConfigToml({ mcp: null, telemetryDisabled: true, shellPath: '/bin/bash' });
    assert.ok(!toml.includes(STEP_MCP_SERVER_NAME));
    assert.ok(toml.includes('steppage__steppage'));
    assert.ok(/\[telemetry\]\nenabled = false/.test(toml));
    assert.ok(toml.includes('shellPath = "/bin/bash"'));
  });
});

describe('step-code-runtime — the child environment', () => {
  const base = {
    PATH: '/usr/bin:/bin',
    LLM_API_KEY: 'k', LLM_BASE_URL: 'b', LLM_MODEL: 'm',
    STEP_API_KEY: 'inherited', STEP_BASE_URL: 'https://inherited',
    STEP_PROVIDER_API_URL: 'https://outranks-base', STEP_MODEL: 'theirs', STEPCODE_AUTH_PATH: '/theirs.json',
  };
  const dirs = { agentDir: '/r/ch/agent', storageDir: '/r/storage', planDir: '/r/plans' };

  it('runs a key on its base, privately rooted, with every routing override gone', () => {
    const env = buildStepChildEnv(base, { ...dirs, auth: { mode: 'key', key: 'sk-form-123456789', baseUrl: 'https://api.stepfun.ai/v1' } });
    assert.equal(env.STEP_API_KEY, 'sk-form-123456789');
    assert.equal(env.STEP_BASE_URL, 'https://api.stepfun.ai/v1');
    assert.equal(env.STEP_CODING_AGENT_DIR, '/r/ch/agent');
    assert.equal(env.STEPCODE_STORAGE_ROOT_DIR, '/r/storage');
    assert.equal(env.STEP_CODING_AGENT_PLAN_DIR, '/r/plans');
    assert.equal(env.STEP_NON_INTERACTIVE_DENIAL, 'continue');
    for (const k of ['STEP_DISABLE_CRON', 'STEP_DISABLE_GOAL', 'STEP_DISABLE_SCHEDULE', 'STEP_DISABLE_WORKFLOW']) assert.equal(env[k], '1');
    for (const k of ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'STEP_PROVIDER_API_URL', 'STEP_MODEL', 'STEPCODE_AUTH_PATH']) {
      assert.equal(env[k], undefined, k);
    }
    // The region's own search endpoint, paid with the same key.
    assert.equal(env.STEPCODE_SEARCH_API_KEY, 'sk-form-123456789');
    assert.equal(env.STEPCODE_SEARCH_WEB_MCP_URL, 'https://api.stepfun.ai/v1/mcp/web_search/mcp');
  });

  it("gives a relay's key no search endpoint", () => {
    const env = buildStepChildEnv(base, { ...dirs, auth: { mode: 'key', key: 'k-123456789', baseUrl: 'https://relay.example.com/v1' } });
    assert.equal(env.STEPCODE_SEARCH_API_KEY, undefined);
    assert.equal(env.STEPCODE_SEARCH_WEB_MCP_URL, undefined);
  });

  it("points a sign-in run at the user's own auth.json, with no key and no base", () => {
    const env = buildStepChildEnv(base, {
      ...dirs, auth: { mode: 'login', key: '', baseUrl: '' }, userPaths: { authPath: '/home/u/.stepcode/auth.json' },
    });
    assert.equal(env.STEPCODE_AUTH_PATH, '/home/u/.stepcode/auth.json');
    assert.equal(env.STEP_API_KEY, undefined);
    assert.equal(env.STEP_BASE_URL, undefined);
  });

  it("puts the installer's fd/rg first on PATH, under whatever the PATH key is called", () => {
    const env = buildStepChildEnv({ Path: 'C:\\Windows' }, {
      ...dirs, auth: { mode: 'login' }, userPaths: { toolsDir: 'C:\\u\\.stepcode\\agent\\bin' }, toolsDirExists: true, pathDelimiter: ';',
    });
    assert.equal(env.Path, 'C:\\u\\.stepcode\\agent\\bin;C:\\Windows');
    assert.equal(env.PATH, undefined);
  });

  it('honours a telemetry opt-out', () => {
    assert.equal(buildStepChildEnv({}, { ...dirs, telemetryDisabled: true }).STEPCODE_DISABLE_TELEMETRY, '1');
  });

  it('lists the base-URL overrides the CLI checks ahead of STEP_BASE_URL', () => {
    for (const k of ['STEP_PROVIDER_API_URL', 'STEP_API_URL']) assert.ok(STEP_ROUTING_VARS.includes(k));
  });
});

describe('step-code-runtime — argv', () => {
  it('runs headless JSON with project-local files untrusted, keeping project instructions and skills', () => {
    const args = buildStepArgs({ sessionDir: '/s', sessionId: 'id', model: 'step-3.5-flash', appendSystemPrompt: 'brief' });
    assert.deepEqual(args.slice(0, 3), ['-p', '--mode', 'json']);
    for (const f of ['--no-approve', '--no-update-check']) assert.ok(args.includes(f), f);
    for (const f of ['--no-context-files', '--no-skills']) assert.ok(!args.includes(f), f);
    assert.equal(args[args.indexOf('--non-interactive-approval') + 1], 'allow');
    assert.equal(args[args.indexOf('--session-id') + 1], 'id');
    assert.equal(args[args.indexOf('--model') + 1], 'step-3.5-flash');
    const excluded = args[args.indexOf('--exclude-tools') + 1].split(',');
    for (const t of ['clarify_user', 'enter_plan_mode', 'exit_plan_mode']) assert.ok(excluded.includes(t), t);
  });

  it('never lets --plan swallow a value', () => {
    const args = buildStepArgs({ planMode: true });
    const i = args.indexOf('--plan');
    assert.ok(i > 0);
    assert.ok(args[i + 1].startsWith('-'));
  });

  it('adds extra exclusions once, and no --model when none is set', () => {
    const args = buildStepArgs({ extraExcludedTools: ['search_web', 'clarify_user'] });
    assert.ok(!args.includes('--model'));
    const excluded = args[args.indexOf('--exclude-tools') + 1].split(',');
    assert.equal(excluded.filter((t) => t === 'clarify_user').length, 1);
    assert.ok(excluded.includes('search_web'));
  });
});

describe('step-code-runtime — frames', () => {
  it('reads the session header and the plan-mode entry', () => {
    assert.deepEqual(interpretStepFrame({ type: 'session', version: 3, id: 'abc', cwd: '/p' }), { kind: 'session', id: 'abc' });
    assert.deepEqual(interpretStepFrame({
      type: 'entry_appended',
      entry: { type: 'custom', customType: 'step-plan', data: { enabled: true, planFilePath: '/plans/session-abc.md' } },
    }), { kind: 'plan_state', enabled: true, planFile: '/plans/session-abc.md' });
    assert.equal(interpretStepFrame({ type: 'entry_appended', entry: { customType: 'step.usage_provenance', data: {} } }).kind, 'entry');
  });

  it("hands Pi's own records to the Pi classifier", () => {
    assert.equal(interpretStepFrame({ type: 'agent_start' }).kind, 'agent_start');
    const tool = interpretStepFrame({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'run_command', args: { command: 'ls' } });
    assert.equal(tool.kind, 'tool_start');
    assert.equal(tool.preview, 'ls');
    assert.equal(interpretStepFrame({ type: 'brand_new' }).kind, 'unknown');
  });

  it('redacts before classifying', () => {
    const ev = interpretStepFrame({ type: 'tool_execution_start', toolCallId: 't', toolName: 'run_command', args: { command: 'echo sk-zz-1234567890' } }, ['sk-zz-1234567890']);
    assert.ok(!ev.preview.includes('sk-zz-1234567890'));
  });
});

describe('step-code-runtime — run classification', () => {
  const key = { mode: 'key', key: 'k', baseUrl: 'https://api.stepfun.com/v1', model: 'step-x' };
  const login = { mode: 'login', key: '', baseUrl: '' };
  const NO_KEY = 'No API key found for the selected model.\n\nUse /login to log into a provider via OAuth or API key. See:\n  /h/.stepcode/bin/docs/providers.md\n';

  it('a clean exit is a success', () => {
    assert.equal(classifyStepRun({ code: 0 }, key).ok, true);
  });

  it('a 401 from the model is a rejected key, or a rejected sign-in', () => {
    const err = '401: {"error":{"message":"Incorrect API key provided","type":"invalid_api_key"}}';
    const k = classifyStepRun({ code: 1, turnError: err }, key);
    assert.equal(k.kind, 'auth');
    assert.ok(k.userMessage.includes('api.stepfun.com'));
    assert.equal(classifyStepRun({ code: 1, turnError: err }, login).userMessage.includes('step login'), true);
  });

  it('separates quota, model, server and network failures', () => {
    assert.equal(classifyStepRun({ code: 1, turnError: '429: {"error":{"message":"rate limited"}}' }, key).kind, 'quota');
    assert.equal(classifyStepRun({ code: 1, turnError: '404: {"error":{"message":"model not found"}}' }, key).kind, 'model');
    assert.equal(classifyStepRun({ code: 1, turnError: '500: {"error":{"message":"boom"}}' }, key).kind, 'server');
    assert.equal(classifyStepRun({ code: 1, turnError: 'fetch failed: ECONNREFUSED' }, key).kind, 'network');
  });

  it('tells a signed-out machine from a sign-in that no longer works', () => {
    assert.ok(classifyStepRun({ code: 1, stderr: NO_KEY }, login).userMessage.includes('not signed in'));
    assert.ok(classifyStepRun({ code: 1, stderr: NO_KEY, hasLoginCredential: true }, login).userMessage.includes('rejected or has expired'));
  });

  it('uses the probe to split a rejected key from an unreachable endpoint', () => {
    assert.equal(classifyStepRun({ code: 1, stderr: NO_KEY, probe: { status: 401 } }, key).kind, 'auth');
    assert.equal(classifyStepRun({ code: 1, stderr: 'Error: No models available. Check your installation.', probe: { networkError: true } }, key).kind, 'network');
    assert.equal(classifyStepRun({ code: 1, stderr: NO_KEY, probe: { status: 200, emptyList: true } }, key).kind, 'no_models');
    assert.ok(classifyStepRun({ code: 1, stderr: NO_KEY, probe: { status: 404 } }, key).userMessage.includes('HTTP 404'));
  });

  it('names a malformed base URL', () => {
    const v = classifyStepRun({ code: 1, stderr: 'Error: Failed to load extension "<inline:Step>": Step API base URL must be a valid URL\nHint: Start without extensions using "step -ne".' }, { ...key, baseUrl: 'nope' });
    assert.equal(v.kind, 'config');
  });

  it("drops the CLI's warnings and doc pointers from what it shows", () => {
    assert.deepEqual(stepErrorLines("Warning: No project session found with id 'x'; creating a new session with that id.\n" + NO_KEY),
      ['No API key found for the selected model.']);
    const v = classifyStepRun({ code: 3, stderr: 'Error: something odd\n    at x (y)' }, key);
    assert.equal(v.kind, 'startup_error');
    assert.ok(v.userMessage.includes('something odd'));
  });

  it("keeps only the chat models the CLI keeps when reading a probe", () => {
    assert.deepEqual(summarizeModelsProbe({ status: 200, body: { data: [{ id: 'step-tts', model_type: '语音合成' }] } }), { status: 200, emptyList: true });
    assert.deepEqual(summarizeModelsProbe({ status: 200, body: { data: [{ id: 'a', model_type: '大语言模型' }] } }), { status: 200, count: 1 });
    assert.deepEqual(summarizeModelsProbe({ status: 200, body: { data: [{ id: 'untyped' }] } }), { status: 200, count: 1 });
    assert.deepEqual(summarizeModelsProbe({ status: 401 }), { status: 401 });
    assert.deepEqual(summarizeModelsProbe({ networkError: true }), { networkError: true });
  });
});

describe('step-code-runtime — process tree', () => {
  it('walks every descendant, nearest first', () => {
    const rows = parseProcessTable('  10 1 10\n 11 10 10\n 12 11 12\n 13 12 12\n 99 1 99\n');
    assert.deepEqual(descendantsOf(rows, 10).map((r) => r.pid), [11, 12, 13]);
    assert.deepEqual(descendantsOf(rows, 99), []);
  });
});

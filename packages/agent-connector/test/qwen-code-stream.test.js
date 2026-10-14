'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  QWEN_DEFAULT_BASE_URL,
  QWEN_MIN_VERSION,
  EXCLUDED_TOOLS,
  buildQwenArgs,
  buildQwenChildEnv,
  buildQwenSystemDefaults,
  classifyQwenRun,
  classifyQwenVersion,
  interpretQwenFrame,
  parseFrame,
  parseQwenSettings,
  qwenSystemDefaultsSource,
  redactArgs,
  sameQwenSettings,
  redactSecrets,
  resolveQwenCredentials,
} = require('../src/adapters/qwen-code-stream');

// Frames below are copied from real `qwen -o stream-json` runs of
// @qwen-code/qwen-code 0.25.1 (uuids and long fields trimmed).

describe('qwen-code version gate', () => {
  it('accepts the floor and anything newer', () => {
    assert.equal(classifyQwenVersion(QWEN_MIN_VERSION).supported, true);
    assert.equal(classifyQwenVersion('0.25.1\n').supported, true);
    assert.equal(classifyQwenVersion('1.0.0').supported, true);
  });

  it('refuses a release that rejects --mcp-config', () => {
    assert.deepEqual(classifyQwenVersion('0.15.0'), { version: '0.15.0', supported: false, tested: true });
  });

  it('reads a prerelease by its base version', () => {
    assert.equal(classifyQwenVersion('0.25.2-preview.0').version, '0.25.2');
  });

  it('proceeds when the version cannot be read', () => {
    assert.equal(classifyQwenVersion('').supported, null);
    assert.equal(classifyQwenVersion('command not found').supported, null);
  });
});

describe('qwen-code credentials', () => {
  it("takes key, base URL and model from the agent's own form fields", () => {
    const c = resolveQwenCredentials({
      LLM_API_KEY: 'sk-agent', LLM_BASE_URL: 'https://coding.dashscope.aliyuncs.com/v1', LLM_MODEL: 'qwen3.6-plus',
      OPENAI_API_KEY: 'sk-shell', OPENAI_BASE_URL: 'https://api.openai.com/v1', OPENAI_MODEL: 'gpt-x',
    });
    assert.deepEqual(c, {
      apiKey: 'sk-agent', baseUrl: 'https://coding.dashscope.aliyuncs.com/v1', model: 'qwen3.6-plus', source: 'agent',
    });
  });

  it('never mixes a form key with a base URL exported for another tool', () => {
    // The form left the base URL blank; the shell has OPENAI_BASE_URL for
    // something else. The agent's key must not be sent there.
    const c = resolveQwenCredentials({ LLM_API_KEY: 'sk-agent', OPENAI_BASE_URL: 'https://api.openai.com/v1' });
    assert.equal(c.baseUrl, '');
    const env = buildQwenChildEnv({ OPENAI_BASE_URL: 'https://api.openai.com/v1', OPENAI_MODEL: 'gpt-x' }, { creds: c });
    assert.equal(env.OPENAI_BASE_URL, QWEN_DEFAULT_BASE_URL);
    assert.equal(env.OPENAI_MODEL, undefined);
  });

  it('falls back to the OPENAI_* set, including QWEN_MODEL', () => {
    const c = resolveQwenCredentials({ OPENAI_API_KEY: 'sk-env', QWEN_MODEL: 'qwen3.8-flash' });
    assert.deepEqual(c, { apiKey: 'sk-env', baseUrl: '', model: 'qwen3.8-flash', source: 'env' });
  });

  it('never sends a key exported for another tool to Model Studio by default', () => {
    // An OPENAI_API_KEY in the shell is most likely an OpenAI key. Pointing a
    // blank base URL at DashScope would hand it to a third party.
    const c = resolveQwenCredentials({ OPENAI_API_KEY: 'sk-openai-key-123456' });
    const env = buildQwenChildEnv({ OPENAI_API_KEY: 'sk-openai-key-123456' }, { creds: c });
    assert.equal(env.OPENAI_BASE_URL, 'https://api.openai.com/v1');
  });

  it("puts the workspace's model picker ahead of the configured model", () => {
    const c = resolveQwenCredentials({ LLM_API_KEY: 'k', LLM_MODEL: 'configured' }, 'picked');
    assert.equal(c.model, 'picked');
  });

  it("leaves a keyless agent to the CLI's own settings", () => {
    const c = resolveQwenCredentials({});
    assert.equal(c.source, 'none');
    const env = buildQwenChildEnv({ OPENAI_BASE_URL: 'keep-me' }, { creds: c });
    assert.equal(env.OPENAI_BASE_URL, 'keep-me');
    assert.equal(env.OPENAI_API_KEY, undefined);
  });

  it('writes the settings layer and silences the per-run yolo warning', () => {
    const env = buildQwenChildEnv({}, { creds: { apiKey: 'k', baseUrl: 'u', model: 'm' }, defaultsPath: '/x/defaults.json' });
    assert.equal(env.OPENAI_API_KEY, 'k');
    assert.equal(env.OPENAI_BASE_URL, 'u');
    assert.equal(env.OPENAI_MODEL, 'm');
    assert.equal(env.QWEN_CODE_SYSTEM_DEFAULTS_PATH, '/x/defaults.json');
    assert.equal(env.QWEN_CODE_SUPPRESS_YOLO_WARNING, '1');
  });
});

describe('qwen-code settings layer', () => {
  it('reads JSONC settings without treating quoted URLs or escaped quotes as comments', () => {
    const source = '\uFEFF{ // system policy\n' +
      '"url": "https://example.com/path/*literal*/", /* keep URL */\n' +
      '"label": "say \\"hello\\" // literal",\n' +
      '"tools": {"exclude": ["web_search"]}\n}';
    assert.deepEqual(parseQwenSettings(source), {
      url: 'https://example.com/path/*literal*/',
      label: 'say "hello" // literal',
      tools: { exclude: ['web_search'] },
    });
    assert.throws(() => parseQwenSettings('{"value":1/* comment */2}'), SyntaxError);
    assert.throws(() => parseQwenSettings('{"value":1,}'), SyntaxError);
    assert.throws(() => parseQwenSettings('null'), SyntaxError);
    assert.throws(() => parseQwenSettings('[]'), SyntaxError);
  });

  it('turns off auto-memory and self-update', () => {
    const d = buildQwenSystemDefaults(null);
    assert.equal(d.memory.enableManagedAutoMemory, false);
    assert.equal(d.memory.enableManagedAutoDream, false);
    assert.equal(d.general.enableAutoUpdate, false);
  });

  it('changes nothing a headless run does not depend on', () => {
    // Usage statistics and the like are the user's call.
    assert.deepEqual(Object.keys(buildQwenSystemDefaults(null)).sort(), ['general', 'memory']);
  });

  it("lets a machine-wide system-defaults file win key by key", () => {
    const d = buildQwenSystemDefaults({ memory: { enableManagedAutoMemory: true }, ui: { theme: 'x' } });
    assert.equal(d.memory.enableManagedAutoMemory, true);
    assert.equal(d.memory.enableManagedAutoDream, false);
    assert.equal(d.ui.theme, 'x');
  });

  it('treats the version stamp the CLI writes back as no change', () => {
    const desired = buildQwenSystemDefaults(null);
    const stamped = { ...JSON.parse(JSON.stringify(desired)), $version: 4 };
    assert.equal(sameQwenSettings(stamped, desired), true);
    stamped.memory.enableManagedAutoMemory = true;
    assert.equal(sameQwenSettings(stamped, desired), false);
    assert.equal(sameQwenSettings(null, desired), false);
  });

  it("finds the CLI's own system-defaults file", () => {
    assert.equal(qwenSystemDefaultsSource({}, 'linux'), '/etc/qwen-code/system-defaults.json');
    assert.equal(qwenSystemDefaultsSource({}, 'darwin'), '/Library/Application Support/QwenCode/system-defaults.json');
    assert.equal(qwenSystemDefaultsSource({}, 'win32'), 'C:\\ProgramData\\qwen-code\\system-defaults.json');
    assert.equal(qwenSystemDefaultsSource({ QWEN_CODE_SYSTEM_SETTINGS_PATH: '/opt/q/settings.json' }, 'linux'),
      '/opt/q/system-defaults.json');
    assert.equal(qwenSystemDefaultsSource({ QWEN_CODE_SYSTEM_DEFAULTS_PATH: '/d.json' }, 'linux'), '/d.json');
  });
});

describe('qwen-code argv', () => {
  it('runs headless with full tool access and no prompt in argv', () => {
    const args = buildQwenArgs({ appendSystemPrompt: 'brief', authType: 'openai', model: 'qwen3.8-flash', mcpConfigPath: '/m.json' });
    assert.deepEqual(args.slice(0, 4), ['--output-format', 'stream-json', '--approval-mode', 'yolo']);
    assert.equal(args[args.indexOf('--auth-type') + 1], 'openai');
    assert.equal(args[args.indexOf('--model') + 1], 'qwen3.8-flash');
    assert.equal(args[args.indexOf('--mcp-config') + 1], '/m.json');
    assert.equal(args[args.indexOf('--append-system-prompt') + 1], 'brief');
    assert.ok(!args.includes('--resume'));
  });

  it('keeps the excluded-tools list closed by another flag', () => {
    // --exclude-tools is a yargs array: it would swallow a following
    // positional, so a flag must come right after its values.
    const args = buildQwenArgs({});
    const i = args.indexOf('--exclude-tools');
    assert.deepEqual(args.slice(i + 1, i + 1 + EXCLUDED_TOOLS.length), EXCLUDED_TOOLS);
    const next = args[i + 1 + EXCLUDED_TOOLS.length];
    assert.ok(next === undefined || next.startsWith('--'));
  });

  it('resumes, and runs read-only in plan mode', () => {
    const args = buildQwenArgs({ resumeSessionId: 'sid-1', planMode: true });
    assert.equal(args[args.indexOf('--resume') + 1], 'sid-1');
    assert.equal(args[args.indexOf('--approval-mode') + 1], 'plan');
  });

  it('omits the auth type and model when the CLI is to decide', () => {
    const args = buildQwenArgs({ authType: '', model: '' });
    assert.ok(!args.includes('--auth-type'));
    assert.ok(!args.includes('--model'));
  });

  it('redacts the session id and system prompt for logging', () => {
    const shown = redactArgs(buildQwenArgs({ resumeSessionId: 'sid-1', appendSystemPrompt: 'secret brief' }));
    assert.ok(!shown.includes('sid-1'));
    assert.ok(!shown.includes('secret brief'));
  });

  it('redacts keys from free text', () => {
    assert.ok(!redactSecrets('key sk-ws-H.PHMLRHM.gozS.abcdef12345').includes('PHMLRHM'));
  });
});

describe('qwen-code frames', () => {
  it('reads the session id off the init frame', () => {
    const ev = interpretQwenFrame(parseFrame(JSON.stringify({
      type: 'system', subtype: 'init', session_id: 'a5d2610a', model: 'qwen3.8-flash', permission_mode: 'yolo',
      mcp_servers: [{ name: 'openagents-workspace', status: 'connected' }], qwen_code_version: '0.25.1',
    })));
    assert.equal(ev.kind, 'init');
    assert.equal(ev.sessionId, 'a5d2610a');
    assert.deepEqual(ev.mcpServers, [{ name: 'openagents-workspace', status: 'connected' }]);
  });

  it('ignores the goal_state ping, tool results, and thinking', () => {
    assert.equal(interpretQwenFrame({ type: 'stream_event', event: { type: 'goal_state' } }).kind, 'ignored');
    assert.equal(interpretQwenFrame({ type: 'user', message: { content: [{ type: 'tool_result' }] } }).kind, 'ignored');
    assert.equal(interpretQwenFrame({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hm' }] } }).kind, 'ignored');
  });

  it('reports text and a shell call for the ticker', () => {
    const text = interpretQwenFrame({ type: 'assistant', message: { content: [{ type: 'text', text: 'I will run it.\n\n' }] } });
    assert.deepEqual(text.texts, ['I will run it.']);
    const tool = interpretQwenFrame({ type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'run_shell_command', input: { command: 'cat hello.txt', description: 'Print it' } },
    ] } });
    assert.deepEqual(tool.tools, [{ name: 'run_shell_command', preview: 'cat hello.txt' }]);
  });

  it('announces an MCP call as the tool it ran, and skips the lookup', () => {
    const lookup = interpretQwenFrame({ type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'tool_search', input: { query: 'select:mcp__magic__get_magic_number' } },
    ] } });
    assert.equal(lookup.kind, 'ignored');
    const call = interpretQwenFrame({ type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'tool_call', input: { name: 'mcp__openagents-workspace__workspace_get_history', arguments: { channel: 'c1' } } },
    ] } });
    assert.deepEqual(call.tools, [{ name: 'workspace_get_history', preview: '{"channel":"c1"}' }]);
  });

  it('keeps a streamed API error out of the answer text', () => {
    const ev = interpretQwenFrame({ type: 'assistant', message: { content: [
      { type: 'text', text: '[API Error: 401 Incorrect API key provided. For details, see: https://help.aliyun.com/zh/model-studio/error-code#apikey-error]' },
    ] } });
    assert.deepEqual(ev.texts, []);
    assert.equal(ev.apiErrors.length, 1);
  });

  it('reads success and failure result frames', () => {
    const ok = interpretQwenFrame({ type: 'result', subtype: 'success', is_error: false, result: 'PONG', session_id: 's', num_turns: 1 });
    assert.equal(ok.text, 'PONG');
    assert.equal(ok.isError, false);
    const bad = interpretQwenFrame({ type: 'result', subtype: 'error_during_execution', is_error: true,
      error: { message: '[API Error: 404 The model `x` does not exist or you do not have access to it.]' } });
    assert.equal(bad.isError, true);
    assert.equal(bad.text, '');
    assert.match(bad.errorMessage, /404/);
  });

  it('normalizes API errors wrapped as successful results by Qwen Code 0.16.0', () => {
    for (const [message, kind] of [
      ['[API Error: 401 Incorrect API key provided.]', 'auth'],
      ['[API Error: 404 The model does not exist.]', 'model'],
    ]) {
      const result = interpretQwenFrame({ type: 'result', subtype: 'success', is_error: false, result: message });
      assert.equal(result.isError, true);
      assert.equal(result.text, '');
      assert.equal(result.errorMessage, message);
      assert.equal(classifyQwenRun({ result, code: 0 }).kind, kind);
    }
  });

  it('flags a frame type it has never seen', () => {
    assert.equal(interpretQwenFrame({ type: 'brand_new' }).kind, 'unknown');
    assert.equal(parseFrame('not json'), null);
  });
});

describe('qwen-code run classification', () => {
  const failed = (message) => ({ result: { isError: true, errorMessage: message }, code: 1 });

  it('trusts a clean result frame', () => {
    assert.equal(classifyQwenRun({ result: { isError: false, text: 'x' }, code: 0 }).ok, true);
  });

  it('explains a missing key without echoing the CLI', () => {
    const v = classifyQwenRun(failed('No auth type is selected. Please configure an auth type (e.g. via settings or `--auth-type`) before running in non-interactive mode.'));
    assert.equal(v.kind, 'not_configured');
    assert.match(v.userMessage, /API key/);
    assert.match(v.userMessage, /dashscope/);
  });

  it('classifies the provider errors the CLI passes through', () => {
    assert.equal(classifyQwenRun(failed('[API Error: 401 Incorrect API key provided.]')).kind, 'auth');
    assert.equal(classifyQwenRun(failed('[API Error: 401 invalid access token or token expired]')).kind, 'auth');
    assert.equal(classifyQwenRun(failed('[API Error: 404 The model `no-such` does not exist or you do not have access to it.]')).kind, 'model');
    assert.equal(classifyQwenRun(failed('[API Error: Connection error. (cause: fetch failed)]')).kind, 'network');
    assert.equal(classifyQwenRun(failed('[API Error: 429 Requests rate limit exceeded]')).kind, 'quota');
    assert.equal(classifyQwenRun(failed('[API Error: 503 Service Unavailable]')).kind, 'model_service');
  });

  it("keeps the provider's own words in the message", () => {
    const v = classifyQwenRun(failed('[API Error: 401 Incorrect API key provided.]'));
    assert.match(v.userMessage, /Incorrect API key provided/);
    assert.match(v.userMessage, /Coding Plan/);
  });

  it('reads a stop, a turn cap and a budget off the exit code', () => {
    assert.equal(classifyQwenRun({ code: 130, stderr: 'Operation cancelled.' }).kind, 'interrupted');
    assert.equal(classifyQwenRun({ code: null, signal: 'SIGKILL' }).kind, 'interrupted');
    assert.equal(classifyQwenRun({ code: 53 }).kind, 'turn_limit');
    assert.equal(classifyQwenRun({ code: 55 }).kind, 'budget');
  });

  it('recognizes a resume the CLI could not find', () => {
    const v = classifyQwenRun({ code: 1, stderr: 'No saved session found with ID a5d2610a. Run `qwen --resume` without an ID to choose from existing sessions.' });
    assert.equal(v.kind, 'stale_session');
  });

  it('falls back to stderr, then to the exit code', () => {
    assert.match(classifyQwenRun({ code: 1, stderr: 'Invalid --session-id: "x".\nUsage: qwen' }).userMessage, /Invalid --session-id/);
    assert.match(classifyQwenRun({ code: 7 }).userMessage, /code 7/);
  });
});

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  PROVIDERS,
  QUESTION_ANSWER,
  normalizeProvider,
  providerKeyEnv,
  qualifyModel,
  resolveServerMode,
  buildServerArgs,
  buildSecretsProfiles,
  sessionIdFor,
  sessionUrl,
  interpretEvent,
  toolLabel,
  promptReply,
  promptSummary,
  isInside,
  serverSpawnCommand,
  classifyServerFailure,
  missingKeyMessage,
  redactSecrets,
  truncate,
} = require('../src/adapters/openworker-runtime');

describe('openworker-runtime — providers', () => {
  it('normalises a known provider and rejects everything else', () => {
    assert.equal(normalizeProvider('Anthropic'), 'anthropic');
    assert.equal(normalizeProvider('  ollama  '), 'ollama');
    assert.equal(normalizeProvider('auto'), '');
    assert.equal(normalizeProvider(''), '');
    assert.equal(normalizeProvider('bedrock'), '', 'multi-field providers are not offered');
    assert.equal(normalizeProvider(undefined), '');
  });

  it('maps each key-taking provider to the env var OpenWorker reads it from', () => {
    assert.equal(providerKeyEnv('anthropic'), 'ANTHROPIC_API_KEY');
    assert.equal(providerKeyEnv('kimi'), 'MOONSHOT_API_KEY');
    assert.equal(providerKeyEnv('qwen'), 'DASHSCOPE_API_KEY');
    // Keyless providers must return null rather than a plausible-looking guess:
    // a caller that exports a made-up var would silently configure nothing.
    assert.equal(providerKeyEnv('ollama'), null);
    assert.equal(providerKeyEnv('openai-codex'), null);
    // Unknown falls back to the default provider, not to undefined.
    assert.equal(providerKeyEnv('nope'), 'OPENAI_API_KEY');
  });

  it('every key-taking provider declares an env var', () => {
    for (const [name, spec] of Object.entries(PROVIDERS)) {
      if (spec.needsKey) assert.ok(spec.envKey, `${name} needs a key but declares no env var`);
      else assert.equal(spec.envKey, null, `${name} takes no key and must declare none`);
    }
  });
});

describe('openworker-runtime — model qualification', () => {
  it('prefixes a bare id with the selected provider', () => {
    assert.equal(qualifyModel('claude-opus-5', 'anthropic'), 'anthropic:claude-opus-5');
    assert.equal(qualifyModel('  gpt-5.6-sol  ', 'openai'), 'openai:gpt-5.6-sol');
  });

  it('leaves an already-qualified id alone', () => {
    assert.equal(qualifyModel('anthropic:claude-opus-5', 'openai'), 'anthropic:claude-opus-5');
  });

  it('does not mistake a version tag for a provider prefix', () => {
    // OpenWorker's router only strips a KNOWN provider prefix, so `qwen3-coder`
    // stays intact — and we must add ollama's, not assume the colon is one.
    assert.equal(qualifyModel('qwen3-coder:30b', 'ollama'), 'ollama:qwen3-coder:30b');
  });

  it('passes through when no provider is selected, and keeps empty empty', () => {
    assert.equal(qualifyModel('gpt-5.6-sol', ''), 'gpt-5.6-sol');
    assert.equal(qualifyModel('', 'anthropic'), '');
    assert.equal(qualifyModel(null, 'anthropic'), '');
  });
});

describe('openworker-runtime — server invocation', () => {
  it('plan mode wins over the configured mode', () => {
    assert.equal(resolveServerMode('plan', 'bypass-approvals'), 'plan');
    assert.equal(resolveServerMode('plan', 'auto-approve'), 'plan');
  });

  it('defaults to bypass-approvals, because nobody is here to approve', () => {
    // `interactive` (OpenWorker's own default) blocks the turn on a human that
    // does not exist on this socket, so an unset/garbage value must not land there.
    assert.equal(resolveServerMode('execute', ''), 'bypass-approvals');
    assert.equal(resolveServerMode('execute', 'nonsense'), 'bypass-approvals');
    assert.equal(resolveServerMode('execute', undefined), 'bypass-approvals');
  });

  it('honours a mode the user deliberately chose', () => {
    assert.equal(resolveServerMode('execute', 'auto-approve'), 'auto-approve');
    assert.equal(resolveServerMode('execute', 'INTERACTIVE'), 'interactive');
  });

  it('builds argv with host, port and the optional flags', () => {
    assert.deepEqual(
      buildServerArgs({ port: 5001, cwd: '/w', model: 'openai:gpt-5.6-sol', mode: 'bypass-approvals' }),
      ['--host', '127.0.0.1', '--port', '5001', '--cwd', '/w', '--model', 'openai:gpt-5.6-sol', '--mode', 'bypass-approvals'],
    );
    assert.deepEqual(buildServerArgs({ port: 1 }), ['--host', '127.0.0.1', '--port', '1']);
  });
});

describe('openworker-runtime — secret profiles', () => {
  it('writes the key as an env REFERENCE, never the value', () => {
    const out = buildSecretsProfiles({ provider: 'anthropic', keyRefVar: 'OPENWORKER_API_KEY', baseUrl: '' });
    assert.deepEqual(out, { 'provider:anthropic': { api_key: '${OPENWORKER_API_KEY}' } });
    assert.ok(!JSON.stringify(out).includes('sk-'), 'no key material may appear');
  });

  it('carries the base URL, which has no env path in OpenWorker', () => {
    const out = buildSecretsProfiles({
      provider: 'deepseek', keyRefVar: 'OPENWORKER_API_KEY', baseUrl: 'https://relay.example/v1',
    });
    assert.deepEqual(out, {
      'provider:deepseek': { api_key: '${OPENWORKER_API_KEY}', base_url: 'https://relay.example/v1' },
    });
  });

  it('writes only a URL for a keyless provider', () => {
    assert.deepEqual(
      buildSecretsProfiles({ provider: 'ollama', keyRefVar: 'OPENWORKER_API_KEY', baseUrl: 'http://box:11434/v1' }),
      { 'provider:ollama': { base_url: 'http://box:11434/v1' } },
    );
  });

  it('returns null when there is nothing to write, so an existing file is left alone', () => {
    assert.equal(buildSecretsProfiles({ provider: 'ollama', keyRefVar: '', baseUrl: '' }), null);
    assert.equal(buildSecretsProfiles({ provider: 'openai', keyRefVar: '', baseUrl: '  ' }), null);
  });
});

describe('openworker-runtime — session addressing', () => {
  it('derives a stable 12-hex id, so a channel keeps its history across restarts', () => {
    const a = sessionIdFor('ws1', 'bot', 'general');
    assert.match(a, /^[0-9a-f]{12}$/);
    assert.equal(a, sessionIdFor('ws1', 'bot', 'general'));
  });

  it('separates workspaces, agents and channels', () => {
    const base = sessionIdFor('ws1', 'bot', 'general');
    assert.notEqual(base, sessionIdFor('ws2', 'bot', 'general'));
    assert.notEqual(base, sessionIdFor('ws1', 'other', 'general'));
    assert.notEqual(base, sessionIdFor('ws1', 'bot', 'random'));
  });

  it('builds a ws:// URL with the workspace and agent as query parameters', () => {
    const url = sessionUrl({ port: 4242, sessionId: 'abc123', workspace: '/my projects/x', agent: 'code' });
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'ws:');
    assert.equal(parsed.port, '4242');
    assert.equal(parsed.pathname, '/ws/session/abc123');
    assert.equal(parsed.searchParams.get('workspace'), '/my projects/x');
    assert.equal(parsed.searchParams.get('agent'), 'code');
  });
});

describe('openworker-runtime — event interpretation', () => {
  it('reads the ready frame', () => {
    const ev = interpretEvent({
      type: 'ready',
      data: { session_id: 's1', model: 'openai:gpt', mode: 'bypass-approvals', workspace: '/w', running: true },
    });
    assert.deepEqual(ev, {
      kind: 'ready', sessionId: 's1', model: 'openai:gpt', mode: 'bypass-approvals', workspace: '/w', running: true,
    });
  });

  it('takes the reply from assistant_message', () => {
    const ev = interpretEvent({ type: 'assistant_message', data: { text: 'done', tool_calls: ['read_file'] } });
    assert.equal(ev.kind, 'text');
    assert.equal(ev.text, 'done');
    assert.deepEqual(ev.toolCalls, ['read_file']);
  });

  it('classifies the tool lifecycle', () => {
    assert.deepEqual(interpretEvent({ type: 'tool_started', data: { name: 'run_shell' } }),
      { kind: 'tool', phase: 'started', name: 'run_shell' });
    assert.equal(interpretEvent({ type: 'tool_finished', data: { name: 'x', status: 'error', reason: 'boom' } }).status, 'error');
  });

  it('marks every blocking prompt as a prompt', () => {
    for (const type of [
      'permission_required', 'directory_requested', 'tool_requested',
      'plan_proposed', 'question_requested', 'team_proposed', 'items_proposed',
    ]) {
      assert.equal(interpretEvent({ type, data: {} }).kind, 'prompt', `${type} must be a prompt`);
    }
  });

  it('drops progress noise but never invents a kind for something new', () => {
    assert.equal(interpretEvent({ type: 'assistant_delta', data: { text: 'x' } }).kind, 'ignore');
    assert.equal(interpretEvent({ type: 'compacting', data: {} }).kind, 'ignore');
    const unknown = interpretEvent({ type: 'brand_new_thing', data: { a: 1 } });
    assert.equal(unknown.kind, 'unknown');
    assert.match(unknown.raw, /brand_new_thing/);
    assert.equal(interpretEvent(null).kind, 'unknown');
    assert.equal(interpretEvent('nope').kind, 'unknown');
  });

  it('separates end-of-stream, failure and refusal', () => {
    assert.equal(interpretEvent({ type: 'turn_done', data: {} }).kind, 'done');
    assert.equal(interpretEvent({ type: 'interrupted', data: {} }).kind, 'interrupted');
    assert.equal(interpretEvent({ type: 'error', data: { error: 'rate limited' } }).message, 'rate limited');
    assert.equal(interpretEvent({ type: 'input_rejected', data: { error: 'too long' } }).kind, 'rejected');
    // A failure frame with no text still has to say something actionable.
    assert.ok(interpretEvent({ type: 'error', data: {} }).message);
  });

  it('labels tools in words, and falls back to the raw name', () => {
    assert.equal(toolLabel('run_shell'), 'running a command');
    assert.equal(toolLabel('some_new_tool'), 'some_new_tool...');
    assert.equal(toolLabel(''), 'working...');
  });
});

describe('openworker-runtime — answering prompts', () => {
  const prompt = (type, data = {}) => interpretEvent({ type, data });

  it('answers EVERY prompt kind — an unanswered one suspends the turn forever', () => {
    for (const type of [
      'permission_required', 'directory_requested', 'tool_requested',
      'plan_proposed', 'question_requested', 'team_proposed', 'items_proposed',
    ]) {
      const reply = promptReply(prompt(type, { path: '/w/sub' }), { workingDir: '/w' });
      assert.ok(reply && typeof reply.type === 'string', `${type} produced no reply frame`);
    }
  });

  it('approves a tool call once, never as a standing rule', () => {
    const reply = promptReply(prompt('permission_required', { name: 'run_shell' }), { workingDir: '/w' });
    assert.deepEqual(reply, { type: 'approval', decision: 'once' });
  });

  it('denies tool calls in plan mode', () => {
    const reply = promptReply(prompt('permission_required', {}), { planMode: true, workingDir: '/w' });
    assert.equal(reply.decision, 'deny');
  });

  it('grants a folder only inside the working directory', () => {
    const inside = promptReply(prompt('directory_requested', { path: '/w/pkg', writable: true }), { workingDir: '/w' });
    assert.equal(inside.granted, true);
    assert.equal(inside.writable, true);

    const outside = promptReply(prompt('directory_requested', { path: '/etc', writable: true }), { workingDir: '/w' });
    assert.equal(outside.granted, false);
    assert.equal(outside.writable, false, 'a denied grant must never carry write access');
  });

  it('declines tool installs unless the user opted in', () => {
    assert.equal(promptReply(prompt('tool_requested', { tool: 'semgrep' }), {}).approved, false);
    assert.equal(promptReply(prompt('tool_requested', {}), { allowToolInstall: true }).approved, true);
    assert.equal(promptReply(prompt('tool_requested', {}), { allowToolInstall: true, planMode: true }).approved, false);
  });

  it('approves a plan in execute mode and refuses to execute one in plan mode', () => {
    assert.equal(promptReply(prompt('plan_proposed', { plan: 'x' }), {}).approved, true);
    const planned = promptReply(prompt('plan_proposed', { plan: 'x' }), { planMode: true });
    assert.equal(planned.approved, false);
    assert.match(planned.feedback, /plan mode/i);
  });

  it('answers a question rather than leaving the turn parked on a human', () => {
    const reply = promptReply(prompt('question_requested', { question: 'Which branch?' }), {});
    assert.equal(reply.type, 'question_response');
    assert.equal(reply.answer, QUESTION_ANSWER);
    assert.match(reply.answer, /state the assumption/i);
  });

  it('refuses to staff a team unattended but lets board items through', () => {
    assert.equal(promptReply(prompt('team_proposed', {}), {}).approved, false);
    assert.equal(promptReply(prompt('items_proposed', {}), {}).approved, true);
  });

  it('returns null for anything that is not a prompt', () => {
    assert.equal(promptReply(interpretEvent({ type: 'turn_done', data: {} }), {}), null);
    assert.equal(promptReply(null, {}), null);
  });

  it('summarises a prompt for the channel, including the question text', () => {
    assert.match(promptSummary(prompt('question_requested', { question: 'Which branch?' })), /Which branch\?/);
    assert.match(promptSummary(prompt('directory_requested', { path: '/etc' })), /\/etc/);
    assert.equal(promptSummary(interpretEvent({ type: 'turn_done', data: {} })), '');
  });
});

describe('openworker-runtime — path containment', () => {
  it('does not read a sibling with a shared prefix as being inside', () => {
    const root = path.resolve('/repo');
    assert.equal(isInside(root, path.resolve('/repo/src')), true);
    assert.equal(isInside(root, root), true);
    assert.equal(isInside(root, path.resolve('/repo-backup/src')), false);
    assert.equal(isInside(root, path.resolve('/repo/../etc')), false);
    assert.equal(isInside('', '/repo'), false);
    assert.equal(isInside('/repo', ''), false);
  });
});

describe('openworker-runtime — spawning the server', () => {
  it('spawns a real executable directly on every platform', () => {
    assert.deepEqual(
      serverSpawnCommand('/usr/local/bin/openworker-server', ['--port', '1234'], 'darwin'),
      { command: '/usr/local/bin/openworker-server', args: ['--port', '1234'] },
    );
    assert.deepEqual(
      serverSpawnCommand('C:\\tools\\openworker-server.exe', ['--port', '1234'], 'win32'),
      { command: 'C:\\tools\\openworker-server.exe', args: ['--port', '1234'] },
    );
  });

  it('routes a Windows .cmd/.bat wrapper through cmd.exe', () => {
    // Node refuses to spawn one without a shell (EINVAL since the
    // CVE-2024-27980 hardening) and throws synchronously, which surfaced as a
    // server that "stopped (exit code undefined)" with no output.
    const cmd = serverSpawnCommand('C:\\tools\\openworker-server.cmd', ['--host', '127.0.0.1'], 'win32');
    assert.equal(cmd.command, 'cmd.exe');
    // A real argv, NOT a joined command line: shell:true would break on the
    // first state directory containing a space.
    assert.deepEqual(cmd.args, ['/c', 'C:\\tools\\openworker-server.cmd', '--host', '127.0.0.1']);
    assert.equal(serverSpawnCommand('x.BAT', [], 'win32').command, 'cmd.exe');
  });

  it('leaves a .cmd alone off Windows, where it is just a filename', () => {
    assert.equal(serverSpawnCommand('/opt/weird.cmd', [], 'linux').command, '/opt/weird.cmd');
  });
});

describe('openworker-runtime — failure classification', () => {
  it('names a broken Python install and how to repair it', () => {
    const v = classifyServerFailure({ code: 1, stderr: "ModuleNotFoundError: No module named 'aisuite'" });
    assert.equal(v.kind, 'broken_install');
    assert.match(v.message, /uv tool install --force/);
  });

  it('separates a busy port from a missing binary from a plain crash', () => {
    assert.equal(classifyServerFailure({ stderr: '[Errno 48] Address already in use' }).kind, 'port_busy');
    assert.equal(classifyServerFailure({ spawnError: 'spawn openworker-server ENOENT' }).kind, 'not_installed');
    const crash = classifyServerFailure({ code: 3, stderr: 'Traceback...' });
    assert.equal(crash.kind, 'crashed');
    assert.match(crash.message, /exit code 3/);
  });

  it('quotes the spawn error rather than an exit code it never had', () => {
    // The synchronous-throw path has no process and therefore no exit code;
    // reporting "exit code undefined" hid the one string that explained it.
    const v = classifyServerFailure({ spawnError: 'spawn EINVAL' });
    assert.equal(v.kind, 'spawn_failed');
    assert.match(v.message, /spawn EINVAL/);
    assert.ok(!/undefined/.test(v.message), v.message);
  });

  it('redacts the captured output it quotes back', () => {
    const v = classifyServerFailure({ code: 1, stderr: 'auth failed for sk-abcdefghijklmnop' });
    assert.ok(!v.message.includes('sk-abcdefghijklmnop'), v.message);
  });

  it('phrases a missing key for the provider actually configured', () => {
    assert.match(missingKeyMessage('anthropic'), /ANTHROPIC_API_KEY/);
    assert.match(missingKeyMessage('ollama'), /ollama serve/);
    assert.match(missingKeyMessage('openai-codex'), /OPENWORKER_STATE_DIR/);
  });
});

describe('openworker-runtime — redaction', () => {
  it('strips keys and bearer tokens', () => {
    assert.match(redactSecrets('key sk-abcdefghijklmnop here'), /\[redacted\]/);
    assert.match(redactSecrets('Authorization: Bearer abcdefghijklmnop'), /\[redacted\]/);
    assert.equal(redactSecrets(null), null);
  });

  it('truncates with an ellipsis', () => {
    assert.equal(truncate('abcdef', 4), 'abc…');
    assert.equal(truncate('ab', 4), 'ab');
    assert.equal(truncate(null, 4), '');
  });
});

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const {
  listCliModels, supportsCliModels, parseCodexModels, parseClaudeModels,
} = require('../src/cli-models');

/** What `codex debug models` prints, cut down to the fields that are read. */
const CODEX_CATALOG = JSON.stringify({
  models: [
    { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6-Sol', visibility: 'list', priority: 5 },
    { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide', priority: 4 },
    { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list', priority: 2 },
    { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide', priority: 43 },
    { slug: 'gpt-5.5', visibility: 'list', priority: 13 },
    { slug: 'gpt-6-astra', display_name: 'Duplicate', visibility: 'list', priority: 99 },
  ],
});

/** The stream-json a Claude Code run prints when sent one `initialize` request. */
function claudeOutput(models) {
  return [
    JSON.stringify({ type: 'system', subtype: 'hook_started' }),
    'not json at all',
    JSON.stringify({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'list-models', response: { models, commands: [] } },
    }),
  ].join('\n');
}

const CLAUDE_PICKER = [
  { value: 'default', displayName: 'Default (recommended)', description: 'Opus 5 with 1M context · Best for everyday, complex tasks' },
  { value: 'opus[1m]', displayName: 'Opus (1M context)', description: 'Opus 5 with 1M context · Best for everyday, complex tasks' },
  { value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 5 · Efficient for routine tasks' },
  { value: 'haiku', displayName: 'Haiku', description: 'Fastest for quick answers' },
  { value: 'sonnet', displayName: 'Sonnet again', description: 'Duplicate · ignored' },
  { value: 'custom-model' },
];

/** A spawn stand-in: records each call and lets `script` play the child's part. */
function fakeSpawn(script) {
  const calls = [];
  const spawnImpl = (binary, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const call = { binary, args, options, input: null, killed: false };
    child.stdin = options.stdio[0] === 'pipe'
      ? { on() {}, end(text) { call.input = text; } }
      : null;
    child.kill = () => { call.killed = true; setImmediate(() => child.emit('close', null)); };
    calls.push(call);
    setImmediate(() => script(child));
    return child;
  };
  return { calls, spawnImpl };
}

/** Print `stdout` and exit, as a CLI that answered does. */
const answers = (stdout) => (child) => {
  child.stdout.emit('data', Buffer.from(stdout));
  child.emit('close', 0);
};

function connector({ binary = '/usr/local/bin/cli', typeEnv = {} } = {}) {
  return {
    registry: {},
    installer: { which: () => binary },
    getAgentEnv: () => typeEnv,
    resolveAgentEnv: () => ({}),
  };
}

describe('parseCodexModels', () => {
  it('keeps what the CLI picker lists, in its order, and drops internal entries', () => {
    assert.deepEqual(parseCodexModels(CODEX_CATALOG), [
      { id: 'gpt-6-astra', label: 'GPT-6-Astra' },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' },
      { id: 'gpt-5.5', label: 'gpt-5.5' },
    ]);
  });

  it('reads nothing from output that is not the catalog', () => {
    assert.deepEqual(parseCodexModels('error: unrecognized subcommand'), []);
    assert.deepEqual(parseCodexModels('{"models":"none"}'), []);
    // A catalog without the visibility field cannot tell internal models apart.
    assert.deepEqual(parseCodexModels('{"models":[{"slug":"gpt-5.5"}]}'), []);
  });
});

describe('parseClaudeModels', () => {
  it('reads the picker from the initialize reply, as the values --model takes', () => {
    assert.deepEqual(parseClaudeModels(claudeOutput(CLAUDE_PICKER)), [
      { id: 'opus[1m]', label: 'Opus 5 with 1M context' },
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'haiku', label: 'Haiku' },
      { id: 'custom-model', label: 'custom-model' },
    ]);
  });

  it('takes the display name of a newer CLI, which carries the version itself', () => {
    // Claude Code 2.1.289: the alias moved out of displayName, and only the
    // "default" entry still leads its description with a model.
    const picker = [
      { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5 · Best for everyday, complex tasks' },
      { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'For complex work and everyday tasks' },
      { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', description: 'Most efficient for simpler tasks' },
      { value: 'claude-opus-4-8', resolvedModel: 'claude-opus-4-8', displayName: 'Opus 4.8', description: 'Best for everyday, complex tasks' },
    ];
    assert.deepEqual(parseClaudeModels(claudeOutput(picker)), [
      { id: 'opus', label: 'Opus 5.5' },
      { id: 'sonnet', label: 'Sonnet 5.5' },
      { id: 'claude-opus-4-8', label: 'Opus 4.8' },
    ]);
  });

  it('reads nothing when the CLI never replied', () => {
    assert.deepEqual(parseClaudeModels(''), []);
    assert.deepEqual(parseClaudeModels('{"type":"result","is_error":true}'), []);
    assert.deepEqual(
      parseClaudeModels('{"type":"control_response","response":{"subtype":"error","error":"nope"}}'),
      [],
    );
  });
});

describe('listCliModels', () => {
  it('knows which CLIs can be asked', () => {
    assert.equal(supportsCliModels('codex'), true);
    assert.equal(supportsCliModels('claude'), true);
    assert.equal(supportsCliModels('gemini'), false);
    assert.equal(supportsCliModels('constructor'), false);
  });

  it('asks the Codex CLI for its catalog', async () => {
    const { calls, spawnImpl } = fakeSpawn(answers(CODEX_CATALOG));
    const res = await listCliModels(connector({ binary: '/opt/codex' }), 'codex', { spawnImpl });
    assert.equal(calls[0].binary, '/opt/codex');
    assert.deepEqual(calls[0].args, ['debug', 'models']);
    assert.equal(calls[0].options.stdio[0], 'ignore');
    assert.equal(res.ok, true);
    assert.deepEqual(res.models.map((m) => m.id), ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.5']);
  });

  it('sends Claude Code an initialize request and no prompt', async () => {
    const { calls, spawnImpl } = fakeSpawn(answers(claudeOutput(CLAUDE_PICKER)));
    const res = await listCliModels(connector(), 'claude', { spawnImpl });
    assert.deepEqual(calls[0].args, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']);
    assert.deepEqual(JSON.parse(calls[0].input), {
      type: 'control_request', request_id: 'list-models', request: { subtype: 'initialize' },
    });
    assert.equal(res.ok, true);
    assert.equal(res.models[0].id, 'opus[1m]');
  });

  it('asks on the sign-in, without the key saved for the type', async () => {
    const { calls, spawnImpl } = fakeSpawn(answers(CODEX_CATALOG));
    await listCliModels(
      connector({ typeEnv: { LLM_API_KEY: 'sk-type-level-key', CODEX_API_KEY: 'sk-native-key' } }),
      'codex',
      { spawnImpl, agentEnv: { OPENAGENTS_AUTH_MODE: 'cli_login' } },
    );
    assert.equal(calls[0].options.env.LLM_API_KEY, undefined);
    assert.equal(calls[0].options.env.CODEX_API_KEY, undefined);
  });

  it('says so when the CLI is missing or cannot be asked, without running anything', async () => {
    const { calls, spawnImpl } = fakeSpawn(answers(CODEX_CATALOG));
    assert.deepEqual(
      await listCliModels(connector({ binary: null }), 'codex', { spawnImpl }),
      { type: 'codex', ok: false, models: [], error: 'Not installed' },
    );
    const other = await listCliModels(connector(), 'gemini', { spawnImpl });
    assert.equal(other.ok, false);
    assert.equal(calls.length, 0);
  });

  it('reports a CLI that listed nothing', async () => {
    const { spawnImpl } = fakeSpawn(answers('error: unrecognized subcommand'));
    const res = await listCliModels(connector(), 'codex', { spawnImpl });
    assert.deepEqual(res, { type: 'codex', ok: false, models: [], error: 'The CLI listed no models.' });
  });

  it('reports a CLI that could not be started', async () => {
    const res = await listCliModels(connector(), 'codex', {
      spawnImpl: () => { throw new Error('spawn EINVAL'); },
    });
    assert.deepEqual(res, { type: 'codex', ok: false, models: [], error: 'spawn EINVAL' });
  });

  it('stops a CLI that hangs', async () => {
    const { calls, spawnImpl } = fakeSpawn(() => {});
    const res = await listCliModels(connector(), 'codex', { spawnImpl, timeoutMs: 20 });
    assert.equal(calls[0].killed, true);
    assert.deepEqual(res, { type: 'codex', ok: false, models: [], error: 'the CLI did not answer in time' });
  });

  it('keeps the answer of a CLI that replied and then hung', async () => {
    const { calls, spawnImpl } = fakeSpawn((child) => {
      child.stdout.emit('data', Buffer.from(claudeOutput(CLAUDE_PICKER)));
    });
    const res = await listCliModels(connector(), 'claude', { spawnImpl, timeoutMs: 20 });
    assert.equal(calls[0].killed, true);
    assert.equal(res.ok, true);
    assert.equal(res.models.length, 4);
  });
});

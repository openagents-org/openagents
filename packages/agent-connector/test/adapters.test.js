'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const events = require('events');

const { Registry } = require('../src/registry');

const childProcess = require('child_process');
const originalSpawn = childProcess.spawn;

function loadAdapter(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function makeFakeProcess(stdoutChunks = [], { stderr = '', code = 0 } = {}) {
  const proc = new events.EventEmitter();
  proc.stdout = new events.EventEmitter();
  proc.stderr = new events.EventEmitter();

  process.nextTick(() => {
    for (const chunk of stdoutChunks) {
      proc.stdout.emit('data', Buffer.from(chunk));
    }
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    proc.emit('exit', code);
    proc.emit('close', code);
  });

  return proc;
}

afterEach(() => {
  childProcess.spawn = originalSpawn;
});

describe('adapter registry alignment', () => {
  it('cursor registry entry matches the CLI-based runtime', () => {
    const reg = new Registry(path.join(os.tmpdir(), 'ac-registry-adapters'));
    const entry = reg.getEntry('cursor');

    assert.equal(entry.install.binary, 'cursor-agent');
    assert.ok(entry.env_config.find((field) => field.name === 'CURSOR_API_KEY'));
    assert.equal(entry.check_ready.saved_env_key, 'CURSOR_API_KEY');
  });
});

describe('CursorAdapter', () => {
  it('builds a cursor-agent command with model and session resume', () => {
    const CursorAdapter = loadAdapter('../src/adapters/cursor');
    const adapter = new CursorAdapter({
      workspaceId: 'ws-1',
      channelName: 'general',
      token: 'tok',
      agentName: 'cursor-bot',
      endpoint: 'https://workspace-endpoint.openagents.org',
      agentEnv: {
        CURSOR_API_KEY: 'cursor-key',
        CURSOR_MODEL: 'gpt-5',
      },
      workingDir: '/tmp/project',
    });

    adapter._cursorBinary = '/usr/local/bin/cursor-agent';
    adapter._channelSessions.general = 'session-123';

    const cmd = adapter._buildCursorCmd('hello world', 'general');
    assert.equal(cmd[0], '/usr/local/bin/cursor-agent');
    assert.ok(cmd.includes('--trust'));
    assert.ok(cmd.includes('--force'));
    assert.ok(cmd.includes('--resume'));
    assert.ok(cmd.includes('session-123'));
    assert.ok(cmd.includes('--model'));
    assert.ok(cmd.includes('gpt-5'));
    assert.ok(cmd.includes('--workspace'));
    assert.ok(cmd.includes('/tmp/project'));
  });

  it('runs cursor with the requested working directory and runtime env', async () => {
    let captured = null;
    childProcess.spawn = (bin, args, opts) => {
      captured = { bin, args, opts };
      return makeFakeProcess([
        JSON.stringify({ type: 'result', result: { text: 'Cursor says hi' } }) + '\n',
      ]);
    };

    const CursorAdapter = loadAdapter('../src/adapters/cursor');
    const adapter = new CursorAdapter({
      workspaceId: 'ws-2',
      channelName: 'general',
      token: 'tok',
      agentName: 'cursor-bot',
      endpoint: 'https://workspace-endpoint.openagents.org',
      agentEnv: {
        CURSOR_API_KEY: 'cursor-key',
        CURSOR_MODEL: 'gpt-5',
      },
      workingDir: '/tmp/openagents-project',
    });
    adapter._cursorBinary = '/usr/local/bin/cursor-agent';

    const response = await adapter._runCursor('hello', 'general');
    assert.equal(response, 'Cursor says hi');
    assert.equal(captured.opts.cwd, '/tmp/openagents-project');
    assert.equal(captured.opts.env.CURSOR_API_KEY, 'cursor-key');

    const mcpPath = path.join(
      os.homedir(),
      '.openagents',
      'runtime',
      'cursor',
      `${adapter.workspaceId}_${adapter.agentName}`,
      'home',
      '.cursor',
      'mcp.json'
    );
    assert.ok(fs.existsSync(mcpPath), 'cursor runtime should write mcp.json');
  });
});

describe('OpenCodeAdapter', () => {
  it('builds runtime env from provider credentials', () => {
    const OpenCodeAdapter = loadAdapter('../src/adapters/opencode');
    const adapter = new OpenCodeAdapter({
      workspaceId: 'ws-3',
      channelName: 'general',
      token: 'tok',
      agentName: 'opencode-bot',
      endpoint: 'https://workspace-endpoint.openagents.org',
      agentEnv: {
        OPENAI_API_KEY: 'openai-key',
        LLM_MODEL: 'gpt-5.4',
      },
      workingDir: '/tmp/project-opencode',
    });

    const { env, modelRef } = adapter._runtimeEnv('general');
    assert.equal(modelRef, 'openai/gpt-5.4');
    assert.ok(env.OPENCODE_CONFIG_CONTENT.includes('"openagents-workspace"'));
    assert.ok(env.XDG_CONFIG_HOME.includes(path.join('.openagents', 'runtime', 'opencode')));
  });

  it('runs opencode in the configured working directory', async () => {
    let captured = null;
    childProcess.spawn = (bin, args, opts) => {
      captured = { bin, args, opts };
      return makeFakeProcess([
        JSON.stringify({
          type: 'message.updated',
          properties: { info: { role: 'assistant', id: 'msg-1' } },
        }) + '\n',
        JSON.stringify({
          type: 'message.part.updated',
          properties: {
            delta: 'OpenCode says hi',
            part: { type: 'text', id: 'part-1', messageID: 'msg-1' },
          },
        }) + '\n',
      ]);
    };

    const OpenCodeAdapter = loadAdapter('../src/adapters/opencode');
    const adapter = new OpenCodeAdapter({
      workspaceId: 'ws-4',
      channelName: 'general',
      token: 'tok',
      agentName: 'opencode-bot',
      endpoint: 'https://workspace-endpoint.openagents.org',
      agentEnv: {
        OPENAI_API_KEY: 'openai-key',
        LLM_MODEL: 'gpt-5.4',
      },
      workingDir: '/tmp/openagents-repo',
    });
    adapter._opencodeBinary = '/usr/local/bin/opencode';

    const response = await adapter._runOpencode('hello', 'general');
    assert.equal(response, 'OpenCode says hi');
    assert.equal(captured.opts.cwd, '/tmp/openagents-repo');
    assert.ok(captured.args.includes('--model'));
    assert.ok(captured.opts.env.OPENCODE_CONFIG_CONTENT.includes('"openagents-workspace"'));
  });
});

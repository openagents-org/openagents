'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');

const BaseAdapter = require('../src/adapters/base');
const LlmDirectAdapter = require('../src/adapters/llm-direct');
const CodexAdapter = require('../src/adapters/codex');
const CursorAdapter = require('../src/adapters/cursor');
const OpenCodeAdapter = require('../src/adapters/opencode');
const HermesAdapter = require('../src/adapters/hermes');
const KimiAdapter = require('../src/adapters/kimi');
const CopilotAdapter = require('../src/adapters/copilot');
const GooseAdapter = require('../src/adapters/goose');
const AiderAdapter = require('../src/adapters/aider');
const ClineAdapter = require('../src/adapters/cline');
const GeminiAdapter = require('../src/adapters/gemini');
const AntigravityAdapter = require('../src/adapters/antigravity');
const MiniAdapter = require('../src/adapters/mini');
const PiAdapter = require('../src/adapters/pi');
const DeepSeekAdapter = require('../src/adapters/deepseek');
const { WorkspaceClient } = require('../src/workspace-client');

function baseOpts(overrides = {}) {
  return {
    workspaceId: 'ws-1',
    channelName: 'general',
    token: 'tok',
    agentName: 'bot',
    endpoint: 'https://example.invalid',
    agentType: 'cursor',
    agentEnv: {},
    ...overrides,
  };
}

function bareAdapter(Adapter, {
  agentEnv = {}, workspaceModel = 'workspace-model', workspaceModelProvider = null,
} = {}) {
  const adapter = Object.create(Adapter.prototype);
  Object.assign(adapter, baseOpts({ agentEnv }), {
    workspaceModel,
    workspaceModelProvider,
    workingDir: null,
    _mode: 'execute',
    _log: () => {},
  });
  return adapter;
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index < 0 ? null : args[index + 1];
}

class SwallowingAdapter extends BaseAdapter {
  async _onControlAction() {
    this.adapterControlCalled = true;
  }
}

describe('workspace model runtime state', () => {
  it('applies model.set before an adapter-specific control handler can swallow it', async () => {
    const adapter = new SwallowingAdapter(baseOpts());
    adapter.client.pollControl = async () => [{
      id: 'event-1',
      payload: {
        action: 'model.set',
        model: 'deepseek/deepseek-v4-pro',
        provider: 'nous',
      },
    }];

    await adapter._pollControl();

    assert.equal(adapter.workspaceModel, 'deepseek/deepseek-v4-pro');
    assert.equal(adapter.workspaceModelProvider, 'nous');
    assert.equal(adapter.adapterControlCalled, undefined);
  });

  it('clearing the workspace model restores the configured fallback', async () => {
    const adapter = new SwallowingAdapter(baseOpts());
    adapter.workspaceModel = 'deepseek/deepseek-v4-pro';
    adapter.workspaceModelProvider = 'nous';
    adapter.client.pollControl = async () => [{
      id: 'event-2',
      payload: { action: 'model.set', model: null, provider: null },
    }];

    await adapter._pollControl();

    assert.equal(adapter.effectiveModel(' configured-model '), 'configured-model');
    assert.equal(adapter.workspaceModelProvider, null);
  });

  it('hydrates model and provider from discovery before processing messages', async () => {
    const adapter = new BaseAdapter(baseOpts());
    const startupOrder = [];
    adapter.client.getAgents = async () => {
      startupOrder.push('discovery');
      return [{
        agentName: 'bot',
        model: 'deepseek/deepseek-v4-pro',
        modelProvider: 'nous',
      }];
    };
    adapter._joinWorkspace = async () => true;
    adapter._skipExistingControlEvents = async () => { startupOrder.push('control-cursor'); };
    adapter._controlPollerLoop = async () => {};
    adapter._heartbeat = async () => {};
    adapter._skipExistingEvents = async () => {};
    adapter._pollLoop = async () => {};
    adapter.client.disconnect = async () => {};

    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (callback, delay, ...args) => {
      const timer = originalSetTimeout(callback, delay, ...args);
      if (delay === 10000) timer.unref();
      return timer;
    };
    try {
      await adapter.run();
    } finally {
      global.setTimeout = originalSetTimeout;
    }

    assert.equal(adapter.workspaceModel, 'deepseek/deepseek-v4-pro');
    assert.equal(adapter.workspaceModelProvider, 'nous');
    assert.deepEqual(startupOrder, ['control-cursor', 'discovery']);
  });

  it('maps discovery model_provider to the JavaScript agent shape', async () => {
    const client = new WorkspaceClient('https://example.invalid');
    client._get = async () => ({ data: { agents: [{
      address: 'openagents:bot',
      model: 'deepseek/deepseek-v4-pro',
      model_provider: 'nous',
    }] } });

    const [agent] = await client.getAgents('ws-1', 'tok');

    assert.equal(agent.modelProvider, 'nous');
  });
});

describe('direct API runtime model', () => {
  it('uses the workspace model in the request and the configured model after clearing', async () => {
    const adapter = new LlmDirectAdapter(baseOpts({
      agentEnv: {
        OPENAI_API_KEY: 'key',
        OPENAI_BASE_URL: 'http://example.invalid/v1',
        CURSOR_MODEL: 'configured-model',
      },
      adapterLabel: 'Cursor',
      modelEnvVar: 'CURSOR_MODEL',
      suppressConfigLog: true,
    }));
    const payloads = [];
    const originalRequest = http.request;
    http.request = (_url, _options, onResponse) => {
      const request = new EventEmitter();
      request.write = (body) => payloads.push(JSON.parse(body));
      request.destroy = () => {};
      request.end = () => {
        const response = new EventEmitter();
        response.statusCode = 200;
        onResponse(response);
        queueMicrotask(() => response.emit('end'));
      };
      return request;
    };

    try {
      adapter.workspaceModel = 'workspace-model';
      await adapter._callCompletionApi('first', 'general');
      adapter.workspaceModel = null;
      await adapter._callCompletionApi('second', 'general');
    } finally {
      http.request = originalRequest;
    }

    assert.deepEqual(payloads.map((payload) => payload.model), [
      'workspace-model',
      'configured-model',
    ]);
  });
});

describe('catalog-backed CLI runtime models', () => {
  it('passes the Workspace model to Codex CLI instead of the constructor model', async () => {
    const adapter = bareAdapter(CodexAdapter);
    Object.assign(adapter, {
      _codexBin: 'codex',
      _directModel: 'configured-model',
      _directApiKey: '',
      _directBaseUrl: '',
      _channelThreads: {},
      _channelProcesses: {},
      _buildSystemContext: () => 'context',
      sendResponse: async () => {},
    });
    let command;
    adapter._spawnCodex = async (cmd) => {
      command = cmd;
      return { responseText: 'done', exitCode: 0 };
    };

    await adapter._handleViaSubprocess('do it', 'general');

    assert.equal(argValue(command, '-m'), 'workspace-model');
  });

  it('passes the Workspace model to the Codex direct API fallback', async () => {
    const adapter = bareAdapter(CodexAdapter);
    Object.assign(adapter, {
      _directModel: 'configured-model',
      _directApiKey: 'key',
      _directBaseUrl: 'http://example.invalid/v1',
      _conversationHistory: [],
      _buildSystemContext: () => 'context',
    });
    let payload;
    const originalRequest = http.request;
    http.request = (_url, _options, onResponse) => {
      const request = new EventEmitter();
      request.write = (body) => { payload = JSON.parse(body); };
      request.end = () => {
        const response = new EventEmitter();
        response.statusCode = 200;
        onResponse(response);
        queueMicrotask(() => response.emit('end'));
      };
      return request;
    };

    try {
      await adapter._callCompletionApi('task', 'general');
    } finally {
      http.request = originalRequest;
    }

    assert.equal(payload.model, 'workspace-model');
  });

  it('passes the Workspace model through one-shot command builders', () => {
    const cursor = bareAdapter(CursorAdapter, { agentEnv: { CURSOR_MODEL: 'configured-model' } });
    cursor.agentName = 'bot';
    cursor._findCursorBinary = () => 'cursor';
    cursor._channelSessions = {};
    assert.equal(argValue(cursor._buildCursorCmd('task', 'general'), '--model'), 'workspace-model');

    const hermes = bareAdapter(HermesAdapter, {
      agentEnv: { LLM_MODEL: 'configured-model' },
      workspaceModel: 'deepseek/deepseek-v4-pro',
      workspaceModelProvider: 'nous',
    });
    Object.assign(hermes, {
      _hermesBin: 'hermes', hermesProfile: 'default', hermesSource: 'tool', maxTurns: 60, yolo: false,
    });
    const hermesArgs = hermes._buildHermesCmd('task');
    assert.equal(argValue(hermesArgs, '--provider'), 'nous');
    assert.equal(argValue(hermesArgs, '--model'), 'deepseek/deepseek-v4-pro');

    hermes.workspaceModelProvider = null;
    const legacyHermesArgs = hermes._buildHermesCmd('task');
    assert.equal(argValue(legacyHermesArgs, '--provider'), 'nous');

    hermes.workspaceModel = null;
    const defaultHermesArgs = hermes._buildHermesCmd('task');
    assert.equal(defaultHermesArgs.includes('--provider'), false);
    assert.equal(defaultHermesArgs.includes('--model'), false);

    const copilot = bareAdapter(CopilotAdapter);
    Object.assign(copilot, {
      _model: 'configured-model', _channelSessions: { general: 'session-1' },
      agentName: 'bot',
    });
    assert.equal(argValue(copilot._buildArgs('task', 'general'), '--model'), 'workspace-model');

    for (const [Adapter, setup, builder, flag] of [
      [GeminiAdapter, {
        _ensureGeminiAuth: () => {}, _findGeminiBinary: () => 'gemini',
        pinnedPromptOpts: () => ({}), _channelSessions: {}, agentType: 'gemini',
      }, (a) => a._buildGeminiCmd('task', 'general').cmd, '-m'],
      [AntigravityAdapter, {
        _ensureAgyAuth: () => {}, _findAgyBinary: () => 'agy',
        pinnedPromptOpts: () => ({}), _channelConversations: {}, agentType: 'antigravity',
      }, (a) => a._buildAgyCmd('task', 'general').cmd, '--model'],
    ]) {
      const adapter = bareAdapter(Adapter, { agentEnv: {} });
      Object.assign(adapter, setup);
      assert.equal(argValue(builder(adapter), flag), 'workspace-model');
    }
  });

  it('uses the Workspace model at config and environment execution boundaries', () => {
    const opencode = bareAdapter(OpenCodeAdapter, {
      agentEnv: { OPENCODE_MODEL: 'configured-model' },
      workspaceModel: 'openai/workspace-model',
    });
    opencode._customBaseUrl = () => '';
    assert.equal(opencode._resolveModel(), 'openai/workspace-model');

    const goose = bareAdapter(GooseAdapter, { agentEnv: { GOOSE_MODEL: 'configured-model' } });
    assert.equal(goose._buildEnv().GOOSE_MODEL, 'workspace-model');

    const aider = bareAdapter(AiderAdapter, {
      agentEnv: { AIDER_PROVIDER: 'openai', AIDER_MODEL: 'configured-model' },
      workspaceModel: 'gpt-workspace',
    });
    Object.assign(aider, {
      _aiderBin: 'aider', _chatHistoryFile: () => 'chat', _inputHistoryFile: () => 'input',
    });
    assert.equal(argValue(aider._buildAiderCmd('general', 'message', false), '--model'), 'gpt-workspace');

    const cline = bareAdapter(ClineAdapter, { agentEnv: { CLINE_MODEL: 'configured-model' } });
    assert.equal(cline._model(), 'workspace-model');

    const mini = bareAdapter(MiniAdapter, { agentEnv: { MSWEA_MODEL_NAME: 'configured-model' } });
    assert.equal(mini._model(), 'workspace-model');

    const pi = bareAdapter(PiAdapter, { agentEnv: { PI_MODEL: 'configured-model' } });
    assert.equal(pi._config().model, 'workspace-model');

    const deepseek = bareAdapter(DeepSeekAdapter, { agentEnv: { DEEPSEEK_MODEL: 'configured-model' } });
    assert.equal(deepseek._model(), 'workspace-model');
  });

  it('passes the Workspace model to Kimi CLI as a per-run override', () => {
    const kimi = bareAdapter(KimiAdapter, { agentEnv: { KIMI_MODEL: 'configured-model' } });
    const args = kimi._buildKimiArgs('task', null);
    assert.equal(argValue(args, '--model'), 'workspace-model');
  });

  it('restores the Kimi CLI native model after clearing an unconfigured override', () => {
    const kimi = bareAdapter(KimiAdapter, { agentEnv: {}, workspaceModel: null });
    kimi._model = 'kimi-k2.6';

    assert.equal(kimi._buildKimiArgs('task', null).includes('--model'), false);

    kimi.agentEnv.KIMI_MODEL = 'configured-model';
    assert.equal(argValue(kimi._buildKimiArgs('task', null), '--model'), 'configured-model');
  });

  it('respawns a persistent Pi process when its effective model changes', async () => {
    const adapter = bareAdapter(PiAdapter, { agentEnv: { PI_MODEL: 'configured-model' } });
    const existing = {
      alive: true,
      spawnMode: 'execute',
      spawnModel: 'configured-model',
      workingDir: '/tmp/project',
    };
    adapter._persistentProcs = { general: existing };
    adapter._piBin = null;
    adapter._findPiBinary = () => null;
    adapter._reportStatus = () => {};
    let killed = false;
    adapter._killPersistentProc = async () => { killed = true; existing.alive = false; };

    await assert.rejects(
      adapter._ensureProc('general', '/tmp/project', 'system prompt'),
      /Pi CLI not found/,
    );
    assert.equal(killed, true);
  });
});

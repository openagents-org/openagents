'use strict';

/**
 * "What model are you?" — the one fact about itself an agent cannot look up.
 *
 * A CLI-driven agent answers that question from what its weights remember
 * about their own training. A user who had configured deepseek was told, in
 * the workspace chat, that the agent was Claude by Anthropic — the config was
 * correct end to end, the model simply guessed. The launcher knows the answer
 * exactly (it is the id it hands the CLI), so the workspace prompt now states
 * it, and these cover both halves: resolving the id, and putting it in front
 * of the agent.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const BaseAdapter = require('../src/adapters/base');
const OpenWorkerAdapter = require('../src/adapters/openworker');
const {
  buildWorkspaceIdentity,
  buildClaudeSystemPrompt,
} = require('../src/adapters/workspace-prompt');

function adapter(Cls, { agentType, agentEnv = {}, workspaceModel = null } = {}) {
  const a = new Cls({
    workspaceId: 'ws-1',
    channelName: 'general',
    token: 'tok',
    agentName: 'bot',
    endpoint: 'https://example.invalid',
    agentType,
    agentEnv,
  });
  a.workspaceModel = workspaceModel;
  return a;
}

describe('modelLabel', () => {
  it('prefers the model the workspace picked — that is what the CLI is spawned with', () => {
    const a = adapter(BaseAdapter, {
      agentType: 'codex',
      agentEnv: { CODEX_MODEL: 'gpt-5.6-sol' },
      workspaceModel: 'gpt-5.6-pro',
    });
    assert.equal(a.modelLabel(), 'gpt-5.6-pro');
  });

  it("falls back to the agent type's own model variable", () => {
    const a = adapter(BaseAdapter, {
      agentType: 'codebuddy',
      agentEnv: { CODEBUDDY_MODEL: 'default-model' },
    });
    assert.equal(a.modelLabel(), 'default-model');
  });

  it('knows the variables that are not named after their agent', () => {
    const claude = adapter(BaseAdapter, {
      agentType: 'claude',
      agentEnv: { ANTHROPIC_MODEL: 'claude-opus-5' },
    });
    assert.equal(claude.modelLabel(), 'claude-opus-5');
  });

  it('accepts the generic LLM_MODEL the direct runners and model.set write', () => {
    const a = adapter(BaseAdapter, {
      agentType: 'openclaw',
      agentEnv: { LLM_MODEL: 'gpt-4o' },
    });
    assert.equal(a.modelLabel(), 'gpt-4o');
  });

  it('says nothing when nothing is configured, rather than guessing', () => {
    const a = adapter(BaseAdapter, { agentType: 'amp', agentEnv: {} });
    assert.equal(a.modelLabel(), null);
  });

  it('reports OpenWorker with the provider prefix it is actually sent with', () => {
    const a = adapter(OpenWorkerAdapter, {
      agentType: 'openworker',
      agentEnv: {
        OPENWORKER_PROVIDER: 'deepseek',
        OPENWORKER_MODEL: 'deepseek-4-flash',
      },
    });
    assert.equal(a.modelLabel(), 'deepseek:deepseek-4-flash');
  });
});

describe('the workspace prompt states the model', () => {
  it('names it in the workspace context block', () => {
    const identity = buildWorkspaceIdentity(
      'bot', 'ws-1', 'general', 'execute', 'skills', 'deepseek:deepseek-4-flash',
    );
    assert.match(identity, /- Model: deepseek:deepseek-4-flash/);
  });

  it('leaves the block alone when the model is unknown', () => {
    for (const unknown of [null, undefined, '', '   ']) {
      const identity = buildWorkspaceIdentity('bot', 'ws-1', 'general', 'execute', 'skills', unknown);
      assert.ok(!/- Model:/.test(identity), `${JSON.stringify(unknown)} produced a model line`);
      assert.match(identity, /- Mode: execute\n\n/);
    }
  });

  it('reaches the agents that get a full system prompt', () => {
    const prompt = buildClaudeSystemPrompt({
      agentName: 'bot',
      workspaceId: 'ws-1',
      channelName: 'general',
      model: 'claude-opus-5',
    });
    assert.match(prompt, /- Model: claude-opus-5/);
  });
});

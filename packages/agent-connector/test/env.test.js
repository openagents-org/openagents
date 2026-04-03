'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EnvManager } = require('../src/env');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-env-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('EnvManager', () => {
  it('load returns empty object for missing file', () => {
    const env = new EnvManager(tmpDir);
    assert.deepEqual(env.load('nonexistent'), {});
  });

  it('save and load round-trip', () => {
    const env = new EnvManager(tmpDir);
    env.save('openclaw', { LLM_API_KEY: 'sk-test', LLM_BASE_URL: 'https://api.openai.com/v1' });
    const loaded = env.load('openclaw');
    assert.equal(loaded.LLM_API_KEY, 'sk-test');
    assert.equal(loaded.LLM_BASE_URL, 'https://api.openai.com/v1');
  });

  it('save merges with existing values', () => {
    const env = new EnvManager(tmpDir);
    env.save('test', { A: '1', B: '2' });
    env.save('test', { B: '3', C: '4' });
    const loaded = env.load('test');
    assert.equal(loaded.A, '1');
    assert.equal(loaded.B, '3');
    assert.equal(loaded.C, '4');
  });

  it('delete removes env file', () => {
    const env = new EnvManager(tmpDir);
    env.save('todel', { X: '1' });
    env.delete('todel');
    assert.deepEqual(env.load('todel'), {});
  });

  it('resolve applies rules', () => {
    const env = new EnvManager(tmpDir);
    const saved = { LLM_API_KEY: 'sk-abc', LLM_BASE_URL: 'https://api.openai.com/v1', LLM_MODEL: 'gpt-4o' };
    const mockRegistry = {
      getResolveRules: () => [
        { from: 'LLM_API_KEY', to: 'OPENAI_API_KEY', unless_base_url_contains: 'anthropic' },
        { from: 'LLM_API_KEY', to: 'ANTHROPIC_API_KEY', if_base_url_contains: 'anthropic' },
        { from: 'LLM_BASE_URL', to: 'OPENAI_BASE_URL' },
        { from: 'LLM_MODEL', to: 'OPENCLAW_MODEL' },
      ],
    };
    const resolved = env.resolve('openclaw', saved, mockRegistry);
    assert.equal(resolved.OPENAI_API_KEY, 'sk-abc');
    assert.equal(resolved.ANTHROPIC_API_KEY, undefined);
    assert.equal(resolved.OPENAI_BASE_URL, 'https://api.openai.com/v1');
    assert.equal(resolved.OPENCLAW_MODEL, 'gpt-4o');
  });

  it('resolve applies anthropic conditional rule', () => {
    const env = new EnvManager(tmpDir);
    const saved = { LLM_API_KEY: 'sk-ant', LLM_BASE_URL: 'https://api.anthropic.com/v1' };
    const mockRegistry = {
      getResolveRules: () => [
        { from: 'LLM_API_KEY', to: 'OPENAI_API_KEY', unless_base_url_contains: 'anthropic' },
        { from: 'LLM_API_KEY', to: 'ANTHROPIC_API_KEY', if_base_url_contains: 'anthropic' },
      ],
    };
    const resolved = env.resolve('openclaw', saved, mockRegistry);
    assert.equal(resolved.OPENAI_API_KEY, undefined);
    assert.equal(resolved.ANTHROPIC_API_KEY, 'sk-ant');
  });

  it('getEffective combines saved and resolved', () => {
    const env = new EnvManager(tmpDir);
    env.save('openclaw', { LLM_API_KEY: 'sk-test', LLM_BASE_URL: 'https://api.openai.com/v1' });
    const mockRegistry = {
      getResolveRules: () => [
        { from: 'LLM_API_KEY', to: 'OPENAI_API_KEY' },
      ],
    };
    const effective = env.getEffective('openclaw', mockRegistry);
    assert.equal(effective.LLM_API_KEY, 'sk-test');
    assert.equal(effective.OPENAI_API_KEY, 'sk-test');
  });
});

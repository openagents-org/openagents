'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Registry } = require('../src/registry');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-reg-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Registry', () => {
  it('getCatalogSync returns bundled registry', () => {
    const reg = new Registry(tmpDir);
    const catalog = reg.getCatalogSync();
    assert.ok(Array.isArray(catalog));
    assert.ok(catalog.length > 0, 'bundled registry should have entries');
    assert.ok(catalog.find((e) => e.name === 'openclaw'), 'should have openclaw');
    assert.ok(catalog.find((e) => e.name === 'claude'), 'should have claude');
  });

  it('getEntry returns correct entry', () => {
    const reg = new Registry(tmpDir);
    const entry = reg.getEntry('openclaw');
    assert.ok(entry);
    assert.equal(entry.name, 'openclaw');
    assert.equal(entry.label, 'OpenClaw');
    assert.ok(entry.install);
    assert.ok(entry.env_config);
  });

  it('kimi entry has Moonshot defaults and OpenAI-compatible env_config', () => {
    const reg = new Registry(tmpDir);
    const entry = reg.getEntry('kimi');
    assert.ok(entry, 'bundled registry should have kimi');
    assert.equal(entry.label, 'Kimi');
    assert.ok(entry.adapter);
    assert.equal(entry.adapter.class, 'KimiAdapter');

    const fields = entry.env_config || [];
    const baseUrl = fields.find((f) => f.name === 'KIMI_BASE_URL');
    const model = fields.find((f) => f.name === 'KIMI_MODEL');
    const apiKey = fields.find((f) => f.name === 'KIMI_API_KEY');
    assert.ok(apiKey && apiKey.password, 'KIMI_API_KEY must be a password field');
    assert.equal(baseUrl.default, 'https://api.moonshot.ai/v1');
    assert.equal(model.default, 'kimi-k2.6');
  });

  it('codex entry exposes direct and CLI readiness fields', () => {
    const reg = new Registry(tmpDir);
    const entry = reg.getEntry('codex');
    assert.ok(entry);
    assert.ok(entry.env_config.find((f) => f.name === 'OPENAI_BASE_URL'));
    assert.equal(entry.check_ready.login_command, 'codex login');
    assert.equal(entry.check_ready.status_command, 'codex login status');
  });

  it('getEntry returns null for unknown', () => {
    const reg = new Registry(tmpDir);
    assert.equal(reg.getEntry('nonexistent'), null);
  });

  it('getEnvFields returns env_config array', () => {
    const reg = new Registry(tmpDir);
    const fields = reg.getEnvFields('openclaw');
    assert.ok(Array.isArray(fields));
    assert.ok(fields.length > 0);
    assert.ok(fields.find((f) => f.name === 'LLM_API_KEY'));
  });

  it('getEnvFields returns empty for agent without env_config', () => {
    const reg = new Registry(tmpDir);
    const fields = reg.getEnvFields('aider');
    assert.ok(Array.isArray(fields));
    assert.equal(fields.length, 0);
  });

  it('getResolveRules returns rules array', () => {
    const reg = new Registry(tmpDir);
    const rules = reg.getResolveRules('openclaw');
    assert.ok(Array.isArray(rules));
    assert.ok(rules.length > 0);
    assert.ok(rules.find((r) => r.from === 'LLM_API_KEY' && r.to === 'OPENAI_API_KEY'));
  });

  it('uses cache when available', () => {
    const reg = new Registry(tmpDir);
    // Write a fake cache
    const fakeEntry = [{ name: 'fake-agent', label: 'Fake' }];
    fs.writeFileSync(path.join(tmpDir, 'agent_catalog.json'), JSON.stringify(fakeEntry), 'utf-8');

    const reg2 = new Registry(tmpDir);
    const catalog = reg2.getCatalogSync();
    // Cache entry is merged with bundled entries
    assert.ok(catalog.length > 1);
    assert.ok(catalog.find(e => e.name === 'fake-agent'));
  });

  it('bundled install data overrides stale cached install data', () => {
    const staleCursor = [{
      name: 'cursor',
      label: 'Cursor',
      install: {
        binary: 'agent',
        npm: 'npm install -g @cursor/cli',
      },
    }];
    fs.writeFileSync(path.join(tmpDir, 'agent_catalog.json'), JSON.stringify(staleCursor), 'utf-8');

    const reg = new Registry(tmpDir);
    const cursor = reg.getEntry('cursor');

    assert.equal(cursor.install.binary, 'cursor-agent');
    assert.deepEqual(cursor.install.binary_aliases, ['agent']);
    assert.equal(cursor.install.npm, undefined);
    assert.match(cursor.install.windows, /WindowsPowerShell\\v1\.0\\powershell\.exe/);
  });

  it('ignores expired cache', () => {
    const reg = new Registry(tmpDir);
    const fakeEntry = [{ name: 'old-agent' }];
    const cacheFile = path.join(tmpDir, 'agent_catalog.json');
    fs.writeFileSync(cacheFile, JSON.stringify(fakeEntry), 'utf-8');
    // Set mtime to 25 hours ago
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(cacheFile, oldTime, oldTime);

    const reg2 = new Registry(tmpDir);
    const catalog = reg2.getCatalogSync();
    // Should fall through to bundled
    assert.ok(catalog.length > 1, 'should load bundled, not expired cache');
  });
});

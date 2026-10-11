'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Config, parseYaml, serializeYaml } = require('../src/config');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-config-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseYaml', () => {
  it('parses a basic daemon.yaml', () => {
    const text = `version: 2
agents:
- name: my-agent
  type: openclaw
  role: worker
  network: demo
networks:
- id: 123
  slug: demo
  name: Demo Network
`;
    const result = parseYaml(text);
    assert.equal(result.version, 2);
    assert.equal(result.agents.length, 1);
    assert.equal(result.agents[0].name, 'my-agent');
    assert.equal(result.agents[0].type, 'openclaw');
    assert.equal(result.agents[0].network, 'demo');
    assert.equal(result.networks.length, 1);
    assert.equal(result.networks[0].slug, 'demo');
  });

  it('parses empty lists', () => {
    const result = parseYaml('version: 2\nagents: []\nnetworks: []');
    assert.deepEqual(result.agents, []);
    assert.deepEqual(result.networks, []);
  });

  it('handles booleans and nulls', () => {
    const result = parseYaml('version: 2\nagents:\n- name: a\n  builtin: true\n  path: null\nnetworks: []');
    assert.equal(result.agents[0].builtin, true);
    assert.equal(result.agents[0].path, null);
  });

  it('parses inline object values such as per-agent env', () => {
    const result = parseYaml('version: 2\nagents:\n- name: a\n  type: opencode\n  env: {"LLM_MODEL":"model-a","LLM_BASE_URL":"https://openrouter.ai/api/v1"}\nnetworks: []');
    assert.deepEqual(result.agents[0].env, {
      LLM_MODEL: 'model-a',
      LLM_BASE_URL: 'https://openrouter.ai/api/v1',
    });
  });
});

describe('serializeYaml', () => {
  it('round-trips through parse/serialize', () => {
    const config = {
      version: 2,
      agents: [{ name: 'bot', type: 'claude', role: 'worker', env: { LLM_MODEL: 'claude-sonnet' } }],
      networks: [{ id: '1', slug: 'ws1', name: 'Workspace 1' }],
    };
    const yaml = serializeYaml(config);
    const parsed = parseYaml(yaml);
    assert.equal(parsed.agents[0].name, 'bot');
    assert.equal(parsed.agents[0].type, 'claude');
    assert.deepEqual(parsed.agents[0].env, { LLM_MODEL: 'claude-sonnet' });
    assert.equal(parsed.networks[0].slug, 'ws1');
  });

  it('serializes empty agents/networks', () => {
    const yaml = serializeYaml({ version: 2, agents: [], networks: [] });
    assert.ok(yaml.includes('agents: []'));
    assert.ok(yaml.includes('networks: []'));
  });
});

describe('Config', () => {
  it('loads default when no file exists', () => {
    const cfg = new Config(tmpDir);
    const data = cfg.load();
    assert.equal(data.version, 2);
    assert.deepEqual(data.agents, []);
    assert.deepEqual(data.networks, []);
  });

  it('addAgent / getAgent / removeAgent', () => {
    const cfg = new Config(tmpDir);
    cfg.addAgent({ name: 'a1', type: 'openclaw', role: 'worker' });
    assert.equal(cfg.getAgents().length, 1);
    assert.equal(cfg.getAgent('a1').type, 'openclaw');

    assert.throws(() => cfg.addAgent({ name: 'a1', type: 'claude' }), /already exists/);

    cfg.removeAgent('a1');
    assert.equal(cfg.getAgents().length, 0);
  });

  it('updateAgent', () => {
    const cfg = new Config(tmpDir);
    cfg.addAgent({ name: 'b1', type: 'claude', role: 'worker' });
    cfg.updateAgent('b1', { role: 'orchestrator' });
    assert.equal(cfg.getAgent('b1').role, 'orchestrator');
  });

  it('updateAgentEnv stores per-agent env independently', () => {
    const cfg = new Config(tmpDir);
    cfg.addAgent({ name: 'a1', type: 'opencode', role: 'worker' });
    cfg.addAgent({ name: 'a2', type: 'opencode', role: 'worker' });

    cfg.updateAgentEnv('a1', { LLM_MODEL: 'model-a' });
    cfg.updateAgentEnv('a2', { LLM_MODEL: 'model-b' });

    assert.equal(cfg.getAgent('a1').env.LLM_MODEL, 'model-a');
    assert.equal(cfg.getAgent('a2').env.LLM_MODEL, 'model-b');
  });

  it('addNetwork / removeNetwork disconnects agents', () => {
    const cfg = new Config(tmpDir);
    cfg.addAgent({ name: 'x', type: 'openclaw', role: 'worker' });
    cfg.addNetwork({ id: '10', slug: 'net1', name: 'Net' });
    cfg.setAgentNetwork('x', 'net1');
    assert.equal(cfg.getAgent('x').network, 'net1');

    cfg.removeNetwork('net1');
    assert.equal(cfg.getNetworks().length, 0);
    assert.equal(cfg.getAgent('x').network, undefined);
  });

  it('persists to disk and reloads', () => {
    const cfg1 = new Config(tmpDir);
    cfg1.addAgent({ name: 'persist', type: 'aider', role: 'worker' });

    const cfg2 = new Config(tmpDir);
    assert.equal(cfg2.getAgent('persist').type, 'aider');
  });

  it('clearLogsInRange removes only timestamped lines in the selected window', () => {
    const cfg = new Config(tmpDir);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(cfg.logFile, [
      '2026-04-22T10:00:00.000Z INFO daemon boot',
      '2026-04-22T10:05:00.000Z INFO agent-a started',
      'stack trace line without timestamp',
      '2026-04-22T10:10:00.000Z INFO agent-b started',
      '',
    ].join('\n'), 'utf-8');

    const result = cfg.clearLogsInRange({
      start: '2026-04-22T10:04:00.000Z',
      end: '2026-04-22T10:06:00.000Z',
    });

    assert.equal(result.removed, 2);
    assert.equal(result.remaining, 2);
    assert.equal(fs.readFileSync(cfg.logFile, 'utf-8'), [
      '2026-04-22T10:00:00.000Z INFO daemon boot',
      '2026-04-22T10:10:00.000Z INFO agent-b started',
      '',
    ].join('\n'));
  });

  it('clearLogsInRange rejects an invalid range', () => {
    const cfg = new Config(tmpDir);
    assert.throws(() => cfg.clearLogsInRange({
      start: '2026-04-22T10:06:00.000Z',
      end: '2026-04-22T10:04:00.000Z',
    }), /Start time must be before end time/);
  });

  it('clearLogsInRange removes rich multi-line log blocks using local time headers', () => {
    const cfg = new Config(tmpDir);
    fs.writeFileSync(cfg.logFile, [
      '[15:59:58] INFO     healthy line',
      '[16:00:10] WARNING  Poll failed: Cannot connect to host',
      '                    workspace-endpoint.openagents.org:443 ssl:True',
      "                    [SSLCertVerificationError: boom]",
      '[16:01:10] INFO     recovered',
      '',
    ].join('\n'), 'utf-8');

    const result = cfg.clearLogsInRange({
      start: new Date(2026, 3, 22, 16, 0, 0).toISOString(),
      end: new Date(2026, 3, 22, 16, 0, 59).toISOString(),
    });

    assert.equal(result.removed, 3);
    assert.equal(fs.readFileSync(cfg.logFile, 'utf-8'), [
      '[15:59:58] INFO     healthy line',
      '[16:01:10] INFO     recovered',
      '',
    ].join('\n'));
  });
});

describe('Config.tailLogs', () => {
  const lineOf = (i, agent = 'alpha') => `[10:00:00] ${agent}: line ${i}`;
  const write = (cfg, lines) => fs.writeFileSync(cfg.logFile, lines.map((l) => `${l}\n`).join(''));

  it('returns the last lines and the offset to resume from', () => {
    const cfg = new Config(tmpDir);
    write(cfg, Array.from({ length: 10 }, (_, i) => lineOf(i)));
    const tail = cfg.tailLogs({ lines: 3 });
    assert.deepEqual(tail.lines, [lineOf(7), lineOf(8), lineOf(9)]);
    assert.equal(tail.size, fs.statSync(cfg.logFile).size);
    assert.equal(tail.reset, false);
  });

  it('returns nothing when nothing was appended', () => {
    const cfg = new Config(tmpDir);
    write(cfg, [lineOf(0), lineOf(1)]);
    const first = cfg.tailLogs({ lines: 2000 });
    assert.deepEqual(cfg.tailLogs({ lines: 2000, offset: first.size }), { lines: [], size: first.size, reset: false });
  });

  it('returns only what was appended, leaving a half-written line for later', () => {
    const cfg = new Config(tmpDir);
    write(cfg, [lineOf(0)]);
    const first = cfg.tailLogs({ lines: 2000 });
    fs.appendFileSync(cfg.logFile, `${lineOf(1)}\n[10:00:01] alpha: hal`);
    const next = cfg.tailLogs({ lines: 2000, offset: first.size });
    assert.deepEqual(next.lines, [lineOf(1)]);
    fs.appendFileSync(cfg.logFile, 'f done\n');
    assert.deepEqual(cfg.tailLogs({ lines: 2000, offset: next.size }).lines, ['[10:00:01] alpha: half done']);
  });

  it('starts over when the file shrank', () => {
    const cfg = new Config(tmpDir);
    write(cfg, Array.from({ length: 5 }, (_, i) => lineOf(i)));
    const first = cfg.tailLogs({ lines: 2000 });
    write(cfg, [lineOf(9)]);
    const next = cfg.tailLogs({ lines: 2000, offset: first.size });
    assert.deepEqual(next.lines, [lineOf(9)]);
    assert.equal(next.reset, true);
  });

  it('stitches lines across read chunks without reading the whole file', (t) => {
    const cfg = new Config(tmpDir);
    const lines = Array.from({ length: 30_000 }, (_, i) => `${lineOf(i)} ${'x'.repeat(i % 97)}`);
    write(cfg, lines);
    const readSync = t.mock.method(fs, 'readSync');
    assert.deepEqual(cfg.tailLogs({ lines: 2000 }).lines, lines.slice(-2000));
    const bytesRead = readSync.mock.calls.reduce((n, call) => n + call.arguments[3], 0);
    assert.ok(readSync.mock.callCount() > 0);
    assert.ok(bytesRead < fs.statSync(cfg.logFile).size / 4);
  });

  it('getLogs filters by agent and keeps daemon lines', () => {
    const cfg = new Config(tmpDir);
    write(cfg, [lineOf(0, 'alpha'), lineOf(1, 'beta'), '[10:00:00] Daemon started', lineOf(2, 'beta')]);
    assert.deepEqual(cfg.getLogs('alpha', 50), [lineOf(0, 'alpha'), '[10:00:00] Daemon started']);
    assert.deepEqual(new Config(path.join(tmpDir, 'missing')).getLogs(null, 50), []);
  });
});

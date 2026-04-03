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
});

describe('serializeYaml', () => {
  it('round-trips through parse/serialize', () => {
    const config = {
      version: 2,
      agents: [{ name: 'bot', type: 'claude', role: 'worker' }],
      networks: [{ id: '1', slug: 'ws1', name: 'Workspace 1' }],
    };
    const yaml = serializeYaml(config);
    const parsed = parseYaml(yaml);
    assert.equal(parsed.agents[0].name, 'bot');
    assert.equal(parsed.agents[0].type, 'claude');
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
});

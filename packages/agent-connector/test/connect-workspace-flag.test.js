'use strict';

// `agn connect <agent> --workspace <slug>` — bind to an already-known
// workspace (registered network or device pairing) with no token and no
// server round-trip. The pairing-first path; the token form stays for
// manual connection.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CLI = path.join(__dirname, '..', 'bin', 'agent-connector.js');

let tmpConfig;
let tmpHome;

beforeEach(() => {
  tmpConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'agn-cfg-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agn-home-'));
});

afterEach(() => {
  fs.rmSync(tmpConfig, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// HOME is redirected so the test never sees the developer's real
// ~/.openagents/node.json pairings.
function run(...args) {
  try {
    const stdout = execFileSync(
      process.execPath, [CLI, ...args, '--config', tmpConfig],
      {
        encoding: 'utf-8',
        timeout: 15000,
        env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome },
      },
    );
    return { code: 0, stdout: stdout.trim() };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : 1,
      stdout: (e.stdout || '').toString().trim(),
    };
  }
}

function writeDaemonYaml({ agents = [], networks = [] }) {
  const lines = ['version: 2', 'agents:'];
  for (const a of agents) {
    lines.push(`- name: ${a.name}`, `  type: ${a.type}`, '  role: worker');
  }
  if (agents.length === 0) lines.push('[]');
  lines.push('networks:');
  for (const n of networks) {
    lines.push(`- id: ${n.id}`, `  slug: ${n.slug}`);
    if (n.name) lines.push(`  name: ${n.name}`);
    if (n.token) lines.push(`  token: ${n.token}`);
  }
  if (networks.length === 0) lines[lines.length - 1] = 'networks: []';
  fs.writeFileSync(path.join(tmpConfig, 'daemon.yaml'), lines.join('\n') + '\n');
}

function readDaemonYaml() {
  return fs.readFileSync(path.join(tmpConfig, 'daemon.yaml'), 'utf-8');
}

describe('agn connect --workspace', () => {
  it('binds by slug from a registered network, with no token and no server call', () => {
    writeDaemonYaml({
      agents: [{ name: 'wsbot', type: 'nanoclaw' }],
      networks: [{ id: 'wid-1', slug: 'myws', name: 'My WS', token: 'tok-1' }],
    });
    const r = run('connect', 'wsbot', '--workspace', 'myws');
    assert.equal(r.code, 0, r.stdout);
    assert.ok(r.stdout.includes("connected to workspace"), r.stdout);
    assert.ok(!r.stdout.includes('Resolving workspace token'), 'must not hit token/resolve');
    assert.match(readDaemonYaml(), /network: myws/);
  });

  it('accepts the workspace id as the reference too', () => {
    writeDaemonYaml({
      agents: [{ name: 'wsbot', type: 'nanoclaw' }],
      networks: [{ id: 'wid-1', slug: 'myws', token: 'tok-1' }],
    });
    const r = run('connect', 'wsbot', '--workspace', 'wid-1');
    assert.equal(r.code, 0, r.stdout);
    assert.match(readDaemonYaml(), /network: myws/);
  });

  it('falls back to a device pairing and registers its network', () => {
    writeDaemonYaml({ agents: [{ name: 'wsbot', type: 'nanoclaw' }], networks: [] });
    const oaDir = path.join(tmpHome, '.openagents');
    fs.mkdirSync(oaDir, { recursive: true });
    fs.writeFileSync(path.join(oaDir, 'node.json'), JSON.stringify({
      node_key: 'nk-1',
      pairings: [{
        node_id: 'n-1',
        workspace_id: 'wid-9',
        workspace_slug: 'paired-ws',
        workspace_name: 'Paired WS',
        endpoint: 'https://example.test',
        token: 'pairing-token',
        paired_at: '2026-08-23T00:00:00Z',
      }],
    }));
    const r = run('connect', 'wsbot', '--workspace', 'paired-ws');
    assert.equal(r.code, 0, r.stdout);
    const yaml = readDaemonYaml();
    assert.match(yaml, /network: paired-ws/);
    assert.match(yaml, /token: pairing-token/, 'pairing token must be registered for the daemon');
  });

  it('fails with the known-workspace list when the reference is unknown', () => {
    writeDaemonYaml({
      agents: [{ name: 'wsbot', type: 'nanoclaw' }],
      networks: [{ id: 'wid-1', slug: 'myws', token: 'tok-1' }],
    });
    const r = run('connect', 'wsbot', '--workspace', 'nope');
    assert.notEqual(r.code, 0);
    assert.ok(r.stdout.includes("No workspace 'nope'"), r.stdout);
    assert.ok(r.stdout.includes('myws'), 'should list known workspaces');
    assert.ok(!readDaemonYaml().includes('network: nope'));
  });
});

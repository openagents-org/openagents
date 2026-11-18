'use strict';

/**
 * OpenCode subagents and folders outside the working directory.
 *
 * Field report 2026-11-17 (daily errors dashboard): "OpenCode timed out before
 * producing a reply" on ~10 runs from 4 users; one user's own Codex agent
 * traced it to a permission prompt nobody answered. opencode-ai 1.17.11's
 * `run --dangerously-skip-permissions` answers only the main session's
 * prompts, and a task-tool subagent runs in a child session where
 * `external_directory` defaults to "ask". The adapter passes
 * OPENCODE_PERMISSION so subagents may go there too, unless the user has
 * rules of their own.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OpenCodeAdapter = require('../src/adapters/opencode');

let root;
let home;
let project;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-perm-'));
  home = path.join(root, 'home');
  project = path.join(root, 'work', 'app');
  fs.mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
  fs.mkdirSync(project, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const baseEnv = () => ({ HOME: home, USERPROFILE: home, PATH: process.env.PATH || '' });

function spawnEnv(env, workingDir = project) {
  const adapter = Object.assign(Object.create(OpenCodeAdapter.prototype), {
    agentEnv: env, workingDir, agentHome: home,
    _wiresWorkspaceMcp: () => false,
  });
  return adapter._spawnEnv('general');
}

describe('OpenCode — subagents may use folders outside the working directory', () => {
  it('passes OPENCODE_PERMISSION allowing external_directory when the user has no rules', () => {
    const env = spawnEnv(baseEnv());
    assert.deepEqual(JSON.parse(env.OPENCODE_PERMISSION), { external_directory: 'allow' });
  });

  it('leaves OPENCODE_PERMISSION the user set alone', () => {
    const env = spawnEnv({ ...baseEnv(), OPENCODE_PERMISSION: '{"bash":"ask"}' });
    assert.equal(env.OPENCODE_PERMISSION, '{"bash":"ask"}');
  });

  it('leaves it out when the global config has an external_directory rule', () => {
    fs.writeFileSync(path.join(home, '.config', 'opencode', 'opencode.json'),
      JSON.stringify({ permission: { external_directory: { '~/secrets/**': 'deny' } } }));
    assert.equal(spawnEnv(baseEnv()).OPENCODE_PERMISSION, undefined);
  });

  it('leaves it out when the config sets every permission at once', () => {
    fs.writeFileSync(path.join(home, '.config', 'opencode', 'opencode.jsonc'),
      '{\n  // locked down\n  "permission": "deny"\n}\n');
    assert.equal(spawnEnv(baseEnv()).OPENCODE_PERMISSION, undefined);
  });

  it('leaves it out when the config denies every permission with a wildcard', () => {
    fs.mkdirSync(path.join(home, '.opencode'), { recursive: true });
    fs.writeFileSync(path.join(home, '.opencode', 'opencode.json'), JSON.stringify({ permission: { '*': 'deny' } }));
    assert.equal(spawnEnv(baseEnv()).OPENCODE_PERMISSION, undefined);
  });

  it('leaves it out when the wildcard is not the first permission key', () => {
    fs.writeFileSync(path.join(home, '.config', 'opencode', 'opencode.json'),
      JSON.stringify({ permission: { bash: { 'git *': 'allow' }, '*': 'deny' } }, null, 2));
    assert.equal(spawnEnv(baseEnv()).OPENCODE_PERMISSION, undefined);
  });

  it('still passes it when a "*" only appears inside one tool\'s rules', () => {
    fs.writeFileSync(path.join(home, '.config', 'opencode', 'opencode.json'),
      JSON.stringify({ permission: { bash: { '*': 'ask', 'git status': 'allow' }, edit: 'allow' } }));
    assert.deepEqual(JSON.parse(spawnEnv(baseEnv()).OPENCODE_PERMISSION), { external_directory: 'allow' });
  });

  it('leaves it out for a rule in a project file above the working directory', () => {
    fs.mkdirSync(path.join(root, 'work', '.opencode'), { recursive: true });
    fs.writeFileSync(path.join(root, 'work', '.opencode', 'opencode.json'),
      JSON.stringify({ permission: { external_directory: 'ask' } }));
    assert.equal(spawnEnv(baseEnv()).OPENCODE_PERMISSION, undefined);
  });

  it('leaves it out for a rule in OPENCODE_CONFIG or the inline config', () => {
    const file = path.join(root, 'custom.json');
    fs.writeFileSync(file, JSON.stringify({ permission: { external_directory: 'deny' } }));
    assert.equal(spawnEnv({ ...baseEnv(), OPENCODE_CONFIG: file }).OPENCODE_PERMISSION, undefined);
    const inline = JSON.stringify({ permission: { external_directory: 'deny' } });
    assert.equal(spawnEnv({ ...baseEnv(), OPENCODE_CONFIG_CONTENT: inline }).OPENCODE_PERMISSION, undefined);
  });

  it('a config without such a rule does not count', () => {
    fs.writeFileSync(path.join(home, '.config', 'opencode', 'opencode.json'),
      JSON.stringify({ model: 'openai/gpt-test', permission: { bash: 'allow' } }));
    assert.ok(spawnEnv(baseEnv()).OPENCODE_PERMISSION);
  });
});

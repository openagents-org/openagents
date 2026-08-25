'use strict';

// check_ready.env_vars must be satisfiable by the SAVED per-agent env (after
// resolve rules), not only the daemon's process env. The workspace configure
// flow saves LLM_API_KEY, resolve rules map it to the provider var (e.g.
// ANTHROPIC_AUTH_TOKEN), and the adapter launches the CLI with exactly that —
// so health must call the agent Ready. Checking process.env alone produced
// "Not logged in" banners and failed smoke tests on agents whose chat worked.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

const { Installer } = require('../src/installer');
const { EnvManager } = require('../src/env');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agn-readiness-'));
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const registry = {
  getEntry: (name) => name === 'claudeish' ? {
    name: 'claudeish',
    label: 'Claude-like CLI',
    install: { binary: 'claudeish-bin', macos: 'npm i -g x', linux: 'npm i -g x', windows: 'npm i -g x' },
    check_ready: {
      env_vars: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
      login_command: 'claudeish login',
      not_ready_message: 'Not logged in. Run: claudeish login',
    },
  } : null,
  getResolveRules: (name) => name === 'claudeish' ? [
    { from: 'LLM_API_KEY', to: 'ANTHROPIC_AUTH_TOKEN', if_base_url_contains: '://' },
    { from: 'LLM_BASE_URL', to: 'ANTHROPIC_BASE_URL' },
  ] : [],
};

function makeInstaller() {
  const inst = new Installer(registry, tmpDir);
  inst._whichBinary = () => 'claudeish-bin';
  inst._checkStatusCommand = () => false;
  // Mark installed so readiness (not NOT_INSTALLED) is what's under test.
  fs.mkdirSync(path.join(tmpDir, 'installed'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'installed_agents.json'), JSON.stringify(['claudeish']));
  return inst;
}

describe('readiness from saved per-agent env', () => {
  it('a saved key that resolve rules map onto env_vars counts as Ready', () => {
    const env = new EnvManager(tmpDir);
    env.save('claudeish', {
      LLM_API_KEY: 'sk-saved-relay-key',
      LLM_BASE_URL: 'https://relay.example/v1',
    });
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;

    const health = makeInstaller().healthCheck('claudeish');
    assert.equal(health.ready, true);
    assert.equal(health.auth_mode, 'api_key');
  });

  it('no saved key and no process env → still not ready', () => {
    new EnvManager(tmpDir).delete('claudeish');
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;

    const health = makeInstaller().healthCheck('claudeish');
    assert.equal(health.ready, false);
  });
});

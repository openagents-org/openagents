'use strict';

/**
 * OpenClaw credentials stay out of the legacy auth-profiles.json. Current
 * OpenClaw keeps them in SQLite and refuses to start while a legacy JSON store
 * sits beside an empty one ("requires legacy credential migration; run
 * openclaw doctor --fix"), so every key saved through the launcher broke the
 * next run. The file this adapter wrote earlier is archived; one holding the
 * user's own profiles is left for Doctor.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME_KEY = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
const MODULE = require.resolve('../src/adapters/openclaw');

let home;
let savedHome;
let openclaw;

const stateDir = () => path.join(home, '.openclaw');
const authFile = () => path.join(stateDir(), 'agents', 'main', 'agent', 'auth-profiles.json');
const readConfig = () => JSON.parse(fs.readFileSync(path.join(stateDir(), 'openclaw.json'), 'utf-8'));

function writeLegacy(profiles) {
  fs.mkdirSync(path.dirname(authFile()), { recursive: true });
  fs.writeFileSync(authFile(), JSON.stringify({ version: 1, profiles }));
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-openclaw-'));
  savedHome = process.env[HOME_KEY];
  process.env[HOME_KEY] = home;
  // The state dir is resolved when the module loads.
  delete require.cache[MODULE];
  openclaw = require(MODULE);
});

afterEach(() => {
  if (savedHome === undefined) delete process.env[HOME_KEY];
  else process.env[HOME_KEY] = savedHome;
  delete require.cache[MODULE];
  fs.rmSync(home, { recursive: true, force: true });
});

describe('OpenClaw native auth', () => {
  it('a custom endpoint keeps its key in openclaw.json only', () => {
    openclaw.configureNativeAuth({
      LLM_API_KEY: 'sk-gw', LLM_BASE_URL: 'https://gateway.example/v1', LLM_MODEL: 'glm-5.3',
    });
    assert.equal(fs.existsSync(authFile()), false);
    const config = readConfig();
    assert.equal(config.models.providers.custom.apiKey, 'sk-gw');
    assert.equal(config.agents.defaults.model.primary, 'custom/glm-5.3');
  });

  it('a standard provider sets the model and leaves the key to the env', () => {
    openclaw.configureNativeAuth({ LLM_API_KEY: 'sk-oa', LLM_BASE_URL: 'https://api.openai.com/v1', LLM_MODEL: 'gpt-4o' });
    assert.equal(fs.existsSync(authFile()), false);
    assert.equal(readConfig().agents.defaults.model.primary, 'openai/gpt-4o');
  });

  it('archives the file an earlier launcher wrote', () => {
    writeLegacy({ 'custom:manual': { type: 'token', provider: 'custom', token: 'sk-old' } });
    openclaw.configureNativeAuth({ LLM_API_KEY: 'sk-new', LLM_BASE_URL: 'https://gateway.example/v1' });
    assert.equal(fs.existsSync(authFile()), false);
    assert.equal(fs.existsSync(`${authFile()}.openagents-retired`), true);
  });

  it('archives a standard-provider entry holding the key we were given', () => {
    writeLegacy({ 'openai:manual': { type: 'token', provider: 'openai', token: 'sk-oa' } });
    assert.equal(openclaw.retireOwnLegacyAuthProfiles(['sk-oa']), true);
    assert.equal(fs.existsSync(authFile()), false);
  });

  it('leaves a file holding the user\'s own profiles for Doctor', () => {
    writeLegacy({
      'custom:manual': { type: 'token', provider: 'custom', token: 'sk-gw' },
      'anthropic:manual': { type: 'token', provider: 'anthropic', token: 'sk-theirs' },
    });
    assert.equal(openclaw.retireOwnLegacyAuthProfiles(['sk-gw']), false);
    assert.equal(fs.existsSync(authFile()), true);
  });
});

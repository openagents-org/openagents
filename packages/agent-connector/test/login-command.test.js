'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loginSpawnSpec } = require('../src/login-command');

const none = () => false;
const only = (...paths) => (p) => paths.includes(p);

describe('loginSpawnSpec', () => {
  it('splits the command into binary + args on unix and spawns the resolved path', () => {
    assert.deepEqual(
      loginSpawnSpec('codex login', '/usr/local/bin/codex', 'darwin', none),
      { file: '/usr/local/bin/codex', args: ['login'], shell: false },
    );
    assert.deepEqual(
      loginSpawnSpec('claude auth login', '/opt/bin/claude', 'linux', none),
      { file: '/opt/bin/claude', args: ['auth', 'login'], shell: false },
    );
  });

  it('keeps a bare login command (no subcommand) spawnable', () => {
    assert.deepEqual(
      loginSpawnSpec('gemini', '/usr/local/bin/gemini', 'linux', none),
      { file: '/usr/local/bin/gemini', args: [], shell: false },
    );
  });

  it('falls back to the shell with the bare command when nothing resolved', () => {
    assert.deepEqual(
      loginSpawnSpec('codex login', null, 'win32', none),
      { file: 'codex login', args: [], shell: true },
    );
    assert.deepEqual(
      loginSpawnSpec('codex login', null, 'linux', none),
      { file: 'codex login', args: [], shell: true },
    );
  });

  it('windows: runs a .cmd shim through the shell, quoted, with the args inline', () => {
    assert.deepEqual(
      loginSpawnSpec('codex login', 'C:\\Users\\First Last\\AppData\\Roaming\\npm\\codex.cmd', 'win32', none),
      { file: '"C:\\Users\\First Last\\AppData\\Roaming\\npm\\codex.cmd" login', args: [], shell: true },
    );
  });

  it('windows: spawns a .exe directly', () => {
    assert.deepEqual(
      loginSpawnSpec('cursor-agent login', 'C:\\cursor\\cursor-agent.exe', 'win32', none),
      { file: 'C:\\cursor\\cursor-agent.exe', args: ['login'], shell: false },
    );
  });

  it('windows: prefers the sibling .cmd shim over a package bin .js', () => {
    const js = 'C:\\x\\node_modules\\@openai\\codex\\bin\\codex.js';
    assert.deepEqual(
      loginSpawnSpec('codex login', js, 'win32', only('C:\\x\\node_modules\\@openai\\codex\\bin\\codex.cmd')),
      { file: '"C:\\x\\node_modules\\@openai\\codex\\bin\\codex.cmd" login', args: [], shell: true },
    );
  });

  it('windows: prefers the sibling .cmd shim over an extensionless git-bash script', () => {
    assert.deepEqual(
      loginSpawnSpec('codex login', 'C:\\nvm4w\\nodejs\\codex', 'win32', only('C:\\nvm4w\\nodejs\\codex.cmd')),
      { file: '"C:\\nvm4w\\nodejs\\codex.cmd" login', args: [], shell: true },
    );
  });

  it('windows: runs a shim-less .js bin through node', () => {
    const js = 'C:\\x\\node_modules\\@openai\\codex\\bin\\codex.js';
    assert.deepEqual(
      loginSpawnSpec('codex login', js, 'win32', none),
      { file: `node "${js}" login`, args: [], shell: true },
    );
  });

  it('windows: an extensionless script with no shim goes to the shell by bare name (PATHEXT)', () => {
    assert.deepEqual(
      loginSpawnSpec('codex login', 'C:\\nvm4w\\nodejs\\codex', 'win32', none),
      { file: 'codex login', args: [], shell: true },
    );
  });

  it('never throws when the existence check does', () => {
    const boom = () => { throw new Error('EPERM'); };
    assert.deepEqual(
      loginSpawnSpec('codex login', 'C:\\x\\codex.js', 'win32', boom),
      { file: 'node "C:\\x\\codex.js" login', args: [], shell: true },
    );
  });
});

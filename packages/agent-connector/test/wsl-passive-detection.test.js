'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/wsl.js'), 'utf8');

function harness() {
  let running = [];
  let blocking = true;
  const calls = [];
  const fakeChildProcess = {
    spawn() { throw new Error('unexpected spawn'); },
    execFile(_file, args, _opts, done) {
      calls.push(args);
      Promise.resolve().then(() => done(null,
        Buffer.from(args.includes('--running') ? running.join('\r\n') : 'Ubuntu\r\nOther\r\n', 'utf16le')));
      return { stdin: { end() {} } };
    },
    execFileSync(_file, args) {
      calls.push(args);
      if (args.includes('--running')) return Buffer.from(running.join('\r\n'), 'utf16le');
      if (args.includes('-q')) return Buffer.from('Ubuntu\r\nOther\r\n', 'utf16le');
      if (args.includes('-e')) {
        return 'noise\n__OPENAGENTS_WSL__\n/usr/local/bin\n/home/u\n/mnt/c/\n';
      }
      throw new Error(`unexpected WSL command: ${args.join(' ')}`);
    },
  };
  const fakeFs = {
    existsSync: () => true,
    statSync: () => ({ isFile: () => true }),
    promises: {
      access: async () => {},
      stat: async () => ({ isFile: () => true }),
    },
  };
  const module = { exports: {} };
  const load = vm.runInNewContext(`(function(require, module, exports, process, Buffer) { ${source}\n})`);
  load((name) => {
    if (name === 'fs') return fakeFs;
    if (name === 'child_process') return fakeChildProcess;
    if (name === './probe-mode') return { canBlock: () => blocking };
    throw new Error(`unexpected import: ${name}`);
  }, module, module.exports, { platform: 'win32', env: {} }, Buffer);
  return {
    wsl: module.exports, calls,
    setRunning: (names) => { running = names; },
    setBlocking: (value) => { blocking = value; },
  };
}

describe('passive WSL runtime detection', () => {
  it('does not boot a stopped default distro to look for agent binaries', () => {
    const { wsl, calls, setRunning } = harness();
    setRunning(['Other']);
    assert.equal(wsl.resolveWslBinary('codex'), null);
    wsl.wslBinDirs(); // Launcher also primes this during startup.
    assert.equal(wsl.wslHomeUnc(), null);
    assert.equal(calls.some((args) => args.includes('-e')), false);
  });

  it('detects a WSL agent after the user starts the default distro', () => {
    const { wsl, calls, setRunning } = harness();
    assert.equal(wsl.resolveWslBinary('codex'), null);
    setRunning(['Ubuntu']);
    wsl.clearWslCache();
    assert.equal(wsl.resolveWslBinary('codex'), 'wsl:/usr/local/bin/codex');
    assert.equal(calls.some((args) => args.includes('-e')), true);
  });

  it('keeps the desktop background refresh passive while WSL is stopped', async () => {
    const { wsl, calls, setBlocking } = harness();
    setBlocking(false);
    assert.equal(wsl.resolveWslBinary('codex'), null);
    wsl.wslBinDirs();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The first refresh learns the registered distros; the next checks state.
    assert.equal(wsl.resolveWslBinary('codex'), null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls.some((args) => args.includes('-e')), false);
    assert.equal(calls.some((args) => args.includes('--running')), true);
  });
});

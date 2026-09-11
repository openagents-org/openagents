'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { withWindowsHide, pinComSpec } = require('../src/win-console');

describe('withWindowsHide', () => {
  it('adds windowsHide to an existing options object', () => {
    const opts = { cwd: '/tmp', stdio: 'pipe' };
    const out = withWindowsHide(['node', ['--version'], opts]);
    assert.deepEqual(out[2], { cwd: '/tmp', stdio: 'pipe', windowsHide: true });
    // The caller's object must not be mutated — option objects get reused.
    assert.deepEqual(opts, { cwd: '/tmp', stdio: 'pipe' });
  });

  it('leaves an explicit windowsHide alone, including false', () => {
    const args = ['cmd', { shell: true, windowsHide: false }];
    assert.equal(withWindowsHide(args), args);
    assert.equal(withWindowsHide(['cmd', { windowsHide: true }])[1].windowsHide, true);
  });

  it('appends options when the call has none', () => {
    assert.deepEqual(withWindowsHide(['whoami']), ['whoami', { windowsHide: true }]);
    assert.deepEqual(withWindowsHide(['node', ['-v']]), [
      'node',
      ['-v'],
      { windowsHide: true },
    ]);
  });

  it('inserts options ahead of a trailing callback', () => {
    const cb = () => {};
    assert.deepEqual(withWindowsHide(['whoami', cb]), [
      'whoami',
      { windowsHide: true },
      cb,
    ]);
    const out = withWindowsHide(['taskkill', ['/pid', '1'], { timeout: 5000 }, cb]);
    assert.deepEqual(out, [
      'taskkill',
      ['/pid', '1'],
      { timeout: 5000, windowsHide: true },
      cb,
    ]);
  });

  it('does not mistake an args array for an options object', () => {
    const out = withWindowsHide(['git', ['--version']]);
    assert.deepEqual(out[1], ['--version']);
    assert.deepEqual(out[2], { windowsHide: true });
  });
});

/**
 * A ComSpec pointed at PowerShell made every .cmd shim start as
 * `pwsh /c "x.cmd"`, which ran x.cmd again — an endless chain of pwsh
 * processes. The platform and the file check are injected so the Windows
 * branch runs here.
 */
describe('pinComSpec', () => {
  const CMD = 'C:\\Windows\\System32\\cmd.exe';
  const present = (p) => p === CMD;

  it('replaces a ComSpec that points at PowerShell', () => {
    const env = { ComSpec: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', SystemRoot: 'C:\\Windows' };
    assert.equal(pinComSpec(env, 'win32', present), true);
    assert.equal(env.ComSpec, CMD);
  });

  it('leaves a ComSpec that already is cmd.exe alone', () => {
    const env = { ComSpec: 'C:\\WINDOWS\\system32\\cmd.exe', SystemRoot: 'C:\\WINDOWS' };
    assert.equal(pinComSpec(env, 'win32', present), false);
    assert.equal(env.ComSpec, 'C:\\WINDOWS\\system32\\cmd.exe');
  });

  it('fills in a missing ComSpec', () => {
    const env = { SystemRoot: 'C:\\Windows' };
    assert.equal(pinComSpec(env, 'win32', present), true);
    assert.equal(env.ComSpec, CMD);
  });

  it('updates the key in the casing it already has, never adding a second', () => {
    const env = { COMSPEC: 'pwsh.exe', SYSTEMROOT: 'C:\\Windows' };
    pinComSpec(env, 'win32', present);
    assert.deepEqual(Object.keys(env).filter((k) => k.toLowerCase() === 'comspec'), ['COMSPEC']);
    assert.equal(env.COMSPEC, CMD);
  });

  it('falls back to a bare cmd.exe when System32 is not where it looked', () => {
    const env = { ComSpec: 'pwsh.exe', SystemRoot: 'D:\\Win' };
    pinComSpec(env, 'win32', () => false);
    assert.equal(env.ComSpec, 'cmd.exe');
  });

  it('does nothing off Windows', () => {
    const env = { ComSpec: 'pwsh.exe' };
    assert.equal(pinComSpec(env, 'linux', present), false);
    assert.equal(env.ComSpec, 'pwsh.exe');
  });
});

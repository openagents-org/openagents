'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { withWindowsHide } = require('../src/win-console');

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

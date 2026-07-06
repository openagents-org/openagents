'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { findNpmBin, runUpdate, npmPrefixFromBin, isolatedRuntimeDir } = require('../src/update-check');

// Capture everything written to process.stderr while `fn` runs.
function captureStderr(fn) {
  const original = process.stderr.write;
  let out = '';
  process.stderr.write = (chunk) => { out += chunk; return true; };
  try {
    const result = fn();
    return { result, out };
  } finally {
    process.stderr.write = original;
  }
}

describe('findNpmBin', () => {
  it('prefers npm.cmd on Windows', () => {
    // Both files exist next to node — Windows must pick npm.cmd, not the
    // extensionless Unix shell script.
    const bin = findNpmBin({
      platform: 'win32',
      nodeDir: 'C:\\Program Files\\nodejs',
      exists: () => true,
    });
    assert.ok(bin.endsWith('npm.cmd'), `expected npm.cmd, got ${bin}`);
  });

  it('prefers npm on non-Windows', () => {
    const bin = findNpmBin({
      platform: 'linux',
      nodeDir: '/usr/local/bin',
      exists: () => true,
    });
    assert.ok(bin.endsWith('npm'), `expected npm, got ${bin}`);
    assert.ok(!bin.endsWith('npm.cmd'));
  });

  it('falls back to npm.cmd name on Windows when PATH lookup fails', () => {
    const bin = findNpmBin({
      platform: 'win32',
      nodeDir: 'C:\\nowhere',
      exists: () => false,            // skip the next-to-node candidates
      lookup: () => { throw new Error('no npm on PATH'); }, // force hard fallback
    });
    // The hard fallback must be the runnable Windows name, not the Unix script.
    assert.equal(bin, 'npm.cmd');
  });
});

describe('runUpdate', () => {
  it('returns false and prints the error when spawn fails to start', () => {
    const err = new Error('spawn npm.cmd ENOENT');
    err.code = 'ENOENT';
    const { result, out } = captureStderr(() =>
      runUpdate({
        platform: 'win32',
        npmBin: 'npm.cmd',
        prefix: null,
        spawn: () => ({ error: err }),
      }));
    assert.equal(result, false);
    assert.ok(out.includes('Failed to run npm'));
    assert.ok(out.includes('ENOENT'));
  });

  it('returns false and prints the exit code when npm exits non-zero', () => {
    const { result, out } = captureStderr(() =>
      runUpdate({
        platform: 'linux',
        npmBin: 'npm',
        prefix: null,
        spawn: () => ({ status: 1 }),
      }));
    assert.equal(result, false);
    assert.ok(out.includes('exited with code 1'));
  });

  it('returns true when npm exits zero', () => {
    const { result } = captureStderr(() =>
      runUpdate({
        platform: 'linux',
        npmBin: 'npm',
        prefix: null,
        spawn: () => ({ status: 0 }),
      }));
    assert.equal(result, true);
  });

  it('invokes npm.cmd through cmd.exe on Windows', () => {
    let captured = null;
    captureStderr(() =>
      runUpdate({
        platform: 'win32',
        npmBin: 'C:\\Program Files\\nodejs\\npm.cmd',
        prefix: null,
        spawn: (cmd, args) => { captured = { cmd, args }; return { status: 0 }; },
      }));
    assert.ok(/cmd\.exe$/i.test(captured.cmd) || captured.cmd.toLowerCase().includes('cmd'));
    assert.deepEqual(captured.args.slice(0, 4), ['/d', '/s', '/c', 'C:\\Program Files\\nodejs\\npm.cmd']);
    assert.ok(captured.args.includes('-g')); // prefix:null → global install
  });

  it('invokes npm directly on non-Windows', () => {
    let captured = null;
    captureStderr(() =>
      runUpdate({
        platform: 'linux',
        npmBin: '/usr/local/bin/npm',
        prefix: null,
        spawn: (cmd, args) => { captured = { cmd, args }; return { status: 0 }; },
      }));
    assert.equal(captured.cmd, '/usr/local/bin/npm');
    assert.equal(captured.args[0], 'install');
  });

  // Regression: the derived --prefix must be the npm PREFIX ROOT, not the
  // directory containing node_modules. On Unix npm appends lib/node_modules to
  // --prefix, so passing `{prefix}/lib` produced `{prefix}/lib/lib/node_modules`
  // and the update silently no-op'd. When prefix is left undefined, runUpdate
  // must derive it from the npm bin location.
  it('derives the correct --prefix on non-Windows (parent of the bin dir)', () => {
    let captured = null;
    captureStderr(() =>
      runUpdate({
        platform: 'linux',
        npmBin: '/home/u/.nvm/versions/node/v24.15.0/bin/npm', // prefix is undefined → derive
        spawn: (cmd, args) => { captured = { cmd, args }; return { status: 0 }; },
      }));
    const i = captured.args.indexOf('--prefix');
    assert.ok(i !== -1, 'expected a --prefix arg');
    assert.equal(captured.args[i + 1], '/home/u/.nvm/versions/node/v24.15.0');
  });

  it('derives the correct --prefix on Windows (the bin dir itself)', () => {
    let captured = null;
    captureStderr(() =>
      runUpdate({
        platform: 'win32',
        npmBin: 'C:\\Program Files\\nodejs\\npm.cmd',
        spawn: (cmd, args) => { captured = { cmd, args }; return { status: 0 }; },
      }));
    const i = captured.args.indexOf('--prefix');
    assert.ok(i !== -1, 'expected a --prefix arg');
    assert.equal(captured.args[i + 1], 'C:\\Program Files\\nodejs');
  });
});

describe('npmPrefixFromBin', () => {
  it('returns the parent of the bin dir on Unix', () => {
    assert.equal(
      npmPrefixFromBin('/home/u/.nvm/versions/node/v24.15.0/bin/npm', 'linux'),
      '/home/u/.nvm/versions/node/v24.15.0',
    );
  });

  it('returns the bin dir itself on Windows', () => {
    assert.equal(
      npmPrefixFromBin('C:\\Program Files\\nodejs\\npm.cmd', 'win32'),
      'C:\\Program Files\\nodejs',
    );
  });

  it('returns null for a bare npm name (PATH fallback) so npm uses its default', () => {
    assert.equal(npmPrefixFromBin('npm', 'linux'), null);
    assert.equal(npmPrefixFromBin('npm.cmd', 'win32'), null);
  });

  it('returns null when no npm bin is given', () => {
    assert.equal(npmPrefixFromBin(null, 'linux'), null);
  });
});

describe('isolatedRuntimeDir', () => {
  const posix = require('node:path').posix; // force POSIX semantics on any host (incl. Windows CI)
  const A = '/@openagents-org/agent-launcher/src';

  it('detects the isolated ~/.openagents/nodejs local project', () => {
    // package at <dir>/node_modules/@openagents-org/agent-launcher, <dir> has package.json
    const dir = '/home/u/.openagents/nodejs/node_modules' + A;
    const got = isolatedRuntimeDir({ dir, path: posix, exists: (p) => p === '/home/u/.openagents/nodejs/package.json' });
    assert.equal(got, '/home/u/.openagents/nodejs');
  });

  it('returns null for a global/nvm layout (…/lib/node_modules)', () => {
    const dir = '/home/u/.nvm/versions/node/v24.15.0/lib/node_modules' + A;
    assert.equal(isolatedRuntimeDir({ dir, path: posix, exists: () => true }), null);
  });

  it('returns null when the prefix root has no package.json (bare global prefix)', () => {
    const dir = '/usr/local/node_modules' + A;
    assert.equal(isolatedRuntimeDir({ dir, path: posix, exists: () => false }), null);
  });
});

describe('runUpdate isolated runtime', () => {
  it('does a LOCAL install into the runtime dir (no -g) when isolated', () => {
    let captured = null;
    captureStderr(() =>
      runUpdate({
        platform: 'linux',
        npmBin: '/home/u/.openagents/nodejs/bin/npm',
        isolatedDir: '/home/u/.openagents/nodejs',
        spawn: (cmd, args) => { captured = { cmd, args }; return { status: 0 }; },
      }));
    assert.ok(!captured.args.includes('-g'), 'must NOT be a global install for an isolated runtime');
    const i = captured.args.indexOf('--prefix');
    assert.ok(i !== -1, 'expected --prefix');
    assert.equal(captured.args[i + 1], '/home/u/.openagents/nodejs'); // → <dir>/node_modules
    assert.ok(captured.args.includes('--no-save'));
  });

  it('still does a GLOBAL install when not isolated', () => {
    let captured = null;
    captureStderr(() =>
      runUpdate({
        platform: 'linux',
        npmBin: '/usr/local/bin/npm',
        isolatedDir: null,
        prefix: '/usr/local',
        spawn: (cmd, args) => { captured = { cmd, args }; return { status: 0 }; },
      }));
    assert.ok(captured.args.includes('-g'), 'non-isolated install must stay global');
  });
});

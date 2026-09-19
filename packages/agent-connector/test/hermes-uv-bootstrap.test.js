'use strict';

/**
 * Provisioning hermes's managed uv before its own installer can fail at it.
 *
 * A hermes install died with "[X] Installation failed: uv installation failed"
 * and exited 0. Its Install-Uv bootstraps its own uv at
 * <HERMES_HOME>\bin\uv.exe by spawning a child PowerShell WITHOUT -NoProfile,
 * and on that machine the child could not auto-load
 * Microsoft.PowerShell.Security, so uv's very first call died. Putting uv
 * there ourselves short-circuits that hop.
 *
 * Best-effort: a failure here must never fail the install. Windows-only, via
 * a `platform` seam (the convention install-preflight.js uses) so the
 * behaviour is covered on every CI runner rather than only on Windows.
 *
 * Run: node --test test/hermes-uv-bootstrap.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Installer } = require('../src/installer');

function newInstaller() {
  return new Installer({ getEntry: () => null }, os.tmpdir());
}

describe('Installer._bootstrapManagedUv', () => {
  it('does nothing for an agent that is not hermes', async () => {
    const lines = [];
    await newInstaller()._bootstrapManagedUv('amp', {}, (d) => lines.push(d), 'win32');
    assert.deepEqual(lines, []);
  });

  it('does nothing on Unix, where the installer reads no profile', async () => {
    const lines = [];
    await newInstaller()._bootstrapManagedUv('hermes', {}, (d) => lines.push(d), 'linux');
    assert.deepEqual(lines, []);
  });

  it('skips the download when hermes already has its managed uv', async () => {
    const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-home-'));
    fs.mkdirSync(path.join(hermesHome, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(hermesHome, 'bin', 'uv.exe'), 'stub');
    const lines = [];
    await newInstaller()._bootstrapManagedUv(
      'hermes', { HERMES_HOME: hermesHome }, (d) => lines.push(d), 'win32',
    );
    assert.deepEqual(lines, []);
  });

  it('never hands the child an inherited PSModulePath', async () => {
    // The whole reason the first attempt failed: Windows PowerShell discovers
    // a command in whatever module directory PSModulePath names and then
    // cannot load it. We spawn a specific interpreter for one download, so
    // the child has no use for an inherited value.
    const seen = [];
    const installer = newInstaller();
    installer._spawnForTest = (file, args, opts) => { seen.push(opts.env); throw new Error('stop'); };
    const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-home-'));
    await installer._bootstrapManagedUv(
      'hermes',
      { HERMES_HOME: hermesHome, PSModulePath: 'C:\\Program Files\\PowerShell\\7\\Modules', SystemRoot: 'C:\\Windows' },
      () => {},
      'win32',
    );
    assert.equal(seen.length, 1);
    assert.equal(
      Object.keys(seen[0]).find((k) => k.toLowerCase() === 'psmodulepath'),
      undefined,
    );
    // The variable it DOES need is still there.
    assert.equal(seen[0].UV_INSTALL_DIR, path.join(hermesHome, 'bin'));
  });

  it('honours HERMES_HOME over LOCALAPPDATA when deciding where uv goes', async () => {
    const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-home-'));
    fs.mkdirSync(path.join(hermesHome, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(hermesHome, 'bin', 'uv.exe'), 'stub');
    const lines = [];
    await newInstaller()._bootstrapManagedUv(
      'hermes',
      { HERMES_HOME: hermesHome, LOCALAPPDATA: path.join(os.tmpdir(), 'nowhere') },
      (d) => lines.push(d),
      'win32',
    );
    // The LOCALAPPDATA copy does not exist; taking it would have started a
    // download instead of returning silently.
    assert.deepEqual(lines, []);
  });
});

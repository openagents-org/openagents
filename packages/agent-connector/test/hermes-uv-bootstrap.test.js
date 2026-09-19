'use strict';

/**
 * Windows-only install hardening, both halves of one field failure.
 *
 * A hermes install died with "[X] Installation failed: uv installation failed"
 * and exited 0. hermes's Install-Uv bootstraps its own uv at
 * <HERMES_HOME>\bin\uv.exe by spawning a child PowerShell WITHOUT -NoProfile,
 * and on that machine the child could not auto-load
 * Microsoft.PowerShell.Security, so uv's very first call died.
 *
 *   - _repairPSModulePath: a child PowerShell inherits PSModulePath from us
 *     verbatim, so a value missing the built-in module directory breaks every
 *     installer we spawn. Appending it is a no-op on a healthy machine.
 *   - _bootstrapManagedUv: put uv where hermes looks BEFORE running its
 *     installer, so its fragile hop is short-circuited. Best-effort — a
 *     failure here must never fail the install.
 *
 * Both take a `platform` seam (the convention install-preflight.js uses), so
 * the Windows behaviour is covered on every CI runner rather than skipped
 * everywhere except the one platform nobody runs the suite on.
 *
 * Run: node --test test/hermes-uv-bootstrap.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Installer } = require('../src/installer');

const BUILTIN = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules';

function newInstaller() {
  return new Installer({ getEntry: () => null }, os.tmpdir());
}

describe('Installer._repairPSModulePath', () => {
  it('appends the built-in module directory when it is missing', () => {
    const env = { SystemRoot: 'C:\\Windows', PSModulePath: 'D:\\miniconda\\shell\\condabin' };
    newInstaller()._repairPSModulePath(env, 'win32');
    assert.equal(env.PSModulePath, `D:\\miniconda\\shell\\condabin;${BUILTIN}`);
  });

  it('is a no-op when the directory is already listed, whatever the casing', () => {
    const env = {
      SystemRoot: 'C:\\Windows',
      PSModulePath: 'c:\\windows\\system32\\windowspowershell\\v1.0\\modules;D:\\x',
    };
    const before = env.PSModulePath;
    newInstaller()._repairPSModulePath(env, 'win32');
    assert.equal(env.PSModulePath, before);
  });

  it('ignores a trailing separator when comparing', () => {
    const env = { SystemRoot: 'C:\\Windows', PSModulePath: `${BUILTIN}\\` };
    const before = env.PSModulePath;
    newInstaller()._repairPSModulePath(env, 'win32');
    assert.equal(env.PSModulePath, before);
  });

  it('writes back to the existing key whatever its casing', () => {
    // Spreading process.env on Windows can yield any casing; a second key
    // would leave the child process reading the old, broken value.
    const env = { SystemRoot: 'C:\\Windows', PsModulePath: 'D:\\x' };
    newInstaller()._repairPSModulePath(env, 'win32');
    assert.equal(env.PSModulePath, undefined);
    assert.equal(env.PsModulePath, `D:\\x;${BUILTIN}`);
  });

  it('sets the directory even when nothing was inherited', () => {
    const env = { SystemRoot: 'C:\\Windows' };
    newInstaller()._repairPSModulePath(env, 'win32');
    assert.equal(env.PSModulePath, BUILTIN);
  });

  it('honours a relocated Windows directory', () => {
    const env = { SystemRoot: 'E:\\Win', PSModulePath: 'D:\\x' };
    newInstaller()._repairPSModulePath(env, 'win32');
    assert.ok(env.PSModulePath.endsWith('E:\\Win\\System32\\WindowsPowerShell\\v1.0\\Modules'));
  });

  it('leaves non-Windows environments untouched', () => {
    const env = { PSModulePath: 'anything' };
    newInstaller()._repairPSModulePath(env, 'linux');
    assert.equal(env.PSModulePath, 'anything');
  });
});

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

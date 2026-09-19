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
const childProcess = require('child_process');
const { EventEmitter } = require('events');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Installer } = require('../src/installer');

function newInstaller() {
  return new Installer({ getEntry: () => null }, os.tmpdir());
}

describe('Installer._powerShellChildEnv', () => {
  it('removes inherited PSModulePath keys without mutating the caller environment', () => {
    const source = {
      Path: 'C:\\Tools',
      PSModulePath: 'C:\\Program Files\\PowerShell\\Modules',
      psmodulepath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules',
    };

    const result = newInstaller()._powerShellChildEnv(source);

    assert.deepEqual(result, { Path: 'C:\\Tools' });
    assert.equal(source.PSModulePath, 'C:\\Program Files\\PowerShell\\Modules');
    assert.equal(source.psmodulepath, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  });
});

describe('Installer._resolveWindowsPowerShellHost', () => {
  it('prefers the inbox Windows PowerShell host when both hosts are available', () => {
    const windowsPowerShell = 'E:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const pwsh = 'D:\\PowerShell\\pwsh.exe';
    const existingFiles = new Set([windowsPowerShell, pwsh]);

    const result = newInstaller()._resolveWindowsPowerShellHost(
      {
        SYSTEMROOT: 'E:\\Windows',
        PATH: 'D:\\PowerShell',
      },
      'win32',
      (candidate) => existingFiles.has(candidate),
    );

    assert.equal(result, windowsPowerShell);
  });

  it('falls back to pwsh on PATH when Windows PowerShell is unavailable', () => {
    const portablePwsh = 'D:\\Portable PowerShell\\pwsh.exe';
    const existingFiles = new Set([portablePwsh]);

    const result = newInstaller()._resolveWindowsPowerShellHost(
      {
        SystemRoot: 'C:\\Windows',
        Path: 'C:\\Tools;D:\\Portable PowerShell',
      },
      'win32',
      (candidate) => existingFiles.has(candidate),
    );

    assert.equal(result, portablePwsh);
  });

  it('finds the standard PowerShell 7 install when it is not on PATH', () => {
    const standardPwsh = 'F:\\Programs\\PowerShell\\7\\pwsh.exe';

    const result = newInstaller()._resolveWindowsPowerShellHost(
      {
        SystemRoot: 'C:\\Windows',
        ProgramFiles: 'F:\\Programs',
        Path: 'C:\\Tools',
      },
      'win32',
      (candidate) => candidate === standardPwsh,
    );

    assert.equal(result, standardPwsh);
  });
});

describe('Installer._retargetPowerShellCommand', () => {
  it('replaces a configured PowerShell host while preserving its arguments', () => {
    const command = '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "Write-Output ok"';

    const result = newInstaller()._retargetPowerShellCommand(
      command,
      'D:\\PowerShell 7\\pwsh.exe',
    );

    assert.equal(
      result,
      '"D:\\PowerShell 7\\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -Command "Write-Output ok"',
    );
  });
});

describe('Installer._prepareWindowsPowerShellInstall', () => {
  it('selects a host, retargets the command, and removes inherited module paths', () => {
    const command = 'powershell.exe -NoProfile -Command "Write-Output ok"';
    const pwsh = 'D:\\Portable\\pwsh.exe';
    const sourceEnv = {
      SystemRoot: 'C:\\MissingWindows',
      Path: 'D:\\Portable',
      PSModulePath: 'C:\\Program Files\\PowerShell\\Modules',
    };

    const result = newInstaller()._prepareWindowsPowerShellInstall(
      command,
      sourceEnv,
      'win32',
      (candidate) => candidate === pwsh,
    );

    assert.equal(result.command, '"D:\\Portable\\pwsh.exe" -NoProfile -Command "Write-Output ok"');
    assert.equal(result.host, pwsh);
    assert.equal(result.env.PSModulePath, undefined);
    assert.equal(sourceEnv.PSModulePath, 'C:\\Program Files\\PowerShell\\Modules');
  });

  it('reports a clear error when no compatible PowerShell host exists', () => {
    assert.throws(
      () => newInstaller()._prepareWindowsPowerShellInstall(
        'powershell.exe -NoProfile -Command "Write-Output ok"',
        { SystemRoot: 'C:\\MissingWindows', Path: 'C:\\Empty' },
        'win32',
        () => false,
      ),
      /Windows PowerShell or PowerShell 7 is required/,
    );
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

  it('never hands the child an inherited PSModulePath', async () => {
    // The whole reason the first attempt failed: Windows PowerShell discovers
    // a command in whatever module directory PSModulePath names and then
    // cannot load it. We spawn a specific interpreter for one download, so
    // the child has no use for an inherited value.
    const winPs = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const seen = [];
    const installer = newInstaller();
    installer._spawnForTest = (file, args, opts) => { seen.push(opts.env); throw new Error('stop'); };
    const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-home-'));
    await installer._bootstrapManagedUv(
      'hermes',
      {
        HERMES_HOME: hermesHome,
        PSModulePath: 'C:\\Program Files\\PowerShell\\7\\Modules',
        SystemRoot: 'C:\\Windows',
      },
      () => {},
      'win32',
      (p) => p === winPs,
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

  it('uses the resolved host with a host-neutral module environment', async () => {
    // No Windows PowerShell on this machine: the portable pwsh on PATH is the
    // only host there is, and it must still be handed a clean module
    // environment. `exists` is injected so the Windows rules run here too.
    const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-pwsh-only-'));
    const pwshDir = 'D:\\Portable PowerShell';
    const pwsh = path.win32.join(pwshDir, 'pwsh.exe');

    let invocation;
    const installer = newInstaller();
    installer._spawnForTest = (file, args, options) => {
      invocation = { file, args, options };
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => child.emit('close', 0));
      return child;
    };

    const sourceEnv = {
      HERMES_HOME: hermesHome,
      SystemRoot: 'C:\\Windows',
      Path: pwshDir,
      PSModulePath: 'C:\\Program Files\\PowerShell\\Modules',
    };
    await installer._bootstrapManagedUv(
      'hermes', sourceEnv, null, 'win32', (p) => p === pwsh,
    );

    assert.equal(invocation.file, pwsh);
    assert.equal(invocation.options.env.PSModulePath, undefined);
    assert.equal(invocation.options.env.UV_INSTALL_DIR, path.join(hermesHome, 'bin'));
    // The caller's own environment is never mutated.
    assert.equal(sourceEnv.PSModulePath, 'C:\\Program Files\\PowerShell\\Modules');
  });
});

describe('Installer.installStreaming hermes PowerShell wiring', () => {
  it('retargets and isolates the main Hermes installer process', {
    skip: process.platform !== 'win32',
  }, async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-install-stream-'));
    const registry = {
      getEntry: (name) => name === 'hermes' ? {
        name: 'hermes',
        label: 'Hermes',
        install: {
          binary: 'hermes',
          windows: '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "Write-Output ok"',
        },
      } : null,
    };
    const installer = new Installer(registry, configDir);
    installer._assertPrereqs = () => {};
    installer._bootstrapManagedUv = async () => {};
    installer._resolveWindowsPowerShellHost = () => 'D:\\Portable PowerShell\\pwsh.exe';
    installer._verifyHermesBinary = () => ({ path: 'C:\\Hermes\\hermes.exe' });

    let invocation;
    const originalSpawn = childProcess.spawn;
    const originalPSModulePath = process.env.PSModulePath;
    childProcess.spawn = (file, args, options) => {
      invocation = { file, args, options };
      const child = new EventEmitter();
      const stream = () => {
        const emitter = new EventEmitter();
        emitter.setEncoding = () => {};
        return emitter;
      };
      child.stdout = stream();
      child.stderr = stream();
      child.pid = 4321;
      setImmediate(() => child.emit('close', 0));
      return child;
    };
    process.env.PSModulePath = 'C:\\Program Files\\PowerShell\\Modules';

    try {
      await installer.installStreaming('hermes', null);
    } finally {
      childProcess.spawn = originalSpawn;
      if (originalPSModulePath === undefined) delete process.env.PSModulePath;
      else process.env.PSModulePath = originalPSModulePath;
      fs.rmSync(configDir, { recursive: true, force: true });
    }

    assert.match(invocation.file, /^"D:\\Portable PowerShell\\pwsh\.exe" /);
    assert.equal(invocation.options.env.PSModulePath, undefined);
  });
});

describe('Installer.install hermes PowerShell wiring', () => {
  it('retargets and isolates the non-streaming Hermes installer process', {
    skip: process.platform !== 'win32',
  }, async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-install-sync-'));
    const registry = {
      getEntry: (name) => name === 'hermes' ? {
        name: 'hermes',
        label: 'Hermes',
        install: {
          binary: 'hermes',
          windows: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Write-Output ok"',
        },
      } : null,
    };
    const installer = new Installer(registry, configDir);
    installer._assertPrereqs = () => {};
    installer._resolveWindowsPowerShellHost = () => 'D:\\Portable PowerShell\\pwsh.exe';
    installer._bootstrapManagedUv = async () => {};

    let invocation;
    installer._execShell = async (command, timeoutMs, env) => {
      invocation = { command, timeoutMs, env };
      return 'ok';
    };
    const originalPSModulePath = process.env.PSModulePath;
    process.env.PSModulePath = 'C:\\Program Files\\PowerShell\\Modules';

    try {
      await installer.install('hermes');
    } finally {
      if (originalPSModulePath === undefined) delete process.env.PSModulePath;
      else process.env.PSModulePath = originalPSModulePath;
      fs.rmSync(configDir, { recursive: true, force: true });
    }

    assert.match(invocation.command, /^"D:\\Portable PowerShell\\pwsh\.exe" /);
    assert.equal(invocation.env.PSModulePath, undefined);
  });
});

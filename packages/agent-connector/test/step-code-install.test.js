'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const { Installer } = require('../src/installer');

// Step Code's install.ps1 verifies its download with Get-FileHash and unpacks
// it with Expand-Archive. Run by Windows PowerShell with a PSModulePath
// inherited from PowerShell 7, neither module loads, so the install has to run
// in an environment of its own — the treatment Hermes already gets.
for (const streaming of [false, true]) {
  it(`step-code ${streaming ? 'streaming' : 'non-streaming'} install isolates PowerShell modules`, async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-code-install-'));
    const entry = require('../../../registry/step-code.json');
    const installer = new Installer({ getEntry: () => entry }, configDir);
    const sourceEnv = {
      SystemRoot: 'C:\\Windows',
      Path: 'C:\\Tools',
      PSModulePath: 'C:\\PowerShell7\\Modules',
    };
    installer._buildShellEnv = () => sourceEnv;
    installer._resolveWindowsPowerShellHost = () => 'D:\\PowerShell 7\\pwsh.exe';

    let invocation;
    installer._execShell = async (command, timeout, env) => {
      invocation = { command, env: env || installer._buildShellEnv() };
      return 'ok';
    };
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const originalSpawn = childProcess.spawn;
    childProcess.spawn = (command, args, options) => {
      invocation = { command, env: options.env };
      const child = new EventEmitter();
      for (const name of ['stdout', 'stderr']) {
        child[name] = new EventEmitter();
        child[name].setEncoding = () => {};
      }
      setImmediate(() => child.emit('close', 0));
      return child;
    };
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    try {
      if (streaming) await installer.installStreaming('step-code', null);
      else await installer.install('step-code');

      assert.equal(invocation.env.PSModulePath, undefined);
      assert.equal(sourceEnv.PSModulePath, 'C:\\PowerShell7\\Modules');
      assert.match(invocation.command, /^"D:\\PowerShell 7\\pwsh\.exe" -NoProfile /);
      assert.match(invocation.command, /irm https:\/\/static-openapi\.stepfun\.com\/stepcode\/install\.ps1 \| iex/);
      assert.equal((invocation.command.match(/ -Command /g) || []).length, 1);
    } finally {
      childProcess.spawn = originalSpawn;
      Object.defineProperty(process, 'platform', originalPlatform);
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });
}

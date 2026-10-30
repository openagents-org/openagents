'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const { Installer } = require('../src/installer');

for (const edition of ['qoder', 'qoder-cn']) {
  for (const streaming of [false, true]) {
    it(`${edition} ${streaming ? 'streaming' : 'non-streaming'} install isolates PowerShell modules`, async () => {
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qoder-install-'));
      const entry = require(`../../../registry/${edition}.json`);
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
        if (streaming) await installer.installStreaming(edition, null);
        else await installer.install(edition);

        assert.equal(invocation.env.PSModulePath, undefined);
        assert.equal(sourceEnv.PSModulePath, 'C:\\PowerShell7\\Modules');
        assert.match(invocation.command, /^"D:\\PowerShell 7\\pwsh\.exe" -NoProfile /);
        assert.match(invocation.command, /irm https:\/\/qoder\.com(?:\.cn)?\/install\.ps1 \| iex/);
        assert.equal((invocation.command.match(/ -Command /g) || []).length, 1);
      } finally {
        childProcess.spawn = originalSpawn;
        Object.defineProperty(process, 'platform', originalPlatform);
        fs.rmSync(configDir, { recursive: true, force: true });
      }
    });
  }
}

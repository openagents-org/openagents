'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  identityOf,
  expandDir,
  ownInstallDirs,
  findOwnInstall,
  versionOutputMatches,
  verifyBinary,
  clearIdentityCache,
} = require('../src/binary-identity');

const STEP = require('../../../registry/step-code.json');
const identify = STEP.install.identify;
const SMALLSTEP = 'Smallstep CLI/0.28.7 (linux/amd64)\nRelease Date: 2025-07-14 22:01 UTC\n';

describe('binary identity — the registry option', () => {
  it('is opted into by step-code alone', () => {
    const catalog = require('../registry.json');
    assert.deepEqual(catalog.filter((e) => identityOf(e)).map((e) => e.name), ['step-code']);
    assert.equal(identityOf({ install: { binary: 'x' } }), null);
    assert.equal(identityOf(null), null);
  });

  it("expands ~ and variables, skipping a variable that is unset", () => {
    const home = path.resolve('/home/u');
    assert.equal(expandDir('~/.stepcode/bin', {}, home), path.join(home, '.stepcode', 'bin'));
    assert.equal(expandDir('$STEP_INSTALL_DIR', { STEP_INSTALL_DIR: '/opt/step' }, home), path.resolve('/opt/step'));
    assert.equal(expandDir('${STEP_HOME}/bin', { STEP_HOME: '/opt/h' }, home), path.resolve('/opt/h/bin'));
    assert.equal(expandDir('$STEP_INSTALL_DIR', {}, home), null);
    assert.deepEqual(ownInstallDirs(identify, { env: {}, home }), [path.join(home, '.stepcode', 'bin')]);
  });

  it("finds the installer's own copy, the custom dir first, .exe on Windows", () => {
    const home = path.resolve('/home/u');
    const files = new Set([path.join(home, '.stepcode', 'bin', 'step'), path.join(path.resolve('/opt/step'), 'step')]);
    const isFile = (p) => files.has(p);
    assert.equal(findOwnInstall(identify, 'step', { env: {}, home, platform: 'linux', isFile }), path.join(home, '.stepcode', 'bin', 'step'));
    assert.equal(findOwnInstall(identify, 'step', { env: { STEP_INSTALL_DIR: '/opt/step' }, home, platform: 'linux', isFile }), path.join(path.resolve('/opt/step'), 'step'));
    const exe = path.join(home, '.stepcode', 'bin', 'step.exe');
    assert.equal(findOwnInstall(identify, 'step', { env: {}, home, platform: 'win32', isFile: (p) => p === exe }), exe);
    assert.equal(findOwnInstall(identify, 'step', { env: {}, home, platform: 'linux', isFile: () => false }), null);
  });

  it("tells Step Code's version output from Smallstep's", () => {
    assert.equal(versionOutputMatches(identify, '0.1.5\n'), true);
    assert.equal(versionOutputMatches(identify, SMALLSTEP), false);
    assert.equal(versionOutputMatches(identify, ''), null);
    assert.equal(versionOutputMatches({}, '0.1.5'), null);
  });
});

describe('binary identity — verifying a binary', () => {
  let dir;
  beforeEach(() => {
    clearIdentityCache();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-identity-'));
  });

  it('asks once per file version, and again once the file changes', () => {
    const bin = path.join(dir, 'step');
    fs.writeFileSync(bin, 'a');
    let calls = 0;
    const run = () => { calls++; return SMALLSTEP; };
    assert.equal(verifyBinary(identify, bin, { run }), false);
    assert.equal(verifyBinary(identify, bin, { run }), false);
    assert.equal(calls, 1);
    fs.writeFileSync(bin, 'a longer file');
    assert.equal(verifyBinary(identify, bin, { run: () => { calls++; return '0.1.5'; } }), true);
    assert.equal(calls, 2);
  });

  it('cannot tell when the binary will not run or is gone', () => {
    const bin = path.join(dir, 'step');
    fs.writeFileSync(bin, 'a');
    assert.equal(verifyBinary(identify, bin, { run: () => '' }), null);
    assert.equal(verifyBinary(identify, path.join(dir, 'missing'), { run: () => '0.1.5' }), null);
    assert.equal(verifyBinary(null, bin, { run: () => SMALLSTEP }), null);
  });
});

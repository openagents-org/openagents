'use strict';

/**
 * The desktop app's main process must never wait on a probe (src/probe-mode.js):
 * binary lookups walk PATH in-process instead of spawning `where`/`which`, and a
 * probe that has to spawn answers from its cache while it runs in the
 * background.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { canBlock, setBlockingProbes } = require('../src/probe-mode');
const { whichBinary, whereBinary, clearBinaryLookupCache, IS_WINDOWS } = require('../src/paths');
const { Installer, clearVersionCache } = require('../src/installer');

const same = (a, b) => (IS_WINDOWS ? String(a).toLowerCase() === String(b).toLowerCase() : a === b);

describe('probe mode', () => {
  afterEach(() => setBlockingProbes(null));

  it('may block in a plain Node process', () => {
    assert.equal(canBlock(), true);
  });

  it('can be forced for tests', () => {
    setBlockingProbes(false);
    assert.equal(canBlock(), false);
  });
});

describe('PATH lookup without where/which', () => {
  let dir;
  let savedPath;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-pathwalk-'));
    savedPath = process.env.PATH;
    process.env.PATH = dir + path.delimiter + (savedPath || '');
    clearBinaryLookupCache();
  });

  afterEach(() => {
    process.env.PATH = savedPath;
    clearBinaryLookupCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeCli(file) {
    const full = path.join(dir, file);
    fs.writeFileSync(full, IS_WINDOWS ? '@echo off\r\n' : '#!/bin/sh\n');
    if (!IS_WINDOWS) fs.chmodSync(full, 0o755);
    return full;
  }

  it('finds a CLI on PATH', () => {
    const cli = makeCli(IS_WINDOWS ? 'oa-fake-cli.cmd' : 'oa-fake-cli');
    assert.ok(same(whichBinary('oa-fake-cli', { allowWsl: false }), cli));
  });

  it('answers null for a name nothing on PATH provides', () => {
    assert.equal(whichBinary('oa-nothing-provides-this', { allowWsl: false }), null);
  });

  it('sees a CLI installed after the last lookup once the cache is cleared', () => {
    assert.equal(whichBinary('oa-late-cli', { allowWsl: false }), null);
    const cli = makeCli(IS_WINDOWS ? 'oa-late-cli.cmd' : 'oa-late-cli');
    clearBinaryLookupCache();
    assert.ok(same(whichBinary('oa-late-cli', { allowWsl: false }), cli));
  });

  it('skips a file Unix cannot execute, as which does', { skip: IS_WINDOWS }, () => {
    fs.writeFileSync(path.join(dir, 'oa-not-exec'), '#!/bin/sh\n', { mode: 0o644 });
    assert.equal(whereBinary('oa-not-exec', { PATH: dir }), null);
  });

  it('prefers the .cmd shim over npm\'s extensionless script', { skip: !IS_WINDOWS }, () => {
    makeCli('oa-shimmed');
    const cmd = makeCli('oa-shimmed.cmd');
    assert.ok(same(whereBinary('oa-shimmed', { PATH: dir }), cmd));
    assert.ok(same(whichBinary('oa-shimmed', { allowWsl: false }), cmd));
  });
});

describe('version probe that may not block', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-version-'));
    clearVersionCache();
  });

  afterEach(() => {
    setBlockingProbes(null);
    clearVersionCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('answers unknown at once, then the version once the probe has finished', async () => {
    setBlockingProbes(false);
    const inst = new Installer({ getEntry: () => null }, tmp);
    const cmd = `"${process.execPath}" --version`;

    assert.equal(inst._detectVersion('node', cmd), null);

    let version = null;
    for (let i = 0; i < 200 && !version; i++) {
      await new Promise((r) => setTimeout(r, 25));
      version = inst._detectVersion('node', cmd);
    }
    assert.equal(version, process.versions.node);
  });
});

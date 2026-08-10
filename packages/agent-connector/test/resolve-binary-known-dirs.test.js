const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveBinaryInKnownDirs, IS_WINDOWS } = require('../src/paths');

/**
 * The launcher resolves agent binaries through installer.which(), which was a
 * PATH lookup and nothing else. On Windows the Cursor/Amp/Hermes installers
 * edit the *registry* PATH, which an already-running process never inherits —
 * so `where cursor-agent` comes back empty for a perfectly good install, the
 * launcher calls it missing, and its terminal fallback then runs a bare
 * `cursor-agent login` that dies with "is not recognized". Every adapter had
 * grown its own filesystem search to cope; the launcher had none.
 */
describe('resolveBinaryInKnownDirs', () => {
  test('finds a binary in the agent\'s isolated runtime bin dir', () => {
    const dir = path.join(os.homedir(), '.openagents', 'runtimes', '__probe__', 'node_modules', '.bin');
    const name = `oa-test-${process.pid}`;
    const file = path.join(dir, IS_WINDOWS ? `${name}.cmd` : name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, '');
    try {
      assert.strictEqual(resolveBinaryInKnownDirs([name], '__probe__'), file);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  test('tries every alias, not just the first', () => {
    const dir = path.join(os.homedir(), '.openagents', 'runtimes', '__probe__', 'node_modules', '.bin');
    const name = `oa-alias-${process.pid}`;
    const file = path.join(dir, IS_WINDOWS ? `${name}.cmd` : name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, '');
    try {
      // Mirrors cursor: install.binary is "cursor-agent", the alias is "agent",
      // and on some layouts only the alias exists on disk.
      assert.strictEqual(resolveBinaryInKnownDirs(['oa-missing-name', name], '__probe__'), file);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  test('returns null rather than a path that is not there', () => {
    assert.strictEqual(resolveBinaryInKnownDirs([`oa-absent-${process.pid}`], '__probe__'), null);
  });

  test('is not fooled by a directory sharing the binary name', () => {
    const dir = path.join(os.homedir(), '.openagents', 'runtimes', '__probe__', 'node_modules', '.bin');
    const name = `oa-dir-${process.pid}`;
    const asDir = path.join(dir, name);
    fs.mkdirSync(asDir, { recursive: true });
    try {
      assert.strictEqual(resolveBinaryInKnownDirs([name], '__probe__'), null);
    } finally {
      fs.rmSync(asDir, { recursive: true, force: true });
    }
  });

  test('handles empty and missing input without throwing', () => {
    assert.strictEqual(resolveBinaryInKnownDirs([], 'cursor'), null);
    assert.strictEqual(resolveBinaryInKnownDirs(null, 'cursor'), null);
    assert.strictEqual(resolveBinaryInKnownDirs(['x'], undefined), null);
  });
});

/**
 * Cursor's Windows installer downloads the CLI with Invoke-WebRequest, and a
 * failed download is a NON-terminating error in PowerShell: the script prints
 * "Happy coding!" and exits 0, leaving an empty %LOCALAPPDATA%\cursor-agent\.
 * Observed directly — an "unexpected EOF or 0 bytes" IOException on line 22 of
 * their script, followed by the success banner. aider/amp/hermes already
 * verify-before-mark for exactly this; cursor was the one left out, so the
 * marker got written and the launcher offered a sign-in for a missing CLI.
 */
describe('cursor verify-before-mark', () => {
  const { Installer } = require('../src/installer');
  const inst = Object.create(Installer.prototype);

  test('reports no binary when the install left nothing behind', () => {
    inst._whichBinary = () => null;
    assert.strictEqual(inst._verifyCursorBinary(), null);
  });

  test('accepts a resolved binary that is really on disk', () => {
    const real = path.join(os.tmpdir(), `oa-cursor-${process.pid}`);
    fs.writeFileSync(real, '');
    inst._whichBinary = () => real;
    try {
      assert.deepStrictEqual(inst._verifyCursorBinary(), { path: real });
    } finally {
      fs.rmSync(real, { force: true });
    }
  });

  test('rejects a resolved path that no longer exists', () => {
    inst._whichBinary = () => path.join(os.tmpdir(), `oa-gone-${process.pid}`);
    assert.strictEqual(inst._verifyCursorBinary(), null);
  });

  test('the failure message names the cause and where it looked', () => {
    const msg = inst._cursorBinaryNotFoundMessage();
    assert.match(msg, /could not be found/);
    assert.match(msg, /exits 0 even when the download failed/);
    assert.match(msg, /cursor-agent/);
  });
});

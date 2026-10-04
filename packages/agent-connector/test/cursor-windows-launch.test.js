'use strict';

/**
 * Cursor on Windows. The install is cursor-agent.cmd → PowerShell →
 * cursor-agent.ps1 → `node.exe index.js`, and the adapter used to reach it
 * through `cmd.exe /c`. cmd.exe stops reading a command line at its first
 * newline, and every prompt carries one — the identity header ends in a blank
 * line — so the user's message and every flag after the prompt (--trust,
 * --force, --output-format …) never arrived. The CLI ran the header alone in
 * an untrusted directory and exited with "Workspace Trust Required", which the
 * chat showed as "No response generated".
 *
 * The adapter now finds the node.exe + index.js pair the way cursor-agent.ps1
 * does and starts node itself, so no shell reads the prompt.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CURSOR_MODULE = require.resolve('../src/adapters/cursor');
const { resolveCursorNodeEntry } = require('../src/adapters/cursor');

// cursor-agent.cmd as the 2026.10.01 Windows package ships it.
const CURSOR_AGENT_CMD = [
  '@echo off',
  'setlocal enabledelayedexpansion',
  'set "CURSOR_INVOKED_AS=%~nx0"',
  '',
  'REM Get the directory of this script',
  'set "SCRIPT_DIR=%~dp0"',
  'REM Remove trailing backslash',
  'if "%SCRIPT_DIR:~-1%"=="\\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"',
  '',
  '%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\\cursor-agent.ps1" %*',
  '',
].join('\n');

let root;

/** Lay down %LOCALAPPDATA%\cursor-agent as the installer leaves it. */
function install(versions, { complete = versions } = {}) {
  fs.writeFileSync(path.join(root, 'cursor-agent.cmd'), CURSOR_AGENT_CMD);
  fs.writeFileSync(path.join(root, 'cursor-agent.ps1'), '# launcher');
  for (const version of versions) {
    const dir = path.join(root, 'versions', version);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), '');
    if (complete.includes(version)) fs.writeFileSync(path.join(dir, 'node.exe'), '');
  }
  return path.join(root, 'cursor-agent.cmd');
}

function entryIn(version) {
  const dir = path.join(root, 'versions', version);
  return [path.join(dir, 'node.exe'), path.join(dir, 'index.js')];
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cursor-win-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('resolveCursorNodeEntry', () => {
  it('finds node.exe and index.js under versions, from the launcher beside it', () => {
    const bin = install(['2026.10.01-e373342']);
    assert.deepEqual(resolveCursorNodeEntry(bin), entryIn('2026.10.01-e373342'));
  });

  it('takes the newest version, by date and not by spelling', () => {
    // As text "2026.9.30" sorts after "2026.10.01".
    const bin = install(['2026.9.30-aaaaaaa', '2026.10.01-e373342', '2026.08.15-bbbbbbb']);
    assert.deepEqual(resolveCursorNodeEntry(bin), entryIn('2026.10.01-e373342'));
  });

  it('reads the timestamped version form too', () => {
    const bin = install(['2026.10.01-e373342', '2026.10.02-12-30-00-abc1234']);
    assert.deepEqual(resolveCursorNodeEntry(bin), entryIn('2026.10.02-12-30-00-abc1234'));
  });

  it('ignores a half-extracted download and anything that is not a version', () => {
    const bin = install(
      ['2026.10.01-e373342', '2026.10.05-fffffff', '.tmp-2026.10.09-e373342-1759'],
      { complete: ['2026.10.01-e373342', '.tmp-2026.10.09-e373342-1759'] },
    );
    assert.deepEqual(resolveCursorNodeEntry(bin), entryIn('2026.10.01-e373342'));
  });

  it('uses the pair beside the launcher when it sits in a version directory', () => {
    install(['2026.10.01-e373342']);
    const dir = path.join(root, 'versions', '2026.10.01-e373342');
    fs.writeFileSync(path.join(dir, 'cursor-agent.cmd'), CURSOR_AGENT_CMD);
    assert.deepEqual(
      resolveCursorNodeEntry(path.join(dir, 'cursor-agent.cmd')),
      entryIn('2026.10.01-e373342'),
    );
  });

  it('answers null for anything that is not that layout', () => {
    fs.writeFileSync(path.join(root, 'cursor-agent.cmd'), CURSOR_AGENT_CMD);
    assert.equal(resolveCursorNodeEntry(path.join(root, 'cursor-agent.cmd')), null);
    fs.mkdirSync(path.join(root, 'versions', 'notes'), { recursive: true });
    assert.equal(resolveCursorNodeEntry(path.join(root, 'cursor-agent.cmd')), null);
  });
});

describe('CursorAdapter on Windows', () => {
  /** The adapter module as it loads on Windows (IS_WINDOWS is read at load). */
  function loadAsWindows() {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    delete require.cache[CURSOR_MODULE];
    try {
      return require(CURSOR_MODULE);
    } finally {
      Object.defineProperty(process, 'platform', platform);
      delete require.cache[CURSOR_MODULE];
    }
  }

  const resolve = (Adapter, bin) =>
    Adapter.prototype._resolveToNodeCmd.call({ _findNodeBin: () => 'node' }, bin);

  it('starts node itself, so no shell reads the prompt', () => {
    const bin = install(['2026.10.01-e373342']);
    assert.deepEqual(resolve(loadAsWindows(), bin), entryIn('2026.10.01-e373342'));
  });

  it('the launcher is not an npm shim — without the lookup it fell to cmd.exe', () => {
    fs.writeFileSync(path.join(root, 'cursor-agent.cmd'), CURSOR_AGENT_CMD);
    assert.equal(resolve(loadAsWindows(), path.join(root, 'cursor-agent.cmd')), null);
  });

  it('still resolves an npm-style .cmd shim to its script', () => {
    const shim = path.join(root, 'agent.cmd');
    fs.writeFileSync(shim, '@"%dp0%\\node_modules\\pkg\\bin\\cli.js" %*\n');
    const got = resolve(loadAsWindows(), shim);
    assert.equal(got[0], 'node');
    assert.match(got[1], /cli\.js$/);
  });
});

'use strict';

/**
 * Aider-only post-install verification tests.
 *
 * Pins the "install command exited 0 but no runnable/genuine aider binary →
 * Launcher must NOT show installed" behavior, plus stale-marker reconciliation.
 * Verification is scoped to agentType === 'aider'; these tests also assert other
 * agent types keep the original "exit 0 → mark installed" behavior.
 *
 * No real install runs: install() stubs _execShell, installStreaming() mocks
 * child_process.spawn, and binary resolution is controlled via _whichBinary +
 * an isolated HOME so the on-disk candidate checks (~/.local/bin) are
 * deterministic.
 *
 * Run: node --test test/aider-install.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('node:events');
const cp = require('child_process');

const { Installer } = require('../src/installer');

const mockRegistry = {
  getEntry: (name) => {
    if (name === 'aider') {
      return {
        name: 'aider',
        install: {
          binary: 'aider',
          macos: 'curl -LsSf https://aider.chat/install.sh | sh',
          linux: 'curl -LsSf https://aider.chat/install.sh | sh',
          windows: 'powershell -c "irm https://aider.chat/install.ps1 | iex"',
        },
      };
    }
    // A non-npm "other agent" proving the non-aider path is unchanged.
    if (name === 'otherapp') {
      return {
        name: 'otherapp',
        install: { binary: 'otherapp', macos: 'echo install', linux: 'echo install', windows: 'echo install' },
      };
    }
    return null;
  },
};

let tmpDir;
let tmpHome;
let saved;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-inst-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-home-'));
  saved = { spawn: cp.spawn };
  for (const k of ['HOME', 'USERPROFILE', 'APPDATA', 'XDG_BIN_HOME', 'XDG_DATA_HOME', 'UV_TOOL_DIR']) {
    saved[k] = process.env[k];
    if (!['HOME', 'USERPROFILE'].includes(k)) delete process.env[k];
  }
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
  cp.spawn = saved.spawn;
  for (const k of ['HOME', 'USERPROFILE', 'APPDATA', 'XDG_BIN_HOME', 'XDG_DATA_HOME', 'UV_TOOL_DIR']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
});

function markerHas(name) {
  const f = path.join(tmpDir, 'installed_agents.json');
  if (!fs.existsSync(f)) return false;
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')).includes(name); } catch { return false; }
}

function mockSpawnExit(code) {
  cp.spawn = () => {
    const proc = new EventEmitter();
    const mkStream = () => { const e = new EventEmitter(); e.setEncoding = () => {}; return e; };
    proc.stdout = mkStream();
    proc.stderr = mkStream();
    proc.pid = 4321;
    setImmediate(() => proc.emit('close', code));
    return proc;
  };
}

// A real aider stub whose `--version` identifies itself as Aider.
function writeAiderBinary(dir) {
  const isWin = process.platform === 'win32';
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, isWin ? 'aider.exe' : 'aider');
  fs.writeFileSync(p, isWin ? 'aider\n' : '#!/bin/sh\necho "aider 0.50.0"\n');
  if (!isWin) fs.chmodSync(p, 0o755);
  return p;
}

// A same-named WRONG binary whose `--version` does NOT mention aider.
function writeWrongBinary(dir) {
  const isWin = process.platform === 'win32';
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, isWin ? 'aider.exe' : 'aider');
  fs.writeFileSync(p, isWin ? 'echo other\n' : '#!/bin/sh\necho "not-the-real-tool 9.9"\n');
  if (!isWin) fs.chmodSync(p, 0o755);
  return p;
}

// ---------------------------------------------------------------------------
// Verification failure → no marker
// ---------------------------------------------------------------------------

describe('Aider install — verification failure (no binary)', () => {
  it('install(): exit 0 but binary missing → throws, writes no marker', async () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._execShell = async () => 'install output';
    inst._whichBinary = () => null; // not on PATH; ~/.local/bin absent in tmpHome

    await assert.rejects(
      () => inst.install('aider'),
      /could not be located/,
    );
    assert.equal(markerHas('aider'), false);
  });

  it('installStreaming(): exit 0 but binary missing → rejects, no marker, no "Done"', async () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => null;
    mockSpawnExit(0);

    const out = [];
    await assert.rejects(
      () => inst.installStreaming('aider', (d) => out.push(d)),
      /could not be located/,
    );
    assert.equal(markerHas('aider'), false);
    assert.ok(!out.join('').includes('Done!'));
  });
});

// ---------------------------------------------------------------------------
// Wrong same-named package is rejected
// ---------------------------------------------------------------------------

describe('Aider install — rejects a same-named non-Aider binary', () => {
  // Skipped on Windows: the wrong binary is a written shell/node script whose
  // `--version` can't be executed there, so the verify can't read it back to
  // detect a non-Aider tool (the very thing this test exercises).
  it('install(): a binary whose --version is not Aider → verification fails', { skip: process.platform === 'win32' }, async () => {
    const wrong = writeWrongBinary(path.join(tmpHome, '.local', 'bin'));
    const inst = new Installer(mockRegistry, tmpDir);
    inst._execShell = async () => 'ok';
    inst._whichBinary = () => wrong; // resolves, but it's the wrong tool

    await assert.rejects(() => inst.install('aider'), /could not be located/);
    assert.equal(markerHas('aider'), false);
  });
});

// ---------------------------------------------------------------------------
// Verification success (binary resolved off PATH)
// ---------------------------------------------------------------------------

describe('Aider install — verification success', () => {
  it('install(): binary in ~/.local/bin (not on PATH) → marker + resolved path', async () => {
    const aiderPath = writeAiderBinary(path.join(tmpHome, '.local', 'bin'));
    const inst = new Installer(mockRegistry, tmpDir);
    inst._execShell = async () => 'install output';
    inst._whichBinary = () => null; // force the ~/.local/bin candidate

    const res = await inst.install('aider');
    assert.equal(res.success, true);
    assert.equal(markerHas('aider'), true);
    assert.ok(res.output.includes(`Aider CLI resolved: ${aiderPath}`), res.output);
  });

  it('installStreaming(): binary in ~/.local/bin → marker + "Done!"', async () => {
    const aiderPath = writeAiderBinary(path.join(tmpHome, '.local', 'bin'));
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => null;
    mockSpawnExit(0);

    const out = [];
    const res = await inst.installStreaming('aider', (d) => out.push(d));
    assert.equal(res.success, true);
    assert.equal(markerHas('aider'), true);
    const joined = out.join('');
    assert.ok(joined.includes(`Aider CLI resolved: ${aiderPath}`));
    assert.ok(joined.includes('Done!'));
  });

  it('install(): binary in the uv tools venv (not ~/.local/bin) → verified', async () => {
    // The real-world Windows failure: `uv tool install` left the executable in
    // its tools venv, not necessarily on ~/.local/bin. The Unix venv layout is
    // ~/.local/share/uv/tools/aider-chat/bin; we must still detect it.
    const isWin = process.platform === 'win32';
    const venvBin = isWin
      ? path.join(tmpHome, 'AppData', 'Roaming', 'uv', 'tools', 'aider-chat', 'Scripts')
      : path.join(tmpHome, '.local', 'share', 'uv', 'tools', 'aider-chat', 'bin');
    if (isWin) process.env.APPDATA = path.join(tmpHome, 'AppData', 'Roaming');
    const aiderPath = writeAiderBinary(venvBin);
    const inst = new Installer(mockRegistry, tmpDir);
    inst._execShell = async () => 'ok';
    inst._whichBinary = () => null;

    const res = await inst.install('aider');
    assert.equal(res.success, true);
    assert.equal(markerHas('aider'), true);
    assert.ok(res.output.includes(`Aider CLI resolved: ${aiderPath}`), res.output);
  });

  it('install(): respects XDG_BIN_HOME (installer\'s first-priority dir)', async () => {
    const xdgBin = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-xdg-'));
    process.env.XDG_BIN_HOME = xdgBin;
    const aiderPath = writeAiderBinary(xdgBin);
    try {
      const inst = new Installer(mockRegistry, tmpDir);
      inst._execShell = async () => 'ok';
      inst._whichBinary = () => null;
      const res = await inst.install('aider');
      assert.equal(res.success, true);
      assert.ok(res.output.includes(`Aider CLI resolved: ${aiderPath}`), res.output);
    } finally {
      delete process.env.XDG_BIN_HOME;
      try { fs.rmSync(xdgBin, { recursive: true, force: true }); } catch {}
    }
  });
});

// ---------------------------------------------------------------------------
// No impact on other agent types
// ---------------------------------------------------------------------------

describe('Aider install — no impact on other agent types', () => {
  it('install(): non-aider still marks installed on exit 0 without a binary', async () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._execShell = async () => 'ok';
    inst._whichBinary = () => null;

    const res = await inst.install('otherapp');
    assert.equal(res.success, true);
    assert.equal(markerHas('otherapp'), true);
    assert.ok(!String(res.output).includes('Aider CLI resolved'));
  });
});

// ---------------------------------------------------------------------------
// Stale-marker reconciliation
// ---------------------------------------------------------------------------

describe('Aider install status — historical marker reconciliation', () => {
  it('aider marker present but no real CLI → NOT installed, cli-missing, marker preserved', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._markInstalled('aider');
    inst._whichBinary = () => null;

    const info = inst.getInstallInfo('aider');
    assert.equal(info.installed, false);
    assert.equal(info.location, 'cli-missing');
    assert.equal(inst.isInstalled('aider'), false);
    assert.equal(markerHas('aider'), true, 'the historical marker must NOT be deleted');
  });

  it('aider marker AND real CLI present → installed (CLI wins)', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._markInstalled('aider');
    inst._whichBinary = () => '/usr/bin/aider';

    const info = inst.getInstallInfo('aider');
    assert.equal(info.installed, true);
    assert.equal(info.location, 'global');
    assert.equal(inst.isInstalled('aider'), true);
  });

  it('aider without marker but real CLI present → installed', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => '/usr/bin/aider';
    assert.equal(inst.getInstallInfo('aider').installed, true);
    assert.equal(markerHas('aider'), false);
  });

  it('non-aider marker present but no CLI → still installed via marker (UNCHANGED)', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._markInstalled('otherapp');
    inst._whichBinary = () => null;

    const info = inst.getInstallInfo('otherapp');
    assert.equal(info.installed, true);
    assert.equal(info.location, 'marker');
  });
});

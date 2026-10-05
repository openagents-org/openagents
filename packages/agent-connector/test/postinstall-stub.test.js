'use strict';

/**
 * An npm install that exits 0 without running the package's postinstall.
 *
 * opencode-ai ships a ~500 byte shell placeholder as its `bin` and has its
 * postinstall script swap the native binary in. With `ignore-scripts=true` in
 * the user's npmrc the script is skipped, npm still exits 0, and the installer
 * used to record that as installed — after which the agent failed on every
 * message, first with "No model is configured" (the model list cannot load
 * from a CLI that does not run) and then with an unexplained exit 1.
 *
 * Covers the placeholder detection itself and what install()/installStreaming()
 * do about one. No network and no real npm: the "install" plants the files npm
 * would have left, and the rebuild is stubbed.
 *
 * The installer scenarios run in a child process with a synthetic HOME —
 * paths.js reads HOME once at load, so the managed runtime prefix cannot be
 * redirected from inside this process.
 *
 * Run: node --test test/postinstall-stub.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { isPostinstallStub, isPostinstallStubOutput } = require('../src/postinstall-stub');

// Verbatim from opencode-ai@1.17.11 and @anthropic-ai/claude-code, installed
// with --ignore-scripts.
const OPENCODE_STUB = [
  'echo "Error: opencode-ai\'s postinstall script was not run." >&2',
  'echo "" >&2',
  'echo "This occurs when using --ignore-scripts during installation, or when using a" >&2',
  'echo "package manager like pnpm that does not run postinstall scripts by default." >&2',
  'echo "" >&2',
  'echo "To fix this, run the postinstall script manually:" >&2',
  'echo "  cd node_modules/opencode-ai && node postinstall.mjs" >&2',
  'echo "" >&2',
  'echo "Or reinstall opencode-ai without the --ignore-scripts flag." >&2',
  'exit 1',
  '',
].join('\n');
const CLAUDE_STUB = [
  'echo "Error: claude native binary not installed." >&2',
  'echo "" >&2',
  'echo "Either postinstall did not run (--ignore-scripts, some pnpm configs)" >&2',
  'echo "or the platform-native optional dependency was not downloaded" >&2',
  'echo "(--omit=optional)." >&2',
  'exit 1',
  '',
].join('\n');

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-stub-'));
});

afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

function write(rel, content) {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

describe('postinstall placeholder — detection', () => {
  it('recognizes the placeholders opencode-ai and claude-code ship', () => {
    assert.equal(isPostinstallStub(write('opencode.exe', OPENCODE_STUB)), true);
    assert.equal(isPostinstallStub(write('claude.exe', CLAUDE_STUB)), true);
  });

  it('does not mistake a real binary, an ordinary script or a missing file for one', () => {
    // Bigger than any placeholder, and it even carries the wording.
    const real = write('real.exe', Buffer.concat([Buffer.alloc(8192), Buffer.from(OPENCODE_STUB)]));
    assert.equal(isPostinstallStub(real), false);
    assert.equal(isPostinstallStub(write('opencode', '#!/bin/sh\necho 1.17.11\n')), false);
    assert.equal(isPostinstallStub(path.join(tmp, 'nope')), false);
    assert.equal(isPostinstallStub(null), false);
  });

  it('follows the symlink npm puts in node_modules/.bin', { skip: process.platform === 'win32' }, () => {
    const target = write('node_modules/opencode-ai/bin/opencode.exe', OPENCODE_STUB);
    const link = path.join(tmp, 'node_modules', '.bin', 'opencode');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link);
    assert.equal(isPostinstallStub(link), true);
  });

  it('follows an npm .cmd shim to the file it launches', () => {
    // What npm's cmd-shim writes for a bin with no shebang: global prefix
    // first, then a local node_modules/.bin.
    const head = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n';
    write('node_modules/opencode-ai/bin/opencode.exe', OPENCODE_STUB);
    const globalShim = write('opencode.cmd', `${head}"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*\r\n`);
    const localShim = write('node_modules/.bin/opencode.cmd', `${head}"%dp0%\\..\\opencode-ai\\bin\\opencode.exe"   %*\r\n`);
    assert.equal(isPostinstallStub(globalShim), true);
    assert.equal(isPostinstallStub(localShim), true);

    // The same shim in front of a real binary is not a placeholder.
    write('node_modules/opencode-ai/bin/opencode.exe', Buffer.alloc(8192));
    assert.equal(isPostinstallStub(globalShim), false);
  });

  it('recognizes the placeholder by what it prints, for a wrapper that hides the file', () => {
    assert.equal(isPostinstallStubOutput("Error: opencode-ai's postinstall script was not run."), true);
    assert.equal(isPostinstallStubOutput('Error: claude native binary not installed.'), true);
    assert.equal(isPostinstallStubOutput('1.17.11'), false);
    assert.equal(isPostinstallStubOutput('ProviderModelNotFoundError: model not found'), false);
    assert.equal(isPostinstallStubOutput(undefined), false);
  });
});

// ---------------------------------------------------------------------------
// Installer: exit 0 with a placeholder is not an install
// ---------------------------------------------------------------------------

const INSTALLER = path.join(__dirname, '..', 'src', 'installer.js');

/**
 * Run `body` in a child whose HOME is `tmp`, with an Installer for a registry
 * holding just opencode. `body` has: inst, calls (rebuild invocations), bin,
 * pkgDir, plant(content) — writes the package as npm would have — and STUB /
 * REAL contents; it must return a JSON-able value.
 */
function scenario(body) {
  const script = `
    const fs = require('fs'), path = require('path'), cp = require('child_process');
    const { EventEmitter } = require('events');
    const { Installer } = require(${JSON.stringify(INSTALLER)});
    const CMD = 'npm install -g opencode-ai@1.17.11';
    const registry = { getEntry: (n) => (n === 'opencode'
      ? { name: 'opencode', label: 'OpenCode', install: { binary: 'opencode', macos: CMD, linux: CMD, windows: CMD } }
      : null) };
    const cfg = path.join(process.env.HOME, '.openagents');
    const inst = new Installer(registry, cfg);
    const prefix = path.join(cfg, 'runtimes', 'opencode');
    const pkgDir = path.join(prefix, 'node_modules', 'opencode-ai');
    const bin = path.join(pkgDir, 'bin', 'opencode.exe');
    const STUB = ${JSON.stringify(OPENCODE_STUB)};
    const REAL = Buffer.alloc(8192);
    const plant = (content) => {
      fs.mkdirSync(path.dirname(bin), { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'opencode-ai', version: '1.17.11', bin: { opencode: './bin/opencode.exe' } }));
      fs.writeFileSync(bin, content);
    };
    const marked = () => {
      try { return JSON.parse(fs.readFileSync(path.join(cfg, 'installed_agents.json'), 'utf-8')).includes('opencode'); }
      catch { return false; }
    };
    // The npm run itself: plants what it would have left, exits 0.
    const npmLeaves = (content) => {
      inst._execShell = async () => { plant(content); return 'added 3 packages'; };
      cp.spawn = () => {
        const proc = new EventEmitter();
        const mk = () => { const e = new EventEmitter(); e.setEncoding = () => {}; return e; };
        proc.stdout = mk(); proc.stderr = mk(); proc.pid = 4321;
        setImmediate(() => { plant(content); proc.emit('close', 0); });
        return proc;
      };
    };
    const calls = [];
    const rebuild = (fn) => { inst._rebuildWithScripts = async (...a) => { calls.push(a); return fn(); }; };
    (async () => { ${body} })().then(
      (v) => process.stdout.write(JSON.stringify(v)),
      (e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); },
    );
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf-8',
    env: { ...process.env, HOME: tmp, USERPROFILE: tmp },
  });
  return JSON.parse(out);
}

describe('postinstall placeholder — install()', () => {
  it('runs the skipped script for that one package, then records the install', () => {
    const r = scenario(`
      npmLeaves(STUB);
      rebuild(() => { fs.writeFileSync(bin, REAL); return 'rebuilt dependencies successfully'; });
      const res = await inst.install('opencode');
      return { success: res.success, calls, prefix, marked: marked(), size: fs.statSync(bin).size };
    `);
    assert.equal(r.success, true);
    assert.deepEqual(r.calls, [['opencode-ai', r.prefix]]);
    assert.equal(r.marked, true);
    assert.equal(r.size, 8192, 'the real binary replaced the placeholder');
  });

  it('fails the install, and takes the package back out, when the script cannot be run', () => {
    const r = scenario(`
      npmLeaves(STUB);
      rebuild(() => { throw new Error("sh: 1: node: not found"); });
      let message = null;
      try { await inst.install('opencode'); } catch (e) { message = e.message; }
      return { message, marked: marked(), pkgLeft: fs.existsSync(pkgDir) };
    `);
    assert.match(r.message, /OpenCode was downloaded, but its setup could not be finished/);
    assert.match(r.message, /ignore-scripts=true/);
    assert.match(r.message, /node: not found/, 'npm\'s own output is carried into the message');
    assert.equal(r.marked, false, 'a placeholder is never recorded as installed');
    assert.equal(r.pkgLeft, false, 'nothing is left behind that reads as installed');
  });

  it('still fails when the rebuild reports success but the placeholder is still there', () => {
    const r = scenario(`
      npmLeaves(STUB);
      rebuild(() => 'rebuilt dependencies successfully');
      let message = null;
      try { await inst.install('opencode'); } catch (e) { message = e.message; }
      return { message, marked: marked() };
    `);
    assert.match(r.message, /could not be finished/);
    assert.equal(r.marked, false);
  });

  it('leaves an install whose postinstall did run alone', () => {
    const r = scenario(`
      npmLeaves(REAL);
      rebuild(() => { throw new Error('must not be called'); });
      const res = await inst.install('opencode');
      return { success: res.success, calls, marked: marked() };
    `);
    assert.equal(r.success, true);
    assert.deepEqual(r.calls, []);
    assert.equal(r.marked, true);
  });
});

describe('postinstall placeholder — installStreaming()', () => {
  it('repairs before reporting Done', () => {
    const r = scenario(`
      npmLeaves(STUB);
      rebuild(() => { fs.writeFileSync(bin, REAL); return 'rebuilt dependencies successfully'; });
      let out = '';
      const res = await inst.installStreaming('opencode', (d) => { out += d; });
      return { success: res.success, calls: calls.length, marked: marked(), out };
    `);
    assert.equal(r.success, true);
    assert.equal(r.calls, 1);
    assert.equal(r.marked, true);
    assert.match(r.out, /opencode-ai's postinstall script did not run/);
    assert.ok(
      r.out.indexOf('OpenCode CLI is in place') < r.out.indexOf('Done! opencode is now installed.'),
      'Done is only said once the real binary is there',
    );
  });

  it('rejects, with no marker and no Done, when the repair fails', () => {
    const r = scenario(`
      npmLeaves(STUB);
      rebuild(() => { throw new Error('npm error command failed'); });
      let out = '', message = null;
      try { await inst.installStreaming('opencode', (d) => { out += d; }); } catch (e) { message = e.message; }
      return { message, marked: marked(), pkgLeft: fs.existsSync(pkgDir), out };
    `);
    assert.match(r.message, /could not be finished/);
    assert.equal(r.marked, false);
    assert.equal(r.pkgLeft, false);
    assert.ok(!r.out.includes('Done!'));
    assert.match(r.out, /could not be finished/, 'the reason reaches the install log too');
  });

  it('leaves an install whose postinstall did run alone', () => {
    const r = scenario(`
      npmLeaves(REAL);
      rebuild(() => { throw new Error('must not be called'); });
      let out = '';
      const res = await inst.installStreaming('opencode', (d) => { out += d; });
      return { success: res.success, calls, marked: marked(), out };
    `);
    assert.equal(r.success, true);
    assert.deepEqual(r.calls, []);
    assert.equal(r.marked, true);
    assert.ok(!r.out.includes('postinstall'));
  });
});

describe('postinstall placeholder — finishNpmInstall(), for a caller that ran npm itself', () => {
  it('answers null for a real CLI, repairs a placeholder, and explains one it cannot repair', () => {
    const r = scenario(`
      plant(REAL);
      rebuild(() => { throw new Error('must not be called'); });
      const real = await inst.finishNpmInstall('opencode');

      plant(STUB);
      rebuild(() => { fs.writeFileSync(bin, REAL); return ''; });
      let out = '';
      const repaired = await inst.finishNpmInstall('opencode', (d) => { out += d; });

      plant(STUB);
      rebuild(() => '');
      const broken = await inst.finishNpmInstall('opencode');
      return { real, repaired, out, broken, pkgLeft: fs.existsSync(pkgDir), unknown: await inst.finishNpmInstall('nope') };
    `);
    assert.equal(r.real, null);
    assert.equal(r.repaired, null);
    assert.match(r.out, /OpenCode CLI is in place/);
    assert.match(r.broken, /could not be finished/);
    assert.equal(r.pkgLeft, false);
    assert.equal(r.unknown, null, 'an agent that is not an npm install has nothing to check');
  });
});

describe('postinstall placeholder — the rebuild command', () => {
  it('names the one package and re-enables scripts on the command line only', () => {
    const r = scenario(`
      let cmd = null;
      inst._resolveNodeNpmCli = () => null; // the shell-string fallback shows the argv
      inst._execShell = async (c) => { cmd = c; return ''; };
      await inst._rebuildWithScripts('opencode-ai', prefix);
      return { cmd, prefix };
    `);
    assert.ok(r.cmd.includes(`rebuild opencode-ai --prefix "${r.prefix}" --ignore-scripts=false`), r.cmd);
  });
});

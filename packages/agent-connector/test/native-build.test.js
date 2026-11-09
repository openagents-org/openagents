'use strict';

/**
 * An npm install that exits 0 without the per-platform package holding the
 * CLI's native build.
 *
 * @openai/codex, @anthropic-ai/claude-code and opencode-ai keep the real
 * executable in one optional dependency per platform. npm drops an optional
 * dependency whose download fails without failing the install (and skips them
 * all under omit=optional). Reported from a Windows machine (2026-11-07):
 * Codex failed every test with "Missing optional dependency
 * @openai/codex-win32-x64", and Claude Code's install was blamed on
 * ignore-scripts — "postinstall script did not run" — when the script had run
 * and found no binary to copy.
 *
 * No network and no real npm: the "install" plants the files npm would have
 * left, and the npm calls are stubbed. Installer scenarios run in a child
 * process with a synthetic HOME (paths.js reads HOME once at load).
 *
 * Run: node --test test/native-build.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { nativeBuildFor } = require('../src/native-build');
const { classifyFailure, buildGuidance, CODE } = require('../src/probe');

const OSES = ['linux', 'darwin', 'win32'];
const CPUS = ['x64', 'arm64'];

// The optionalDependencies the real packages list (codex 0.167.0, claude-code
// 2.1.319, opencode-ai 1.17.11).
function codexOptional(version = '0.167.0') {
  const o = {};
  for (const p of OSES) for (const c of CPUS) o[`@openai/codex-${p}-${c}`] = `npm:@openai/codex@${version}-${p}-${c}`;
  return o;
}
function claudeOptional(version = '2.1.319') {
  const o = {};
  for (const p of OSES) for (const c of CPUS) o[`@anthropic-ai/claude-code-${p}-${c}`] = version;
  for (const c of CPUS) o[`@anthropic-ai/claude-code-linux-${c}-musl`] = version;
  return o;
}
function opencodeOptional(version = '1.17.11') {
  const o = {};
  for (const p of ['linux', 'darwin', 'windows']) {
    for (const c of CPUS) o[`opencode-${p}-${c}`] = version;
    o[`opencode-${p}-x64-baseline`] = version;
  }
  for (const c of CPUS) o[`opencode-linux-${c}-musl`] = version;
  return o;
}

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-native-')); });
afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

function writePkg(dir, json) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(json));
  return dir;
}

describe('nativeBuildFor — which package holds the native build', () => {
  it('names codex\'s build with its npm: alias, and finds it hoisted or nested', () => {
    const prefix = path.join(tmp, 'p');
    const pkgDir = writePkg(path.join(prefix, 'node_modules', '@openai', 'codex'),
      { name: '@openai/codex', version: '0.167.0', optionalDependencies: codexOptional() });
    const at = { platform: 'win32', arch: 'x64', musl: false };

    const missing = nativeBuildFor(pkgDir, at);
    assert.equal(missing.name, '@openai/codex-win32-x64');
    assert.equal(missing.spec, 'npm:@openai/codex@0.167.0-win32-x64');
    assert.equal(missing.installed, null);
    assert.equal(missing.target, 'win32-x64');

    // Hoisted next to the wrapper, where npm normally puts it.
    const hoisted = writePkg(path.join(prefix, 'node_modules', '@openai', 'codex-win32-x64'), { name: '@openai/codex' });
    assert.equal(nativeBuildFor(pkgDir, at).installed, hoisted);
    fs.rmSync(hoisted, { recursive: true });

    // Nested inside the wrapper.
    const nested = writePkg(path.join(pkgDir, 'node_modules', '@openai', 'codex-win32-x64'), { name: '@openai/codex' });
    assert.equal(nativeBuildFor(pkgDir, at).installed, nested);
  });

  it('does not accept another architecture\'s build', () => {
    const prefix = path.join(tmp, 'p');
    const pkgDir = writePkg(path.join(prefix, 'node_modules', '@openai', 'codex'),
      { name: '@openai/codex', version: '0.167.0', optionalDependencies: codexOptional() });
    writePkg(path.join(prefix, 'node_modules', '@openai', 'codex-win32-arm64'), { name: '@openai/codex' });
    assert.equal(nativeBuildFor(pkgDir, { platform: 'win32', arch: 'x64', musl: false }).installed, null);
  });

  it('picks claude-code\'s musl build on a musl Linux, and only that one', () => {
    const prefix = path.join(tmp, 'p');
    const pkgDir = writePkg(path.join(prefix, 'node_modules', '@anthropic-ai', 'claude-code'),
      { name: '@anthropic-ai/claude-code', version: '2.1.319', optionalDependencies: claudeOptional() });
    writePkg(path.join(prefix, 'node_modules', '@anthropic-ai', 'claude-code-linux-x64'), { name: 'x' });
    const musl = nativeBuildFor(pkgDir, { platform: 'linux', arch: 'x64', musl: true });
    assert.equal(musl.name, '@anthropic-ai/claude-code-linux-x64-musl');
    assert.equal(musl.installed, null, 'install.cjs would not use the glibc build there');
    assert.equal(musl.target, 'linux-x64-musl');
    assert.ok(nativeBuildFor(pkgDir, { platform: 'linux', arch: 'x64', musl: false }).installed);
  });

  it('calls win32 "windows" for opencode-ai and takes its baseline build as well', () => {
    const prefix = path.join(tmp, 'p');
    const pkgDir = writePkg(path.join(prefix, 'node_modules', 'opencode-ai'),
      { name: 'opencode-ai', version: '1.17.11', optionalDependencies: opencodeOptional() });
    const at = { platform: 'win32', arch: 'x64', musl: false };
    assert.equal(nativeBuildFor(pkgDir, at).name, 'opencode-windows-x64');
    writePkg(path.join(prefix, 'node_modules', 'opencode-windows-x64-baseline'), { name: 'x' });
    assert.ok(nativeBuildFor(pkgDir, at).installed, 'its postinstall accepts the baseline build');
  });

  it('has nothing to check for a package it does not know, or a platform the package does not list', () => {
    const prefix = path.join(tmp, 'p');
    // gemini-cli lists optional node-pty builds it can run without.
    const gemini = writePkg(path.join(prefix, 'node_modules', '@google', 'gemini-cli'), {
      name: '@google/gemini-cli', optionalDependencies: { '@lydell/node-pty-win32-x64': '1.1.0' },
    });
    assert.equal(nativeBuildFor(gemini, { platform: 'win32', arch: 'x64', musl: false }), null);
    const codex = writePkg(path.join(prefix, 'node_modules', '@openai', 'codex'),
      { name: '@openai/codex', optionalDependencies: codexOptional() });
    assert.equal(nativeBuildFor(codex, { platform: 'freebsd', arch: 'x64', musl: false }), null);
    // An older codex with no platform packages at all (the JS-only builds).
    const old = writePkg(path.join(tmp, 'q', 'node_modules', '@openai', 'codex'), { name: '@openai/codex', version: '0.1.0' });
    assert.equal(nativeBuildFor(old, { platform: 'win32', arch: 'x64', musl: false }), null);
    assert.equal(nativeBuildFor(path.join(tmp, 'nope')), null);
  });
});

// ---------------------------------------------------------------------------
// Installer: exit 0 without the native build is not an install
// ---------------------------------------------------------------------------

const INSTALLER = path.join(__dirname, '..', 'src', 'installer.js');
const NATIVE = path.join(__dirname, '..', 'src', 'native-build.js');
const CLAUDE_STUB = [
  'echo "Error: claude native binary not installed." >&2',
  'echo "" >&2',
  'echo "Either postinstall did not run (--ignore-scripts, some pnpm configs)" >&2',
  'echo "or the platform-native optional dependency was not downloaded" >&2',
  'echo "(--omit=optional)." >&2',
  'exit 1',
  '',
].join('\n');

// opencode-ai 1.17.11's bin/opencode.exe as published.
const OPENCODE_STUB = [
  'echo "Error: opencode-ai\'s postinstall script was not run." >&2',
  'echo "" >&2',
  'echo "This occurs when using --ignore-scripts during installation, or when using a" >&2',
  'echo "package manager like pnpm that does not run postinstall scripts by default." >&2',
  'exit 1',
  '',
].join('\n');

const AGENTS = {
  codex: { pkg: '@openai/codex', label: 'Codex', bin: 'bin/codex.js', optional: codexOptional(), stub: null },
  claude: { pkg: '@anthropic-ai/claude-code', label: 'Claude Code', bin: 'bin/claude.exe', optional: claudeOptional(), stub: CLAUDE_STUB },
  opencode: { pkg: 'opencode-ai', label: 'OpenCode', bin: 'bin/opencode.exe', optional: opencodeOptional(), stub: OPENCODE_STUB },
};

/**
 * Run `body` in a child whose HOME is `tmp`, with an Installer for codex,
 * claude or opencode. `body` has: inst, AGENT (the agent type), pkgDir, prefix, build()
 * (what nativeBuildFor says now), plantWrapper(), plantNative() — where npm
 * hoists the build — and nativeCalls / rebuildCalls, the stubbed npm runs.
 */
function scenario(agent, body, extraEnv = {}) {
  const a = AGENTS[agent];
  const script = `
    const fs = require('fs'), path = require('path'), cp = require('child_process');
    const { EventEmitter } = require('events');
    const { Installer } = require(${JSON.stringify(INSTALLER)});
    const { nativeBuildFor } = require(${JSON.stringify(NATIVE)});
    const AGENT = ${JSON.stringify(agent)};
    const PKG = ${JSON.stringify(a.pkg)};
    const CMD = 'npm install -g ' + PKG;
    const LABEL = ${JSON.stringify(a.label)};
    const registry = { getEntry: (n) => (n === AGENT
      ? { name: AGENT, label: LABEL, install: { binary: AGENT, macos: CMD, linux: CMD, windows: CMD } }
      : null) };
    const cfg = path.join(process.env.HOME, '.openagents');
    const inst = new Installer(registry, cfg);
    const prefix = path.join(cfg, 'runtimes', AGENT);
    const pkgDir = path.join(prefix, 'node_modules', ...PKG.split('/'));
    const binRel = ${JSON.stringify(a.bin)};
    const bin = path.join(pkgDir, binRel);
    const REAL = Buffer.alloc(8192);
    const STUB = ${JSON.stringify(a.stub)};
    const plantWrapper = () => {
      fs.mkdirSync(path.dirname(bin), { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
        name: PKG, version: '1.0.0', bin: { [AGENT]: binRel }, optionalDependencies: ${JSON.stringify(a.optional)},
      }));
      // codex's bin is a JS launcher; claude-code's and opencode-ai's are the
      // placeholder until their postinstall copies the native binary over it.
      fs.writeFileSync(bin, STUB || REAL);
    };
    const build = () => nativeBuildFor(pkgDir);
    const plantNative = () => {
      const b = build();
      const dir = path.join(prefix, 'node_modules', ...b.name.split('/'));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: b.name }));
      return dir;
    };
    const marked = () => {
      try { return JSON.parse(fs.readFileSync(path.join(cfg, 'installed_agents.json'), 'utf-8')).includes(AGENT); }
      catch { return false; }
    };
    // The npm run itself: plants the wrapper (and the build, when withNative), exits 0.
    const npmLeaves = (withNative) => {
      const leave = () => { plantWrapper(); if (withNative) plantNative(); };
      inst._execShell = async () => { leave(); return 'added 1 package'; };
      cp.spawn = () => {
        const proc = new EventEmitter();
        const mk = () => { const e = new EventEmitter(); e.setEncoding = () => {}; return e; };
        proc.stdout = mk(); proc.stderr = mk(); proc.pid = 4321;
        setImmediate(() => { leave(); proc.emit('close', 0); });
        return proc;
      };
    };
    const nativeCalls = [], rebuildCalls = [];
    const nativeInstall = (fn) => { inst._installNativeBuildPackage = async (...a) => { nativeCalls.push(a[0].name + '@' + a[0].spec); return fn(); }; };
    const rebuild = (fn) => { inst._rebuildWithScripts = async (...a) => { rebuildCalls.push(a[0]); return fn(); }; };
    rebuild(() => { throw new Error('rebuild must not be called'); });
    (async () => { ${body} })().then(
      (v) => process.stdout.write(JSON.stringify(v)),
      (e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); },
    );
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf-8',
    env: { ...process.env, OPENAGENTS_NO_SCRIPT_REPAIR: '', HOME: tmp, USERPROFILE: tmp, ...extraEnv },
  });
  return JSON.parse(out);
}

describe('native build left out — codex', () => {
  it('installs the build on its own, then records the install', () => {
    const r = scenario('codex', `
      npmLeaves(false);
      nativeInstall(() => { plantNative(); return 'added 1 package'; });
      const res = await inst.install('codex');
      return { success: res.success, output: res.output, nativeCalls, marked: marked(), expected: build().name + '@' + build().spec, installed: !!build().installed };
    `);
    assert.equal(r.success, true);
    assert.deepEqual(r.nativeCalls, [r.expected]);
    assert.match(r.expected, /^@openai\/codex-[a-z0-9]+-[a-z0-9]+@npm:@openai\/codex@0\.167\.0-/);
    assert.equal(r.installed, true);
    assert.equal(r.marked, true);
    assert.match(r.output, /npm did not install @openai\/codex-\S+, the package that holds Codex's native build/);
    assert.match(r.output, /is in place/);
  });

  it('fails with the reason, and takes the package back out, when the build cannot be installed', () => {
    const r = scenario('codex', `
      npmLeaves(false);
      nativeInstall(() => { throw new Error('npm error code ECONNRESET\\nnpm error network aborted'); });
      let message = null;
      try { await inst.install('codex'); } catch (e) { message = e.message; }
      return { message, marked: marked(), pkgLeft: fs.existsSync(pkgDir) };
    `);
    assert.match(r.message, /Codex was downloaded, but not its native build for this computer/);
    assert.match(r.message, /optional dependency of @openai\/codex/);
    assert.match(r.message, /omit=optional/);
    assert.match(r.message, /ECONNRESET/, 'npm\'s own output is carried into the message');
    assert.doesNotMatch(r.message, /ignore-scripts/);
    assert.equal(r.marked, false);
    assert.equal(r.pkgLeft, false, 'nothing is left behind that reads as installed');
  });

  it('leaves a complete install alone', () => {
    const r = scenario('codex', `
      npmLeaves(true);
      nativeInstall(() => { throw new Error('must not be called'); });
      const res = await inst.install('codex');
      return { success: res.success, nativeCalls, marked: marked() };
    `);
    assert.equal(r.success, true);
    assert.deepEqual(r.nativeCalls, []);
    assert.equal(r.marked, true);
  });

  it('restores the build before installStreaming() says Done', () => {
    const r = scenario('codex', `
      npmLeaves(false);
      nativeInstall(() => { plantNative(); return ''; });
      let out = '';
      const res = await inst.installStreaming('codex', (d) => { out += d; });
      return { success: res.success, out, marked: marked() };
    `);
    assert.equal(r.success, true);
    assert.equal(r.marked, true);
    assert.ok(r.out.indexOf('is in place') < r.out.indexOf('Done! codex is now installed.'));
  });

  it('is checked for a caller that ran npm itself (the launcher\'s pinned installs)', () => {
    const r = scenario('codex', `
      plantWrapper();
      nativeInstall(() => '');  // reports success but leaves nothing
      const broken = await inst.finishNpmInstall('codex');
      plantWrapper(); plantNative();
      const fine = await inst.finishNpmInstall('codex');
      return { broken, fine };
    `);
    assert.match(r.broken, /not its native build/);
    assert.equal(r.fine, null);
  });
});

describe('native build left out — claude-code', () => {
  it('installs the build, then re-runs the script, and does not blame ignore-scripts', () => {
    const r = scenario('claude', `
      npmLeaves(false);
      nativeInstall(() => { plantNative(); return ''; });
      rebuild(() => { fs.writeFileSync(bin, REAL); return 'rebuilt dependencies successfully'; });
      const res = await inst.install('claude');
      return { success: res.success, output: res.output, nativeCalls: nativeCalls.length, rebuildCalls, marked: marked(), size: fs.statSync(bin).size };
    `);
    assert.equal(r.success, true);
    assert.equal(r.nativeCalls, 1);
    assert.deepEqual(r.rebuildCalls, ['@anthropic-ai/claude-code']);
    assert.equal(r.size, 8192, 'the real binary replaced the placeholder');
    assert.equal(r.marked, true);
    assert.match(r.output, /npm did not install @anthropic-ai\/claude-code-/);
    assert.match(r.output, /install script ran before its native build was there/);
    assert.doesNotMatch(r.output, /ignore-scripts\)/);
  });

  it('says the script did not place the binary when re-running it does not help', () => {
    const r = scenario('claude', `
      npmLeaves(false);
      nativeInstall(() => { plantNative(); return ''; });
      rebuild(() => 'rebuilt dependencies successfully');
      let message = null;
      try { await inst.install('claude'); } catch (e) { message = e.message; }
      return { message, marked: marked() };
    `);
    assert.match(r.message, /install script did not put its native build in place/);
    assert.doesNotMatch(r.message, /ignore-scripts=true/);
    assert.equal(r.marked, false);
  });

  it('still reads a placeholder next to a present build as skipped scripts', () => {
    const r = scenario('claude', `
      npmLeaves(true);
      nativeInstall(() => { throw new Error('must not be called'); });
      rebuild(() => { fs.writeFileSync(bin, REAL); return ''; });
      const res = await inst.install('claude');
      return { success: res.success, output: res.output, nativeCalls: nativeCalls.length };
    `);
    assert.equal(r.success, true);
    assert.equal(r.nativeCalls, 0);
    assert.match(r.output, /npm skipped @anthropic-ai\/claude-code's install script \(ignore-scripts\)/);
  });
});

describe('native build left out — opencode-ai', () => {
  // opencode-ai 1.17.11's postinstall, when npm left the build out, installs
  // it into a temp directory, copies the binary over bin/opencode.exe and
  // deletes the directory: the package is gone and the CLI works.
  it('leaves alone an install whose postinstall fetched the build itself — even with the registry out of reach', () => {
    const r = scenario('opencode', `
      inst._execShell = async () => { plantWrapper(); fs.writeFileSync(bin, REAL); return 'added 1 package'; };
      nativeInstall(() => { throw new Error('npm error code ECONNRESET'); });
      const res = await inst.install('opencode');
      return { success: res.success, nativeCalls, marked: marked(), pkgLeft: fs.existsSync(pkgDir), installed: build().installed };
    `);
    assert.equal(r.success, true);
    assert.deepEqual(r.nativeCalls, [], 'no second install of a build that is already in place');
    assert.equal(r.installed, null, 'the platform package really is absent');
    assert.equal(r.marked, true);
    assert.equal(r.pkgLeft, true, 'the working install is not removed');
  });

  it('still restores the build while the placeholder stands', () => {
    const r = scenario('opencode', `
      npmLeaves(false);
      nativeInstall(() => { plantNative(); return ''; });
      rebuild(() => { fs.writeFileSync(bin, REAL); return ''; });
      const res = await inst.install('opencode');
      return { success: res.success, nativeCalls: nativeCalls.length, rebuildCalls, size: fs.statSync(bin).size };
    `);
    assert.equal(r.success, true);
    assert.equal(r.nativeCalls, 1);
    assert.deepEqual(r.rebuildCalls, ['opencode-ai']);
    assert.equal(r.size, 8192);
  });
});

describe('native build left out — the npm command', () => {
  it('installs that one package, optional dependencies on, without saving it — an argv, not a shell string', () => {
    const r = scenario('codex', `
      plantWrapper();
      let call = null;
      inst._resolveNodeNpmCli = () => null; // no bundled npm: falls back to the npm on PATH
      inst._execShell = async () => { throw new Error('must not build a shell string'); };
      inst._execFileForTest = (file, args, opts, cb) => { call = { file, args, opts }; cb(null, 'ok', ''); };
      const out = await inst._installNativeBuildPackage(build(), prefix);
      return { call, prefix, out, expected: build().name + '@' + build().spec };
    `);
    assert.equal(r.out, 'ok');
    assert.deepEqual(r.call.args.slice(0, 6), ['install', r.expected, '--prefix', r.prefix, '--no-save', '--include=optional']);
    assert.equal(r.call.opts.windowsHide, true);
    assert.equal(r.call.opts.cwd, r.prefix);
    if (process.platform !== 'win32') assert.ok(!r.call.opts.shell, 'no shell off Windows');
  });

  it('uses the registry the install itself used (the mainland mirror), and none where the user chose one', () => {
    const body = `
      plantWrapper();
      let call = null;
      inst._resolveNodeNpmCli = () => null;
      inst._execFileForTest = (file, args, opts, cb) => { call = { args }; cb(null, 'ok', ''); };
      await inst._installNativeBuildPackage(build(), prefix);
      return call.args;
    `;
    const cn = scenario('codex', body, { OPENAGENTS_DOWNLOAD_REGION: 'cn', npm_config_registry: '' });
    const i = cn.indexOf('--registry');
    assert.ok(i > 0, JSON.stringify(cn));
    assert.match(cn[i + 1], /npmmirror\.com/);
    const own = scenario('codex', body, { OPENAGENTS_DOWNLOAD_REGION: 'cn', npm_config_registry: 'https://npm.corp.example' });
    assert.equal(own.includes('--registry'), false, 'the user\'s own registry is left to npm');
    const global = scenario('codex', body, { OPENAGENTS_DOWNLOAD_REGION: 'global', npm_config_registry: '' });
    assert.equal(global.includes('--registry'), false);
  });
});

describe('probe — a CLI missing its native build', () => {
  it('reads codex\'s and claude-code\'s wording as an incomplete install, with a reinstall next step', () => {
    const codex = [
      'file:///C:/Users/IT%20GURU/.openagents/runtimes/codex/node_modules/@openai/codex/bin/codex.js:108',
      'throw new Error(',
      '^',
      'Error: Missing optional dependency @openai/codex-win32-x64. Reinstall Codex: npm install -g @openai/codex@latest',
    ].join('\n');
    assert.equal(classifyFailure(codex, {}), CODE.INSTALL_INCOMPLETE);
    assert.equal(classifyFailure(CLAUDE_STUB.replace(/echo "|" >&2/g, ''), {}), CODE.INSTALL_INCOMPLETE);
    // A timed-out run that printed it says so too, not "waiting for input".
    assert.equal(classifyFailure(codex, { timedOut: true }), CODE.INSTALL_INCOMPLETE);

    const guidance = buildGuidance(CODE.INSTALL_INCOMPLETE,
      { name: 'codex', label: 'Codex', install: { linux: 'npm install -g @openai/codex', macos: 'npm install -g @openai/codex', windows: 'npm install -g @openai/codex' } }, {}).join('\n');
    assert.match(guidance, /Codex is installed, but not completely/);
    assert.match(guidance, /Reinstall Codex from the launcher's Install page/);
    assert.match(guidance, /npm install -g @openai\/codex/);
  });
});

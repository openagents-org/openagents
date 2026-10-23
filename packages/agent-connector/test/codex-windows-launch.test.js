'use strict';

/**
 * Codex launch on a profile folder cmd.exe can't parse.
 *
 * The adapter used to hand its npm `.cmd` shim to cmd.exe (shell: true). cmd
 * rebuilt one unquoted command line from it, so a profile folder with a space
 * (`C:\Users\Windows 用户`) was cut at the space and every message failed with
 * "'C:\Users\Windows' 不是内部或外部命令", shown in chat as GBK mojibake. A
 * missing working folder failed the same spawn as
 * "spawn C:\Windows\system32\cmd.exe ENOENT".
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CodexAdapter = require('../src/adapters/codex');

const IS_WINDOWS = process.platform === 'win32';

function bare(overrides = {}) {
  return Object.assign(Object.create(CodexAdapter.prototype), {
    _log: () => {},
    _channelProcesses: {},
    _channelThreads: {},
    _saveSessions: () => {},
    _stoppedBeforeStart: () => false,
    _stopRequestedDuringTurn: () => false,
    sendThinking: async () => {},
    sendStatus: async () => {},
  }, overrides);
}

describe('CodexAdapter._resolveExec', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex shim 用户 '));
  });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  // The shim's `%dp0%\..\x.js` is a Windows path; only Windows resolves it.
  it('runs an npm .cmd shim through node, with no shell', { skip: !IS_WINDOWS }, () => {
    const shim = path.join(dir, 'codex.cmd');
    fs.writeFileSync(shim, '@ECHO off\r\n"%_prog%"  "%dp0%\\..\\@openai\\codex\\bin\\codex.js" %*\r\n');
    const r = bare()._resolveExec(shim, true);
    assert.equal(r.shell, false);
    assert.deepEqual(r.args, [path.resolve(dir, '..', '@openai', 'codex', 'bin', 'codex.js')]);
    assert.ok(!/cmd\.exe$/i.test(r.file), 'node, not cmd.exe');
  });

  it('runs a shim that forwards to a native .exe directly', { skip: !IS_WINDOWS }, () => {
    const shim = path.join(dir, 'codex-exe.cmd');
    fs.writeFileSync(shim, '@"%dp0%\\vendor\\codex.exe" %*\r\n');
    assert.deepEqual(bare()._resolveExec(shim, true), {
      file: path.resolve(dir, 'vendor', 'codex.exe'), args: [], shell: false,
    });
  });

  it('reads through the older %~dp0 shim style too', { skip: !IS_WINDOWS }, () => {
    const shim = path.join(dir, 'codex-old.cmd');
    fs.writeFileSync(shim, '@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe" "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n)\r\n');
    const r = bare()._resolveExec(shim, true);
    assert.equal(r.shell, false);
    assert.deepEqual(r.args, [path.resolve(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')]);
  });

  it('runs a shim it cannot read through under cmd.exe with every argument quoted', () => {
    const shim = path.join(dir, 'odd.cmd');
    fs.writeFileSync(shim, '@echo off\r\ncall something-else %*\r\n');
    const exec = bare()._resolveExec(shim, true);
    assert.equal(exec.shell, false);
    assert.equal(exec.cmdShim, shim);
    const { argv, windowsVerbatimArguments } = bare()._spawnArgv(exec, ['-C', 'C:\\Users\\Windows 10\\work', '-c', 'x="y"']);
    assert.equal(windowsVerbatimArguments, true);
    assert.deepEqual(argv.slice(0, 3), ['/d', '/s', '/c']);
    assert.equal(argv[3], `""${shim}" "-C" "C:\\Users\\Windows 10\\work" "-c" "x=""y""""`);
  });

  it('spawns a native binary as is', () => {
    assert.deepEqual(bare()._resolveExec('C:\\tools\\codex.exe', true), { file: 'C:\\tools\\codex.exe', args: [], shell: false });
    assert.deepEqual(bare()._resolveExec('/usr/local/bin/codex', false), { file: '/usr/local/bin/codex', args: [], shell: false });
  });
});

describe('CodexAdapter._spawnCodex — paths with spaces and CJK', () => {
  let root;
  let bin;
  let workDir;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-'));
    const home = path.join(root, 'Windows 用户');
    workDir = path.join(home, 'work dir');
    const binDir = path.join(home, '.openagents', 'runtimes', 'codex', 'node_modules', '.bin');
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    // Echoes its argv and cwd back as the agent's reply.
    const entry = path.join(binDir, 'fake-codex.js');
    fs.writeFileSync(entry, [
      "let input = '';",
      "process.stdin.on('data', (d) => { input += d; });",
      "process.stdin.on('end', () => {",
      "  const text = JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), input });",
      "  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }) + '\\n');",
      "});",
    ].join('\n'));
    if (IS_WINDOWS) {
      bin = path.join(binDir, 'codex.cmd');
      fs.writeFileSync(bin, '@ECHO off\r\n"%_prog%"  "%dp0%\\fake-codex.js" %*\r\n');
    } else {
      bin = entry;
    }
  });
  after(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('keeps the binary path, the -C folder and quoted -c values intact', async () => {
    const adapter = bare({ workingDir: workDir });
    const args = ['exec', '--json', '-c', 'model_providers.openagents.name="openagents"', '-C', workDir];
    const result = await adapter._spawnCodex([bin, ...args], { ...process.env }, 'general', 'hi & <you>');
    assert.equal(result.exitCode, 0, result.stderr);
    const seen = JSON.parse(result.responseText);
    assert.deepEqual(seen.argv, args);
    assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(workDir));
    assert.equal(seen.input, 'hi & <you>');
  });
});

describe('CodexAdapter — missing working directory', () => {
  it('creates a configured folder that is not there yet', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-workdir-'));
    const missing = path.join(root, 'agent 用户');
    const errors = [];
    const adapter = bare({
      workingDir: missing,
      agentEnv: {},
      sendError: async (_ch, msg) => { errors.push(msg); },
      _spawnCodex: async () => ({ responseText: 'ok', exitCode: 0 }),
    });
    try {
      // Whatever the rest of the turn does on this machine, the folder exists
      // and is not reported missing.
      await adapter._handleViaSubprocess('hello', 'general').catch(() => {});
      assert.ok(fs.statSync(missing).isDirectory());
      assert.ok(!errors.some((m) => m.startsWith('Working directory does not exist')), errors.join('\n'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('names a folder it cannot create instead of spawning', async () => {
    const errors = [];
    let spawned = false;
    // Below a regular file, so the folder can never be made.
    const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oa-workdir-')), 'file');
    fs.writeFileSync(blocker, '');
    const missing = path.join(blocker, 'agent');
    const adapter = bare({
      workingDir: missing,
      agentEnv: {},
      sendError: async (_ch, msg) => { errors.push(msg); },
      _spawnCodex: async () => { spawned = true; return { responseText: 'ok', exitCode: 0 }; },
    });
    await adapter._handleViaSubprocess('hello', 'general');
    assert.equal(spawned, false);
    assert.deepEqual(errors, [`Working directory does not exist: ${missing}`]);
  });
});

describe('CodexAdapter._decodeOutput', () => {
  // "'C:\Users\Windows' 不是内部或外部命令" as cmd.exe writes it on a Chinese system.
  const gbk = Buffer.concat([
    Buffer.from("'C:\\Users\\Windows' "),
    Buffer.from([0xB2, 0xBB, 0xCA, 0xC7, 0xC4, 0xDA, 0xB2, 0xBF, 0xBB, 0xF2, 0xCD, 0xE2, 0xB2, 0xBF, 0xC3, 0xFC, 0xC1, 0xEE]),
  ]);

  it('reads console-code-page output on Windows', () => {
    assert.equal(CodexAdapter._decodeOutput(gbk, true), "'C:\\Users\\Windows' 不是内部或外部命令");
  });

  it('leaves UTF-8 alone', () => {
    const text = 'error: 找不到文件 — ok';
    assert.equal(CodexAdapter._decodeOutput(Buffer.from(text), true), text);
  });

  it('does not guess off Windows', () => {
    assert.ok(CodexAdapter._decodeOutput(gbk, false).includes('\uFFFD'));
  });
});

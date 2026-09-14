'use strict';

/**
 * The Windows/WSL boundary (src/wsl.js).
 *
 * No distro is needed and none is started: every case here is about the
 * REWRITE — what argv, env and options a resolved binary turns into — which is
 * where the boundary bugs actually live. `wsl:` marking, WSLENV composition,
 * argument translation and the refusal to run a Windows .cmd from inside Linux
 * are all pure functions of their inputs.
 *
 * The `inWsl` seam is injected for the same reason win-exec.ts injects its
 * platform: the mirror direction only ever runs inside a distro, and a test
 * that can only run there is a test that never runs.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

const {
  isWslBinary,
  wslBinaryPath,
  windowsBinaryKind,
  bridgeSpawn,
  bridgedCommandString,
  toWslPath,
} = require('../src/wsl');

const WSL_CLAUDE = 'wsl:/home/u/.local/bin/claude';

describe('marking an in-distro binary', () => {
  it('recognises a marked path and hands back the path behind it', () => {
    assert.equal(isWslBinary(WSL_CLAUDE), true);
    assert.equal(wslBinaryPath(WSL_CLAUDE), '/home/u/.local/bin/claude');
  });

  it('does not claim a bare POSIX path', () => {
    // The whole reason the marker exists: plenty of callers deal in POSIX
    // paths for their own reasons, and bridging one nobody meant as WSL would
    // send an ordinary local binary through wsl.exe.
    assert.equal(isWslBinary('/usr/bin/mini'), false);
    assert.equal(isWslBinary('C:\\npm\\claude.cmd'), false);
    assert.equal(isWslBinary(null), false);
  });

  it('leaves an unmarked path untouched when stripping', () => {
    assert.equal(wslBinaryPath('/usr/bin/mini'), '/usr/bin/mini');
  });
});

describe('bridgeSpawn — Windows host, CLI inside the distro', () => {
  it('runs the CLI through wsl.exe with argv intact', () => {
    const { file, args } = bridgeSpawn(WSL_CLAUDE, ['-p', 'fix A && B > c']);
    assert.equal(file, 'wsl.exe');
    assert.deepEqual(args, ['-e', '/home/u/.local/bin/claude', '-p', 'fix A && B > c']);
  });

  it('forwards what the caller ADDED to the environment, and nothing else', () => {
    const { opts } = bridgeSpawn(WSL_CLAUDE, [], {
      env: { ...process.env, ANTHROPIC_API_KEY: 'sk-test', OPENAGENTS_ENDPOINT: 'https://x' },
    });
    const forwarded = String(opts.env.WSLENV).split(':');
    assert.ok(forwarded.includes('ANTHROPIC_API_KEY'));
    assert.ok(forwarded.includes('OPENAGENTS_ENDPOINT'));
    // Without this the distro would start with a clean environment and the
    // agent would come up unauthenticated.
    assert.ok(forwarded.length >= 2);
  });

  it('never hands the distro a Windows PATH or HOME', () => {
    const { opts } = bridgeSpawn(WSL_CLAUDE, [], {
      env: { ...process.env, PATH: 'C:\\somewhere', HOME: 'C:\\Users\\u', TOKEN: 't' },
    });
    const forwarded = String(opts.env.WSLENV || '').split(':');
    assert.equal(forwarded.includes('PATH'), false);
    assert.equal(forwarded.includes('HOME'), false);
    assert.ok(forwarded.includes('TOKEN'));
  });

  it('asks WSL to translate path-valued variables', () => {
    const { opts } = bridgeSpawn(WSL_CLAUDE, [], {
      env: { ...process.env, ONE_DIR: 'D:\\work', MANY_DIRS: 'C:\\a;D:\\b', PLAIN: 'hello' },
    });
    const forwarded = String(opts.env.WSLENV).split(':');
    assert.ok(forwarded.includes('ONE_DIR/p'), 'a single Windows path gets /p');
    assert.ok(forwarded.includes('MANY_DIRS/l'), 'a list of them gets /l');
    assert.ok(forwarded.includes('PLAIN'), 'an ordinary value is forwarded untagged');
  });

  it('keeps an existing WSLENV rather than replacing it', () => {
    const { opts } = bridgeSpawn(WSL_CLAUDE, [], {
      env: { ...process.env, WSLENV: 'ALREADY/p', TOKEN: 't' },
    });
    assert.ok(String(opts.env.WSLENV).startsWith('ALREADY/p:'));
  });

  it('translates a path-shaped argument that really is a path', () => {
    // Adapters pass real directories on the command line (--add-dir D:\work);
    // a Windows path is simply a missing file to a Linux process.
    const real = os.tmpdir();
    const { args } = bridgeSpawn(WSL_CLAUDE, ['--add-dir', real]);
    assert.equal(args[3], toWslPath(real));
    assert.ok(args[3].startsWith('/'), 'the distro gets a Linux path');
  });

  it('leaves prompt text alone even when it mentions a Windows path', () => {
    const missing = path.join('D:\\', 'no-such-dir-' + Date.now(), 'x');
    const { args } = bridgeSpawn(WSL_CLAUDE, ['-p', missing]);
    assert.equal(args[3], missing);
  });

  it('turns off the shell and detaching, which cannot apply across the boundary', () => {
    const { opts } = bridgeSpawn(WSL_CLAUDE, [], { shell: true, detached: true });
    assert.equal(opts.shell, false);
    assert.equal(opts.detached, false);
    assert.equal(opts.windowsHide, true);
  });

  it('drops a cwd that does not exist instead of failing the spawn', () => {
    // spawn() itself throws ENOENT for a missing cwd, and that reads to the
    // caller exactly like "the agent is not installed".
    const gone = bridgeSpawn(WSL_CLAUDE, [], { cwd: 'C:\\no\\such\\dir' });
    assert.equal(gone.opts.cwd, undefined);
    const here = bridgeSpawn(WSL_CLAUDE, [], { cwd: os.tmpdir() });
    assert.equal(here.opts.cwd, os.tmpdir());
  });
});

describe('bridgeSpawn — inside the distro, CLI on the Windows side', () => {
  const inWsl = { inWsl: true };

  it('runs a real .exe unchanged — interop preserves argv', () => {
    const r = bridgeSpawn('/mnt/c/cursor/cursor-agent.exe', ['-p', 'hi'], {}, inWsl);
    assert.equal(r.file, '/mnt/c/cursor/cursor-agent.exe');
    assert.deepEqual(r.args, ['-p', 'hi']);
  });

  it('refuses a .cmd shim, with a message naming the fix', () => {
    assert.throws(
      () => bridgeSpawn('/mnt/c/npm/claude.cmd', ['-p', 'hi'], {}, inWsl),
      (e) => /cmd\.exe/.test(e.message) && /install the agent/i.test(e.message),
    );
  });

  it('classifies by extension only while we are inside a distro', () => {
    assert.equal(windowsBinaryKind('/mnt/c/npm/claude.cmd', true), 'shim');
    assert.equal(windowsBinaryKind('/mnt/c/x/agent.exe', true), 'exe');
    assert.equal(windowsBinaryKind('/usr/bin/claude', true), null);
    assert.equal(windowsBinaryKind('/mnt/c/npm/claude.cmd', false), null);
  });
});

describe('bridgeSpawn — everything else', () => {
  it('is a pass-through for an ordinary local binary', () => {
    const opts = { cwd: 'C:\\no\\such\\dir', shell: true, detached: true };
    const r = bridgeSpawn('C:\\npm\\claude.cmd', ['-p'], opts);
    assert.equal(r.file, 'C:\\npm\\claude.cmd');
    assert.deepEqual(r.args, ['-p']);
    // Untouched, including the options the WSL branch would have overridden.
    assert.equal(r.opts, opts);
  });
});

describe('an agent that only exists inside the distro', () => {
  const { Installer } = require('../src/installer');
  const fs = require('fs');

  const registry = {
    getEntry: (name) =>
      name === 'claude'
        ? { name: 'claude', install: { binary: 'claude', npm_package: '@anthropic-ai/claude-code' } }
        : null,
  };

  function installer() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-wsl-'));
    return new Installer(registry, dir);
  }

  it('reports it as installed, and never as one the launcher manages', () => {
    // The reported bug: a working `claude` in the distro read as "Not
    // installed", so the marketplace offered to install a second copy.
    const inst = installer();
    inst._whichBinary = () => WSL_CLAUDE;
    assert.deepEqual(inst.getInstallInfo('claude'), {
      installed: true,
      managed: false,
      location: 'wsl',
    });
  });

  it('asks it for its version through wsl.exe', () => {
    const inst = installer();
    assert.equal(
      inst._versionProbeCommand(WSL_CLAUDE),
      'wsl.exe -e "/home/u/.local/bin/claude" "--version"',
    );
    // Native resolution is untouched.
    assert.equal(inst._versionProbeCommand('C:\\npm\\claude.cmd'), '"C:\\npm\\claude.cmd" --version');
  });

  it('resolves ~ against the host home for every native install', () => {
    const inst = installer();
    inst._whichBinary = () => 'C:\\npm\\claude.cmd';
    assert.equal(inst._expandHome('~/.claude/sessions', 'claude'), path.join(os.homedir(), '.claude/sessions'));
    assert.equal(inst._expandHome('~/.claude/sessions'), path.join(os.homedir(), '.claude/sessions'));
  });
});

describe('bridgedCommandString', () => {
  it('builds a wsl.exe command line for a marked binary', () => {
    assert.equal(
      bridgedCommandString(WSL_CLAUDE, ['--version']),
      'wsl.exe -e "/home/u/.local/bin/claude" "--version"',
    );
  });

  it('answers null for a native binary, so the caller builds its own', () => {
    assert.equal(bridgedCommandString('C:\\npm\\claude.cmd', ['--version']), null);
  });
});

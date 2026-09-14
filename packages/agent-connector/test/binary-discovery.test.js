'use strict';

/**
 * Discovery of agent CLIs a GUI-launched process cannot see.
 *
 * A launcher started from Finder / the Dock inherits `/usr/bin:/bin:/usr/sbin:
 * /sbin` and nothing else, so every check here runs paths.js in a CHILD process
 * with that PATH and a synthetic HOME — the only way to reproduce the state the
 * bug reports came from (#648: "无法识别我机器里的 opencode 和 pi") without
 * depending on what the developer happens to have installed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const IS_WINDOWS = process.platform === 'win32';
const PATHS_MODULE = path.join(__dirname, '..', 'src', 'paths.js');

let home;
let shellDir;

/** Run getExtraBinDirs() in a child with a GUI-like PATH and our fake HOME. */
function discover(extraEnv) {
  const out = execFileSync(
    process.execPath,
    ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(PATHS_MODULE)}).getExtraBinDirs()))`],
    {
      encoding: 'utf-8',
      timeout: 30000,
      env: {
        HOME: home,
        USERPROFILE: home,
        PATH: IS_WINDOWS ? process.env.PATH : '/usr/bin:/bin:/usr/sbin:/sbin',
        SystemRoot: process.env.SystemRoot,
        // Windows resolves the npm and pnpm defaults out of these; a synthetic
        // HOME without them has no equivalent of those directories at all.
        ...(IS_WINDOWS
          ? {
              APPDATA: path.join(home, 'AppData', 'Roaming'),
              LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
            }
          : {}),
        ...extraEnv,
      },
    },
  );
  return JSON.parse(out);
}

const mk = (...parts) => {
  const dir = path.join(home, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

describe('Binary discovery for GUI-launched processes', () => {
  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-discovery-'));
    shellDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-shell-'));
  });

  after(() => {
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(shellDir, { recursive: true, force: true }); } catch {}
  });

  it("finds opencode installed by its own installer (~/.opencode/bin)", () => {
    // `curl -fsSL https://opencode.ai/install | bash` lands here and only edits
    // a shell rc file, so a running launcher never sees it on PATH.
    const dir = mk('.opencode', 'bin');
    assert.ok(discover().includes(dir));
  });

  it('honours OPENCODE_INSTALL_DIR without forgetting the default dir', () => {
    // Both, not either: OPENCODE_INSTALL_DIR set today does not unmake the copy
    // an earlier default-path install left in ~/.opencode/bin, and which of the
    // two the user's PATH actually points at is not ours to guess.
    const custom = mk('custom-opencode');
    const standard = mk('.opencode', 'bin');
    const dirs = discover({ OPENCODE_INSTALL_DIR: custom });
    assert.ok(dirs.includes(custom), 'the relocated dir');
    assert.ok(dirs.includes(standard), 'the default dir');
  });

  it('honours the install dir each agent installer lets the user move', () => {
    // Every one of these is read by the CLI's own installer script. A user who
    // set one has their only copy there, and no hardcoded default finds it.
    const ampHome = mk('elsewhere', 'amp');
    fs.mkdirSync(path.join(ampHome, 'bin'), { recursive: true });
    const gooseBin = mk('elsewhere', 'goose-bin');
    const hermesHome = mk('elsewhere', 'hermes');
    fs.mkdirSync(path.join(hermesHome, 'bin'), { recursive: true });
    const hermesInstall = mk('elsewhere', 'hermes-agent');
    const dirs = discover({
      AMP_HOME: ampHome,
      GOOSE_BIN_DIR: gooseBin,
      HERMES_HOME: hermesHome,
      HERMES_INSTALL_DIR: hermesInstall,
    });
    assert.ok(dirs.includes(path.join(ampHome, 'bin')), 'AMP_HOME');
    assert.ok(dirs.includes(gooseBin), 'GOOSE_BIN_DIR');
    assert.ok(dirs.includes(path.join(hermesHome, 'bin')), 'HERMES_HOME');
    assert.ok(dirs.includes(hermesInstall), 'HERMES_INSTALL_DIR');
  });

  it('finds every uv tool venv, not a hardcoded list of them', () => {
    // `uv tool install X` builds the venv and only COPIES the executable into
    // uv's bin dir, whose PATH entry comes from a shell rc edit. The venv is
    // routinely the only copy a GUI launch can reach — and naming the packages
    // one by one is what left `uv tool install mini-swe-agent` undetected while
    // aider and openworker (the two that were named) worked.
    const venvBin = IS_WINDOWS ? 'Scripts' : 'bin';
    const root = IS_WINDOWS
      ? ['AppData', 'Roaming', 'uv', 'tools']
      : ['.local', 'share', 'uv', 'tools'];
    const mini = mk(...root, 'mini-swe-agent', venvBin);
    const future = mk(...root, 'some-agent-we-have-not-shipped-yet', venvBin);
    const dirs = discover();
    assert.ok(dirs.includes(mini), 'uv tool install mini-swe-agent');
    assert.ok(dirs.includes(future), 'and any package installed the same way');
  });

  it('honours UV_TOOL_DIR', () => {
    const root = mk('elsewhere', 'uv-tools');
    const venv = path.join(root, 'aider-chat', IS_WINDOWS ? 'Scripts' : 'bin');
    fs.mkdirSync(venv, { recursive: true });
    assert.ok(discover({ UV_TOOL_DIR: root }).includes(venv));
  });

  it('finds a CLI installed with Homebrew on Linux', () => {
    // `brew install` is a real route for goose/opencode/gemini/codex, and
    // Linuxbrew's prefix is in neither the Unix nor the macOS list. Its PATH
    // entry comes from `brew shellenv` in a shell rc file.
    if (IS_WINDOWS || process.platform === 'darwin') return;
    const dir = mk('.linuxbrew', 'bin');
    assert.ok(discover().includes(dir));
  });

  it('finds CLIs installed with bun, pnpm and yarn, not just npm', () => {
    const bun = mk('.bun', 'bin');
    // pnpm's global bin genuinely differs per platform: ~/Library/pnpm on
    // macOS, ~/.local/share/pnpm on Linux, %LOCALAPPDATA%\pnpm on Windows.
    const pnpm = mk(
      ...(IS_WINDOWS
        ? ['AppData', 'Local', 'pnpm']
        : process.platform === 'darwin'
          ? ['Library', 'pnpm']
          : ['.local/share', 'pnpm']),
    );
    const yarn = mk('.yarn', 'bin');
    const dirs = discover();
    assert.ok(dirs.includes(bun), 'bun global bin');
    assert.ok(dirs.includes(pnpm), 'pnpm global bin');
    assert.ok(dirs.includes(yarn), 'yarn global bin');
  });

  it('honours PNPM_HOME and BUN_INSTALL', () => {
    const pnpmHome = mk('elsewhere', 'pnpm');
    const bunRoot = mk('elsewhere', 'bun');
    fs.mkdirSync(path.join(bunRoot, 'bin'), { recursive: true });
    const dirs = discover({ PNPM_HOME: pnpmHome, BUN_INSTALL: bunRoot });
    assert.ok(dirs.includes(pnpmHome));
    assert.ok(dirs.includes(path.join(bunRoot, 'bin')));
  });

  it('finds a relocated npm prefix from ~/.npmrc', () => {
    // `npm config set prefix ~/somewhere` is the standard sudo-free setup. Which
    // npm BINARY answers `npm config get prefix` is not decidable here (the
    // launcher prepends its own runtime, Homebrew may have another, each
    // reports its own builtin default), so the setting is read from npm's own
    // config instead.
    const prefix = mk('opt', 'mynpm');
    fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(home, '.npmrc'), `prefix=${prefix}\n`, 'utf-8');
    try {
      assert.ok(discover().includes(path.join(prefix, 'bin')));
    } finally {
      fs.rmSync(path.join(home, '.npmrc'), { force: true });
    }
  });

  it('honours $NPM_CONFIG_PREFIX over everything else', () => {
    const prefix = mk('opt', 'envnpm');
    fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true });
    assert.ok(discover({ NPM_CONFIG_PREFIX: prefix }).includes(path.join(prefix, 'bin')));
  });

  it('finds every installed nvm version, not only the default alias', () => {
    // `nvm use 20 && npm i -g opencode` puts a real CLI under v20 even when the
    // default alias points at v22 — the case the alias-only lookup missed.
    if (IS_WINDOWS) return;
    const v20 = mk('.nvm', 'versions', 'node', 'v20.19.2', 'bin');
    const v22 = mk('.nvm', 'versions', 'node', 'v22.16.0', 'bin');
    // The alias must exist and point elsewhere, or the old default-alias lookup
    // falls through to "just return the newest version" and passes by accident.
    fs.mkdirSync(path.join(home, '.nvm', 'alias'), { recursive: true });
    fs.writeFileSync(path.join(home, '.nvm', 'alias', 'default'), '22.16.0', 'utf-8');
    const dirs = discover();
    assert.ok(dirs.includes(v20), 'non-default nvm version');
    assert.ok(dirs.includes(v22), 'newest nvm version');
    assert.ok(dirs.indexOf(v22) < dirs.indexOf(v20), 'newest version ranks first');
  });

  it('imports PATH from the user login shell', () => {
    if (IS_WINDOWS) return;
    // A fake $SHELL: it ignores the flags and prints the delimited env block
    // paths.js parses, the same shape `zsh -ilc 'command env'` produces.
    const shellOwned = mk('opt', 'somewhere', 'bin');
    const shell = path.join(shellDir, 'fake-shell');
    fs.writeFileSync(
      shell,
      `#!/bin/sh\necho __OPENAGENTS_ENV__\necho "SOME_VAR=noise"\necho "PATH=${shellOwned}"\necho __OPENAGENTS_ENV__\n`,
      'utf-8',
    );
    fs.chmodSync(shell, 0o755);
    assert.ok(discover({ SHELL: shell }).includes(shellOwned));
  });

  it('a chatty or broken login shell never breaks discovery', () => {
    if (IS_WINDOWS) return;
    const known = mk('.opencode', 'bin');
    // Prints a banner, then fails — a plausible rc file. Discovery must still
    // return the hardcoded well-known dirs.
    const shell = path.join(shellDir, 'noisy-shell');
    fs.writeFileSync(shell, '#!/bin/sh\necho "Welcome to my shell"\nexit 1\n', 'utf-8');
    fs.chmodSync(shell, 0o755);
    assert.ok(discover({ SHELL: shell }).includes(known));
    // And a $SHELL that isn't there at all.
    assert.ok(discover({ SHELL: '/nonexistent/shell' }).includes(known));
  });

  it('OPENAGENTS_SKIP_SHELL_PATH=1 opts out of the shell probe', () => {
    if (IS_WINDOWS) return;
    const shellOwned = mk('opt', 'optout', 'bin');
    const shell = path.join(shellDir, 'optout-shell');
    fs.writeFileSync(
      shell,
      `#!/bin/sh\necho __OPENAGENTS_ENV__\necho "PATH=${shellOwned}"\necho __OPENAGENTS_ENV__\n`,
      'utf-8',
    );
    fs.chmodSync(shell, 0o755);
    const dirs = discover({ SHELL: shell, OPENAGENTS_SKIP_SHELL_PATH: '1' });
    assert.ok(!dirs.includes(shellOwned));
  });
});

/**
 * The filesystem fallback, and the dirs it is allowed to forget.
 *
 * getExtraBinDirs() answers "what must I PREPEND to PATH", so it drops every
 * dir already on PATH. resolveBinaryInKnownDirs() answers "where might this CLI
 * be", and it only ever runs after `where`/`which` has ALREADY failed — which on
 * Windows happens wholesale (OEM-codepage output on a non-English install, a 5s
 * timeout, no resolvable cmd.exe in an Electron process). Feeding it the
 * PATH-filtered list made that failure erase every agent installed to a normal
 * location, and the marketplace offered to install CodeBuddy / opencode / dsh
 * over copies already on the machine.
 */
describe('Filesystem fallback vs the PATH filter', () => {
  let box;

  before(() => {
    box = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-fallback-'));
  });

  after(() => {
    try { fs.rmSync(box, { recursive: true, force: true }); } catch {}
  });

  /** Evaluate an expression against paths.js in a child, with PATH under test. */
  function inChild(expr, { home: h, pathValue }) {
    const out = execFileSync(
      process.execPath,
      ['-e', `const p=require(${JSON.stringify(PATHS_MODULE)});process.stdout.write(JSON.stringify(${expr}))`],
      {
        encoding: 'utf-8',
        timeout: 30000,
        env: {
          HOME: h,
          USERPROFILE: h,
          PATH: pathValue,
          SystemRoot: process.env.SystemRoot,
          ComSpec: process.env.ComSpec,
          ...(IS_WINDOWS
            ? {
                APPDATA: path.join(h, 'AppData', 'Roaming'),
                LOCALAPPDATA: path.join(h, 'AppData', 'Local'),
              }
            : {}),
          OPENAGENTS_SKIP_SHELL_PATH: '1',
        },
      },
    );
    return JSON.parse(out);
  }

  /** A synthetic HOME with opencode installed where its own installer puts it. */
  function homeWithOpencode() {
    const h = fs.mkdtempSync(path.join(box, 'home-'));
    const dir = path.join(h, '.opencode', 'bin');
    fs.mkdirSync(dir, { recursive: true });
    const bin = path.join(dir, IS_WINDOWS ? 'opencode.cmd' : 'opencode');
    fs.writeFileSync(bin, IS_WINDOWS ? '@echo 1.0.0' : '#!/bin/sh\necho 1.0.0\n', 'utf-8');
    if (!IS_WINDOWS) fs.chmodSync(bin, 0o755);
    return { home: h, dir, bin };
  }

  it('finds a CLI whose directory is already on PATH', () => {
    const { home: h, dir, bin } = homeWithOpencode();
    // The dir IS on PATH — the state a user who ran the installer and restarted
    // is in, and the one getExtraBinDirs() filters away.
    const found = inChild("p.resolveBinaryInKnownDirs(['opencode'], 'opencode')", {
      home: h,
      pathValue: [dir, IS_WINDOWS ? process.env.PATH : '/usr/bin:/bin'].join(IS_WINDOWS ? ';' : ':'),
    });
    assert.equal(found, bin, 'a resolvable CLI must not become invisible for being on PATH');
  });

  it('getKnownBinDirs keeps what getExtraBinDirs drops', () => {
    const { home: h, dir } = homeWithOpencode();
    const pathValue = [dir, IS_WINDOWS ? process.env.PATH : '/usr/bin:/bin'].join(IS_WINDOWS ? ';' : ':');
    assert.ok(inChild('p.getKnownBinDirs()', { home: h, pathValue }).includes(dir), 'known dirs');
    assert.ok(!inChild('p.getExtraBinDirs()', { home: h, pathValue }).includes(dir), 'extra dirs');
  });

  it('getExtraBinDirs stays a subset of getKnownBinDirs', () => {
    const { home: h } = homeWithOpencode();
    const pathValue = IS_WINDOWS ? process.env.PATH : '/usr/bin:/bin';
    const known = new Set(inChild('p.getKnownBinDirs()', { home: h, pathValue }));
    for (const d of inChild('p.getExtraBinDirs()', { home: h, pathValue })) {
      assert.ok(known.has(d), `${d} is offered for PATH but not searched`);
    }
  });
});

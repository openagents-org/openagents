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

  it('honours OPENCODE_INSTALL_DIR', () => {
    const dir = mk('custom-opencode');
    assert.ok(discover({ OPENCODE_INSTALL_DIR: dir }).includes(dir));
  });

  it('finds CLIs installed with bun, pnpm and yarn, not just npm', () => {
    const bun = mk('.bun', 'bin');
    const pnpm = mk(process.platform === 'darwin' ? 'Library' : '.local/share', 'pnpm');
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

  it('finds every installed nvm version, not only the default alias', () => {
    // `nvm use 20 && npm i -g opencode` puts a real CLI under v20 even when the
    // default alias points at v22 — the case the alias-only lookup missed.
    if (IS_WINDOWS) return;
    const v20 = mk('.nvm', 'versions', 'node', 'v20.19.2', 'bin');
    const v22 = mk('.nvm', 'versions', 'node', 'v22.16.0', 'bin');
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

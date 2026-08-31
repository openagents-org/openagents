'use strict';

/**
 * Every agent in the registry, detected from the place its CLI really lands.
 *
 * #648 was one agent (opencode) missed in one directory, but the shape of the
 * bug was general: the installer decides whether a CLI EXISTS through
 * getExtraBinDirs(), while each adapter finds the CLI it SPAWNS through its own
 * hardcoded candidate list. The two drifted, so an agent could run fine and
 * still be advertised as "not installed".
 *
 * This matrix closes that by example: for every registry entry, drop a real
 * executable in a plausible real-world install location and assert
 * getInstallInfo() sees it — with the GUI-like PATH a Dock-launched app gets.
 * Adding an agent to the registry without teaching paths.js where its CLI lives
 * fails here.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const IS_WINDOWS = process.platform === 'win32';
const ROOT = path.join(__dirname, '..');
const registry = require(path.join(ROOT, 'registry.json'));
const ENTRIES = Array.isArray(registry) ? registry : registry.agents || Object.values(registry);

/**
 * Install locations that are REAL on the platform the test is running on.
 *
 * The layouts genuinely differ — pnpm alone is ~/Library/pnpm on macOS,
 * ~/.local/share/pnpm on Linux and %LOCALAPPDATA%\pnpm on Windows — so a table
 * of fixed paths tests macOS and lies everywhere else. (It did: CI failed on
 * ubuntu for exactly this.) Each entry resolves to somewhere paths.js is
 * supposed to look ON THIS PLATFORM, so a miss is a real gap, not a fixture bug.
 */
const IS_MACOS = process.platform === 'darwin';
const LOC = {
  localBin: '.local/bin',
  homeBin: 'bin',
  bun: '.bun/bin',
  yarn: '.yarn/bin',
  pnpm: IS_WINDOWS
    ? 'AppData/Local/pnpm'
    : IS_MACOS
      ? 'Library/pnpm'
      : '.local/share/pnpm',
  // nvm-for-windows has an entirely different layout and is keyed off NVM_HOME;
  // the npm default prefix is the equivalent "installed under a version manager"
  // location there.
  nvm20: IS_WINDOWS ? 'AppData/Roaming/npm' : '.nvm/versions/node/v20.19.2/bin',
  nvm22: IS_WINDOWS ? 'AppData/Roaming/npm' : '.nvm/versions/node/v22.16.0/bin',
  npmPrefix: '.npm-global/bin',
  opencode: '.opencode/bin',
  kimi: '.kimi-code/bin',
  cursor: '.cursor/bin',
  amp: '.amp/bin',
  // uv keys its tool venv by the DISTRIBUTION name, so OpenWorker's is
  // `coworker`. This is the location that exists even when uv's copy into the
  // bin dir (or its PATH edit) never happened, which is the case a GUI launch
  // actually hits.
  uvCoworker: IS_WINDOWS
    ? 'AppData/Roaming/uv/tools/coworker/Scripts'
    : '.local/share/uv/tools/coworker/bin',
}

/**
 * Where each agent's CLI actually lands, and how it got there. One case per
 * agent; the location is the one its own installer or the common package
 * manager for it would use, NOT a location invented to make the test pass.
 */
const WHERE = {
  aider: [LOC.localBin, 'uv tool / pipx'],
  amp: [LOC.amp, 'ampcode.com/install.sh'],
  antigravity: [LOC.localBin, 'antigravity.google/cli/install.sh'],
  claude: [LOC.nvm20, 'npm -g under a non-default node version'],
  cline: [LOC.pnpm, 'pnpm add -g'],
  codex: [LOC.npmPrefix, 'npm -g with a relocated prefix'],
  commandcode: [LOC.bun, 'bun install -g'],
  copilot: [LOC.localBin, 'npm -g with prefix=~/.local'],
  cursor: [LOC.cursor, 'cursor.com/install'],
  deepseek: [LOC.yarn, 'yarn global add'],
  gemini: [LOC.nvm22, 'npm -g under a node version manager'],
  goose: [LOC.localBin, 'block/goose release installer'],
  hermes: [LOC.localBin, 'hermes-agent install.sh'],
  kimi: [LOC.kimi, '@moonshot-ai/kimi-code postinstall (native build)'],
  'mini-swe-agent': [LOC.localBin, 'pip install --user'],
  nanoclaw: [LOC.localBin, 'external runtime'],
  openclaw: [LOC.homeBin, 'installed into ~/bin'],
  opencode: [LOC.opencode, 'opencode.ai/install'],
  openworker: [LOC.uvCoworker, 'uv tool install git+github.com/andrewyng/openworker'],
  pi: [LOC.nvm20, 'npm -g under a non-default node version'],
}

/**
 * The environment every probe child runs in: a synthetic HOME and the PATH a
 * GUI launch is handed. Shared so a lookup and the assertion about that lookup
 * can never disagree about where "installed" would even be visible.
 */
function childEnv(home) {
  return {
    HOME: home,
    USERPROFILE: home,
    PATH: IS_WINDOWS ? process.env.PATH : '/usr/bin:/bin:/usr/sbin:/sbin',
    SystemRoot: process.env.SystemRoot,
    // Windows derives the npm/pnpm defaults from these; without them a
    // synthetic HOME has no equivalent of those directories at all.
    ...(IS_WINDOWS
      ? {
          APPDATA: path.join(home, 'AppData', 'Roaming'),
          LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
        }
      : {}),
    // The shell probe is irrelevant here and would leak the developer's own
    // PATH into the result, hiding a missing hardcoded dir.
    OPENAGENTS_SKIP_SHELL_PATH: '1',
  };
}

/** Substring test for a path, case-insensitive where the filesystem is. */
function pathIncludes(full, part) {
  return IS_WINDOWS ? full.toLowerCase().includes(part.toLowerCase()) : full.includes(part);
}

/** getInstallInfo() for one agent, in a child with a GUI-like PATH. */
function installInfo(home, agentType) {
  const out = execFileSync(
    process.execPath,
    [
      '-e',
      `const {AgentConnector}=require(${JSON.stringify(path.join(ROOT, 'src', 'index.js'))});
       const c=new AgentConnector({configDir: process.env.HOME + '/.openagents'});
       process.stdout.write(JSON.stringify(c.installer.getInstallInfo(process.argv[1])));`,
      agentType,
    ],
    { encoding: 'utf-8', timeout: 30000, env: childEnv(home) },
  );
  return JSON.parse(out);
}

function plantBinary(home, relDir, name) {
  const dir = path.join(home, relDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, IS_WINDOWS ? `${name}.cmd` : name);
  fs.writeFileSync(file, IS_WINDOWS ? '@echo 1.0.0' : '#!/bin/sh\necho 1.0.0\n', 'utf-8');
  if (!IS_WINDOWS) fs.chmodSync(file, 0o755);
  return file;
}

describe('Agent detection matrix', () => {
  it('covers every registry entry — no agent may be added without a case', () => {
    const missing = ENTRIES
      .map((e) => e.name)
      .filter((n) => !WHERE[n] && !ENTRIES.find((e) => e.name === n)?.install?.api_only);
    assert.deepEqual(missing, [], `add a real install location for: ${missing.join(', ')}`);
  });

  for (const entry of ENTRIES) {
    const name = entry.name;
    const install = entry.install || {};

    if (install.api_only) {
      it(`${name}: api-only, install is a marker (no binary to find)`, () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), `oa-${name}-`));
        try {
          assert.equal(installInfo(home, name).installed, false, 'not installed before the marker');
          fs.mkdirSync(path.join(home, '.openagents', 'installed'), { recursive: true });
          fs.writeFileSync(path.join(home, '.openagents', 'installed', name), '', 'utf-8');
          const info = installInfo(home, name);
          assert.equal(info.installed, true, 'installed once the marker exists');
          assert.equal(info.location, 'api_only');
        } finally {
          fs.rmSync(home, { recursive: true, force: true });
        }
      });
      continue;
    }

    const [relDir, how] = WHERE[name] || [];
    if (!relDir) continue;

    it(`${name}: detected in ~/${relDir} (${how})`, (t) => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), `oa-${name}-`));
      try {
        // getExtraBinDirs() legitimately includes the dir holding the running
        // node binary, so on a developer machine that has this CLI installed
        // next to its own node the synthetic HOME cannot isolate it. Skip
        // rather than fail: on a clean checkout / CI runner this is never hit,
        // and pretending otherwise would mean weakening the real assertion.
        if (installInfo(home, name).installed) {
          t.skip(`${install.binary || name} is installed on this machine outside the test HOME`);
          return;
        }
        plantBinary(home, relDir, install.binary || name);
        const info = installInfo(home, name);
        assert.equal(info.installed, true, `${install.binary || name} in ~/${relDir} must be detected`);
        // Installed outside ~/.openagents means the launcher must not claim it
        // can uninstall or update it.
        assert.equal(info.managed, false);
        assert.equal(info.location, 'global');
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  }
});

/**
 * Which copy actually runs when the user has one AND the launcher has one.
 *
 * getInstallInfo() checks our isolated prefix first, so it reported
 * location:'runtime' and showed that copy's version — while a PATH lookup
 * returned the user's global copy, because every node-manager and system bin
 * dir outranks ~/.openagents/runtimes/*​/node_modules/.bin. The marketplace
 * described one program and the daemon ran another, which is what made
 * "Update" look like it did nothing.
 */
describe('Managed vs global copy', () => {
  // The user's own copy, in a place this platform really looks: an nvm version
  // dir on Unix, the npm default prefix (%APPDATA%\npm) on Windows — where
  // nvm's layout doesn't exist at all (nvm-for-windows is keyed off %NVM_HOME%
  // and installs elsewhere). Planting it somewhere unscanned would test the
  // fixture, not the lookup.
  const GLOBAL_DIR = IS_WINDOWS
    ? path.join('AppData', 'Roaming', 'npm')
    : path.join('.nvm', 'versions', 'node', 'v22.16.0', 'bin');

  const plantGlobal = (home, text) => {
    if (!IS_WINDOWS) {
      fs.mkdirSync(path.join(home, '.nvm', 'alias'), { recursive: true });
      fs.writeFileSync(path.join(home, '.nvm', 'alias', 'default'), '22.16.0', 'utf-8');
    }
    const dir = path.join(home, GLOBAL_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const bin = path.join(dir, IS_WINDOWS ? 'opencode.cmd' : 'opencode');
    fs.writeFileSync(bin, IS_WINDOWS ? `@echo ${text}` : `#!/bin/sh\necho ${text}\n`, 'utf-8');
    if (!IS_WINDOWS) fs.chmodSync(bin, 0o755);
  };
  const plantManaged = (home, { withPackage }) => {
    const modules = path.join(home, '.openagents', 'runtimes', 'opencode', 'node_modules');
    fs.mkdirSync(path.join(modules, '.bin'), { recursive: true });
    const bin = path.join(modules, '.bin', IS_WINDOWS ? 'opencode.cmd' : 'opencode');
    fs.writeFileSync(bin, IS_WINDOWS ? '@echo MANAGED' : '#!/bin/sh\necho MANAGED\n', 'utf-8');
    if (!IS_WINDOWS) fs.chmodSync(bin, 0o755);
    if (withPackage) {
      fs.mkdirSync(path.join(modules, 'opencode-ai'), { recursive: true });
      fs.writeFileSync(
        path.join(modules, 'opencode-ai', 'package.json'),
        JSON.stringify({ name: 'opencode-ai', version: '1.18.25' }),
        'utf-8',
      );
    }
  };
  const resolved = (home) =>
    execFileSync(
      process.execPath,
      [
        '-e',
        `const {AgentConnector}=require(${JSON.stringify(path.join(ROOT, 'src', 'index.js'))});
         const c=new AgentConnector({configDir: process.env.HOME + '/.openagents'});
         process.stdout.write(c.installer.which('opencode') || '');`,
      ],
      { encoding: 'utf-8', timeout: 30000, env: childEnv(home) },
    );

  it('runs the launcher-installed copy when one is really installed', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-managed-'));
    try {
      plantGlobal(home, 'GLOBAL');
      plantManaged(home, { withPackage: true });
      const info = installInfo(home, 'opencode');
      assert.equal(info.location, 'runtime');
      assert.ok(
        pathIncludes(resolved(home), path.join('.openagents', 'runtimes')),
        'the binary that runs must be the one the UI describes',
      );
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('falls back to the global copy when only an orphaned shim remains', () => {
    // A shim with no package behind it cannot run; shadowing a working global
    // CLI with it would turn a broken install into a broken agent.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-orphan-'));
    try {
      plantGlobal(home, 'GLOBAL');
      plantManaged(home, { withPackage: false });
      assert.equal(installInfo(home, 'opencode').location, 'global');
      assert.ok(
        pathIncludes(resolved(home), GLOBAL_DIR),
        `the global copy in ~/${GLOBAL_DIR} must be the one that runs`,
      );
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

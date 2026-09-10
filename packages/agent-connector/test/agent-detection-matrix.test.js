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
  // Linuxbrew's alternative in-HOME prefix. `brew install` is a real route for
  // goose/opencode/gemini/codex, and on Linux its prefix is in neither the
  // Unix nor the macOS list. (The system-wide /home/linuxbrew prefix is the
  // other half; only the in-HOME one can be planted under a synthetic HOME.)
  linuxbrew: IS_WINDOWS || IS_MACOS ? null : '.linuxbrew/bin',
  // The npm default prefix. On Windows that's %APPDATA%\npm — where `npm i -g`
  // drops a shim for anyone who never relocated the prefix, i.e. most people.
  // There is no in-HOME equivalent on Unix (the default is /usr/local), so
  // cases using it are Windows-only.
  npmDefault: IS_WINDOWS ? 'AppData/Roaming/npm' : null,
  // CodeBuddy also ships a native build — the engine behind the WorkBuddy
  // desktop app — which installs outside npm entirely.
  codebuddyNative: IS_WINDOWS ? 'AppData/Local/CodeBuddy/bin' : '.codebuddy/bin',
  // `claude install` (the native build) relocates the CLI here and reaches it
  // through a shell alias a GUI process never sees.
  claudeLocal: '.claude/local',
  hermesHome: '.hermes/bin',
  agyWin: IS_WINDOWS ? 'AppData/Local/agy/bin' : null,
  // winget's shim dir — how the GitHub Copilot CLI arrives for a Windows user
  // who didn't take the npm route.
  winget: IS_WINDOWS ? 'AppData/Local/Microsoft/WinGet/Links' : null,
}

/** `pipx install <dist>` — the venv copy, which exists even when the shim doesn't. */
const pipx = (dist) => `.local/pipx/venvs/${dist}/${IS_WINDOWS ? 'Scripts' : 'bin'}`

/**
 * `uv tool install <dist>` — the venv copy. uv only COPIES the executable into
 * its bin dir, and that dir reaches PATH through a shell rc edit, so on a GUI
 * launch this venv is routinely the only copy that can be found at all.
 */
const uv = (dist) =>
  IS_WINDOWS
    ? `AppData/Roaming/uv/tools/${dist}/Scripts`
    : `.local/share/uv/tools/${dist}/bin`

/**
 * Where each agent's CLI actually lands, how it got there, and which ROUTE
 * FAMILY that is.
 *
 * Every location listed is one its own installer or a common package manager
 * for it really uses — never one invented to make the test pass. Agents get
 * more than one case where they genuinely have more than one route onto a
 * machine, because "installed" that only holds for the route WE would have
 * taken is what makes the launcher offer to install a CLI that is already
 * there. A null location is skipped (it doesn't exist on this platform).
 *
 * The family is what `covers the route the registry itself recommends` below
 * checks against: a case is not enough on its own if it tests a route the user
 * was never told to take.
 */
const WHERE = {
  aider: [
    [LOC.localBin, 'aider.chat/install.sh (uv tool, shim linked)', 'installer'],
    [uv('aider-chat'), 'aider.chat/install.sh (uv venv copy, shim not linked)', 'uv'],
    [pipx('aider-chat'), 'pipx install aider-chat (venv copy, shim not linked)', 'pip'],
  ],
  amp: [[LOC.amp, 'ampcode.com/install.sh', 'installer']],
  antigravity: [
    [LOC.localBin, 'antigravity.google/cli/install.sh', 'installer'],
    [LOC.agyWin, 'antigravity.google/cli/install.ps1', 'installer'],
  ],
  claude: [
    [LOC.nvm20, 'npm -g under a non-default node version', 'npm'],
    [LOC.claudeLocal, '`claude install` (native build)', 'installer'],
  ],
  cline: [[LOC.pnpm, 'pnpm add -g', 'npm']],
  codebuddy: [
    [LOC.nvm22, 'npm -g under a node version manager', 'npm'],
    [LOC.npmDefault, 'npm i -g @tencent-ai/codebuddy-code', 'npm'],
    [LOC.codebuddyNative, 'CodeBuddy native install', 'installer'],
  ],
  codex: [[LOC.npmPrefix, 'npm -g with a relocated prefix', 'npm']],
  commandcode: [[LOC.bun, 'bun install -g', 'npm']],
  copilot: [
    [LOC.localBin, 'npm -g with prefix=~/.local', 'npm'],
    [LOC.winget, 'winget install GitHub.CopilotCLI', 'installer'],
  ],
  cursor: [
    [LOC.cursor, 'cursor.com/install (~/.cursor/bin layout)', 'installer'],
    // What the current cursor.com/install actually does on Unix: unpack into
    // ~/.local/share/cursor-agent/versions/<v> and symlink into ~/.local/bin.
    [IS_WINDOWS ? null : LOC.localBin, 'cursor.com/install (~/.local/bin symlink)', 'installer'],
  ],
  deepseek: [
    [LOC.yarn, 'yarn global add', 'npm'],
    [LOC.npmDefault, 'npm i -g @deepseek-ai/dsh', 'npm'],
  ],
  gemini: [[LOC.nvm22, 'npm -g under a node version manager', 'npm']],
  goose: [
    [LOC.localBin, 'block/goose release installer', 'installer'],
    [LOC.linuxbrew, 'brew install block-goose-cli', 'brew'],
  ],
  hermes: [
    [LOC.localBin, 'hermes-agent install.sh', 'installer'],
    [LOC.hermesHome, 'hermes-agent install.sh (~/.hermes/bin layout)', 'installer'],
  ],
  kimi: [
    [LOC.kimi, '@moonshot-ai/kimi-code postinstall (native build)', 'installer'],
    [LOC.nvm20, 'npm i -g @moonshot-ai/kimi-code', 'npm'],
  ],
  'mini-swe-agent': [
    [LOC.localBin, 'pip install --user', 'pip'],
    [pipx('mini-swe-agent'), 'pipx install mini-swe-agent', 'pip'],
    [uv('mini-swe-agent'), 'uv tool install mini-swe-agent', 'uv'],
  ],
  nanoclaw: [[LOC.localBin, 'external runtime', 'external']],
  openclaw: [
    [LOC.homeBin, 'installed into ~/bin', 'installer'],
    [LOC.npmPrefix, 'npm i -g openclaw with a relocated prefix', 'npm'],
  ],
  opencode: [
    [LOC.opencode, 'opencode.ai/install', 'installer'],
    // The npm route has to be exercised somewhere that exists on THIS platform:
    // %APPDATA%\npm has no Unix equivalent, and a Unix-only miss is exactly how
    // "not detected" was reported against launcher 0.9.27.
    [LOC.nvm22, 'npm i -g opencode-ai under a node version manager', 'npm'],
    [LOC.npmDefault, 'npm i -g opencode-ai', 'npm'],
    [LOC.bun, 'bun install -g opencode-ai', 'npm'],
    [LOC.linuxbrew, 'brew install sst/tap/opencode', 'brew'],
  ],
  openworker: [
    [uv('coworker'), 'uv tool install git+github.com/andrewyng/openworker', 'uv'],
    [pipx('coworker'), 'pipx install coworker', 'pip'],
  ],
  pi: [[LOC.nvm20, 'npm -g under a non-default node version', 'npm']],
}

/**
 * The route family a registry install command tells the user to take.
 *
 * This is the rule that makes the matrix self-maintaining: whatever install
 * command an agent ships with, the location THAT command lands in has to be
 * one the matrix proves is detected. A table of cases can otherwise drift into
 * testing only the routes that already happen to work — which is how an agent
 * whose own installer picks its own directory (opencode's ~/.opencode/bin)
 * stayed undetected while its npm route was covered.
 */
function requiredFamily(cmd) {
  const c = String(cmd || '')
  // An `echo …` entry is setup PROSE, not a command — nanoclaw's tells the user
  // to clone a repo and symlink the binary themselves. Matching the package
  // managers named inside that sentence would demand a route nobody takes.
  if (/^\s*echo\b/.test(c)) return null
  if (/uv tool install/.test(c)) return 'uv'
  if (/\bpip install\b/.test(c)) return 'pip'
  if (/npm install|yarn global add|pnpm add|bun (install|add)/.test(c)) return 'npm'
  if (/curl|wget|irm |Invoke-RestMethod|iex|powershell/i.test(c)) return 'installer'
  return null // e.g. nanoclaw, whose "install" is a note, not a command
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
      .filter((n) => !WHERE[n]?.length && !ENTRIES.find((e) => e.name === n)?.install?.api_only);
    assert.deepEqual(missing, [], `add a real install location for: ${missing.join(', ')}`);
  });

  it('covers the route the registry itself recommends, on this platform', () => {
    const gaps = [];
    for (const entry of ENTRIES) {
      const install = entry.install || {};
      if (install.api_only) continue;
      const cmd = IS_WINDOWS
        ? install.windows
        : IS_MACOS
          ? install.macos
          : install.linux;
      const want = requiredFamily(cmd);
      if (!want) continue;
      // A case whose location is null does not exist on this platform, so it
      // proves nothing here — the family has to be covered by a real one.
      const covered = (WHERE[entry.name] || []).some(([dir, , family]) => dir && family === want);
      if (!covered) gaps.push(`${entry.name}: install command is a "${want}" route with no ${want} case`);
    }
    assert.deepEqual(gaps, [], gaps.join('\n'));
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

    for (const [relDir, how] of WHERE[name] || []) {
      if (!relDir) continue; // not a location that exists on this platform

      it(`${name}: detected in ~/${relDir} (${how})`, (t) => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), `oa-${name}-`));
        try {
          // getKnownBinDirs() legitimately includes the dir holding the running
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

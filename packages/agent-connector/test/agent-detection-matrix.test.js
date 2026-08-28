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
 * Where each agent's CLI actually lands, and how it got there. One case per
 * agent; the location is the one its own installer or the common package
 * manager for it would use, NOT a location invented to make the test pass.
 */
const WHERE = {
  aider: ['.local/bin', 'uv tool / pipx'],
  amp: ['.amp/bin', 'ampcode.com/install.sh'],
  antigravity: ['.local/bin', 'antigravity.google/cli/install.sh'],
  claude: ['.nvm/versions/node/v20.19.2/bin', 'npm -g under a non-default nvm version'],
  cline: ['Library/pnpm', 'pnpm add -g'],
  codex: ['.npm-global/bin', 'npm -g with a relocated prefix'],
  commandcode: ['.bun/bin', 'bun install -g'],
  copilot: ['.local/bin', 'npm -g with prefix=~/.local'],
  cursor: ['.cursor/bin', 'cursor.com/install'],
  deepseek: ['.yarn/bin', 'yarn global add'],
  gemini: ['.nvm/versions/node/v22.16.0/bin', 'npm -g under nvm'],
  goose: ['.local/bin', 'block/goose release installer'],
  hermes: ['.local/bin', 'hermes-agent install.sh'],
  'mini-swe-agent': ['.local/bin', 'pip install --user'],
  nanoclaw: ['.local/bin', 'external runtime'],
  openclaw: ['.local/share/pnpm', 'pnpm add -g (linux layout)'],
  opencode: ['.opencode/bin', 'opencode.ai/install'],
  pi: ['.nvm/versions/node/v20.19.2/bin', 'npm -g under a non-default nvm version'],
};

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
    {
      encoding: 'utf-8',
      timeout: 30000,
      env: {
        HOME: home,
        USERPROFILE: home,
        PATH: IS_WINDOWS ? process.env.PATH : '/usr/bin:/bin:/usr/sbin:/sbin',
        SystemRoot: process.env.SystemRoot,
        // The shell probe is irrelevant here and would leak the developer's own
        // PATH into the result, hiding a missing hardcoded dir.
        OPENAGENTS_SKIP_SHELL_PATH: '1',
      },
    },
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

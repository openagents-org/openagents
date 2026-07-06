'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Installer, compareVersions, clearVersionCache } = require('../src/installer');

let tmpDir;

const mockRegistry = {
  getEntry: (name) => {
    if (name === 'gated') {
      return {
        name: 'gated',
        label: 'Gated CLI',
        install: {
          binary: 'gated-bin',
          min_version: '1.2.0',
          macos: 'npm install -g gated',
          linux: 'npm install -g gated',
        },
      };
    }
    if (name === 'unverif') {
      // Mirrors the Copilot pattern: token env vars + login command, but auth
      // cannot be reliably probed offline (unverifiable).
      return {
        name: 'unverif',
        label: 'Unverifiable Auth CLI',
        install: { binary: 'unverif-bin', macos: 'npm install -g unverif', linux: 'npm install -g unverif' },
        check_ready: {
          env_vars: ['SOME_TOKEN'],
          saved_env_key: 'SOME_TOKEN',
          login_command: 'unverif login',
          unverifiable: true,
          not_ready_message: 'Sign-in not confirmed.',
        },
      };
    }
    if (name === 'testpkg') {
      return {
        name: 'testpkg',
        install: {
          binary: 'testpkg-bin',
          macos: 'npm install -g testpkg@latest',
          linux: 'npm install -g testpkg@latest',
          windows: 'npm install -g testpkg@latest',
        },
      };
    }
    if (name === 'pipapp') {
      return {
        name: 'pipapp',
        install: {
          binary: 'pipapp',
          macos: 'pip install pipapp',
          linux: 'pip install pipapp',
        },
      };
    }
    if (name === 'codex') {
      return {
        name: 'codex',
        install: {
          binary: 'codex',
          macos: 'npm install -g @openai/codex',
          linux: 'npm install -g @openai/codex',
          windows: 'npm install -g @openai/codex',
        },
        check_ready: {
          env_all: ['OPENAI_API_KEY', 'OPENAI_BASE_URL'],
          saved_env_all: ['OPENAI_API_KEY', 'OPENAI_BASE_URL'],
          status_command: 'codex login status',
          login_command: 'codex login',
          not_ready_message: 'Not configured. Set OPENAI_API_KEY + OPENAI_BASE_URL, or run: codex login',
        },
      };
    }
    if (name === 'cursor') {
      return {
        name: 'cursor',
        install: {
          binary: 'cursor-agent',
          binary_aliases: ['agent'],
          macos: 'curl https://cursor.com/install -fsSL | bash',
          linux: 'curl https://cursor.com/install -fsSL | bash',
          windows: "\"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\" -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-RestMethod -UseBasicParsing 'https://cursor.com/install?win32=true' | Invoke-Expression\"",
        },
      };
    }
    if (name === 'kimi') {
      return {
        name: 'kimi',
        label: 'Kimi',
        install: {
          binary: 'kimi',
          api_only: true,
          macos: "echo 'Kimi uses direct API mode'",
          linux: "echo 'Kimi uses direct API mode'",
          windows: "echo 'Kimi uses direct API mode'",
        },
        check_ready: {
          env_vars: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
          saved_env_key: 'KIMI_API_KEY',
          not_ready_message: 'No API key — press e to configure',
        },
      };
    }
    return null;
  },
  getResolveRules: () => [],
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-inst-'));
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.KIMI_API_KEY;
  delete process.env.MOONSHOT_API_KEY;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Installer', () => {
  it('platform returns a valid key', () => {
    const plat = Installer.platform();
    assert.ok(['macos', 'linux', 'windows'].includes(plat));
  });

  it('isInstalled returns false for unknown agent', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    assert.equal(inst.isInstalled('nonexistent-xyz'), false);
  });

  // Regression: a resolved binary that is a JS entry (OpenClaw's package bin is
  // openclaw.mjs) must be probed via `node <file> --version`, NEVER as a bare
  // `"<file>.mjs" --version`. On Windows the latter goes through cmd.exe, which
  // has no PATHEXT association for .mjs and ShellExecutes it → the OS "choose an
  // app to open this .mjs file" dialog, popped repeatedly by the periodic health
  // poll. Non-JS binaries (.cmd/.exe/native) stay unprefixed.
  it('_versionProbeCommand runs JS entries via node, leaves others bare', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    const node = inst._nodeBinary();
    for (const ext of ['mjs', 'cjs', 'js']) {
      const p = `/home/u/.openagents/runtimes/openclaw/node_modules/openclaw/openclaw.${ext}`;
      assert.equal(inst._versionProbeCommand(p), `"${node}" "${p}" --version`);
    }
    assert.equal(
      inst._versionProbeCommand('C:\\Users\\u\\AppData\\Roaming\\npm\\openclaw.cmd'),
      '"C:\\Users\\u\\AppData\\Roaming\\npm\\openclaw.cmd" --version',
    );
    assert.equal(inst._versionProbeCommand('/usr/local/bin/opencode'), '"/usr/local/bin/opencode" --version');
  });

  it('marker write and read', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._markInstalled('testpkg');
    assert.ok(inst._hasMarker('testpkg'));

    // Check JSON file
    const json = JSON.parse(fs.readFileSync(path.join(tmpDir, 'installed_agents.json'), 'utf-8'));
    assert.ok(json.includes('testpkg'));

    // Check marker file
    assert.ok(fs.existsSync(path.join(tmpDir, 'installed', 'testpkg')));
  });

  it('marker uninstall removes both markers', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._markInstalled('testpkg');
    inst._markUninstalled('testpkg');
    assert.equal(inst._hasMarker('testpkg'), false);

    const json = JSON.parse(fs.readFileSync(path.join(tmpDir, 'installed_agents.json'), 'utf-8'));
    assert.ok(!json.includes('testpkg'));
    assert.ok(!fs.existsSync(path.join(tmpDir, 'installed', 'testpkg')));
  });

  it('getInstallInfo returns installed=true via marker when binary is not detected', () => {
    // Reproduces the Cursor regression: install succeeds → marker written →
    // _whichBinary can't find the binary yet (cache lag or PATH gap) →
    // previously getInstallInfo would delete the marker and report
    // not-installed. Now it must trust the marker.
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => null; // simulate detection miss
    inst._markInstalled('cursor');
    const info = inst.getInstallInfo('cursor');
    assert.equal(info.installed, true);
    assert.equal(info.location, 'marker');
    // Marker must survive the call — previous code destructively unlinked it.
    assert.ok(inst._hasMarker('cursor'));
    assert.ok(fs.existsSync(path.join(tmpDir, 'installed', 'cursor')));
  });

  it('getInstallInfo returns installed=false when no marker and no binary', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => null;
    const info = inst.getInstallInfo('cursor');
    assert.equal(info.installed, false);
    assert.equal(info.location, null);
  });

  it('getInstallInfo reports installed (global) when agent.cmd is found in %LOCALAPPDATA%\\cursor-agent', () => {
    // Windows: the native installer drops agent.cmd into %LOCALAPPDATA%\cursor-agent,
    // outside ~/.openagents. Once the enhanced PATH can see that dir, _whichBinary
    // resolves it and Cursor must read as installed (global/unmanaged, not "Install").
    const inst = new Installer(mockRegistry, tmpDir);
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const agentCmd = path.join(localAppData, 'cursor-agent', 'agent.cmd');
    inst._whichBinary = () => agentCmd;
    const info = inst.getInstallInfo('cursor');
    assert.equal(info.installed, true);
    assert.equal(info.managed, false);
    assert.equal(info.location, 'global');
  });

  it('getInstallInfo reports installed (global) when cursor-agent.cmd is found in %LOCALAPPDATA%\\cursor-agent', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const cursorAgentCmd = path.join(localAppData, 'cursor-agent', 'cursor-agent.cmd');
    inst._whichBinary = () => cursorAgentCmd;
    const info = inst.getInstallInfo('cursor');
    assert.equal(info.installed, true);
    assert.equal(info.managed, false);
    assert.equal(info.location, 'global');
  });

  it('Cursor detection searches cursor-agent/agent, not the cursor editor binary', () => {
    // The "cursor" CLI is the editor launcher (C:\cursor\resources\app\bin\cursor),
    // NOT the agent runtime. Detection must key off cursor-agent / agent only, so a
    // machine with only the editor present is correctly NOT treated as runtime-installed.
    const entry = mockRegistry.getEntry('cursor');
    const names = [entry.install.binary, ...(entry.install.binary_aliases || [])];
    assert.deepEqual(names, ['cursor-agent', 'agent']);
    assert.ok(!names.includes('cursor'), 'editor binary "cursor" must not be a detection name');

    // Editor present but no cursor-agent/agent CLI → _whichBinary misses → not installed.
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => null;
    const info = inst.getInstallInfo('cursor');
    assert.equal(info.installed, false);
  });

  it('detection survives a non-ASCII home/config path (e.g. C:\\Users\\王思瑶)', () => {
    // Regression guard: the reporting user is 王思瑶, installed under
    // C:\Users\王思瑶\AppData\Local\cursor-agent. Path parsing / marker IO / the
    // ~/.openagents prefix comparison must not throw or misclassify on non-ASCII.
    const nonAsciiCfg = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-王思瑶-'));
    try {
      const inst = new Installer(mockRegistry, nonAsciiCfg);
      const nonAsciiBin = path.join(nonAsciiCfg, 'AppData', 'Local', 'cursor-agent', 'agent.cmd');
      inst._whichBinary = () => nonAsciiBin;
      const info = inst.getInstallInfo('cursor');
      assert.equal(info.installed, true);
      assert.equal(info.managed, false);

      // Marker write/read round-trips through the non-ASCII config dir.
      inst._whichBinary = () => null;
      inst._markInstalled('cursor');
      assert.ok(inst._hasMarker('cursor'));
      assert.equal(inst.getInstallInfo('cursor').installed, true);
    } finally {
      fs.rmSync(nonAsciiCfg, { recursive: true, force: true });
    }
  });

  it('_markInstalled invalidates the paths whichBinary cache', () => {
    const { whichBinary, clearBinaryLookupCache } = require('../src/paths');
    const fakeName = `_oa_installer_test_${process.pid}_${Date.now()}`;
    const inst = new Installer(mockRegistry, tmpDir);
    try {
      clearBinaryLookupCache();
      // Prime the cache with a null (binary genuinely doesn't exist).
      assert.equal(whichBinary(fakeName), null);

      // Create a real binary in a fresh dir and put it on PATH — but without
      // a cache invalidation, the previously-cached null would still be
      // returned for `fakeName` even though it now resolves.
      const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inst-cache-'));
      const ext = process.platform === 'win32' ? '.cmd' : '';
      const binFile = path.join(stagingDir, fakeName + ext);
      fs.writeFileSync(binFile, process.platform === 'win32' ? '@echo ok' : '#!/bin/sh\necho ok', 'utf-8');
      if (process.platform !== 'win32') fs.chmodSync(binFile, 0o755);

      const origPATH = process.env.PATH;
      try {
        process.env.PATH = stagingDir + (process.platform === 'win32' ? ';' : ':') + (origPATH || '');
        // _markInstalled must clear the cache so the next lookup sees the
        // freshly-installed binary.
        inst._markInstalled('testpkg');
        const resolved = whichBinary(fakeName);
        assert.ok(resolved, 'expected whichBinary to find the freshly-installed binary after _markInstalled cleared the cache');
      } finally {
        process.env.PATH = origPATH;
        try { fs.unlinkSync(binFile); } catch {}
        try { fs.rmdirSync(stagingDir); } catch {}
      }
    } finally {
      clearBinaryLookupCache();
    }
  });

  it('_deriveUninstallCommand handles npm', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    assert.equal(
      inst._deriveUninstallCommand('npm install -g testpkg@latest'),
      `npm uninstall --prefix "${path.join(os.homedir(), '.openagents', 'nodejs')}" testpkg`
    );
  });

  it('_deriveUninstallCommand handles pip', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    assert.equal(
      inst._deriveUninstallCommand('pip install pipapp'),
      'pip uninstall -y pipapp'
    );
  });

  it('_deriveUninstallCommand handles pipx', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    assert.equal(
      inst._deriveUninstallCommand('pipx install somepkg'),
      'pipx uninstall somepkg'
    );
  });

  it('_deriveUninstallCommand returns null for curl-based installs', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    assert.equal(
      inst._deriveUninstallCommand('curl -fsSL https://example.com/install.sh | bash'),
      null
    );
  });

  it('install throws for unknown agent type', async () => {
    const inst = new Installer(mockRegistry, tmpDir);
    await assert.rejects(() => inst.install('nonexistent'), /No install definition/);
  });

  it('api-only install uses managed markers instead of requiring a binary', async () => {
    const inst = new Installer(mockRegistry, tmpDir);

    assert.deepEqual(inst.getInstallInfo('kimi'), {
      installed: false,
      managed: false,
      location: null,
    });

    await inst.install('kimi');

    assert.deepEqual(inst.getInstallInfo('kimi'), {
      installed: true,
      managed: true,
      location: 'api_only',
    });
    assert.equal(inst.which('kimi'), null);
  });

  it('api-only uninstall removes managed markers without a derived command', async () => {
    const inst = new Installer(mockRegistry, tmpDir);
    await inst.install('kimi');

    const result = await inst.uninstall('kimi');

    assert.equal(result.success, true);
    assert.equal(inst.isInstalled('kimi'), false);
  });

  it('healthCheck supports API-only readiness from Kimi env vars', async () => {
    const inst = new Installer(mockRegistry, tmpDir);
    await inst.install('kimi');
    process.env.MOONSHOT_API_KEY = 'sk-test';

    const health = inst.healthCheck('kimi');

    assert.equal(health.installed, true);
    assert.equal(health.binary, null);
    assert.equal(health.ready, true);
    assert.equal(health.auth_mode, 'api_key');
    assert.equal(health.execution_mode, 'direct');
  });

  it('_getInstallCommand resolves platform-specific command', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    const cmd = inst._getInstallCommand({
      macos: 'brew install x',
      linux: 'apt install x',
      windows: 'choco install x',
    });
    assert.ok(typeof cmd === 'string');
    assert.ok(cmd.length > 0);
  });

  it('_getInstallCommand uses platform installer before npm fallback', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    const cmd = inst._getInstallCommand(mockRegistry.getEntry('cursor').install);

    if (process.platform === 'win32') {
      assert.equal(cmd, "\"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\" -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-RestMethod -UseBasicParsing 'https://cursor.com/install?win32=true' | Invoke-Expression\"");
    } else {
      assert.equal(cmd, 'curl https://cursor.com/install -fsSL | bash');
    }
  });

  it('_wrapForWindowsShell wraps PowerShell-only commands on Windows', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    const original = process.platform;
    try {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      // Bare PS aliases get wrapped
      const wrapped = inst._wrapForWindowsShell("irm 'https://cursor.com/install?win32=true' | iex");
      assert.match(wrapped, /^powershell\.exe -NoProfile -ExecutionPolicy Bypass -Command "/);
      assert.ok(wrapped.includes("cursor.com/install"));

      // Already wrapped: don't double-wrap
      const already = 'powershell -c "irm https://foo | iex"';
      assert.equal(inst._wrapForWindowsShell(already), already);

      const explicitExe = '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "irm x | iex"';
      assert.equal(inst._wrapForWindowsShell(explicitExe), explicitExe);

      // Plain cmd.exe-compatible commands pass through
      const npm = 'npm install -g testpkg@latest';
      assert.equal(inst._wrapForWindowsShell(npm), npm);
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });

  it('_wrapForWindowsShell is a no-op on non-Windows', () => {
    if (process.platform === 'win32') return;
    const inst = new Installer(mockRegistry, tmpDir);
    const cmd = "irm 'https://cursor.com/install' | iex";
    assert.equal(inst._wrapForWindowsShell(cmd), cmd);
  });

  it('healthCheck does not treat OPENAI_API_KEY alone as codex ready', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => 'codex';
    inst._checkStatusCommand = () => false;

    const health = inst.healthCheck('codex');
    assert.equal(health.ready, false);
    assert.equal(health.execution_mode, 'unavailable');
  });

  it('healthCheck marks codex direct mode ready when key and base URL are set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = 'https://api.example.com/v1';
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => 'codex';
    inst._checkStatusCommand = () => false;

    const health = inst.healthCheck('codex');
    assert.equal(health.ready, true);
    assert.equal(health.auth_mode, 'api_key');
    assert.equal(health.execution_mode, 'direct');
  });

  it('healthCheck marks codex subprocess mode ready when login status succeeds', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => 'codex';
    inst._checkStatusCommand = () => true;

    const health = inst.healthCheck('codex');
    assert.equal(health.ready, true);
    assert.equal(health.auth_mode, 'cli_login');
    assert.equal(health.execution_mode, 'subprocess');
  });

  it('healthCheck prefers direct mode when env and CLI login are both available', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = 'https://api.example.com/v1';
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => 'codex';
    inst._checkStatusCommand = () => true;

    const health = inst.healthCheck('codex');
    assert.equal(health.ready, true);
    assert.equal(health.auth_mode, 'api_key');
    assert.equal(health.execution_mode, 'direct');
  });

  it('healthCheck reports codex not configured when env and CLI login both fail', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => 'codex';
    inst._checkStatusCommand = () => false;

    const health = inst.healthCheck('codex');
    assert.equal(health.ready, false);
    assert.equal(
      health.message,
      'Not configured. Set OPENAI_API_KEY + OPENAI_BASE_URL, or run: codex login'
    );
  });
});

describe('Installer auth_status (generic unverifiable flag)', () => {
  it('reports auth_status=ready when a token env var is present', () => {
    process.env.SOME_TOKEN = 'x';
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => 'unverif-bin';
    inst._detectVersion = () => '1.0.0';
    const h = inst.healthCheck('unverif');
    assert.equal(h.ready, true);
    assert.equal(h.auth_status, 'ready');
    delete process.env.SOME_TOKEN;
  });

  it('reports auth_status=unknown (not no_credentials) when unverifiable and no signal', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => 'unverif-bin';
    inst._detectVersion = () => '1.0.0';
    const h = inst.healthCheck('unverif');
    assert.equal(h.ready, false);
    assert.equal(h.auth_status, 'unknown', 'absence of a token must not be claimed as no_credentials');
  });

  it('reports auth_status=no_credentials for a normal (verifiable) agent with no creds', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => 'codex';
    inst._checkStatusCommand = () => false;
    const h = inst.healthCheck('codex');
    assert.equal(h.ready, false);
    assert.equal(h.auth_status, 'no_credentials');
  });
});

describe('compareVersions (generic helper)', () => {
  it('orders versions numerically, not lexically', () => {
    assert.equal(compareVersions('1.2.0', '1.10.0'), -1);
    assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
    assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
  });
  it('ignores pre-release / build suffixes and extra segments', () => {
    assert.equal(compareVersions('1.2.0-beta.3', '1.2.0'), 0);
    assert.equal(compareVersions('0.0.331', '0.0.330'), 1);
    assert.equal(compareVersions('1.2', '1.2.0'), 0);
  });
  it('returns null when a version is unparseable', () => {
    assert.equal(compareVersions('unknown', '1.0.0'), null);
    assert.equal(compareVersions(null, '1.0.0'), null);
    assert.equal(compareVersions('1.0.0', ''), null);
  });
});

describe('Installer min-version gate (generic, no per-agent special-casing)', () => {
  beforeEach(() => clearVersionCache());

  it('passes the gate and stays ready when version >= min_version', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => 'gated-bin';
    inst._detectVersion = () => '1.5.0';
    const h = inst.healthCheck('gated');
    assert.equal(h.installed, true);
    assert.equal(h.compatible, true);
    assert.equal(h.min_version, '1.2.0');
  });

  it('blocks (installed=true, compatible=false, ready=false) when below min_version', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => 'gated-bin';
    inst._detectVersion = () => '1.0.0';
    const h = inst.healthCheck('gated');
    assert.equal(h.installed, true, 'must NOT report not-installed for an old version');
    assert.equal(h.compatible, false);
    assert.equal(h.ready, false);
    assert.match(h.message, /too old|upgrade/i);
  });

  it('reports compatible=null (unknown) — not a false pass — when version cannot be parsed', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => 'gated-bin';
    inst._detectVersion = () => null;
    const h = inst.healthCheck('gated');
    assert.equal(h.installed, true);
    assert.equal(h.compatible, null);
  });

  it('leaves the gate open (compatible=true) for entries without min_version', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => 'codex';
    inst._checkStatusCommand = () => true;
    const h = inst.healthCheck('codex');
    assert.equal(h.compatible, true);
    assert.equal(h.min_version, null);
  });

  it('caches a detected version and serves the same result within the TTL', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    // Use a real, fast version command so the cache path is genuinely exercised.
    const v1 = inst._detectVersion('node', `"${process.execPath}" --version`);
    assert.match(String(v1), /\d+\.\d+/);
    const v2 = inst._detectVersion('node', `"${process.execPath}" --version`);
    assert.equal(v2, v1, 'cached value returned on the second call');
    clearVersionCache();
    const v3 = inst._detectVersion('node', `"${process.execPath}" --version`);
    assert.equal(v3, v1, 're-detection after cache clear yields the same version');
  });
});

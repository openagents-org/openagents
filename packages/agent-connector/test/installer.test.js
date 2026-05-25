'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Installer } = require('../src/installer');

let tmpDir;

const mockRegistry = {
  getEntry: (name) => {
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

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
    return null;
  },
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-inst-'));
});

afterEach(() => {
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
      'npm uninstall -g testpkg'
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
});

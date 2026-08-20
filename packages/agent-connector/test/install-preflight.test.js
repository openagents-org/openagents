'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  checkInstallPrereqs,
  missingPrereqError,
  probeGit,
} = require('../src/install-preflight');

/** A mac with nothing developer-ish installed: no brew git, no CLT, no Xcode. */
const CLEAN_MAC = { platform: 'darwin', dirs: [], developerDir: null, exists: () => false };

test('git probe: a mac with no developer tools reports missing', () => {
  assert.deepStrictEqual(probeGit(CLEAN_MAC), { ok: false });
});

test('git probe: Command Line Tools alone is enough', () => {
  const result = probeGit({
    ...CLEAN_MAC,
    exists: (p) => p === '/Library/Developer/CommandLineTools/usr/bin/git',
  });
  assert.strictEqual(result.ok, true);
});

test('git probe: a full Xcode install is enough', () => {
  const developerDir = '/Applications/Xcode.app/Contents/Developer';
  const result = probeGit({
    ...CLEAN_MAC,
    developerDir,
    exists: (p) => p === `${developerDir}/usr/bin/git`,
  });
  assert.strictEqual(result.ok, true);
});

test('git probe: a Homebrew git satisfies it without touching xcode-select', () => {
  let developerDirRead = false;
  const result = probeGit({
    platform: 'darwin',
    dirs: ['/opt/homebrew/bin'],
    exists: (p) => p === '/opt/homebrew/bin/git',
    get developerDir() {
      developerDirRead = true;
      return null;
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.detail, '/opt/homebrew/bin/git');
  assert.strictEqual(developerDirRead, false, 'should short-circuit before the CLT check');
});

test('git probe: Windows is exempt — install.ps1 downloads PortableGit itself', () => {
  // Refusing here would break every Windows machine where that download works,
  // and it needs no admin rights and shows no dialog. Windows gets a readable
  // error when the download fails instead (see the launcher's install-progress).
  const result = probeGit({ platform: 'win32', dirs: [], exists: () => false });
  assert.strictEqual(result.ok, true);
});

test('git probe: Linux looks at PATH', () => {
  assert.strictEqual(
    probeGit({ platform: 'linux', dirs: ['/usr/bin'], exists: () => false, uid: 1000 }).ok,
    false,
  );
  assert.strictEqual(
    probeGit({ platform: 'linux', dirs: ['/usr/bin'], exists: (p) => p === '/usr/bin/git', uid: 1000 }).ok,
    true,
  );
});

test('git probe: Linux as root is exempt — apt/dnf need no password there', () => {
  const result = probeGit({ platform: 'linux', dirs: [], exists: () => false, uid: 0 });
  assert.strictEqual(result.ok, true);
});

test('git probe: the real machine running these tests has git', () => {
  // Guards the production code path (real PATH, real xcode-select): anything
  // able to check this repo out has git, so a false here means the probe is
  // broken, not the machine.
  assert.strictEqual(probeGit().ok, true);
});

test('checkInstallPrereqs: no requires means nothing to check', () => {
  assert.deepStrictEqual(checkInstallPrereqs({ install: {} }), { ok: true, missing: [] });
  assert.deepStrictEqual(checkInstallPrereqs({}), { ok: true, missing: [] });
  assert.deepStrictEqual(checkInstallPrereqs(null), { ok: true, missing: [] });
});

test('checkInstallPrereqs: a dependency with no probe never blocks an install', () => {
  // hermes lists python3, but its installer provisions Python via uv. Blocking
  // on it would break installs that work today.
  const result = checkInstallPrereqs({ install: { requires: ['python3', 'ruby', 'go'] } });
  assert.deepStrictEqual(result, { ok: true, missing: [] });
});

test('checkInstallPrereqs: hermes declares git', () => {
  const hermes = require('../registry.json').find((e) => e.name === 'hermes');
  assert.ok(hermes.install.requires.includes('git'), 'hermes must require git');
});

test('missingPrereqError: carries a machine-readable payload and a readable message', () => {
  const missing = [
    {
      name: 'git',
      action: 'install-xcode-clt',
      summary: 'Git is required, and it comes with the Xcode Command Line Tools.',
      command: 'xcode-select --install',
      alternative: 'brew install git',
    },
  ];
  const err = missingPrereqError('Hermes Agent', missing);

  assert.strictEqual(err.code, 'MISSING_PREREQ');
  assert.deepStrictEqual(err.missing, missing);
  assert.match(err.message, /Hermes Agent/);
  assert.match(err.message, /xcode-select --install/);
  assert.match(err.message, /brew install git/);
});

test('installer refuses the install instead of spawning a black-box script', () => {
  const { Installer } = require('../src/installer');
  // Bare prototype: the wiring under test is one method, and a real Installer
  // would drag in a config dir and a registry it never touches here.
  const installer = Object.create(Installer.prototype);
  const entry = { label: 'Hermes Agent', install: { requires: ['git'] } };
  const streamed = [];

  const missing = [
    {
      name: 'git',
      action: 'install-xcode-clt',
      summary: 'Git is required, and it comes with the Xcode Command Line Tools.',
      command: 'xcode-select --install',
      alternative: 'brew install git',
    },
  ];

  assert.throws(
    () => installer._assertPrereqs('hermes', entry, (d) => streamed.push(d), () => ({
      ok: false,
      missing,
    })),
    (err) => err.code === 'MISSING_PREREQ' && err.missing === missing,
  );
  // The refusal is streamed too, so it lands in the install log file.
  assert.match(streamed.join(''), /Hermes Agent/);
});

test('installer proceeds when every requirement is met', () => {
  const { Installer } = require('../src/installer');
  const installer = Object.create(Installer.prototype);
  assert.doesNotThrow(() =>
    installer._assertPrereqs('hermes', { install: { requires: ['git'] } }, null, () => ({
      ok: true,
      missing: [],
    })),
  );
});

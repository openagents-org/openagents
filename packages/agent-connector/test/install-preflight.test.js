'use strict';

const test = require('node:test');
const assert = require('node:assert');

const path = require('node:path');

const {
  checkInstallPrereqs,
  missingPrereqError,
  probeGit,
  gitRemedy,
  uvRemedy,
} = require('../src/install-preflight');

// Paths are built with path.join so the expectations match what the probe
// itself builds. Hardcoded POSIX literals passed on macOS/Linux and failed on
// the Windows runner, where path.join yields backslashes — a defect in the
// test, not in the code it covers. Skipping Windows instead would have dropped
// the coverage rather than fixed it.
const HOMEBREW_GIT = path.join('/opt/homebrew/bin', 'git');
const USR_BIN_GIT = path.join('/usr/bin', 'git');

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
  const xcodeGit = path.join(developerDir, 'usr', 'bin', 'git');
  const result = probeGit({
    ...CLEAN_MAC,
    developerDir,
    exists: (p) => p === xcodeGit,
  });
  assert.strictEqual(result.ok, true);
});

test('git probe: a Homebrew git satisfies it without touching xcode-select', () => {
  let developerDirRead = false;
  const result = probeGit({
    platform: 'darwin',
    dirs: ['/opt/homebrew/bin'],
    exists: (p) => p === HOMEBREW_GIT,
    get developerDir() {
      developerDirRead = true;
      return null;
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.detail, HOMEBREW_GIT);
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
    probeGit({ platform: 'linux', dirs: ['/usr/bin'], exists: (p) => p === USR_BIN_GIT, uid: 1000 }).ok,
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

// --- remedies -------------------------------------------------------------
//
// A remedy is read by a user who is stuck, on the platform they are stuck on,
// so both halves have to be right there: the command has to run in the shell
// they will paste it into, and the label above it has to name the tool the
// command actually uses. The launcher used to hardcode that label to Homebrew,
// which on Windows read "Or, if you use Homebrew: pipx install uv" — advice
// that is wrong twice over. The remedies are therefore built per platform and
// carry a `alternativeKind` the UI can label from, instead of a guess.

test('uvRemedy: Windows gets a command that survives cmd.exe, and winget', () => {
  const remedy = uvRemedy('win32');
  // "Run this in a terminal" on Windows is as likely to be cmd.exe as
  // PowerShell, and a bare `irm … | iex` is a syntax error in cmd.
  assert.match(remedy.command, /^powershell -ExecutionPolicy ByPass -c/);
  assert.match(remedy.command, /install\.ps1/);
  assert.strictEqual(remedy.alternative, 'winget install --id=astral-sh.uv -e');
  assert.strictEqual(remedy.alternativeKind, 'winget');
  assert.ok(!/brew/.test(JSON.stringify(remedy)), 'Windows must never be told about Homebrew');
});

test('uvRemedy: Homebrew on macOS, pipx elsewhere', () => {
  const mac = uvRemedy('darwin');
  assert.strictEqual(mac.command, 'curl -LsSf https://astral.sh/uv/install.sh | sh');
  assert.strictEqual(mac.alternative, 'brew install uv');
  assert.strictEqual(mac.alternativeKind, 'homebrew');

  const linux = uvRemedy('linux');
  assert.strictEqual(linux.command, 'curl -LsSf https://astral.sh/uv/install.sh | sh');
  assert.strictEqual(linux.alternative, 'pipx install uv');
  assert.strictEqual(linux.alternativeKind, 'pipx');
});

test('gitRemedy: only macOS offers Homebrew and the Xcode button', () => {
  const mac = gitRemedy('darwin');
  assert.strictEqual(mac.action, 'install-xcode-clt');
  assert.strictEqual(mac.alternativeKind, 'homebrew');

  for (const platform of ['linux', 'win32']) {
    const other = gitRemedy(platform);
    assert.strictEqual(other.action, null, `${platform} has no Xcode installer to open`);
    assert.strictEqual(other.alternative, null);
    assert.strictEqual(other.alternativeKind, null);
  }
});

test('every remedy carries a summaryKey, and a kind whenever it has an alternative', () => {
  // The launcher renders these by key and falls back to `summary` — a remedy
  // with no key is an untranslatable sentence in a translated dialog.
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const remedy of [gitRemedy(platform), uvRemedy(platform)]) {
      const where = `${remedy.name} on ${platform}`;
      assert.ok(remedy.summaryKey, `${where}: missing summaryKey`);
      assert.ok(remedy.summary, `${where}: missing English fallback`);
      assert.ok(remedy.command, `${where}: missing command`);
      assert.strictEqual(
        Boolean(remedy.alternative),
        Boolean(remedy.alternativeKind),
        `${where}: an alternative command and its label must come together`,
      );
    }
  }
});

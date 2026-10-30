/**
 * Pre-flight checks for install commands that shell out to a third-party script.
 *
 * `curl … | bash` installers are black boxes: whatever they decide to do about a
 * missing dependency happens with no way for us to explain it, cancel it, or
 * even show a useful progress line. Hermes is the case that forced this file to
 * exist. Its install.sh needs git to clone the repo, and on a mac with no
 * developer tools it:
 *   1. runs `git --version`, which on macOS is a SHIM that opens the system
 *      "The 'git' command requires the command line developer tools" dialog —
 *      a dialog with no OpenAgents branding, appearing seconds after the user
 *      pressed Install in our marketplace;
 *   2. calls `xcode-select --install`, opening it a second time;
 *   3. sleeps in a 5-second poll loop for up to 900 SECONDS waiting for git to
 *      appear, printing one line per minute.
 * In the launcher that reads as a progress bar frozen on "downloading" for a
 * quarter of an hour, so users retry, which starts the whole thing again.
 *
 * Catching the missing dependency BEFORE spawning the installer turns all of
 * that into one actionable message.
 *
 * Only dependencies with a probe below are enforced. `install.requires` is
 * hand-maintained and partly aspirational — hermes lists python3 even though
 * its installer provisions Python through uv when none is found — so an unknown
 * entry is left to the installer rather than blocking an install that would
 * have worked.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/** Directories on PATH, minus any the caller wants skipped. */
function pathDirs(exclude = []) {
  const raw = process.env.PATH || '';
  return raw
    .split(path.delimiter)
    .map((d) => d.trim())
    .filter((d) => d && !exclude.includes(d));
}

function existsIn(dirs, name, exists, isWindows) {
  const names = isWindows ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  for (const dir of dirs) {
    for (const n of names) {
      const full = path.join(dir, n);
      try {
        if (exists(full)) return full;
      } catch {
        /* unreadable dir on PATH — skip */
      }
    }
  }
  return null;
}

/**
 * The active developer directory, or null when none is selected. `xcode-select
 * -p` is safe to run with no tools installed: it exits 2 and prints to stderr
 * WITHOUT opening the install dialog. Running `git` is what opens it.
 */
function activeDeveloperDir() {
  try {
    return (
      execFileSync('xcode-select', ['-p'], {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

/**
 * Is a REAL git available?
 *
 * The hard constraint on macOS: never execute `git`, and never execute
 * `/usr/bin/git` in particular. That file exists on every mac whether or not
 * the Command Line Tools are installed, and running it is precisely what opens
 * the install dialog we are trying to get ahead of. So this probe only ever
 * touches the filesystem plus `xcode-select -p`, which reports the active
 * developer directory (exit code 2, no dialog, when there is none).
 *
 * Two platforms are deliberately exempt, because on them a missing git is
 * something the installer genuinely recovers from:
 *
 * - **Windows.** install.ps1's Install-Git downloads PortableGit from
 *   github.com into %LOCALAPPDATA%\hermes\git — no admin rights, no dialog, no
 *   winget. It is slow (the script's own comment budgets five minutes) and it
 *   can fail on a restricted network, but blocking the install would break the
 *   many machines where it works. What Windows needs from us is a readable
 *   error when that download fails, not a refusal — see userFacingInstallError
 *   in the launcher.
 * - **Linux as root.** install.sh shells out to apt/dnf/pacman, which succeeds
 *   without a password prompt when we are already root. As a normal user the
 *   sudo call has no tty to ask on and fails, so the refusal stands there.
 *
 * @param {object} [deps] - seams for tests; production passes nothing.
 */
function probeGit(deps = {}) {
  const platform = deps.platform || process.platform;
  const exists = deps.exists || ((p) => fs.existsSync(p));
  const dirs = deps.dirs || null;

  if (platform === 'win32') {
    return { ok: true, detail: 'installer provisions PortableGit itself' };
  }

  if (platform !== 'darwin') {
    const search = dirs || [...pathDirs(), '/usr/bin', '/usr/local/bin'];
    const found = existsIn(search, 'git', exists, false);
    if (found) return { ok: true, detail: found };
    const uid = deps.uid !== undefined ? deps.uid : (process.getuid ? process.getuid() : null);
    if (uid === 0) return { ok: true, detail: 'root can install git unattended' };
    return { ok: false };
  }

  // A git outside /usr/bin (Homebrew, MacPorts, a manual install) is a real
  // binary and safe to trust without running it.
  const search = dirs || [
    ...pathDirs(['/usr/bin']),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const found = existsIn(search, 'git', exists, false);
  if (found) return { ok: true, detail: found };

  // Otherwise the only candidate left is the /usr/bin shim, which forwards to
  // the active developer directory. Resolve that directory and look for the git
  // it would forward to: present means the shim works, absent means running it
  // would open the dialog — which is exactly the case we refuse to walk into.
  const developerDir =
    'developerDir' in deps ? deps.developerDir : activeDeveloperDir();

  const candidates = [];
  if (developerDir) candidates.push(path.join(developerDir, 'usr', 'bin', 'git'));
  candidates.push('/Library/Developer/CommandLineTools/usr/bin/git');
  for (const c of candidates) {
    try {
      if (exists(c)) return { ok: true, detail: c };
    } catch {
      /* ignore */
    }
  }

  return { ok: false };
}

/**
 * How the user fixes each missing dependency, phrased for the install screen.
 *
 * `action` is a hint the launcher UI can turn into a button. `summaryKey` and
 * `alternativeKind` are the same thing for text: the launcher is translated
 * and this package is not, so it looks up its own wording by those keys and
 * keeps `summary` only as the fallback — which is also what the CLI and the
 * install log print. `alternativeKind` in particular has to be carried rather
 * than guessed: the alternative is Homebrew only on macOS, and a UI that
 * labels every alternative "if you use Homebrew" is wrong on two of the three
 * platforms we ship.
 *
 * @param {string} [platform] - seam for tests; production passes nothing.
 */
function gitRemedy(platform = process.platform) {
  if (platform === 'darwin') {
    return {
      name: 'git',
      action: 'install-xcode-clt',
      summaryKey: 'gitXcodeClt',
      summary: 'Git is required, and it comes with the Xcode Command Line Tools.',
      command: 'xcode-select --install',
      alternative: 'brew install git',
      alternativeKind: 'homebrew',
    };
  }
  return {
    name: 'git',
    action: null,
    summaryKey: 'git',
    summary: 'Git is required to download this agent.',
    command: 'sudo apt install git   # or dnf / pacman, per your distro',
    alternative: null,
    alternativeKind: null,
  };
}

/**
 * Is `uv` on PATH?
 *
 * Unlike git, nothing provisions uv for us: an agent whose install command IS
 * `uv tool install …` and whose machine has no uv gets the shell's own
 * "command not found" buried in installer output, several seconds after
 * pressing Install. The probe is a plain filesystem check — running `uv
 * --version` would be the same answer at the cost of a process spawn, and uv
 * has no shim behaviour to catch out the way macOS's /usr/bin/git does.
 *
 * Also checks uv's own default install location, which its installer script
 * adds to PATH via a shell profile a running GUI/daemon never re-read.
 */
function probeUv(deps = {}) {
  const platform = deps.platform || process.platform;
  const exists = deps.exists || ((p) => fs.existsSync(p));
  const home = deps.home || os.homedir();
  const isWindows = platform === 'win32';
  const search = deps.dirs || [
    ...pathDirs(),
    path.join(home, '.local', 'bin'),
    path.join(home, '.cargo', 'bin'),
    ...(isWindows ? [] : ['/opt/homebrew/bin', '/usr/local/bin']),
  ];
  const found = existsIn(search, 'uv', exists, isWindows);
  return found ? { ok: true, detail: found } : { ok: false };
}

/** @param {string} [platform] - seam for tests; production passes nothing. */
function uvRemedy(platform = process.platform) {
  const summary = 'uv is required to install this agent (it is a Python tool).';

  if (platform === 'win32') {
    return {
      name: 'uv',
      action: null,
      summaryKey: 'uv',
      summary,
      // Spelled out instead of a bare `irm … | iex`, because "run this in a
      // terminal" on Windows lands in cmd.exe as often as in PowerShell, and
      // the bare form is a syntax error there.
      command:
        'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
      // pipx is the obvious parallel to Homebrew, but a machine with no uv
      // seldom has pipx either — whereas winget ships with Windows.
      alternative: 'winget install --id=astral-sh.uv -e',
      alternativeKind: 'winget',
    };
  }

  const viaHomebrew = platform === 'darwin';
  return {
    name: 'uv',
    action: null,
    summaryKey: 'uv',
    summary,
    command: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
    alternative: viaHomebrew ? 'brew install uv' : 'pipx install uv',
    alternativeKind: viaHomebrew ? 'homebrew' : 'pipx',
  };
}

const PROBES = {
  git: { probe: probeGit, remedy: gitRemedy },
  uv: { probe: probeUv, remedy: uvRemedy },
};

/**
 * Check a registry entry's `install.requires` against the machine.
 * @returns {{ ok: boolean, missing: Array<{name: string, action: string|null, summary: string, command: string, alternative: string|null}> }}
 */
function checkInstallPrereqs(entry) {
  const requires = entry && entry.install ? entry.install.requires : null;
  if (!Array.isArray(requires) || requires.length === 0) return { ok: true, missing: [] };

  const missing = [];
  for (const name of requires) {
    const spec = PROBES[String(name || '').toLowerCase()];
    if (!spec) continue; // no probe → the installer's problem, not ours
    let result;
    try {
      result = spec.probe();
    } catch {
      continue; // a probe that throws must never block an install
    }
    if (!result || !result.ok) missing.push(spec.remedy());
  }
  return { ok: missing.length === 0, missing };
}

/**
 * The error thrown in place of running the installer. Carries `code` and
 * `missing` so the launcher can render buttons instead of parsing prose, and a
 * message that stands on its own for the CLI and the log.
 */
function missingPrereqError(agentLabel, missing) {
  const lines = [
    `${agentLabel} cannot be installed yet — a required tool is missing.`,
    '',
  ];
  for (const item of missing) {
    lines.push(`• ${item.summary}`);
    lines.push(`  Install it with:  ${item.command}`);
    if (item.alternative) lines.push(`  Or:               ${item.alternative}`);
  }
  lines.push('', 'Once it is installed, come back and press Install again.');

  const err = new Error(lines.join('\n'));
  err.code = 'MISSING_PREREQ';
  err.missing = missing;
  return err;
}

module.exports = {
  checkInstallPrereqs,
  missingPrereqError,
  probeGit,
  probeUv,
  gitRemedy,
  uvRemedy,
};

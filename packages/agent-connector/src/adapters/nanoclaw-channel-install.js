/**
 * Install / verify the native NanoClaw `openagents` channel.
 *
 * The channel source ships with this package (nanoclaw-channel/openagents.ts).
 * Installing it means: copy it to `<home>/src/channels/openagents.ts` and add a
 * marker-delimited `import './openagents.js';` block to `src/channels/index.ts`
 * so it self-registers on host startup — the same thing NanoClaw's own
 * `/add-<channel>` skills do. We never touch the database.
 *
 * This is an EXPLICIT, opt-in action (not run automatically on every adapter
 * start) because it modifies the user's NanoClaw checkout and needs a host
 * restart. It is COMPATIBILITY-GATED and ROLLBACK-SAFE:
 *   - refuses unknown / incompatible NanoClaw versions (no modification);
 *   - verifies the expected dirs + the `ChannelAdapter` interface + the barrel
 *     before touching anything;
 *   - writes atomically and restores the barrel on any failure;
 *   - never overwrites a user's own `openagents.ts` (only files we own);
 *   - edits the barrel via a precise marker block, never fuzzy text replace;
 *   - validates the barrel after editing.
 *
 * If NanoClaw later exposes a formal channel-install entry point, prefer it.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { looksLikeNanoclaw } = require('./nanoclaw-control');

// The EXACT NanoClaw revision this channel was verified against. Auto-install is
// gated on this precise commit (NOT a semver range): a different commit — even
// with the same version number — is treated as unverified.
const VERIFIED = {
  remote: 'https://github.com/nanocoai/nanoclaw',
  version: '2.1.19',
  commit: '625264ba4b9de0a466d10debb267ca9ad688f4c0',
  // The verified commit is the cloned `main` HEAD reporting version 2.1.19.
  // It is NOT confirmed to be a tagged release.
  tag: null,
  // Fingerprint of the ChannelAdapter method signatures in adapter.ts at the
  // verified commit. Extra protection / basis for a future tag+fingerprint
  // allowlist; the auto-install gate remains the exact commit.
  interfaceFingerprint: '6bde65465812d49d',
};
// Commits we will auto-install into without an explicit force. Currently just
// the verified commit; a future release can add {commit, fingerprint} entries.
const AUTO_INSTALL_COMMITS = new Set([VERIFIED.commit]);

// A line present in the shipped channel header — used to recognise a file we own.
const OURS_MARKER = 'OPENAGENTS-CHANNEL v1';
const BARREL_BEGIN = '// >>> openagents channel (OpenAgents Workspace bridge) — managed, do not edit';
const BARREL_IMPORT = "import './openagents.js';";
const BARREL_END = '// <<< openagents channel';
const BARREL_BLOCK = `${BARREL_BEGIN}\n${BARREL_IMPORT}\n${BARREL_END}\n`;

function channelSourcePath() {
  return path.join(__dirname, '..', '..', 'nanoclaw-channel', 'openagents.ts');
}
function channelDestPath(home) {
  return path.join(home, 'src', 'channels', 'openagents.ts');
}
function barrelPath(home) {
  return path.join(home, 'src', 'channels', 'index.ts');
}

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

function getNanoclawVersion(home) {
  const raw = readFileSafe(path.join(home, 'package.json'));
  if (!raw) return null;
  try {
    const v = JSON.parse(raw).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Resolve the checkout's git commit SHA (null if not a git repo / unknown). */
function getNanoclawCommit(home, opts = {}) {
  if (Object.prototype.hasOwnProperty.call(opts, 'commitOverride')) {
    const c = opts.commitOverride;
    return c && /^[0-9a-f]{40}$/.test(c) ? c : null;
  }
  try {
    const out = execFileSync('git', ['-C', home, 'rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const sha = String(out || '').trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** Fingerprint the ChannelAdapter method signatures in adapter.ts. */
function computeInterfaceFingerprint(adapterTs) {
  if (adapterTs == null) return null;
  const sig = (
    adapterTs.match(/(onInbound|onMetadata|onInboundEvent|onAction|deliver|setup|teardown|isConnected|setTyping)\s*\(/g) ||
    []
  )
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(sig).digest('hex').slice(0, 16);
}

/**
 * Structural / interface pre-flight — a HARD gate that even `force` cannot
 * bypass (installing into a checkout with a moved channel API would produce a
 * broken host). Returns {ok, reason, fingerprint}.
 */
function checkStructure(home) {
  const adapterTs = readFileSafe(path.join(home, 'src', 'channels', 'adapter.ts'));
  const registryTs = readFileSafe(path.join(home, 'src', 'channels', 'channel-registry.ts'));
  const configTs = readFileSafe(path.join(home, 'src', 'config.ts'));
  const barrel = readFileSafe(barrelPath(home));
  const missing = [];
  if (adapterTs == null) missing.push('src/channels/adapter.ts');
  if (registryTs == null) missing.push('src/channels/channel-registry.ts');
  if (configTs == null) missing.push('src/config.ts');
  if (barrel == null) missing.push('src/channels/index.ts');
  if (missing.length) return { ok: false, reason: `missing expected files: ${missing.join(', ')}`, fingerprint: null };

  const fingerprint = computeInterfaceFingerprint(adapterTs);
  if (!(/interface\s+ChannelAdapter/.test(adapterTs) && /onInbound\s*\(/.test(adapterTs) && /deliver\s*\(/.test(adapterTs))) {
    return { ok: false, reason: 'ChannelAdapter interface shape not recognised', fingerprint };
  }
  if (!/registerChannelAdapter/.test(registryTs)) return { ok: false, reason: 'registerChannelAdapter not found', fingerprint };
  if (!/DATA_DIR/.test(configTs)) return { ok: false, reason: 'DATA_DIR export not found in config.ts', fingerprint };
  if (!/import\s+['"]\.\//.test(barrel)) return { ok: false, reason: 'index.ts does not look like the channel barrel', fingerprint };
  return { ok: true, reason: null, fingerprint };
}

/**
 * Pre-flight compatibility. Auto-install (`ok:true`, code `verified`) requires
 * BOTH a sound structure AND the EXACT verified commit. A different commit —
 * even with the same version number — is `commit-mismatch`; an undeterminable
 * commit is `unknown`; a moved interface is `incompatible`. None of these
 * auto-install; the checkout is left untouched.
 * @param {string} home
 * @param {{versionOverride?:string, commitOverride?:string|null}} [opts]
 */
function checkCompatibility(home, opts = {}) {
  if (!home || !looksLikeNanoclaw(home)) {
    return { ok: false, code: 'unknown', version: null, commit: null, structureOk: false, reason: `not a NanoClaw checkout: ${home}` };
  }
  const version = opts.versionOverride || getNanoclawVersion(home);
  const structure = checkStructure(home);
  const commit = getNanoclawCommit(home, opts);
  const fingerprintMatch = structure.fingerprint === VERIFIED.interfaceFingerprint;
  const base = { version, commit, structureOk: structure.ok, fingerprint: structure.fingerprint, fingerprintMatch };

  if (!structure.ok) return { ok: false, code: 'incompatible', reason: structure.reason, ...base };
  if (commit && AUTO_INSTALL_COMMITS.has(commit)) {
    return { ok: true, code: 'verified', reason: null, ...base };
  }
  if (!commit) {
    return {
      ok: false,
      code: 'unknown',
      reason: `could not determine the NanoClaw commit (not a git checkout?); auto-install requires the verified commit ${VERIFIED.commit}`,
      ...base,
    };
  }
  return {
    ok: false,
    code: 'commit-mismatch',
    reason: `NanoClaw commit ${commit} is not the verified commit ${VERIFIED.commit}${fingerprintMatch ? ' (interface fingerprint matches, but auto-install still requires the exact commit)' : ''}`,
    ...base,
  };
}

/** Is the channel both present (a file we own) and wired into the barrel? */
function isChannelInstalled(home) {
  const dest = readFileSafe(channelDestPath(home));
  if (dest == null) return false;
  const barrel = readFileSafe(barrelPath(home));
  return !!barrel && barrel.includes(BARREL_IMPORT);
}

/** Does a dest file exist that we did NOT write (a user's own channel)? */
function _destIsForeign(home) {
  const dest = readFileSafe(channelDestPath(home));
  if (dest == null) return false; // no file → not foreign
  return !dest.includes(OURS_MARKER);
}

/** A NanoClaw channels barrel is a list of `import './x.js';` lines (+ comments). */
function _validateBarrel(content) {
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    if (!/^import\s+['"][^'"]+['"];?$/.test(line)) {
      return { ok: false, reason: `unexpected barrel line: ${line.slice(0, 60)}` };
    }
  }
  return { ok: true };
}

/**
 * Copy the channel and add the barrel import. Compatibility-gated, idempotent,
 * rollback-safe.
 * @param {string} home
 * @param {{force?:boolean, versionOverride?:string}} [opts]
 * @returns {{ok:boolean, code?:string, changed:boolean, needsRestart:boolean, error?:string, dest?:string, version?:string}}
 */
function installChannel(home, opts = {}) {
  const compat = checkCompatibility(home, opts);
  const forced = opts.force === true; // OFF by default; admin/CLI only, never a Workspace user

  // Structure is a HARD gate — never bypassable, even with force (installing
  // into a checkout with a moved channel API would just break the host).
  if (!compat.structureOk) {
    return {
      ok: false,
      code: compat.code || 'incompatible',
      changed: false,
      needsRestart: false,
      error: compat.reason,
      version: compat.version,
      commit: compat.commit,
    };
  }
  // Commit gate: auto-install only into the verified commit, unless forced.
  if (!compat.ok && !forced) {
    return {
      ok: false,
      code: compat.code,
      changed: false,
      needsRestart: false,
      error: compat.reason,
      version: compat.version,
      commit: compat.commit,
      hint: 'unverified NanoClaw commit — pass force:true (admin/CLI only) to override',
    };
  }
  if (!compat.ok && forced) {
    // Redacted diagnostic — no secrets, no full paths, commit truncated.
    const diag = {
      code: compat.code,
      version: compat.version,
      commit: compat.commit ? compat.commit.slice(0, 12) : null,
      fingerprintMatch: compat.fingerprintMatch,
    };
    (typeof opts.logger === 'function' ? opts.logger : (m, d) => console.warn(m, d))(
      'NanoClaw channel: FORCED install into an unverified commit',
      diag,
    );
  }

  const src = channelSourcePath();
  if (!fs.existsSync(src)) {
    return { ok: false, code: 'unknown', changed: false, needsRestart: false, error: `channel source missing: ${src}` };
  }
  if (!opts.force && _destIsForeign(home)) {
    return {
      ok: false,
      code: 'foreign-file',
      changed: false,
      needsRestart: false,
      error: 'refusing to overwrite an existing src/channels/openagents.ts not written by OpenAgents (use force to override)',
      dest: channelDestPath(home),
    };
  }

  const dest = channelDestPath(home);
  let changed = false;

  // 1) Copy the channel file atomically (temp + rename); skip if identical.
  let needWrite = opts.force || !fs.existsSync(dest);
  if (!needWrite) needWrite = readFileSafe(dest) !== readFileSafe(src);
  if (needWrite) {
    const tmp = `${dest}.tmp-${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, tmp);
      fs.renameSync(tmp, dest);
      changed = true;
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* best-effort */
      }
      return { ok: false, code: compat.code, changed, needsRestart: false, error: `copy failed: ${e.message}`, dest };
    }
  }

  // 2) Add the barrel import block (marker-delimited; backup + restore on error).
  const barrelFile = barrelPath(home);
  const original = readFileSafe(barrelFile);
  if (original == null) {
    return { ok: false, code: compat.code, changed, needsRestart: changed, error: 'barrel disappeared', dest };
  }
  if (!original.includes(BARREL_IMPORT)) {
    const sep = original.length && !original.endsWith('\n') ? '\n' : '';
    const updated = `${original}${sep}${BARREL_BLOCK}`;
    const check = _validateBarrel(updated);
    if (!check.ok) {
      return { ok: false, code: compat.code, changed, needsRestart: changed, error: `barrel validation failed: ${check.reason}`, dest };
    }
    const tmp = `${barrelFile}.tmp-${process.pid}`;
    try {
      fs.writeFileSync(tmp, updated);
      fs.renameSync(tmp, barrelFile);
      // Post-edit re-read validation: our import present + original preserved.
      const after = readFileSafe(barrelFile);
      if (!after || !after.includes(BARREL_IMPORT) || !after.includes(original.trim().split('\n')[0])) {
        fs.writeFileSync(barrelFile, original); // restore
        return { ok: false, code: compat.code, changed, needsRestart: changed, error: 'post-edit barrel validation failed; restored', dest };
      }
      changed = true;
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* best-effort */
      }
      try {
        fs.writeFileSync(barrelFile, original); // restore
      } catch {
        /* best-effort */
      }
      return { ok: false, code: compat.code, changed, needsRestart: changed, error: `barrel patch failed (restored): ${e.message}`, dest };
    }
  }

  return {
    ok: true,
    code: forced && !compat.ok ? 'forced' : compat.code,
    changed,
    needsRestart: changed,
    dest,
    version: compat.version,
    commit: compat.commit,
    forced: forced && !compat.ok,
  };
}

/** Remove ONLY what we injected: our channel file (if ours) + our barrel block. */
function uninstallChannel(home) {
  let changed = false;
  const dest = channelDestPath(home);
  const destContent = readFileSafe(dest);
  if (destContent != null && destContent.includes(OURS_MARKER)) {
    try {
      fs.unlinkSync(dest);
      changed = true;
    } catch {
      /* best-effort */
    }
  }
  const barrelFile = barrelPath(home);
  const barrel = readFileSafe(barrelFile);
  if (barrel != null && barrel.includes(BARREL_IMPORT)) {
    // Remove our marker block precisely; fall back to removing just our import line.
    let updated = barrel.replace(
      new RegExp(`${_escapeRe(BARREL_BEGIN)}\\n${_escapeRe(BARREL_IMPORT)}\\n${_escapeRe(BARREL_END)}\\n?`, 'g'),
      '',
    );
    if (updated === barrel) {
      updated = barrel
        .split('\n')
        .filter((l) => l.trim() !== BARREL_IMPORT && l.trim() !== BARREL_BEGIN && l.trim() !== BARREL_END)
        .join('\n');
    }
    if (updated !== barrel) {
      try {
        fs.writeFileSync(barrelFile, updated);
        changed = true;
      } catch {
        /* best-effort */
      }
    }
  }
  return { ok: true, changed };
}

function _escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  VERIFIED,
  AUTO_INSTALL_COMMITS,
  OURS_MARKER,
  channelSourcePath,
  channelDestPath,
  barrelPath,
  getNanoclawVersion,
  getNanoclawCommit,
  computeInterfaceFingerprint,
  checkStructure,
  checkCompatibility,
  isChannelInstalled,
  installChannel,
  uninstallChannel,
  BARREL_IMPORT,
};

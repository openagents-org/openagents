'use strict';

/**
 * Which release of an npm agent can run on the Node that will run it.
 *
 * Every npm agent is installed and run on one Node — the portable runtime in
 * ~/.openagents/nodejs. npm only warns when a package's `engines.node` rules
 * that Node out, so `npm install <pkg>` happily fetches a `latest` the runtime
 * cannot start, and some packages then refuse on their own: openclaw's
 * preinstall exits 1 below its floor (2026.9.3 → Node 24.16, 2026.10.6 →
 * 24.22.1). The launcher's Install button already held such packages back to
 * the newest release that runs; a workspace's remote "create agent" goes
 * through the daemon and this installer instead, and failed outright.
 *
 * Mirrors the launcher's main/agents/node-engines.ts + npm-registry.ts. The
 * grammar read is what packages write in `engines.node`: comparators
 * (>= > <= < =), bare and partial versions (22, 22.1, 22.x, *), caret, tilde,
 * hyphen ranges and `||`. Anything else answers null ("can't tell"), which
 * counts as compatible: a wrong "no" would hold an agent back for nothing.
 */

const https = require('https');
const http = require('http');

const PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/;

function parsePartial(s) {
  const m = PARTIAL.exec(s);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].map((p) => (p === undefined || /^[xX*]$/.test(p) ? null : Number(p)));
  const wild = parts.indexOf(null);
  return wild === -1 ? parts : parts.map((p, i) => (i < wild ? p : null));
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** One comparator as the [lo, hi) interval it allows, or null when unreadable. */
function toInterval(comparator) {
  const m = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(comparator);
  const parts = m && parsePartial(m[2]);
  if (!m || !parts) return null;
  const op = m[1] || '=';
  const [major, minor, patch] = parts;
  if (major === null) return op === '<' || op === '>' ? null : {};
  const lo = [major, minor ?? 0, patch ?? 0];
  const next = minor === null ? [major + 1, 0, 0]
    : patch === null ? [major, minor + 1, 0]
      : [major, minor, patch + 1];
  switch (op) {
    case '>=': return { lo };
    case '>': return { lo: next };
    case '<': return { hi: lo };
    case '<=': return { hi: next };
    case '~': return { lo, hi: minor === null ? [major + 1, 0, 0] : [major, minor + 1, 0] };
    case '^': return {
      lo,
      hi: major > 0 || minor === null ? [major + 1, 0, 0]
        : minor > 0 || patch === null ? [0, minor + 1, 0]
          : [0, 0, patch + 1],
    };
    default: return { lo, hi: next };
  }
}

function parseSet(set) {
  const s = set.trim();
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(s);
  const comparators = hyphen
    ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`]
    : s.replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').split(/\s+/).filter(Boolean);
  const out = [];
  for (const c of comparators) {
    const interval = toInterval(c);
    if (!interval) return null;
    out.push(interval);
  }
  return out;
}

/** true / false when the range can be read, null when it can't. */
function nodeSatisfies(version, range) {
  const v = parsePartial(String(version || '').trim());
  if (!v || v.includes(null)) return null;
  let unreadable = false;
  for (const set of String(range).split('||')) {
    const intervals = parseSet(set);
    if (!intervals) { unreadable = true; continue; }
    if (intervals.every(({ lo, hi }) => (!lo || compare(v, lo) >= 0) && (!hi || compare(v, hi) < 0))) return true;
  }
  return unreadable ? null : false;
}

function compareVersionsDesc(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return y - x;
  }
  return 0;
}

function nodeEngineRange(info, version) {
  const range = info && info.versions && info.versions[version] && info.versions[version].engines
    && info.versions[version].engines.node;
  return typeof range === 'string' && range.trim() ? range : null;
}

/**
 * The version to install on `nodeVersion`: `latest` when it accepts that Node,
 * else the newest earlier stable release that does. `latest` comes back
 * unchanged when the Node is unknown or nothing accepts it — npm or the
 * package then says why in its own words.
 */
function resolveInstallableVersion(info, nodeVersion) {
  const versions = Object.keys((info && info.versions) || {});
  const latest = (info && info['dist-tags'] && info['dist-tags'].latest)
    || versions.filter((v) => /^\d/.test(v) && !v.includes('-')).sort(compareVersionsDesc)[0]
    || null;
  if (!latest || !nodeVersion) return latest;
  const runs = (v) => {
    const range = nodeEngineRange(info, v);
    return !range || nodeSatisfies(nodeVersion, range) !== false;
  };
  if (runs(latest)) return latest;
  const older = versions
    .filter((v) => /^\d/.test(v) && !v.includes('-'))
    .sort(compareVersionsDesc)
    .find((v) => compareVersionsDesc(v, latest) > 0 && runs(v));
  return older || latest;
}

/** npm's abbreviated packument: dist-tags plus each version's engines. */
function fetchPackument(registry, pkg, { timeoutMs = 10000 } = {}) {
  const url = `${String(registry).replace(/\/+$/, '')}/${encodeURIComponent(pkg).replace('%40', '@')}`;
  const get = (target, hops) => new Promise((resolve, reject) => {
    const mod = target.startsWith('https:') ? https : http;
    const req = mod.get(target, { headers: { Accept: 'application/vnd.npm.install-v1+json' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 3) {
        res.resume();
        get(new URL(res.headers.location, target).toString(), hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('npm registry timeout')));
  });
  return get(url, 0);
}

/** `openclaw`, `openclaw@latest`, `@scope/pkg@latest` → the package name; null for a pinned spec. */
function unpinnedPackage(arg) {
  const m = /^(@[^/@\s]+\/[^@\s]+|[^@\s][^@\s]*)(?:@(.*))?$/.exec(String(arg || ''));
  if (!m) return null;
  const spec = m[2];
  return spec === undefined || spec === '' || spec === 'latest' ? m[1] : null;
}

module.exports = {
  nodeSatisfies,
  resolveInstallableVersion,
  fetchPackument,
  unpinnedPackage,
};

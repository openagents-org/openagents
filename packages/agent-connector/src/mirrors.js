'use strict';

/**
 * Region-aware download origins.
 *
 * The core downloads a portable Node.js runtime (nodejs.org) and talks to the
 * npm registry. Both are slow to unusable from mainland China, which shows up
 * as an install that appears to hang. Mirrors carry byte-identical copies under
 * the same path layout, so the only decision is which origin to try first —
 * every list keeps the official one as the final fallback.
 *
 * Where the region comes from, in order:
 *   1. OPENAGENTS_NODE_MIRRORS / OPENAGENTS_NPM_MIRRORS — explicit, comma
 *      separated base URLs. The launcher sets these from its own Settings →
 *      Network preference so the core inherits the user's actual choice
 *      instead of guessing again in a child process.
 *   2. OPENAGENTS_DOWNLOAD_REGION = cn | global — explicit override for CLI
 *      users and support.
 *   3. Timezone / locale detection (best effort).
 */

const OFFICIAL_NODE = 'https://nodejs.org/dist';
const CN_NODE = [
  'https://cdn.npmmirror.com/binaries/node',
  'https://mirrors.aliyun.com/nodejs-release',
  'https://mirrors.huaweicloud.com/nodejs',
];
const OFFICIAL_NPM = 'https://registry.npmjs.org';
const CN_NPM = [
  'https://registry.npmmirror.com',
  'https://mirrors.cloud.tencent.com/npm',
];

function envBases(name) {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => /^https?:\/\//.test(s));
}

function inChina() {
  const region = (process.env.OPENAGENTS_DOWNLOAD_REGION || '').toLowerCase();
  if (region === 'cn') return true;
  if (region === 'global') return false;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (/Shanghai|Chongqing|Chungking|Urumqi|Harbin|Kashgar|PRC/i.test(tz)) return true;
  } catch {}
  const locale = (process.env.LC_ALL || process.env.LANG || '').toLowerCase();
  if (locale.startsWith('zh_cn') || locale.startsWith('zh-cn')) return true;
  return false;
}

function bases(envName, official, mirrors) {
  const fromEnv = envBases(envName);
  if (fromEnv.length) {
    // Trust the caller's list, but never drop the official origin entirely —
    // a mirror outage must still degrade to "slow", not "broken".
    return fromEnv.includes(official) ? fromEnv : [...fromEnv, official];
  }
  return inChina() ? [...mirrors, official] : [official];
}

/** Candidate URLs for a Node dist path, e.g. "v22.22.3/node-v22.22.3-darwin-arm64.tar.gz". */
function nodeDistUrls(relPath) {
  return bases('OPENAGENTS_NODE_MIRRORS', OFFICIAL_NODE, CN_NODE).map(
    (base) => `${base}/${relPath}`
  );
}

/** Candidate URLs for an npm registry path, e.g. "@scope/pkg/latest". */
function npmUrls(relPath) {
  return bases('OPENAGENTS_NPM_MIRRORS', OFFICIAL_NPM, CN_NPM).map(
    (base) => `${base}/${relPath}`
  );
}

/** Registry base for `npm install --registry`. */
function npmRegistry() {
  return process.env.npm_config_registry || npmUrls('').slice(0, 1)[0].replace(/\/$/, '');
}

/** A registry the user (or the launcher) has already chosen, if any. */
function userConfiguredRegistry() {
  if (process.env.npm_config_registry) return process.env.npm_config_registry;
  try {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const rc = fs.readFileSync(path.join(os.homedir(), '.npmrc'), 'utf-8');
    const match = /^\s*registry\s*=\s*(\S+)/m.exec(rc);
    if (match) return match[1];
  } catch {}
  return null;
}

/**
 * Registry to force via `--registry` when installing an agent runtime, or null
 * to leave npm's own resolution alone.
 *
 * Agent runtimes are the biggest download of a first run (a CLI plus its whole
 * dependency tree), and they install through a child npm process where our own
 * mirror logic can't reach — the flag is the only lever. It stays null unless
 * we'd actually be helping: an explicit npm_config_registry or a registry in
 * the user's .npmrc (corporate proxy, private mirror) is honoured as-is.
 */
function installRegistry() {
  if (userConfiguredRegistry()) return null;
  return inChina() ? CN_NPM[0] : null;
}

module.exports = {
  nodeDistUrls,
  npmUrls,
  npmRegistry,
  installRegistry,
  userConfiguredRegistry,
  inChina,
};

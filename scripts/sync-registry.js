#!/usr/bin/env node
'use strict';

/**
 * One registry, many consumers.
 *
 * `registry/` is the source of truth. Everything else that carries agent
 * metadata is generated from it:
 *
 *   registry/<name>.json  ─┬─→  packages/agent-connector/registry.json  (one array)
 *                          └─→  workspace/backend/registry/<name>.json  (file per agent)
 *
 * Before this script existed those three were kept in step by hand, and they
 * had already drifted: workspace's kimi.json carried a `resolve_env` block the
 * other two had never seen, and the bundled copy carried a gemini description
 * and a hermes `check_ready` that `registry/` did not. The generator that was
 * supposed to prevent this (`build-registry.js`) had been pointing at
 * `src/openagents/registry` since the SDK moved under `sdk/`, so every run
 * failed and the bundled file quietly became hand-maintained.
 *
 * Usage:
 *   node scripts/sync-registry.js           write the generated copies
 *   node scripts/sync-registry.js --check   verify only; exit 1 on drift (CI)
 *
 * Icons are handled differently on purpose — see syncIcons() below.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'registry');
const SOURCE_ICONS = path.join(SOURCE_DIR, 'icons');
const INDEX_FILE = path.join(SOURCE_DIR, 'index.json');

const BUNDLED_FILE = path.join(ROOT, 'packages', 'agent-connector', 'registry.json');
const WORKSPACE_DIR = path.join(ROOT, 'workspace', 'backend', 'registry');

/**
 * Every directory that needs an icon for an agent in the registry.
 *
 * These are NOT mirrors of registry/icons. Two of them hold icons that have no
 * registry entry at all (provider logos, the yaml-agent placeholder), and the
 * two under packages/ hold `fill="currentColor"` UI icons that follow the app
 * theme, where registry/ and the workspace frontend hold the tile artwork with
 * its own background. `pi.svg` differs between the two families for exactly
 * that reason. So an icon is only ever COPIED IN WHEN MISSING, never
 * overwritten — the check reports what is absent and leaves what is there.
 */
const ICON_DIRS = [
  path.join(ROOT, 'packages', 'agent-connector', 'icons'),
  path.join(WORKSPACE_DIR, 'icons'),
  path.join(ROOT, 'packages', 'launcher', 'src', 'renderer', 'public', 'icons'),
  path.join(ROOT, 'workspace', 'frontend', 'public', 'icons', 'agents'),
];

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/** Compare ignoring line endings — checkouts differ on autocrlf. */
const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/** Read the source of truth, and fail loudly on anything the index disagrees with. */
function loadSource() {
  const names = readJson(INDEX_FILE);
  if (!Array.isArray(names)) {
    throw new Error(`${rel(INDEX_FILE)} must be an array of agent names`);
  }

  const onDisk = fs
    .readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => f.slice(0, -'.json'.length))
    .sort();

  const missing = names.filter((n) => !onDisk.includes(n));
  if (missing.length) {
    throw new Error(`listed in index.json but no registry/<name>.json: ${missing.join(', ')}`);
  }
  const unlisted = onDisk.filter((n) => !names.includes(n));
  if (unlisted.length) {
    throw new Error(`registry/<name>.json exists but is not in index.json: ${unlisted.join(', ')}`);
  }

  const entries = names.map((name) => {
    const entry = readJson(path.join(SOURCE_DIR, `${name}.json`));
    if (entry.name !== name) {
      throw new Error(`registry/${name}.json has name "${entry.name}" — filename and name must match`);
    }
    return entry;
  });

  return { names, entries };
}

/**
 * The bundled catalog agent-connector ships: one array, in index.json order
 * (which is the curated display order, not the alphabetical order the old
 * generator produced).
 */
function syncBundled(entries, check, drift) {
  const want = JSON.stringify(entries, null, 2) + '\n';
  const have = fs.existsSync(BUNDLED_FILE) ? fs.readFileSync(BUNDLED_FILE, 'utf-8') : null;

  if (have !== null && sameText(have, want)) return;

  if (check) {
    drift.push(
      have === null
        ? `${rel(BUNDLED_FILE)} is missing`
        : `${rel(BUNDLED_FILE)} is out of date`
    );
    return;
  }
  fs.writeFileSync(BUNDLED_FILE, want, 'utf-8');
  console.log(`  wrote ${rel(BUNDLED_FILE)} (${entries.length} entries)`);
}

/** The workspace backend reads a file per agent, plus its own index.json. */
function syncWorkspace(names, check, drift) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  let written = 0;

  const copy = (fromFile, toFile) => {
    const want = fs.readFileSync(fromFile, 'utf-8');
    const have = fs.existsSync(toFile) ? fs.readFileSync(toFile, 'utf-8') : null;
    if (have !== null && sameText(have, want)) return;
    if (check) {
      drift.push(have === null ? `${rel(toFile)} is missing` : `${rel(toFile)} is out of date`);
      return;
    }
    fs.writeFileSync(toFile, want, 'utf-8');
    written++;
  };

  for (const name of names) {
    copy(path.join(SOURCE_DIR, `${name}.json`), path.join(WORKSPACE_DIR, `${name}.json`));
  }
  copy(INDEX_FILE, path.join(WORKSPACE_DIR, 'index.json'));

  // An agent dropped from the registry has to leave the mirror too, or the
  // workspace keeps offering something the launcher can no longer install.
  const stale = fs
    .readdirSync(WORKSPACE_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => f.slice(0, -'.json'.length))
    .filter((n) => !names.includes(n));

  for (const name of stale) {
    const file = path.join(WORKSPACE_DIR, `${name}.json`);
    if (check) {
      drift.push(`${rel(file)} is no longer in the registry`);
      continue;
    }
    fs.unlinkSync(file);
    console.log(`  removed ${rel(file)}`);
  }

  if (!check && written) console.log(`  wrote ${written} file(s) under ${rel(WORKSPACE_DIR)}`);
}

/**
 * Icons: fill the gaps, never overwrite.
 *
 * The consuming directories are not mirrors (see ICON_DIRS above), so a
 * blanket copy would replace a themed UI icon with tile artwork. What IS worth
 * catching is an agent in the registry with no icon in a directory that needs
 * one — that ships as a blank tile.
 */
function syncIcons(entries, check, drift) {
  let copied = 0;

  for (const entry of entries) {
    const key = (entry.logo && entry.logo.key) || entry.name;
    const source = path.join(SOURCE_ICONS, `${key}.svg`);
    if (!fs.existsSync(source)) {
      drift.push(`${rel(source)} is missing — ${entry.name} has no source icon`);
      continue;
    }

    for (const dir of ICON_DIRS) {
      const target = path.join(dir, `${key}.svg`);
      if (fs.existsSync(target)) continue;
      if (check) {
        drift.push(`${rel(target)} is missing`);
        continue;
      }
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(source, target);
      console.log(`  copied ${rel(target)}`);
      copied++;
    }
  }

  if (!check && copied) console.log(`  filled ${copied} missing icon(s)`);
}

function main() {
  const check = process.argv.includes('--check');
  const drift = [];

  const { names, entries } = loadSource();
  if (!check) console.log(`registry/ → ${entries.length} agents`);

  syncBundled(entries, check, drift);
  syncWorkspace(names, check, drift);
  syncIcons(entries, check, drift);

  if (check) {
    if (drift.length) {
      console.error('Registry copies have drifted from registry/:\n');
      for (const line of drift) console.error(`  - ${line}`);
      console.error('\nRun: node scripts/sync-registry.js');
      process.exit(1);
    }
    console.log(`registry is in sync (${entries.length} agents)`);
    return;
  }

  // Problems the writing pass cannot fix on its own still have to surface.
  if (drift.length) {
    console.error('\nUnresolved:');
    for (const line of drift) console.error(`  - ${line}`);
    process.exit(1);
  }
  console.log('registry is in sync');
}

main();

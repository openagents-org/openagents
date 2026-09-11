'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const SYNC_SCRIPT = path.join(ROOT, 'scripts', 'sync-registry.js');
const SOURCE_DIR = path.join(ROOT, 'registry');

/**
 * `registry/` is the source of truth; this package's registry.json and the
 * workspace backend's copy are generated from it.
 *
 * This test is the thing that keeps them honest. Before it existed the three
 * copies were synced by hand and had already drifted in three places — a
 * `resolve_env` block only the workspace had, a gemini description and a
 * hermes `check_ready` only the bundle had. Each of those is a live bug for
 * whichever consumer holds the stale copy.
 *
 * Skipped when run from an installed package, where only this directory ships.
 */
const inRepo = fs.existsSync(SYNC_SCRIPT) && fs.existsSync(SOURCE_DIR);

describe('registry sync', { skip: inRepo ? false : 'not running inside the repo' }, () => {
  test('every generated copy matches registry/', () => {
    try {
      execFileSync(process.execPath, [SYNC_SCRIPT, '--check'], {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch (err) {
      // The script prints exactly what drifted and how to fix it — surfacing
      // that beats a bare "exit code 1".
      assert.fail(`${err.stderr || ''}${err.stdout || ''}`.trim());
    }
  });

  test('the bundled catalog is in the registry index order', () => {
    const names = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'index.json'), 'utf-8'));
    const bundled = require('../registry.json');
    assert.deepEqual(
      bundled.map((e) => e.name),
      names,
      'registry.json must carry every agent in index.json, in that order',
    );
  });

  test('every agent the launcher can install resolves to an icon', () => {
    const bundled = require('../registry.json');
    for (const entry of bundled) {
      const key = (entry.logo && entry.logo.key) || entry.name;
      const icon = path.join(SOURCE_DIR, 'icons', `${key}.svg`);
      assert.ok(fs.existsSync(icon), `${entry.name} has no icon at registry/icons/${key}.svg`);
    }
  });
});

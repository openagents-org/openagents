'use strict';

/**
 * Pins the "installed vs login_required vs not_installed" split for Amp at the
 * core readiness layer (installer.healthCheck), so the Install page and the
 * Agents list can never disagree:
 *   - amp binary resolves, no creds  → installed:true,  ready:false, reason
 *     'login_required', and the message is NOT "Not installed".
 *   - amp binary missing             → installed:false, ready:false, reason
 *     'not_installed', message "Not installed".
 *   - amp binary resolves + API key  → installed:true,  ready:true,  reason
 *     'ready'.
 *
 * Run: node --test test/amp-readiness.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { Installer, clearVersionCache } = require('../src/installer');

const AMP_NOT_READY =
  'Amp is installed but not signed in — run: amp login or set AMP_API_KEY';

const mockRegistry = {
  // EnvManager.resolve() consults resolve_env rules; none for amp.
  getResolveRules: () => [],
  getEntry: (name) =>
    name === 'amp'
      ? {
          name: 'amp',
          label: 'Amp (Sourcegraph)',
          install: {
            binary: 'amp',
            macos: 'curl -fsSL https://ampcode.com/install.sh | bash',
            linux: 'curl -fsSL https://ampcode.com/install.sh | bash',
          },
          check_ready: {
            login_command: 'amp login',
            // legacy single-key env probe so a saved AMP_API_KEY counts as ready
            env_vars: ['AMP_API_KEY'],
            saved_env_key: 'AMP_API_KEY',
            not_ready_message: AMP_NOT_READY,
          },
        }
      : null,
};

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-ready-'));
  clearVersionCache();
});
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('Amp readiness reason — installer.healthCheck', () => {
  it('binary resolves, no creds → installed + login_required (NOT "not installed")', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => '/usr/local/bin/amp'; // resolved off PATH
    const h = inst.healthCheck('amp');

    assert.equal(h.installed, true, 'binary resolved → installed');
    assert.equal(h.ready, false, 'no creds → not ready');
    assert.equal(h.reason, 'login_required');
    assert.doesNotMatch(
      String(h.message),
      /not installed/i,
      'an installed agent must never say "not installed"',
    );
  });

  it('binary missing → not installed (reason not_installed, message "Not installed")', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => null;
    const h = inst.healthCheck('amp');

    assert.equal(h.installed, false);
    assert.equal(h.ready, false);
    assert.equal(h.reason, 'not_installed');
    assert.equal(h.message, 'Not installed');
  });

  it('binary resolves + saved AMP_API_KEY → ready', () => {
    // Persist a type-level AMP_API_KEY so _evaluateReadiness sees a credential.
    const envDir = path.join(tmpDir, 'env');
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(path.join(envDir, 'amp.env'), 'AMP_API_KEY=sgp_test_key\n');

    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => '/usr/local/bin/amp';
    const h = inst.healthCheck('amp');

    assert.equal(h.installed, true);
    assert.equal(h.ready, true);
    assert.equal(h.reason, 'ready');
  });
});

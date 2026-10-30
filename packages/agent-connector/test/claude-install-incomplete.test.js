'use strict';

/**
 * A Claude Code install whose postinstall never ran leaves a placeholder where
 * the native binary goes. On Windows that is a `claude.exe` the OS will not
 * start, and every message came back as "Error processing message: spawn
 * EFTYPE" — thousands of times a day on one agent, with nothing a user could
 * act on. The adapter now says what is wrong and how to fix it.
 *
 * Run: node --test test/claude-install-incomplete.test.js
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ClaudeAdapter = require('../src/adapters/claude');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-stub-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function adapterWithBinary(bin) {
  return Object.assign(Object.create(ClaudeAdapter.prototype), {
    _findClaudeBinary: () => bin,
  });
}

describe('Claude — placeholder binary', () => {
  it('refuses to build a command around the postinstall placeholder', () => {
    const stub = path.join(dir, 'claude.exe');
    fs.writeFileSync(stub, 'echo "Error: claude native binary not installed." >&2\nexit 1\n');
    assert.throws(
      () => adapterWithBinary(stub)._buildClaudeCmd('hi', 'general'),
      (e) => e.message === ClaudeAdapter.INSTALL_INCOMPLETE,
    );
  });

  it('names the fix', () => {
    assert.match(ClaudeAdapter.INSTALL_INCOMPLETE, /Reinstall Claude Code from the launcher/);
    assert.match(ClaudeAdapter.INSTALL_INCOMPLETE, /--ignore-scripts=false/);
  });
});

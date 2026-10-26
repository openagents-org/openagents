'use strict';

/**
 * Hermes keeps one provider in its config.yaml for every agent on the device.
 * configureNativeAuth points it at a custom endpoint for a keyed agent; an
 * agent that later moves to the `hermes setup` sign-in has to get back the
 * provider that replaced, or it keeps calling the custom endpoint with a key
 * that may be gone (the 401 in OA-031).
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HermesAdapter = require('../src/adapters/hermes');

const SIGNED_IN = [
  '# Hermes config',
  'model:',
  '  default: hermes-4-405b',
  '  provider: nous',
  '',
  'agent:',
  '  max_turns: 60',
  '',
].join('\n');

const CUSTOM = [
  '# Hermes config',
  'model:',
  '  default: gpt-oss-20b',
  '  provider: custom',
  '  base_url: https://relay.example/v1',
  '  api_key: sk-relay',
  '',
  'agent:',
  '  max_turns: 60',
  '',
].join('\n');

let dir;
let configFile;
let recordFile;
let savedRecordFile;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-hermes-auth-'));
  configFile = path.join(dir, 'config.yaml');
  recordFile = path.join(dir, 'native-auth', 'hermes.json');
  savedRecordFile = HermesAdapter.nativeAuthRecordFile;
  HermesAdapter.nativeAuthRecordFile = () => recordFile;
});

afterEach(() => {
  HermesAdapter.nativeAuthRecordFile = savedRecordFile;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** What configureNativeAuth does around its `hermes config set` calls. */
function pointAtRelay(before, after) {
  fs.writeFileSync(configFile, after);
  HermesAdapter.recordNativeAuth(configFile, before, after);
}

// Hermes's own config.yaml: commented-out examples in column 0 sit inside
// `model:`, and `hermes config set model.api_key` appends the key after them.
const HERMES_LAYOUT_BEFORE = [
  'model:',
  '  default: "anthropic/claude-opus-4.6"',
  '  provider: "auto"',
  '  base_url: "https://openrouter.ai/api/v1"',
  '  # api_key: sk-...',
  '# providers:',
  '#   meta:',
  '#     base_url: https://api.meta.ai/v1',
  '',
  '# Kanban',
  'kanban:',
  '  review_dispatch: true',
  '',
].join('\n');

const HERMES_LAYOUT_AFTER = [
  'model:',
  '  default: "gpt-5.6-terra"',
  '  provider: "custom"',
  '  base_url: "https://relay.example/v1"',
  '  # api_key: sk-...',
  '# providers:',
  '#   meta:',
  '#     base_url: https://api.meta.ai/v1',
  '',
  '# Kanban',
  '  api_key: sk-relay',
  'kanban:',
  '  review_dispatch: true',
  '',
].join('\n');

describe('Hermes model lines', () => {
  it('reads the section line and the keys configureNativeAuth sets', () => {
    assert.deepEqual(HermesAdapter.modelLines(SIGNED_IN), {
      header: 'model:',
      default: '  default: hermes-4-405b',
      provider: '  provider: nous',
      base_url: null,
      api_key: null,
    });
  });

  it('finds the key Hermes appends after column-0 comments, not a commented one', () => {
    const lines = HermesAdapter.modelLines(HERMES_LAYOUT_AFTER);
    assert.equal(lines.api_key, '  api_key: sk-relay');
    assert.equal(HermesAdapter.modelLines(HERMES_LAYOUT_BEFORE).api_key, null);
  });

  it('ignores keys of the same name deeper in, or in another section', () => {
    const text = 'model:\n  provider: nous\n  extra:\n    base_url: x\nother:\n  api_key: y\n';
    const lines = HermesAdapter.modelLines(text);
    assert.equal(lines.base_url, null);
    assert.equal(lines.api_key, null);
  });

  it('is all null when the config has no model section', () => {
    assert.deepEqual(Object.values(HermesAdapter.modelLines('agent:\n  max_turns: 60\n')), [null, null, null, null, null]);
  });

  it('puts back only those lines, comments between them untouched', () => {
    const out = HermesAdapter.restoreModelLines(HERMES_LAYOUT_AFTER, HermesAdapter.modelLines(HERMES_LAYOUT_BEFORE));
    assert.equal(out, HERMES_LAYOUT_BEFORE);
  });

  it('keeps CRLF line endings', () => {
    const out = HermesAdapter.restoreModelLines(CUSTOM.replace(/\n/g, '\r\n'), HermesAdapter.modelLines(SIGNED_IN));
    assert.equal(out, SIGNED_IN.replace(/\n/g, '\r\n'));
  });

  it('turns a mapping back into the plain `model: <id>` it was', () => {
    const before = 'model: anthropic/claude-sonnet-4\nagent: {}\n';
    const after = 'model:\n  provider: custom\n  base_url: https://relay.example/v1\nagent: {}\n';
    assert.equal(HermesAdapter.restoreModelLines(after, HermesAdapter.modelLines(before)), before);
  });
});

describe('Hermes native auth restore', () => {
  it('hands back the provider the custom endpoint replaced', () => {
    pointAtRelay(SIGNED_IN, CUSTOM);
    assert.deepEqual(HermesAdapter.restoreNativeAuth(), { restored: true });
    assert.equal(fs.readFileSync(configFile, 'utf8'), SIGNED_IN);
    assert.equal(fs.existsSync(recordFile), false);
  });

  it('keeps the first original across later endpoints', () => {
    pointAtRelay(SIGNED_IN, CUSTOM);
    const second = CUSTOM.replace('relay.example', 'relay2.example');
    pointAtRelay(CUSTOM, second);
    HermesAdapter.restoreNativeAuth();
    assert.equal(fs.readFileSync(configFile, 'utf8'), SIGNED_IN);
  });

  it('keeps the comments around the key Hermes appended', () => {
    pointAtRelay(HERMES_LAYOUT_BEFORE, HERMES_LAYOUT_AFTER);
    assert.deepEqual(HermesAdapter.restoreNativeAuth(), { restored: true });
    assert.equal(fs.readFileSync(configFile, 'utf8'), HERMES_LAYOUT_BEFORE);
  });

  it('removes the section when Hermes had none before', () => {
    const bare = '# Hermes config\n\nagent:\n  max_turns: 60\n';
    pointAtRelay(bare, CUSTOM);
    HermesAdapter.restoreNativeAuth();
    assert.equal(fs.readFileSync(configFile, 'utf8'), bare);
  });

  it('leaves a section the user changed since alone', () => {
    pointAtRelay(SIGNED_IN, CUSTOM);
    const theirs = CUSTOM.replace('provider: custom', 'provider: openrouter');
    fs.writeFileSync(configFile, theirs);
    assert.equal(HermesAdapter.restoreNativeAuth().skipped, true);
    assert.equal(fs.readFileSync(configFile, 'utf8'), theirs);
    assert.equal(fs.existsSync(recordFile), false);
  });

  it('does nothing without a record', () => {
    fs.writeFileSync(configFile, CUSTOM);
    assert.deepEqual(HermesAdapter.restoreNativeAuth(), { skipped: true, reason: 'nothing recorded' });
    assert.equal(fs.readFileSync(configFile, 'utf8'), CUSTOM);
  });

  it('does not copy the key it wrote into the record', () => {
    pointAtRelay(SIGNED_IN, CUSTOM);
    assert.doesNotMatch(fs.readFileSync(recordFile, 'utf8'), /sk-relay/);
  });
});

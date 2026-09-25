'use strict';

// Hermes -Q mode splits streams: response body on stdout, session_id (and the
// resume banner) on stderr. These tests pin that contract so the adapter never
// regresses to single-stream parsing (which produced either a null session_id
// or an empty response body, depending on which stream it read).

const test = require('node:test');
const assert = require('node:assert');

const HermesAdapter = require('../src/adapters/hermes.js');

// ponytail: Object.create instead of full construction — the parse helper is a
// pure function on the prototype; the constructor's workspace client is
// irrelevant here and would drag in network config.
const probe = Object.create(HermesAdapter.prototype);

const parse = (stdout, stderr) => probe._parseHermesOutput(stdout, stderr);

test('hermes parse: body from stdout, session_id from stderr', () => {
  const { text, sessionId } = parse('NOTED', '\nsession_id: 20260920_131441_9b2bfe');
  assert.strictEqual(sessionId, '20260920_131441_9b2bfe');
  assert.strictEqual(text, 'NOTED');
});

test('hermes parse: resume banner on stderr is not part of the body', () => {
  const stderr =
    '↻ Resumed session 20260920_131441_9b2bfe "..." (1 user message, 2 total messages)\n\nsession_id: 20260920_131441_9b2bfe';
  const { text, sessionId } = parse('BANANA-42', stderr);
  assert.strictEqual(sessionId, '20260920_131441_9b2bfe');
  assert.strictEqual(text, 'BANANA-42');
});

test('hermes parse: legacy Hermes printed session_id on stdout', () => {
  const { text, sessionId } = parse('session_id: old_style_123\nBODY_OLD', '');
  assert.strictEqual(sessionId, 'old_style_123');
  assert.strictEqual(text, 'BODY_OLD');
});

test('hermes parse: no session_id anywhere yields null, body untouched', () => {
  const { text, sessionId } = parse('JUST_A_BODY', '');
  assert.strictEqual(sessionId, null);
  assert.strictEqual(text, 'JUST_A_BODY');
});

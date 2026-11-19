'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { workspaceWebBase, workspaceWebUrl } = require('../src/web-url');

test('hosted endpoints map to the hosted web app', () => {
  assert.strictEqual(workspaceWebBase('https://workspace-endpoint.openagents.org'), 'https://workspace.openagents.org');
  assert.strictEqual(workspaceWebBase('https://workspace-endpoint-preview.openagents.org/'), 'https://workspace-preview.openagents.org');
  assert.strictEqual(workspaceWebBase(''), 'https://workspace.openagents.org');
});

test('self-hosted /api endpoints map to the same origin', () => {
  assert.strictEqual(workspaceWebUrl('abc', 'https://agents.example.com/api'), 'https://agents.example.com/abc');
  assert.strictEqual(workspaceWebUrl('abc', 'https://agents.example.com/api/'), 'https://agents.example.com/abc');
});

test('local endpoints keep their origin', () => {
  assert.strictEqual(workspaceWebUrl('abc', 'http://localhost:8000'), 'http://localhost:8000/abc');
});

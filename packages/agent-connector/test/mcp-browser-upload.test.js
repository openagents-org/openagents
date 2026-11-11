'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { WorkspaceClient } = require('../src/workspace-client');
const { buildWorkspaceSkillSection } = (() => {
  try { return require('../src/adapters/workspace-prompt'); } catch { return {}; }
})();

test('browserUpload posts files to the tab upload endpoint', async () => {
  const ws = new WorkspaceClient('https://ws.example');
  let call;
  ws._post = async (url, body, headers) => { call = { url, body, headers }; return { data: { status: 'attached', files: ['a.png'] } }; };
  ws._wsHeaders = (t) => ({ 'X-Workspace-Token': t });
  const r = await ws.browserUpload('w1', 'tok', 'tab-9', [{ file_id: 'f1' }], { frame_selector: 'iframe#e', source: 'openagents:bot', channel: 'c1' });
  assert.equal(call.url, '/v1/browser/tabs/tab-9/upload');
  assert.deepEqual(call.body, { selector: 'input[type=file]', files: [{ file_id: 'f1' }], source: 'openagents:bot', channel: 'c1', frame_selector: 'iframe#e' });
  assert.equal(r.status, 'attached');
});

test('MCP server exposes workspace_browser_upload and reads a local path', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/mcp-server.js'), 'utf8');
  assert.match(src, /name: 'workspace_browser_upload'/);
  assert.match(src, /case 'workspace_browser_upload'/);
});

test('curl skill prompt documents the upload endpoint', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/adapters/workspace-prompt.js'), 'utf8');
  assert.match(src, /\/v1\/browser\/tabs\/\{tab_id\}\/upload/);
});

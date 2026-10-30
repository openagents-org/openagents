'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

it('connects with a legacy workspace token after successful resolution, without a device pairing', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agn-manual-connect-'));
  const cli = path.resolve(__dirname, '../bin/agent-connector.js');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 200, data: { workspace_id: 'workspace-id', slug: 'legacy', name: 'Legacy workspace' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, HOME: home, USERPROFILE: home, OPENAGENTS_SKIP_UPDATE_CHECK: '1',
    OPENAGENTS_ENDPOINT: `http://127.0.0.1:${server.address().port}` };
  const run = args => exec(process.execPath, [cli, ...args, '--config', home], { env, timeout: 15000 });
  try {
    await run(['create', 'legacy-agent', '--type', 'claude']);
    const { stdout } = await run(['connect', 'legacy-agent', 'test-workspace-token']);
    assert.match(stdout, /connected to workspace 'Legacy workspace'/);
    assert.doesNotMatch(stdout, /test-workspace-token|chosen is not defined/);
    const { Config } = require('../src/config');
    const config = new Config(home);
    assert.equal(config.getAgent('legacy-agent').network, 'legacy');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(home, { recursive: true, force: true });
  }
});

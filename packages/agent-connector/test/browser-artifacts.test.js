'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { WorkspaceClient } = require('../src/workspace-client');
const { McpServer } = require('../src/mcp-server');

it('carries the working conversation on every browser tool, including read operations', async () => {
  const ws = new WorkspaceClient();
  const calls = [];
  ws._post = async (path, body) => { calls.push({path, body}); return {data:{id:'tab'}}; };
  ws._getRaw = async path => { calls.push({path}); return Buffer.from('snapshot'); };
  const server = new McpServer({wsClient:ws,workspaceId:'workspace',channelName:'general',agentName:'claude-dev',token:'test-token'});
  server._write = () => {};
  for (const name of ['open','navigate','click','type','snapshot','screenshot']) {
    await server._handleToolCall(1,{name:`workspace_browser_${name}`,arguments:{tab_id:'tab',url:'https://example.com',selector:'input',text:'hi'}});
  }
  assert.equal(calls.length,6);
  for (const call of calls) {
    const values=call.body || Object.fromEntries(new URL(call.path,'https://workspace.test').searchParams);
    assert.equal(values.channel,'general');
    assert.equal(values.source,'openagents:claude-dev');
  }
});

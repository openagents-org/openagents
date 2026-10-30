'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {WorkspaceClient} = require('../src/workspace-client');
const {buildToolDefs} = require('../src/mcp-server');
test('project create and update use stable ID and workspace identity', async()=>{
  const client = new WorkspaceClient('https://example.test'); const calls=[];
  client._post=async(...args)=>{calls.push(args);return {data:{id:'p',revision:'v1'}};};
  client._put=async(...args)=>{calls.push(args);return {data:{id:'p',revision:'v2'}};};
  const bundle={title:'Dashboard',files:[{path:'index.html',content_base64:'eA=='}],visibility:'inherit',channel_name:'general'};
  assert.equal((await client.publishWebProject('w','t',bundle)).id,'p');
  await client.publishWebProject('w','t',{...bundle,expected_revision:'v1'},'p');
  assert.equal(calls[0][0],'/v1/web-projects');
  assert.equal(calls[1][0],'/v1/web-projects/p');
  assert.equal(calls[1][1].expected_revision,'v1');
  assert.equal(calls[1][1].network,'w');
  assert.equal(calls[1][2]['X-Workspace-Token'],'t');
});
test('project publishing follows the files module setting',()=>{
  assert.ok(buildToolDefs(new Set()).some(t=>t.name==='workspace_publish_project'));
  assert.ok(!buildToolDefs(new Set(['files'])).some(t=>t.name==='workspace_publish_project'));
});

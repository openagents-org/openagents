'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { decidePermission } = require('../src/adapters/opencode-server-run');
const config = { workspaceId:'ws',token:'secret',channel:'thread',agentName:'test' };
const permission = { id:'per_1',permission:'external_directory',patterns:['/tmp/fixture/*'] };
it('waits for a human and grants only this request once', async () => {
  let posted;
  const client = {createApproval:async (...args) => {posted=args[2];return {id:'a',status:'pending'};},
    getApproval:async () => ({id:'a',status:'approved',resolved_by:'human@example.com'})};
  assert.equal(await decidePermission(client,config,permission,{pollMs:1}), 'once');
  assert.equal(posted.require_human,true);
  assert.equal(posted.resume_in_place,true);
  assert.deepEqual(JSON.parse(posted.details).patterns,permission.patterns);
});
it('fails closed when an older server auto-approves despite require_human', async () => {
  await assert.rejects(decidePermission({createApproval:async () => ({status:'approved',resolved_by:'policy'})},config,permission), /human-required/);
});
for (const status of ['rejected','expired','unknown']) it(`does not grant ${status} approvals`, async () => {
  assert.equal(await decidePermission({createApproval:async () => ({status})},config,permission),'reject');
});
it('a pending request timing out never becomes approval', async () => {
  assert.equal(await decidePermission({createApproval:async () => ({id:'a',status:'pending'})},config,permission,{timeoutMs:0}),'reject');
});
it('stopping while waiting prevents permission being granted', async () => {
  const controller = new AbortController();
  const client={createApproval:async () => ({id:'a',status:'pending'}),getApproval:async () => {controller.abort();return {status:'approved',resolved_by:'human'};}};
  await assert.rejects(decidePermission(client,config,permission,{signal:controller.signal,pollMs:1}),/abort/i);
});
it('does not truncate the scope a human is asked to approve', async () => {
  await assert.rejects(decidePermission({},config,{...permission,metadata:{command:'x'.repeat(5000)}}),/too large/);
});

it('cannot grant native access from a workspace-token decision', async () => {
  await assert.rejects(decidePermission({createApproval:async () => ({status:'approved',resolved_by:'token'})},config,permission), /human-required/);
});

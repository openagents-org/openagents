'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const BaseAdapter = require('../src/adapters/base');
const { publishResponseArtifacts, localDocumentLinks, MAX_BYTES } = require('../src/adapters/response-artifacts');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'response-artifacts-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'report.html'), '<h1>Report</h1>');
  return root;
}
test('publishes a linked output and returns an attachment with an unambiguous file link', async t => {
  const root = await fixture(t); const calls = [];
  const result = await publishResponseArtifacts({ content:`Created [report.html](${root}/report.html).`,workingDir:root,
    upload:async (...args)=>{calls.push(args);return {id:'file-1',filename:'documents/report.html'};} });
  assert.equal(calls.length,1);
  assert.equal(Buffer.from(calls[0][1],'base64').toString(),'<h1>Report</h1>');
  assert.equal(calls[0][2],'text/html');
  assert.equal(result.content,'Created [report.html](/v1/files/file-1).');
  assert.equal(result.attachments[0].file_id,'file-1');
});
test('never uploads external links, code examples, private directories, or paths outside the working directory', async t => {
  const root=await fixture(t);const outside=await fs.mkdtemp(path.join(os.tmpdir(),'outside-artifacts-'));
  t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  await fs.writeFile(path.join(outside,'secret.md'),'secret');
  await fs.symlink(path.join(outside,'secret.md'),path.join(root,'escape.md'));
  await fs.mkdir(path.join(root,'.private'));await fs.writeFile(path.join(root,'.private/secret.md'),'secret');
  const result=await publishResponseArtifacts({workingDir:root,content:`[outside](${outside}/secret.md) [escape](escape.md) [private](.private/secret.md) [site](https://example.com/report.html)\n\`\`\`md\n[example](report.html)\n\`\`\``,upload:async()=>assert.fail('must not upload')});
  assert.deepEqual(result.attachments,[]);
});
test('supports encoded paths and skips missing or oversized files without dropping the reply',async t=>{
  const root=await fixture(t);await fs.writeFile(path.join(root,'my notes.md'),'# Notes');
  await fs.writeFile(path.join(root,'large.html'),Buffer.alloc(MAX_BYTES+1));
  const errors=[];const calls=[];
  const result=await publishResponseArtifacts({workingDir:root,content:'[notes](my%20notes.md) [large](large.html) [missing](missing.md)',upload:async(name)=>{calls.push(name);return{id:'notes'};},onError:e=>errors.push(e)});
  assert.deepEqual(calls,['my notes.md']);assert.equal(errors.length,1);
  assert.match(result.content,/\[notes\]\(\/v1\/files\/notes\)/);
  assert.equal(localDocumentLinks('[report](report.html#section)').length,1);
});
test('upload failures preserve the answer and original link',async t=>{
  const root=await fixture(t);const content='[Report](report.html)';
  const result=await publishResponseArtifacts({workingDir:root,content,upload:async()=>{throw Error('offline');}});
  assert.equal(result.content,content);assert.deepEqual(result.attachments,[]);
});
test('final response attaches the published artifact and honors the disabled files module',async t=>{
  const root=await fixture(t);const a=new BaseAdapter({workspaceId:'ws',channelName:'general',token:'token',agentName:'bot',workingDir:root});
  a._responseOutboxDirectory = path.join(root, 'outbox');
  const sent=[];let uploads=0;
  a.client={uploadFile:async()=>{uploads++;return{id:'file-1'};},sendMessage:async(...args)=>sent.push(args)};
  await a.sendResponse('general','[Report](report.html)');
  assert.equal(sent[0][4].attachments[0].file_id,'file-1');
  assert.equal(sent[0][4].metadata.status_kind,'completed');
  a.disabledModules=new Set(['files']);await a.sendResponse('general','[Report](report.html)');
  assert.equal(uploads,1);assert.equal(sent[1][3],'[Report](report.html)');
});

'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runServer } = require('../src/adapters/opencode-server-run');

// A protocol fixture, not a model: exercises the real subprocess, HTTP and SSE
// lifecycle, including a paused request and a lost event stream.
const source = `
const http = require('node:http');
let stream;
const send = (type, properties) => stream.write('data: '+JSON.stringify({type,properties})+'\\n\\n');
const server = http.createServer(async(req,res)=>{
 const expected = 'Basic '+Buffer.from('openagents:'+process.env.OPENCODE_SERVER_PASSWORD).toString('base64');
 if(req.headers.authorization!==expected){res.writeHead(401);return res.end();}
 if(process.env.OPENAGENTS_OPENCODE_BRIDGE){res.writeHead(500);return res.end();}
 const url=new URL(req.url,'http://localhost');
 if(url.searchParams.get('directory')!==process.cwd()){res.writeHead(400);return res.end();}
 let body='';for await(const chunk of req)body+=chunk;
 res.setHeader('Content-Type','application/json');
 if(url.pathname==='/session'){return res.end(JSON.stringify({id:'test-session'}));}
 if(url.pathname==='/event'){
  res.setHeader('Content-Type','text/event-stream');stream=res;res.flushHeaders();return;
 }
 if(url.pathname==='/session/test-session/prompt_async'){
  res.writeHead(204);res.end();
  setImmediate(()=>{
   send('session.status',{sessionID:'test-session',status:{type:'busy'}});
   if(process.env.FIXTURE_MODE==='disconnect')return stream.end();
   send('permission.asked',{id:'permission-1',sessionID:'test-session',permission:'external_directory',patterns:['/fixture/*']});
  });return;
 }
 if(url.pathname==='/permission/permission-1/reply'){
  const reply=JSON.parse(body).reply;
  if(reply!=='once'&&reply!=='reject'){res.writeHead(400);return res.end();}
  res.end('true');
  send('message.part.updated',{part:{id:'tool-1',sessionID:'test-session',type:'tool',tool:'read',state:{status:reply==='once'?'completed':'error',error:reply==='reject'?'The user rejected permission to use this specific tool call.':undefined}}});
  send('session.status',{sessionID:'test-session',status:{type:'idle'}});return;
 }
 if(url.pathname==='/session/test-session/message'&&req.method==='GET'){
  return res.end(JSON.stringify([{info:{role:'assistant'},parts:[{id:'text-1',type:'text',text:'done'}]}]));
 }
 res.writeHead(404);res.end();
});
server.listen(0,'127.0.0.1',()=>console.log('OpenCode server listening on http://127.0.0.1:'+server.address().port));
`;
async function fixture(fn) {
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'opencode-server-test-')));
 const binary=path.join(dir,'opencode');
 fs.writeFileSync(binary,'#!'+process.execPath+'\n'+source,{mode:0o700});
 try {await fn({binary,cwd:dir,model:'provider/model',prompt:'read fixture',env:{...process.env,OPENAGENTS_OPENCODE_BRIDGE:'must not leak'}});}
 finally {fs.rmSync(dir,{recursive:true,force:true});}
}
for(const reply of ['once','reject'])it(`native server passes ${reply} and recovers final text after idle`, {skip:process.platform==='win32'},()=>fixture(async config=>{
 const events=[];let requested=0;
 await runServer({...config,emit:(type,data)=>events.push({type,...data}),approve:async(p)=>{requested++;assert.equal(p.id,'permission-1');return reply;}});
 assert.equal(requested,1);
 assert.equal(events.find(e=>e.type==='tool_use').part.state.status,reply==='once'?'completed':'error');
 assert.equal(events.find(e=>e.type==='text').part.text,'done');
}));
it('event stream loss fails instead of leaving a paused subprocess', {skip:process.platform==='win32'},()=>fixture(async config=>{
 await assert.rejects(runServer({...config,env:{...config.env,FIXTURE_MODE:'disconnect'},emit:()=>{},approve:async()=>{throw Error('unexpected approval');}}),/stopped|disconnected|abort/i);
}));
it('stop while awaiting approval shuts down the native server', {skip:process.platform==='win32'},()=>fixture(async config=>{
 const controller=new AbortController();
 await assert.rejects(runServer({...config,signal:controller.signal,emit:()=>{},approve:async()=>{controller.abort();return 'once';}}),/stopped|abort/i);
}));

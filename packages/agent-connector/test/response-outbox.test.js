'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { ResponseOutbox } = require('../src/adapters/response-outbox');
const { WorkspaceClient, SessionRevokedError } = require('../src/workspace-client');
const BaseAdapter = require('../src/adapters/base');

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-replies-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logs = [];
  const config = { directory, prepare: async entry => ({ safeRetry: true }), send: async () => {}, log: m => logs.push(m), onRevoked: () => {}, ...overrides };
  return { directory, config, logs, outbox: new ResponseOutbox(config) };
}
function makeDue(outbox) {
  for (const file of fs.readdirSync(outbox.directory)) {
    const entry = JSON.parse(fs.readFileSync(path.join(outbox.directory, file)));
    entry.nextAttemptAt = 0;
    outbox.save(entry);
  }
}

test('saved reply survives a 503 and restart with the same key, content and requester', async t => {
  const { outbox, config, directory } = fixture(t, { send: async () => { throw Object.assign(new Error('unavailable'), { status: 503 }); } });
  await outbox.enqueue({ channel: 'issue-work-1', content: 'Full report', metadata: { in_reply_to: 'request-1' } });
  const file = path.join(directory, fs.readdirSync(directory)[0]);
  const saved = JSON.parse(fs.readFileSync(file));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(saved.blocked, false);
  let sent;
  const restarted = new ResponseOutbox({ ...config, send: async entry => { sent = entry; } });
  makeDue(restarted);
  await restarted.flush();
  assert.equal(sent.id, saved.id);
  assert.equal(sent.content, 'Full report');
  assert.equal(sent.metadata.in_reply_to, 'request-1');
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('ambiguous HTTP delivery retries the same idempotency key', async t => {
  const received = new Map(); let calls = 0;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      const message = JSON.parse(body); calls++;
      received.set(message.idempotency_key, message.payload.content);
      if (calls === 1) req.socket.destroy();
      else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: { id: message.idempotency_key } })); }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const client = new WorkspaceClient(`http://127.0.0.1:${server.address().port}`);
  const { outbox, directory } = fixture(t, { send: entry => client.sendMessage('ws', entry.channel, 'token', entry.content, { senderName: 'agent', idempotencyKey: entry.id }) });
  await outbox.enqueue({ channel: 'general', content: 'One answer' });
  makeDue(outbox); await Promise.all([outbox.flush(), outbox.flush()]);
  assert.equal(calls, 2); assert.equal(received.size, 1);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('permanent rejection and legacy-server ambiguous failures are retained without repeated sends', async t => {
  for (const [status, safeRetry] of [[403, true], [503, false]]) {
    let sends = 0;
    const { outbox, directory } = fixture(t, { prepare: async () => ({ safeRetry }), send: async () => { sends++; throw Object.assign(new Error('failed'), { status }); } });
    await outbox.enqueue({ channel: 'general', content: 'Answer' });
    makeDue(outbox); await outbox.flush();
    assert.equal(sends, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, fs.readdirSync(directory)[0]))).blocked, true);
  }
});

test('revocation stops delivery and keeps the reply for the next authenticated session', async t => {
  let revoked = 0;
  const { outbox, directory } = fixture(t, { send: async () => { throw new SessionRevokedError(); }, onRevoked: () => revoked++ });
  await outbox.enqueue({ channel: 'general', content: 'Answer' });
  assert.equal(revoked, 1); assert.equal(fs.readdirSync(directory).length, 1);
});

test('an outage in one channel preserves ordering without blocking another channel', async t => {
  let failing = true; const sent = [];
  const { outbox } = fixture(t, { send: async e => {
    if (e.channel === 'a' && failing) throw Object.assign(new Error('offline'), { status: 503 });
    sent.push(e.content);
  } });
  await outbox.enqueue({ channel: 'a', content: 'first' });
  await outbox.enqueue({ channel: 'a', content: 'second' });
  await outbox.enqueue({ channel: 'b', content: 'independent' });
  assert.deepEqual(sent, ['independent']);
  failing = false; makeDue(outbox); await outbox.flush();
  assert.deepEqual(sent, ['independent', 'first', 'second']);
});

test('adapter captures the original trigger and retries with its current session', async t => {
  const { directory } = fixture(t);
  const adapter = new BaseAdapter({ workspaceId: 'ws', agentName: 'agent', token: 'SECRET' });
  adapter._responseOutboxDirectory = directory; adapter._log = () => {};
  adapter._sessionId = 'old-session'; adapter._channelTriggerId = { general: 'first-request' };
  let failing = true; const sent = [];
  adapter.client = { supportsMessageDelivery: async () => true, sendMessage: async (...args) => {
    sent.push(args); if (failing) throw Object.assign(new Error('unavailable'), { status: 503 });
  } };
  await adapter.sendResponse('general', 'Answer');
  const saved = fs.readFileSync(path.join(directory, fs.readdirSync(directory)[0]), 'utf8');
  assert.ok(!saved.includes('SECRET') && !saved.includes('old-session'));
  adapter._channelTriggerId.general = 'new-request'; adapter._sessionId = 'new-session';
  failing = false; makeDue(adapter._replyOutbox()); await adapter._flushResponses();
  assert.equal(sent[1][4].metadata.in_reply_to, 'first-request');
  assert.equal(sent[1][4].sessionId, 'new-session');
  assert.equal(sent[0][4].idempotencyKey, sent[1][4].idempotencyKey);
});

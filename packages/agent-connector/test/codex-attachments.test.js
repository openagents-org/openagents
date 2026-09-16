'use strict';

/**
 * Codex attachments and Direct API mode empty replies.
 *
 * A PRD uploaded to a Codex agent never reached it: the adapter ignored
 * msg.attachments, so the CLI saw only the filename. In Direct API mode a
 * relay's in-band error, a non-stream body or a reasoning-only reply all
 * resolved to '' and surfaced as "finished without producing a reply", and a
 * relay that accepted the request and then went quiet hung forever, because
 * Node's `timeout` option only emits an event and never aborts. Resuming a
 * thread passed -C after `resume`, which the CLI rejects, so every follow-up
 * silently started a brand new session.
 * Synthetic fixtures only: a stubbed spawn and a local HTTP server.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const CodexAdapter = require('../src/adapters/codex');
const { formatAttachmentsForPrompt } = require('../src/adapters/utils');

// What the web UI sends: the filename is the workspace path the upload got,
// browsers upload .md as octet-stream, and the url is the browser's own.
const PRD = {
  fileId: 'f-prd',
  filename: 'uploaded_files/20260914_095400_客户交付AI系统_v2.0_PRD.md',
  contentType: 'application/octet-stream',
  url: 'https://browser.example/api/v1/files/f-prd?token=viewer-token',
};
const PRD_LOCAL = '20260914_095400_客户交付AI系统_v2.0_PRD.md';

function fakeAdapter(overrides = {}) {
  const adapter = Object.create(CodexAdapter.prototype);
  const sent = [];
  Object.assign(adapter, {
    channelName: 'general',
    workspaceId: 'ws1',
    token: 'agent-token-1',
    endpoint: 'https://ws.example',
    agentEnv: {},
    workingDir: '',
    _directApiKey: '',
    _directBaseUrl: '',
    _directModel: '',
    _channelThreads: {},
    _channelProcesses: {},
    _conversationHistory: [],
    sent,
    _log() {},
    _saveSessions() {},
    _autoTitleChannel: async () => {},
    _buildSystemContext: () => 'SYSTEM',
    sendStatus: async () => {},
    sendResponse: async (channel, content) => { sent.push({ kind: 'response', channel, content }); },
    sendError: async (channel, content) => { sent.push({ kind: 'error', channel, content }); },
  }, overrides);
  return adapter;
}

// ---------------------------------------------------------------------------
// Shared helper: where curl writes the download
// ---------------------------------------------------------------------------

describe('formatAttachmentsForPrompt — curl download target', () => {
  it('downloads a web upload to its bare name, since curl -o makes no folders', () => {
    const text = formatAttachmentsForPrompt([PRD], 'skills', false, { endpoint: 'https://ws.example' });
    assert.ok(text.includes(`-o /tmp/${PRD_LOCAL}\n`));
    assert.ok(text.includes(`Read tool on /tmp/${PRD_LOCAL}`));
    assert.ok(!text.includes('/tmp/uploaded_files/'));
    assert.ok(text.includes(`File: ${PRD.filename}`), 'the workspace path is still named');
  });

  it('does the same on Windows', () => {
    const text = formatAttachmentsForPrompt([PRD], 'skills', true, { endpoint: 'https://ws.example' });
    assert.ok(text.includes(`-o $env:TEMP/${PRD_LOCAL}\n`));
    assert.ok(!text.includes('$env:TEMP/uploaded_files/'));
  });
});

// ---------------------------------------------------------------------------
// CLI mode
// ---------------------------------------------------------------------------

describe('Codex CLI mode — attachments reach the prompt', () => {
  async function run(msg) {
    let prompt = null;
    const adapter = fakeAdapter({
      _useCliMode: true,
      _codexBin: 'codex',
      _spawnCodex: async (cmd, env, channel, p) => {
        prompt = p;
        return { responseText: 'read it', exitCode: 0 };
      },
    });
    await adapter._handleMessage({ sessionId: 'general', ...msg });
    return { adapter, prompt };
  }

  it('tells Codex how to download the file with curl', async () => {
    const { adapter, prompt } = await run({ content: PRD.filename, attachments: [PRD] });
    assert.ok(prompt.includes(`User message:\n${PRD.filename}\n[Attached files]`));
    assert.ok(prompt.includes('file_id: f-prd'));
    assert.ok(prompt.includes(
      'curl -s -H "X-Workspace-Token: agent-token-1" "https://ws.example/v1/files/f-prd"',
    ));
    assert.deepStrictEqual(adapter.sent.map((s) => s.kind), ['response']);
  });

  it("names no tool Codex doesn't have and no shell variable it can't expand", async () => {
    const { prompt } = await run({ content: 'see file', attachments: [PRD] });
    assert.ok(!prompt.includes('workspace_read_file'));
    assert.ok(!prompt.includes('$TOKEN'));
  });

  it("never passes on the browser's URL or the viewer's token", async () => {
    const { prompt } = await run({ content: 'see file', attachments: [PRD] });
    assert.ok(!prompt.includes('browser.example'));
    assert.ok(!prompt.includes('viewer-token'));
  });

  it('handles a file sent with no text instead of dropping it', async () => {
    const { prompt } = await run({ content: '', attachments: [PRD] });
    assert.ok(prompt && prompt.includes('file_id: f-prd'));
  });

  it('still ignores a message with neither text nor files', async () => {
    const { prompt } = await run({ content: '  ' });
    assert.strictEqual(prompt, null);
  });

  it('leaves a plain message unchanged', async () => {
    const { prompt } = await run({ content: 'hello' });
    assert.ok(prompt.endsWith('User message:\nhello'));
  });
});

// ---------------------------------------------------------------------------
// Direct API mode: attachments
// ---------------------------------------------------------------------------

describe('Codex Direct API mode — attachments are inlined', () => {
  function directAdapter(files) {
    let userMessage = null;
    const adapter = fakeAdapter({
      _directMode: true,
      client: {
        readFile: async (workspaceId, token, fileId) => {
          if (!(fileId in files)) throw new Error('HTTP 404: {"message":"File not found"}');
          return files[fileId];
        },
      },
      _callCompletionApi: async (m) => { userMessage = m; return 'ok'; },
    });
    return { adapter, message: () => userMessage };
  }

  it("puts a text file's contents in the message", async () => {
    const { adapter, message } = directAdapter({ 'f-prd': Buffer.from('# PRD\n交付系统需求') });
    await adapter._handleMessage({ sessionId: 'general', content: PRD.filename, attachments: [PRD] });
    assert.ok(message().startsWith(PRD.filename));
    assert.ok(message().includes(`[Attached file: ${PRD.filename}]\n# PRD\n交付系统需求\n[End of`));
    assert.strictEqual(adapter._conversationHistory[0].content, message(), 'history keeps the file for follow-ups');
  });

  it('names a file it cannot read instead of pretending', async () => {
    const pdf = { fileId: 'f-pdf', filename: 'spec.pdf', contentType: 'application/pdf' };
    const { adapter, message } = directAdapter({});
    await adapter._handleMessage({ sessionId: 'general', content: '', attachments: [pdf] });
    assert.ok(message().includes("spec.pdf (application/pdf) — its contents can't be read in this mode"));
  });

  it('says so when the download fails', async () => {
    const { adapter, message } = directAdapter({});
    await adapter._handleMessage({ sessionId: 'general', content: 'x', attachments: [PRD] });
    assert.ok(message().includes('download failed: HTTP 404'));
  });

  it('treats a text-named file holding NUL bytes as binary', async () => {
    const { adapter, message } = directAdapter({ 'f-prd': Buffer.from([0x50, 0x00, 0x4b]) });
    await adapter._handleMessage({ sessionId: 'general', content: 'x', attachments: [PRD] });
    assert.ok(message().includes('binary content'));
  });

  it('caps how much file text goes in', async () => {
    const big = { fileId: 'f-big', filename: 'big.txt', contentType: 'text/plain' };
    const next = { fileId: 'f-next', filename: 'next.txt', contentType: 'text/plain' };
    const { adapter, message } = directAdapter({
      'f-big': Buffer.from('a'.repeat(60000)),
      'f-next': Buffer.from('b'),
    });
    await adapter._handleMessage({ sessionId: 'general', content: 'x', attachments: [big, next] });
    assert.ok(message().includes('big.txt — only the first 50000 characters'));
    assert.ok(!message().includes('a'.repeat(50001)));
    assert.ok(message().includes('next.txt — left out'));
  });
});

// ---------------------------------------------------------------------------
// Direct API mode: replies with no text
// ---------------------------------------------------------------------------

describe('Codex Direct API mode — a reply with no text says why', () => {
  let server;
  let baseUrl;
  let respond;

  before(async () => {
    server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => respond(req, res));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  // close() alone waits on keep-alive sockets, which left the file's process
  // alive and hung the whole suite when it ran alongside the other files.
  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  function sse(events, { trailingNewline = true } = {}) {
    return (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const text = events
        .map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}`)
        .join('\n\n');
      res.end(trailingNewline ? `${text}\n\n` : text);
    };
  }

  function json(body) {
    return (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
  }

  const direct = () => fakeAdapter({ _directMode: true, _directBaseUrl: baseUrl, _directApiKey: 'k' });
  const call = () => direct()._callCompletionApi('hi', 'general');

  it('returns the streamed reply', async () => {
    respond = sse([
      { choices: [{ delta: { content: 'hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      '[DONE]',
    ]);
    assert.strictEqual(await call(), 'hello');
  });

  it('keeps the last event of a stream with no trailing newline', async () => {
    respond = sse([{ choices: [{ delta: { content: 'hello' } }] }], { trailingNewline: false });
    assert.strictEqual(await call(), 'hello');
  });

  it('decodes a character split across two chunks', async () => {
    respond = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const bytes = Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: '需求文档' } }] })}\n\n`);
      const cut = bytes.indexOf(Buffer.from('求')) + 1;
      res.write(bytes.subarray(0, cut));
      setTimeout(() => res.end(bytes.subarray(cut)), 20);
    };
    assert.strictEqual(await call(), '需求文档');
  });

  it("surfaces a relay's in-band error instead of an empty reply", async () => {
    respond = sse([{ error: { message: 'quota exhausted for this key' } }]);
    await assert.rejects(call(), /quota exhausted for this key/);
  });

  it('reads a relay that ignores stream:true and sends one JSON body', async () => {
    respond = json({ choices: [{ message: { content: 'whole reply' }, finish_reason: 'stop' }] });
    assert.strictEqual(await call(), 'whole reply');
  });

  it('surfaces an error sent as one JSON body', async () => {
    respond = json({ error: { message: 'model not supported' } });
    await assert.rejects(call(), /model not supported/);
  });

  it('says when the model only reasoned and ran out of tokens', async () => {
    respond = sse([
      { choices: [{ delta: { reasoning_content: 'thinking' } }] },
      { choices: [{ delta: {}, finish_reason: 'length' }] },
      '[DONE]',
    ]);
    await assert.rejects(call(), /ran out of output tokens/);
  });

  it('says when the body was empty', async () => {
    respond = (req, res) => { res.writeHead(200); res.end(); };
    await assert.rejects(call(), /returned an empty response/);
  });

  it('quotes a body with no reply in it', async () => {
    respond = json({ output: [] });
    await assert.rejects(call(), /had no reply in it: \{"output":\[\]\}/);
  });

  it('posts the reason to the chat, not the generic retry line', async () => {
    respond = sse([{ error: { message: 'quota exhausted for this key' } }]);
    const adapter = direct();
    await adapter._handleMessage({ sessionId: 'general', content: 'hi' });
    assert.strictEqual(adapter.sent.length, 1);
    assert.ok(adapter.sent[0].content.includes('> quota exhausted for this key'));
    assert.ok(!adapter.sent[0].content.includes('without producing a reply'));
    assert.strictEqual(adapter._conversationHistory.length, 0, 'a failed turn stays out of history');
  });
});

// ---------------------------------------------------------------------------
// Direct API mode: a connection that stalls, drops, or is refused
// ---------------------------------------------------------------------------

describe('Codex Direct API mode — a stalled or broken connection', () => {
  let server;
  let baseUrl;
  let respond;
  const open = [];

  before(async () => {
    server = http.createServer((req, res) => {
      open.push(res);
      req.resume();
      req.on('end', () => respond(req, res));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    for (const res of open) {
      try { res.destroy(); } catch { /* already gone */ }
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  // Short deadlines keep the suite fast; production values are the constants.
  const direct = (overrides = {}) => fakeAdapter({
    _directMode: true,
    _directBaseUrl: baseUrl,
    _directApiKey: 'k',
    _directIdleTimeoutMs: 150,
    _directTotalTimeoutMs: 5000,
    ...overrides,
  });

  const quiet = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': waiting\n\n'); // a comment frame, never any data, never an end
  };

  it('gives up when the relay accepts the request and then goes quiet', async () => {
    respond = quiet;
    await assert.rejects(
      direct()._callCompletionApi('hi', 'general'),
      /stopped responding, no data for 0s \(HTTP 200, \d+ bytes, 0 events/,
    );
  });

  it('gives up at the overall deadline even while the relay keeps trickling', async () => {
    respond = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const tick = setInterval(() => res.write(': keep-alive\n\n'), 30);
      res.on('close', () => clearInterval(tick));
    };
    await assert.rejects(
      direct({ _directIdleTimeoutMs: 5000, _directTotalTimeoutMs: 600 })._callCompletionApi('hi', 'general'),
      /went past 1s with no usable reply/,
    );
  });

  it('reports a connection dropped mid-response instead of an empty reply', async () => {
    respond = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`);
      setTimeout(() => res.socket.destroy(), 20);
    };
    await assert.rejects(
      direct()._callCompletionApi('hi', 'general'),
      /closed the connection mid-response|connection failed/,
    );
  });

  it('surfaces an HTTP 401 with the body', async () => {
    respond = (req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
    };
    await assert.rejects(
      direct()._callCompletionApi('hi', 'general'),
      /LLM API returned 401.*invalid api key/,
    );
  });

  it('surfaces an HTTP 404 from a wrong endpoint path', async () => {
    respond = (req, res) => { res.writeHead(404); res.end('Not Found'); };
    await assert.rejects(
      direct()._callCompletionApi('hi', 'general'),
      /LLM API returned 404.*Not Found/,
    );
  });

  it('posts the stall reason to the chat rather than hanging the turn', async () => {
    respond = quiet;
    const adapter = direct();
    await adapter._handleMessage({ sessionId: 'general', content: 'hi' });
    assert.strictEqual(adapter.sent.length, 1);
    assert.match(adapter.sent[0].content, /stopped responding/);
    assert.ok(!adapter.sent[0].content.includes('without producing a reply'));
  });
});

// ---------------------------------------------------------------------------
// CLI mode: resuming a channel's thread
// ---------------------------------------------------------------------------

describe('Codex CLI mode — resuming a thread', () => {
  function runWith({ threadId, results = [{ responseText: 'ok', exitCode: 0 }] }) {
    const calls = [];
    const adapter = fakeAdapter({
      _useCliMode: true,
      _codexBin: 'codex',
      workingDir: '/tmp/agent-work',
      _directModel: 'gpt-5',
      _channelThreads: threadId ? { general: threadId } : {},
      _spawnCodex: async (cmd) => {
        calls.push(cmd);
        return results[Math.min(calls.length - 1, results.length - 1)];
      },
    });
    return { adapter, calls };
  }

  it('puts resume after the exec options, the order codex-cli 0.154 accepts', async () => {
    const { adapter, calls } = runWith({ threadId: 'thread-1' });
    await adapter._handleMessage({ sessionId: 'general', content: 'hi' });
    const cmd = calls[0];
    assert.deepStrictEqual(cmd.slice(-2), ['resume', 'thread-1']);
    // -C after `resume` is what the CLI rejected with "unexpected argument".
    assert.ok(cmd.indexOf('-C') < cmd.indexOf('resume'), '-C must come before resume');
    assert.strictEqual(cmd[cmd.indexOf('-C') + 1], '/tmp/agent-work');
    assert.ok(cmd.indexOf('-m') < cmd.indexOf('resume'), '-m must come before resume');
    assert.ok(cmd.indexOf('--json') < cmd.indexOf('resume'));
  });

  it('sends no resume for a channel that has no thread yet', async () => {
    const { adapter, calls } = runWith({ threadId: null });
    await adapter._handleMessage({ sessionId: 'general', content: 'hi' });
    assert.ok(!calls[0].includes('resume'));
    assert.strictEqual(calls.length, 1);
  });

  it('retries once without resume when the thread is really gone', async () => {
    const { adapter, calls } = runWith({
      threadId: 'thread-1',
      results: [
        { responseText: '', exitCode: 1, errorMessage: 'no rollout found for thread id thread-1' },
        { responseText: 'fresh answer', exitCode: 0 },
      ],
    });
    await adapter._handleMessage({ sessionId: 'general', content: 'hi' });
    assert.strictEqual(calls.length, 2);
    assert.ok(calls[0].includes('resume'));
    assert.ok(!calls[1].includes('resume'));
    assert.deepStrictEqual(adapter.sent, [{ kind: 'response', channel: 'general', content: 'fresh answer' }]);
    assert.strictEqual(adapter._channelThreads.general, undefined, 'the dead thread id is dropped');
  });
});

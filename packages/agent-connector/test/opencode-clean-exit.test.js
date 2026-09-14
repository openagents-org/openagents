/**
 * OpenCode clean-exit outcome: a run that ends on a tool call with no closing
 * text is a FAILURE (the run died on that tool), not a reply. Previously the
 * streamed reasoning was posted as the answer, which users read as the agent
 * "going silent mid-task" (Windows + multi-line PowerShell via `bash`).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const OpenCodeAdapter = require('../src/adapters/opencode');

function makeAdapter(overrides = {}) {
  const adapter = new OpenCodeAdapter({
    workspaceId: 'ws',
    channelName: 'thread',
    token: 'token',
    agentName: 'opencode-test',
    ...overrides,
  });
  adapter._log = () => {};
  return adapter;
}

async function streamed(events) {
  const adapter = makeAdapter();
  adapter.sendThinking = async () => {};
  adapter.sendStatus = async () => {};
  const state = { finalText: '', allText: '', seenText: false };
  for (const ev of events) await adapter._handleStreamEvent(ev, 'thread', state);
  const stdout = events.map((e) => JSON.stringify(e)).join(' ');
  return { state, stdout, stdoutErr: OpenCodeAdapter._extractErrorFromStdout(stdout) };
}

describe('OpenCode — clean-exit outcome', () => {
  it('records the last tool call on the response state', async () => {
    const { state } = await streamed([
      { type: 'text', part: { text: 'Looking. ' } },
      { type: 'tool_use', item: { name: 'bash', input: { command: 'dir' } } },
    ]);
    assert.equal(state.lastTool, 'bash');
    assert.equal(state.finalText, '');
    assert.equal(state.allText, 'Looking. ');
  });

  it('text -> tool -> exit 0 (no closing text) → incomplete_run naming the tool, NOT a reply', async () => {
    const { state, stdout, stdoutErr } = await streamed([
      { type: 'text', part: { text: 'Let me run a syntax check on the modified script block.' } },
      { type: 'tool_use', item: { name: 'bash', input: { command: '$lines = Get-Content -LiteralPath x' } } },
    ]);
    const out = OpenCodeAdapter._outcomeForCleanExit({ stdout, stdoutErr, responseState: state });
    assert.equal(out.text, undefined);
    assert.equal(out.failure.category, 'incomplete_run');
    assert.match(out.failure.detail, /`bash`/);
  });

  it('text -> tool -> error event -> exit 0 → the structured error wins over the streamed text', async () => {
    const { state, stdout, stdoutErr } = await streamed([
      { type: 'text', part: { text: 'Checking auth. ' } },
      { type: 'tool_use', item: { name: 'bash', input: { command: 'dir' } } },
      { type: 'error', error: { name: 'APIError', message: 'Invalid API key', status: 401 } },
    ]);
    assert.ok(stdoutErr);
    const out = OpenCodeAdapter._outcomeForCleanExit({ stdout, stdoutErr, responseState: state });
    assert.equal(out.failure.category, 'auth_failed');
  });

  it('text -> tool -> vague error event → incomplete_run (not unknown_error)', async () => {
    const { state, stdout, stdoutErr } = await streamed([
      { type: 'text', part: { text: 'Working. ' } },
      { type: 'tool_use', item: { name: 'bash', input: { command: 'dir' } } },
      { type: 'error', error: { message: 'tool execution aborted' } },
    ]);
    const out = OpenCodeAdapter._outcomeForCleanExit({ stdout, stdoutErr, responseState: state });
    assert.equal(out.failure.category, 'incomplete_run');
  });

  it('text -> tool -> closing text → the closing text is the reply', async () => {
    const { state, stdout, stdoutErr } = await streamed([
      { type: 'text', part: { text: 'Let me check. ' } },
      { type: 'tool_use', item: { name: 'read', input: { filePath: '/x' } } },
      { type: 'text', part: { text: 'Done: 3 files changed.' } },
    ]);
    const out = OpenCodeAdapter._outcomeForCleanExit({ stdout, stdoutErr, responseState: state });
    assert.equal(out.text, 'Done: 3 files changed.');
  });

  it('plain text, no tools → the text is the reply', async () => {
    const { state, stdout, stdoutErr } = await streamed([{ type: 'text', part: { text: 'Answer: 42.' } }]);
    const out = OpenCodeAdapter._outcomeForCleanExit({ stdout, stdoutErr, responseState: state });
    assert.equal(out.text, 'Answer: 42.');
  });

  it('only control events, no text → empty_response; error event without text → classified', () => {
    const state = { finalText: '', allText: '', seenText: false };
    const ctl = '{"type":"step_start"} {"type":"step_finish"}';
    assert.equal(
      OpenCodeAdapter._outcomeForCleanExit({ stdout: ctl, stdoutErr: null, responseState: state }).failure.category,
      'empty_response',
    );
    const errOut = '{"type":"error","error":{"message":"forbidden","status":403}}';
    const out = OpenCodeAdapter._outcomeForCleanExit({
      stdout: errOut, stdoutErr: OpenCodeAdapter._extractErrorFromStdout(errOut), responseState: state,
    });
    assert.equal(out.failure.category, 'auth_failed');
  });

  it('incomplete_run posts a "stopped mid-task" error naming the tool, as an error message', async () => {
    const adapter = makeAdapter();
    const sent = [];
    adapter.client.sendMessage = async (_ws, channel, _tok, content, opts) => { sent.push({ channel, content, opts }); };
    await adapter._sendClassifiedError('thread', 'incomplete_run', 'Last tool call: `bash`');
    assert.equal(sent.length, 1);
    assert.match(sent[0].content, /stopped mid-task/);
    assert.match(sent[0].content, /`bash`/);
    assert.match(sent[0].content, /continue/);
    assert.equal(sent[0].opts.messageType, 'error');
    assert.equal(sent[0].opts.metadata.error_category, 'incomplete_run');
  });
});

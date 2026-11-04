/**
 * OpenCode thinking: with --thinking, `opencode run --format json` emits
 * `reasoning` events. They are posted live as thinking traces (like Claude and
 * Codex) and never become part of the reply. Event shapes are those recorded
 * from opencode-ai 1.17.11.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const OpenCodeAdapter = require('../src/adapters/opencode');

function makeAdapter() {
  const adapter = new OpenCodeAdapter({ workspaceId: 'ws', channelName: 'thread', token: 'token', agentName: 'opencode-test' });
  adapter._log = () => {};
  return adapter;
}

const RUN = [
  { type: 'step_start', part: { type: 'step-start' } },
  { type: 'reasoning', part: { type: 'reasoning', text: '**Checking file length**' } },
  { type: 'tool_use', part: { type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'wc -l sample.txt' } } } },
  { type: 'step_finish', part: { type: 'step-finish' } },
  { type: 'step_start', part: { type: 'step-start' } },
  { type: 'reasoning', part: { type: 'reasoning', text: 'The output says 37.' } },
  { type: 'text', part: { type: 'text', text: 'The file has 37 lines.' } },
  { type: 'step_finish', part: { type: 'step-finish' } },
];

async function stream(events) {
  const adapter = makeAdapter();
  const posted = [];
  adapter.sendThinking = async (_ch, text) => { posted.push(['thinking', text]); };
  adapter.sendStatus = async (_ch, text) => { posted.push(['status', text]); };
  const state = { finalText: '', allText: '', seenText: false };
  for (const ev of events) await adapter._handleStreamEvent(ev, 'thread', state);
  return { posted, state, stdout: events.map((e) => JSON.stringify(e)).join('\n') };
}

describe('OpenCode — thinking', () => {
  it('asks OpenCode for reasoning, including on resumed sessions', () => {
    const adapter = makeAdapter();
    assert.ok(adapter._buildRunArgs({ runCwd: '/tmp/p', model: 'p/m' }).includes('--thinking'));
    assert.ok(adapter._buildRunArgs({ runCwd: '/tmp/p', model: 'p/m', sessionId: 'ses_1' }).includes('--thinking'));
  });

  it('posts reasoning live as thinking, in stream order with tool status', async () => {
    const { posted } = await stream(RUN);
    assert.deepStrictEqual(posted.map(([kind]) => kind), ['thinking', 'status', 'thinking', 'thinking']);
    assert.strictEqual(posted[0][1], '**Checking file length**');
    assert.strictEqual(posted[2][1], 'The output says 37.');
  });

  it('keeps reasoning out of the reply', async () => {
    const { state, stdout } = await stream(RUN);
    assert.strictEqual(state.finalText, 'The file has 37 lines.');
    assert.ok(!state.allText.includes('Checking'));
    assert.strictEqual(OpenCodeAdapter._finalTextFromStdout(stdout, state), 'The file has 37 lines.');
    assert.strictEqual(OpenCodeAdapter._extractTextFromJson(stdout), 'The file has 37 lines.');
    const outcome = OpenCodeAdapter._outcomeForCleanExit({ stdout, responseState: state });
    assert.strictEqual(outcome.text, 'The file has 37 lines.');
  });

  it('treats a run with reasoning but no answer as having no reply', async () => {
    const events = RUN.slice(0, 2);
    const { state, stdout } = await stream(events);
    assert.ok(OpenCodeAdapter._isOnlyControlJson(stdout));
    assert.ok(OpenCodeAdapter._outcomeForCleanExit({ stdout, responseState: state }).failure);
  });

  it('separates reasoning summaries that OpenCode glues together', async () => {
    const { posted } = await stream([{ type: 'reasoning', part: { type: 'reasoning', text: '**Checking recurrence termination****Inspecting recurrence code**' } }]);
    assert.deepStrictEqual(posted, [['thinking', '**Checking recurrence termination**\n\n**Inspecting recurrence code**']]);
  });

  it('skips empty reasoning without posting', async () => {
    const { posted } = await stream([{ type: 'reasoning', part: { type: 'reasoning', text: '   ' } }]);
    assert.deepStrictEqual(posted, []);
  });
});

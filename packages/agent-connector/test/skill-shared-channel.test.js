'use strict';
// A skill file is written once per agent and read by all of its threads,
// including ones running at the same time, so it must not name a channel:
// an agent working in two threads posted one thread's to-do list into the
// other because the shared file named the thread that started last.
const { test } = require('node:test');
const assert = require('node:assert');
const w = require('../src/adapters/workspace-prompt');

const args = { endpoint: 'https://ws.example', workspaceId: 'ws-1', token: 'tok', agentName: 'ccbot',
  channelName: 'channel-thread-a', disabledModules: new Set() };

for (const name of ['buildClaudeSkillMd', 'buildCursorSkillMd', 'buildOpenCodeSkillMd', 'buildCommandCodeSkillMd', 'buildOpenclawSkillMd']) {
  test(`${name} names no channel and says where to find it`, () => {
    const md = w[name](args);
    assert.ok(!md.includes('channel-thread-a'), 'the spawning thread\'s channel must not be baked in');
    assert.match(md, /"channel":"CURRENT_CHANNEL"/);
    assert.match(md, /shared by all of your threads/);
  });
}

test('per-thread system prompts still carry the real channel', () => {
  const prompt = w.buildClaudeSystemPrompt({ agentName: 'ccbot', workspaceId: 'ws-1', channelName: 'channel-thread-a', toolMode: 'skills' });
  assert.match(prompt, /Channel: channel-thread-a/);
});

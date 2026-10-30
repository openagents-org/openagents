'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const ClaudeAdapter = require('../src/adapters/claude');
const { WorkspaceClient } = require('../src/workspace-client');

function adapter(todos) {
  const a = new ClaudeAdapter({ workspaceId: 'todo-regression', agentName: 'worker', token: 'test' });
  a.client.getTodos = async (_ws, _channel, _token, options) => {
    assert.deepEqual(options, { all: false, source: 'openagents:worker' });
    return { todos };
  };
  return a;
}

it('finishing an unrelated task does not resume four pending human dependencies', async () => {
  const a = adapter([
    { content: 'Read news', status: 'completed' },
    ...['Login', 'Provide copy', 'Approve publication', 'Decide on draft'].map(content =>
      ({ content, status: 'pending', created_by: 'openagents:worker', assignee: 'human' })),
  ]);
  await a._queueTodoNudge('thread', { content: 'Read news' });
  assert.equal(a._channelQueues.thread, undefined);
});

it('pending items assigned to this agent do not wake it either', async () => {
  const a = adapter([{ content: 'Wait for login', status: 'pending', assignee: 'worker' }]);
  assert.equal(await a._buildTodoNudge('thread'), null);
});

it('active work continues, excluding foreign lists, human assignments and pending items', async () => {
  const a = adapter([
    { content: 'Run verification', status: 'in_progress', created_by: 'openagents:worker', assignee: 'worker' },
    { content: 'Other plan', status: 'in_progress', created_by: 'openagents:other', assignee: 'worker' },
    { content: 'Human confirmation', status: 'in_progress', assignee: 'human' },
    { content: 'Waiting', status: 'pending', assignee: 'worker' },
  ]);
  const nudge = await a._buildTodoNudge('thread');
  assert.match(nudge.content, /Run verification/);
  assert.doesNotMatch(nudge.content, /Other plan|Human confirmation|Waiting/);
});

it('an explicit new turn can reactivate previously pending work', async () => {
  const todos = [{ content: 'Continue after login', status: 'pending', assignee: 'worker' }];
  const a = adapter(todos);
  assert.equal(await a._buildTodoNudge('thread'), null);
  todos[0].status = 'in_progress';
  assert.match((await a._buildTodoNudge('thread')).content, /Continue after login/);
});

it('getTodos transmits the creator scope to the API', async () => {
  const client = new WorkspaceClient();
  client._get = async url => {
    const params = new URL(url, 'https://example.test').searchParams;
    assert.equal(params.get('source'), 'openagents:worker');
    assert.equal(params.get('channel'), 'thread');
    assert.equal(params.get('all'), null);
    return { data: { todos: [] } };
  };
  await client.getTodos('workspace', 'thread', 'test', { all: false, source: 'openagents:worker' });
});

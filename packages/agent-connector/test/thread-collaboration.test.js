'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const BaseAdapter = require('../src/adapters/base');
test('applies only the current agent thread instructions once and preserves original content', () => {
  const adapter = Object.create(BaseAdapter.prototype); adapter.agentName = 'reviewer';
  const message = { content: 'Result', metadata: { thread_agent_instructions: { reviewer: 'Review citations', executor: 'Build' } } };
  adapter._applyThreadCollaboration('one', message);
  assert.match(message.content, /Review citations/); assert.doesNotMatch(message.content, /Build/);
  assert.equal(message.originalContent, 'Result');
  const once = message.content; adapter._applyThreadCollaboration('one', message); assert.equal(message.content, once);
  const next = { content: 'Another task', metadata: {} }; adapter._applyThreadCollaboration('two', next);
  assert.equal(next.content, 'Another task');
  const dm = { content: 'Direct', metadata: message.metadata }; adapter._applyThreadCollaboration('dm:someone', dm);
  assert.equal(dm.content, 'Direct');
});

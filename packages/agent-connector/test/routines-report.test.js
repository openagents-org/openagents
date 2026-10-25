'use strict';

/**
 * `/routines` slash command report (BaseAdapter._postRoutinesReport).
 * The workspace now lists paused routines too, so they must be marked and
 * must not advertise a stale "Next fires" time.
 *
 * Run: node --test test/routines-report.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const BaseAdapter = require('../src/adapters/base');

function makeAdapter(routines) {
  const a = new BaseAdapter({
    workspaceId: 'w',
    channelName: 'general',
    token: 't',
    agentName: 'bot',
    endpoint: 'http://127.0.0.1:0',
  });
  a._log = () => {};
  const sent = [];
  a.client = {
    listRoutines: async () => ({ routines }),
    sendMessage: async (_ws, _ch, _tok, content) => { sent.push(content); },
  };
  return { a, sent };
}

describe('_postRoutinesReport', () => {
  it('marks paused routines and hides their stale next-fire time', async () => {
    const { a, sent } = makeAdapter([
      { id: 'aaaaaaaa-1', name: 'Daily digest', created_by: 'openagents:bot', status: 'active',
        schedule_hour: 9, schedule_minute: 0, next_fires_at: '2099-01-01T09:00:00Z' },
      { id: 'bbbbbbbb-2', name: 'Weekly sync', created_by: 'openagents:bot', status: 'paused',
        schedule_interval_minutes: 60, next_fires_at: '2000-01-01T00:00:00Z' },
    ]);
    await a._postRoutinesReport({ channel: 'general' });
    assert.equal(sent.length, 1);
    const [content] = sent;
    assert.match(content, /\| `aaaaaaaa` \| Daily digest \| 09:00 UTC daily \| 2099-01-01T09:00:00Z \|/);
    assert.match(content, /\| `bbbbbbbb` \| Weekly sync \[paused\] \| every 60 min \| — \|/);
    assert.doesNotMatch(content, /2000-01-01/);
  });

  it('says "No routines" when the agent owns none', async () => {
    const { a, sent } = makeAdapter([
      { id: 'cccccccc', name: 'Other', created_by: 'openagents:someone-else', status: 'active' },
    ]);
    await a._postRoutinesReport({ channel: 'general' });
    assert.match(sent[0], /_No routines\._/);
    assert.doesNotMatch(sent[0], /active/);
  });
});

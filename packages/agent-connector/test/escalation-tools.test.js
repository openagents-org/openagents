'use strict';

/**
 * v1.1 M3 escalation tools (src/tools-v11/escalation.js):
 *   - both tools are registered through the v1.1 registry into buildToolDefs
 *   - formatHelp / formatProposal put the verdict first
 *   - workspace_ask_owner sends kind=help with channel/source/requester_email
 *     and returns the answer; workspace_propose_improvement is non-blocking
 *   - names the module does not own fall through (undefined)
 *
 * Run: node --test test/escalation-tools.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const esc = require('../src/tools-v11/escalation');
const { buildToolDefs } = require('../src/mcp-server');

const text = (t) => ({ content: [{ type: 'text', text: t }] });

function fakeServer(ws, extra = {}) {
  return {
    ws,
    workspaceId: 'ws-1',
    channelName: 'task:42',
    agentName: 'deploy-bot',
    token: 'tok',
    _log: () => {},
    ...extra,
  };
}

describe('escalation tool registry', () => {
  it('exposes both tools through buildToolDefs regardless of skill toggles', () => {
    const names = buildToolDefs(new Set(['knowledge', 'files', 'browser'])).map((t) => t.name);
    assert.ok(names.includes('workspace_ask_owner'));
    assert.ok(names.includes('workspace_propose_improvement'));
  });

  it('declares required inputs', () => {
    const byName = Object.fromEntries(esc.defs.map((d) => [d.name, d]));
    assert.deepEqual(byName.workspace_ask_owner.inputSchema.required, ['question']);
    assert.deepEqual(byName.workspace_propose_improvement.inputSchema.required, ['summary', 'proposal']);
  });
});

describe('formatHelp', () => {
  it('pending names the owner and tells the agent to stop', () => {
    const out = esc.formatHelp({ id: 'h1', status: 'pending', action: 'Include EU?', assignee_email: 'mia@acme.test' });
    assert.match(out, /^PENDING/);
    assert.match(out, /your owner \(mia@acme.test\)/);
    assert.match(out, /end your turn/);
    assert.match(out, /workspace_check_approval with id h1/);
  });

  it('pending without an owner falls back to the role', () => {
    assert.match(esc.formatHelp({ id: 'h', status: 'pending', action: 'q', required_role: 'any' }), /a workspace member/);
    assert.match(esc.formatHelp({ id: 'h', status: 'pending', action: 'q', required_role: 'admin' }), /an Admin/);
  });

  it('answered puts the answer text in the result', () => {
    const out = esc.formatHelp({
      id: 'h1', status: 'approved', action: 'Include EU?',
      resolved_by: 'mia@acme.test', resolved_by_role: 'member', note: 'Yes, same template.',
    });
    assert.match(out, /^ANSWERED — mia@acme.test \(member\)/);
    assert.match(out, /Yes, same template\./);
  });

  it('declined and expired tell the agent not to guess', () => {
    assert.match(esc.formatHelp({ id: 'h', status: 'rejected', action: 'q', resolved_by: 'mia@acme.test' }), /^DECLINED[\s\S]*Do not guess/);
    assert.match(esc.formatHelp({ id: 'h', status: 'expired', action: 'q' }), /^EXPIRED[\s\S]*Do not guess/);
  });
});

describe('formatProposal', () => {
  it('pending is non-blocking', () => {
    const out = esc.formatProposal({ id: 'p1', status: 'pending', action: 'Run evals first', assignee_email: 'mia@acme.test' });
    assert.match(out, /^PROPOSED/);
    assert.match(out, /Carry on/);
    assert.match(out, /proposal id: p1/);
  });

  it('adopted / not adopted', () => {
    assert.match(esc.formatProposal({ id: 'p', status: 'approved', action: 's', resolved_by: 'mia@acme.test' }), /^ADOPTED/);
    assert.match(esc.formatProposal({ id: 'p', status: 'rejected', action: 's', resolved_by: 'mia@acme.test', note: 'too slow' }), /^NOT ADOPTED[\s\S]*too slow/);
  });
});

describe('handle', () => {
  it('returns undefined for tools it does not own', async () => {
    const r = await esc.handle(fakeServer({}), 'workspace_get_history', {}, { text });
    assert.equal(r, undefined);
  });

  it('workspace_ask_owner files kind=help with channel/source/requester and returns the answer', async () => {
    const calls = [];
    const ws = {
      async askOwner(workspaceId, token, body) {
        calls.push({ workspaceId, token, body });
        return { id: 'h9', status: 'approved', action: body.question, resolved_by: 'mia@acme.test', resolved_by_role: 'member', note: 'Yes.' };
      },
      async getApproval() { throw new Error('should not poll when already answered'); },
    };
    const server = fakeServer(ws, { requesterEmail: 'max@acme.test' });
    const r = await esc.handle(server, 'workspace_ask_owner', { question: 'Include EU?', details: 'ctx' }, { text });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      workspaceId: 'ws-1', token: 'tok',
      body: { channel: 'task:42', source: 'openagents:deploy-bot', requester_email: 'max@acme.test', question: 'Include EU?', details: 'ctx' },
    });
    assert.match(r.content[0].text, /^ANSWERED/);
  });

  it('workspace_ask_owner polls until answered and tolerates a missing requesterEmail', async () => {
    let polls = 0;
    const ws = {
      async askOwner(_w, _t, body) {
        assert.equal('requester_email' in body, false);
        return { id: 'h1', status: 'pending', action: body.question };
      },
      async getApproval() {
        polls += 1;
        return { id: 'h1', status: polls >= 2 ? 'approved' : 'pending', action: 'q', resolved_by: 'mia@acme.test', note: 'ok' };
      },
    };
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => realSetTimeout(fn, 0); // do not actually wait 3 s per poll
    try {
      const r = await esc.handle(fakeServer(ws), 'workspace_ask_owner', { question: 'q', wait_seconds: 30 }, { text });
      assert.equal(polls, 2);
      assert.match(r.content[0].text, /^ANSWERED/);
    } finally {
      global.setTimeout = realSetTimeout;
    }
  });

  it('workspace_ask_owner returns PENDING when wait_seconds is 0', async () => {
    const ws = {
      async askOwner() { return { id: 'h1', status: 'pending', action: 'q', assignee_email: 'mia@acme.test' }; },
      async getApproval() { throw new Error('no polling with wait_seconds=0'); },
    };
    const r = await esc.handle(fakeServer(ws), 'workspace_ask_owner', { question: 'q', wait_seconds: 0 }, { text });
    assert.match(r.content[0].text, /^PENDING/);
  });

  it('workspace_propose_improvement is non-blocking and returns the id', async () => {
    const calls = [];
    const ws = {
      async proposeImprovement(_w, _t, body) {
        calls.push(body);
        return { id: 'p7', status: 'pending', action: body.summary, assignee_email: 'mia@acme.test' };
      },
      async getApproval() { throw new Error('proposals must not poll'); },
    };
    const r = await esc.handle(fakeServer(ws), 'workspace_propose_improvement',
      { summary: 'Run evals first', proposal: 'Before deploying, run make eval.' }, { text });
    assert.deepEqual(calls, [{ channel: 'task:42', source: 'openagents:deploy-bot', summary: 'Run evals first', proposal: 'Before deploying, run make eval.' }]);
    assert.match(r.content[0].text, /^PROPOSED[\s\S]*proposal id: p7/);
  });

  it('rejects empty inputs before calling the API', async () => {
    const ws = { async askOwner() { throw new Error('must not be called'); }, async proposeImprovement() { throw new Error('must not be called'); } };
    await assert.rejects(esc.handle(fakeServer(ws), 'workspace_ask_owner', { question: '  ' }, { text }), /question is required/);
    await assert.rejects(esc.handle(fakeServer(ws), 'workspace_propose_improvement', { summary: 's' }, { text }), /proposal is required/);
  });
});

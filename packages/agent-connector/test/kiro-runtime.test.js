'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  KIRO_MIN_VERSION,
  WORKSPACE_MCP_NAME,
  installHint,
  parseKiroVersion,
  classifyKiroVersion,
  resolveKiroSettings,
  buildKiroArgs,
  toAcpMcpServer,
  toolLabel,
  interpretUpdate,
  permissionOutcome,
  isStaleSessionError,
  rpcErrorText,
  agentNotFoundMessage,
} = require('../src/adapters/kiro-runtime');

// Frames below are copied from what kiro-cli 2.37.0 sent a recording client.
const update = (u) => ({ sessionId: 's1', update: u });
const PERMISSION_OPTIONS = [
  { optionId: 'allow_once', name: 'Yes', kind: 'allow_once' },
  { optionId: 'allow_always', name: 'Always', kind: 'allow_always' },
  { optionId: 'reject_once', name: 'No', kind: 'reject_once' },
];

describe('kiro-runtime — version gate', () => {
  it('reads `kiro-cli --version`', () => {
    assert.deepEqual(parseKiroVersion('kiro-cli 2.37.0\n'), [2, 37, 0]);
    assert.equal(parseKiroVersion('no version here'), null);
  });

  it('accepts the verified version and newer, refuses older, is lenient when unreadable', () => {
    assert.deepEqual(classifyKiroVersion(`kiro-cli ${KIRO_MIN_VERSION}`), { version: KIRO_MIN_VERSION, supported: true });
    assert.equal(classifyKiroVersion('kiro-cli 3.0.1').supported, true);
    assert.equal(classifyKiroVersion('kiro-cli 2.36.9').supported, false);
    assert.equal(classifyKiroVersion('kiro-cli 1.99.0').supported, false);
    assert.deepEqual(classifyKiroVersion(''), { version: null, supported: null });
  });

  it('names the official installer per platform', () => {
    assert.match(installHint('darwin'), /cli\.kiro\.dev\/install \| bash/);
    assert.match(installHint('win32'), /install\.ps1 \| iex/);
  });
});

describe('kiro-runtime — settings and argv', () => {
  it('takes the agent profile and model from the agent env, the workspace model first', () => {
    assert.deepEqual(resolveKiroSettings({ KIRO_AGENT: ' researcher ', KIRO_MODEL: 'claude-haiku-4.5' }),
      { agent: 'researcher', model: 'claude-haiku-4.5' });
    assert.deepEqual(resolveKiroSettings({ KIRO_MODEL: 'claude-haiku-4.5' }, 'claude-sonnet-4.6'),
      { agent: null, model: 'claude-sonnet-4.6' });
    assert.deepEqual(resolveKiroSettings({ LLM_MODEL: 'auto' }), { agent: null, model: 'auto' });
    assert.deepEqual(resolveKiroSettings({}), { agent: null, model: null });
  });

  it('starts the ACP server without blanket tool trust', () => {
    assert.deepEqual(buildKiroArgs(), ['acp']);
    const args = buildKiroArgs({ agent: 'writer', model: 'auto' });
    assert.deepEqual(args, ['acp', '--agent', 'writer', '--model', 'auto']);
    assert.ok(!args.includes('--trust-all-tools') && !args.includes('-a'));
  });

  it('turns an MCP server into the ACP stdio shape, env as {name, value} pairs', () => {
    const s = toAcpMcpServer(WORKSPACE_MCP_NAME, {
      command: '/usr/bin/node', args: ['cli.js', 'mcp-server'], env: { OA_WORKSPACE_TOKEN: 'tok', EMPTY: '', MISSING: undefined },
    });
    assert.deepEqual(s, {
      name: 'openagents-workspace',
      command: '/usr/bin/node',
      args: ['cli.js', 'mcp-server'],
      env: [{ name: 'OA_WORKSPACE_TOKEN', value: 'tok' }],
    });
  });
});

describe('kiro-runtime — session/update interpretation', () => {
  it('drops frames replayed by session/load', () => {
    const ev = interpretUpdate(update({
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old answer' }, _meta: { kiro: { replay: true } },
    }));
    assert.deepEqual(ev, { kind: 'replay' });
  });

  it('reads message and thought chunks', () => {
    assert.deepEqual(interpretUpdate(update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'PONG' } })),
      { kind: 'message', text: 'PONG' });
    assert.deepEqual(interpretUpdate(update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } })),
      { kind: 'thought', text: 'hmm' });
  });

  it('labels an MCP tool call by server and tool, and remembers its kind', () => {
    const ev = interpretUpdate(update({
      sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Running: @notes-db/get_codeword',
      rawInput: {}, _meta: { kiro: { toolName: 'get_codeword', mcpServerName: 'notes-db' } },
    }));
    assert.deepEqual(ev, { kind: 'tool_start', id: 't1', label: 'notes-db › get_codeword', toolKind: 'other', server: 'notes-db' });
  });

  it('labels built-in tools with what they are doing', () => {
    assert.equal(toolLabel({ title: 'Running: sleep 90 && echo finished' }, { toolName: 'shell' }), 'shell › sleep 90 && echo finished');
    assert.equal(toolLabel({ title: 'Creating hello.txt' }, { toolName: 'write' }), 'write › Creating hello.txt');
    assert.equal(toolLabel({ title: 'read' }, { toolName: 'read' }), 'read');
    assert.equal(toolLabel({}, {}), 'tool');
  });

  it('redacts secrets a tool title quotes', () => {
    const ev = interpretUpdate(update({
      sessionUpdate: 'tool_call', toolCallId: 't2', title: 'Running: echo sk-secret-value-123', _meta: { kiro: { toolName: 'shell' } },
    }), ['sk-secret-value-123']);
    assert.ok(!ev.label.includes('sk-secret-value-123'));
  });

  it('marks tool ends, failures and permission denials', () => {
    assert.deepEqual(interpretUpdate(update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' })),
      { kind: 'tool_end', id: 't1', failed: false, denied: false });
    assert.deepEqual(interpretUpdate(update({
      sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'failed',
      _meta: { kiro: { toolName: 'write', toolCallFailureReason: 'permission_denied' } },
    })), { kind: 'tool_end', id: 't1', failed: true, denied: true });
    assert.deepEqual(interpretUpdate(update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'in_progress' })),
      { kind: 'ignore' });
  });

  it('turns an ACP plan into workspace todos', () => {
    const ev = interpretUpdate(update({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Read the code', priority: 'high', status: 'completed' },
        { content: 'Write the fix', priority: 'high', status: 'in_progress' },
        { content: ' ', status: 'pending' },
        { content: 'Ship', status: 'weird' },
      ],
    }));
    assert.deepEqual(ev.todos, [
      { content: 'Read the code', status: 'completed' },
      { content: 'Write the fix', status: 'in_progress' },
      { content: 'Ship', status: 'pending' },
    ]);
  });

  it('ignores updates a channel has no use for', () => {
    assert.equal(interpretUpdate(update({ sessionUpdate: 'available_commands_update' })).kind, 'ignore');
    assert.equal(interpretUpdate({}).kind, 'ignore');
  });
});

describe('kiro-runtime — approvals', () => {
  const ask = (kind) => ({ sessionId: 's1', toolCall: { toolCallId: 't1', title: 'x', ...(kind ? { kind } : {}) }, options: PERMISSION_OPTIONS });

  it('allows each call once in execute mode, never "always"', () => {
    assert.deepEqual(permissionOutcome(ask('edit'), { mode: 'execute' }),
      { outcome: { outcome: 'selected', optionId: 'allow_once' } });
  });

  it('refuses writes and commands in plan mode, using what the tool_call said about it', () => {
    assert.equal(permissionOutcome(ask(), { mode: 'plan', known: { toolKind: 'edit' } }).outcome.optionId, 'reject_once');
    assert.equal(permissionOutcome(ask(), { mode: 'plan', known: { toolKind: 'execute' } }).outcome.optionId, 'reject_once');
    assert.equal(permissionOutcome(ask(), { mode: 'plan', known: null }).outcome.optionId, 'reject_once');
  });

  it('allows read-only tools and the workspace tools in plan mode', () => {
    for (const kind of ['read', 'search', 'think', 'fetch']) {
      assert.equal(permissionOutcome(ask(kind), { mode: 'plan' }).outcome.optionId, 'allow_once', kind);
    }
    assert.equal(permissionOutcome(ask(), { mode: 'plan', known: { toolKind: 'other', server: WORKSPACE_MCP_NAME } }).outcome.optionId,
      'allow_once');
    assert.equal(permissionOutcome(ask(), { mode: 'plan', known: { toolKind: 'other', server: 'notes-db' } }).outcome.optionId,
      'reject_once');
  });

  it('cancels when the request offers nothing to pick', () => {
    assert.deepEqual(permissionOutcome({ options: [] }), { outcome: { outcome: 'cancelled' } });
  });
});

describe('kiro-runtime — errors', () => {
  it('recognises the stale-session answer to session/load', () => {
    assert.equal(isStaleSessionError({
      code: -32603, message: 'Internal error', data: 'Failed to start session: Session not found: 00000000-0000-0000-0000-000000000000',
    }), true);
    assert.equal(isStaleSessionError({ code: -32603, message: 'Internal error', data: 'No session found with id' }), true);
    assert.equal(isStaleSessionError({ code: -32603, message: 'Internal error', data: 'something else' }), false);
    assert.equal(isStaleSessionError(null), false);
  });

  it('flattens a JSON-RPC error for classification', () => {
    assert.equal(rpcErrorText({ message: 'Internal error', data: 'Not logged in' }), 'Internal error: Not logged in');
    assert.equal(rpcErrorText({ message: 'x', data: { reason: 'y' } }), 'x: {"reason":"y"}');
  });

  it('explains a missing agent profile instead of running the default agent', () => {
    const msg = agentNotFoundMessage({ requestedAgent: 'researcher', fallbackAgent: 'kiro_default' }, 'researcher');
    assert.match(msg, /"researcher" was not found/);
    assert.match(msg, /kiro_default/);
    assert.match(msg, /\.kiro\/agents\/researcher\.json/);
  });
});

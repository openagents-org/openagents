'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMuseArgs,
  buildMuseMcpEntry,
  classifyMuseRun,
  classifyMuseVersion,
  interpretMuseRecord,
  mergeMuseSettings,
  museSettingsProblem,
  parseRecord,
  redactArgs,
  toolNameFromTaskKind,
  MUSE_MCP_SERVER_NAME,
} = require('../src/adapters/muse-stream');

// Records below are trimmed copies of what Muse Code 1.3.0 printed for
// `muse exec --json --provider echo`.
const SID = '01a0d272-40a3-79c0-86a6-5bbd423d381a';
const rec = (payload_type, payload) => ({
  schema_version: 1,
  stream: { kind: 'session', id: SID },
  sequence: 1,
  record_type: 'event',
  payload_type,
  payload,
});

describe('muse-stream — version gate', () => {
  it('reads the version out of the banner', () => {
    const v = classifyMuseVersion('Muse Code 1.3.0 (1.3.0-R3401.1)\n');
    assert.equal(v.version, '1.3.0');
    assert.equal(v.supported, true);
  });

  it('blocks a version below the floor and is lenient about garbage', () => {
    assert.equal(classifyMuseVersion('Muse Code 1.2.9').supported, false);
    assert.equal(classifyMuseVersion('').supported, null);
  });
});

describe('muse-stream — argv', () => {
  it('runs headless with approvals off and the sandbox left on', () => {
    const args = buildMuseArgs({ promptFile: '/p.md', sessionId: 'u-1' });
    assert.deepEqual(args.slice(0, 2), ['exec', '--json']);
    assert.equal(args[args.indexOf('--prompt-file') + 1], '/p.md');
    assert.equal(args[args.indexOf('--session-id') + 1], 'u-1');
    assert.equal(args[args.indexOf('--approval-mode') + 1], 'never');
    for (const flag of ['--disable-sandbox', '--yolo', '--disable-approval']) {
      assert.ok(!args.includes(flag), `${flag} must never be passed`);
    }
  });

  it('plan mode removes writes and shell', () => {
    const args = buildMuseArgs({ promptFile: '/p', sessionId: 's', planMode: true });
    assert.ok(args.includes('--disable-write'));
    assert.ok(args.includes('--disable-shell'));
  });

  it('passes model, effort and step cap only when set', () => {
    const bare = buildMuseArgs({ promptFile: '/p', sessionId: 's', model: ' ', effort: '' });
    assert.ok(!bare.includes('--model') && !bare.includes('--reasoning-effort'));
    const full = buildMuseArgs({ promptFile: '/p', sessionId: 's', model: 'muse-spark-1.3', effort: 'low', maxSteps: 12 });
    assert.equal(full[full.indexOf('--model') + 1], 'muse-spark-1.3');
    assert.equal(full[full.indexOf('--reasoning-effort') + 1], 'low');
    assert.equal(full[full.indexOf('--max-model-steps') + 1], '12');
  });

  it('redacts the session id and prompt path for logs', () => {
    const out = redactArgs(buildMuseArgs({ promptFile: '/secret/p.md', sessionId: 'abc' }));
    assert.ok(!out.includes('abc') && !out.includes('/secret/p.md'));
  });
});

describe('muse-stream — records', () => {
  it('takes the reply and session id from the terminal record', () => {
    const ev = interpretMuseRecord(rec('run.terminal.completed', {
      kind: 'run_terminal', reason: null, terminal: 'completed', text: 'echo: hi\n',
    }));
    assert.equal(ev.kind, 'terminal');
    assert.equal(ev.terminal, 'completed');
    assert.equal(ev.text, 'echo: hi\n');
    assert.equal(ev.sessionId, SID);
  });

  it('treats a failed internal task as a note, not a run failure', () => {
    const ev = interpretMuseRecord(rec('task.lifecycle.failed', {
      event: { kind: 'failed', reason: 'invalid run configuration: provider does not support base instructions' },
    }));
    assert.equal(ev.kind, 'task_failed');
  });

  it('keeps deltas as progress and ignores lifecycle noise', () => {
    assert.equal(interpretMuseRecord(rec('run.output.delta', { text: 'x' })).kind, 'delta');
    assert.equal(interpretMuseRecord(rec('task.lifecycle.started', {})).kind, 'ignored');
    assert.equal(interpretMuseRecord(rec('task.lifecycle.proposed', {
      event: { task_kind: 'model.unknown.response' },
    })).kind, 'ignored');
  });

  it('reports unknown types for the log instead of throwing', () => {
    const ev = interpretMuseRecord(rec('something.new.here', {}));
    assert.equal(ev.kind, 'unknown');
    assert.equal(parseRecord('not json'), null);
    assert.equal(parseRecord(''), null);
  });

  it('only reads tool names out of tool task kinds', () => {
    assert.equal(toolNameFromTaskKind('tool.bash'), 'bash');
    assert.equal(toolNameFromTaskKind('reminder.agent.skill-reminder'), null);
  });
});

describe('muse-stream — run classification', () => {
  it('a completed terminal is success', () => {
    assert.equal(classifyMuseRun({ code: 0, terminal: { terminal: 'completed' } }).ok, true);
  });

  it('a failed terminal carries its reason', () => {
    const v = classifyMuseRun({ code: 1, terminal: { terminal: 'failed', reason: 'model error' } });
    assert.equal(v.ok, false);
    assert.match(v.userMessage, /model error/);
  });

  it('a rejected key before any terminal is an auth failure', () => {
    const v = classifyMuseRun({ code: 1, stderr: 'muse: your API key from META_API_KEY was rejected' });
    assert.equal(v.kind, 'auth_required');
  });

  it('otherwise surfaces the last real stderr line, not the startup notes', () => {
    const v = classifyMuseRun({
      code: 2,
      stderr: 'muse: something broke\nmuse: workspace root: /w (cwd default)\n',
    });
    assert.equal(v.kind, 'cli_error');
    assert.match(v.userMessage, /something broke/);
  });
});

describe('muse-stream — MCP settings', () => {
  const entry = buildMuseMcpEntry({ command: '/node', args: ['/cli.js', 'mcp-server'] });

  it('holds no secret: every varying value is an env reference', () => {
    for (const v of Object.values(entry.env)) assert.match(v, /^\$\{[A-Z_]+\}$/);
    assert.equal(entry.mode, 'optional');
    assert.equal(entry.framing, 'line_delimited_json');
  });

  it('creates a loadable file from nothing', () => {
    const out = mergeMuseSettings(null, entry);
    assert.equal(out.schema_version, 1);
    assert.deepEqual(out.mcp_servers[MUSE_MCP_SERVER_NAME], entry);
  });

  it('keeps the user\'s other settings and servers', () => {
    const out = mergeMuseSettings({ schema_version: 2, theme: 'dark', mcp_servers: { mine: { transport: 'stdio' } } }, entry);
    assert.equal(out.schema_version, 2);
    assert.equal(out.theme, 'dark');
    assert.ok(out.mcp_servers.mine);
  });

  it('reports no change when the entry is already current', () => {
    const once = mergeMuseSettings(null, entry);
    assert.equal(mergeMuseSettings(once, entry), null);
  });

  it('names what is wrong with a file it will not merge into', () => {
    assert.equal(museSettingsProblem({ schema_version: 1 }), null);
    assert.equal(museSettingsProblem([1]).museRejects, true);
    assert.equal(museSettingsProblem({ mcp_servers: {} }).museRejects, true);
    // Muse 1.3.0 starts with this one; we still refuse to overwrite it.
    assert.equal(museSettingsProblem({ schema_version: 1, mcp_servers: 5 }).museRejects, false);
  });
});

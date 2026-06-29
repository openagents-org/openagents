'use strict';

/**
 * Tests for the Goose adapter and its stream-json parser. No real goose binary
 * and no model credits: a fake `goose` Node script emits stream-json, and the
 * parser is tested as a pure unit. Mirrors tests/agents/test_goose_stream.py
 * and tests/agents/test_goose_adapter.py.
 *
 * Run: node --test test/goose.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { GooseStreamParser, classifyGooseError, redactSecrets } = require('../src/adapters/goose-stream');
const GooseAdapter = require('../src/adapters/goose');
const { ADAPTER_MAP } = require('../src/adapters/index');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function isPidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function msg(role, content) {
  return JSON.stringify({ type: 'message', message: { role, created: 1, content } });
}
function feedAll(p, ...lines) {
  const out = [];
  for (const l of lines) out.push(...p.feed(l + '\n'));
  out.push(...p.finish());
  return out;
}
function kinds(events) { return events.map((e) => e.kind); }

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe('GooseStreamParser', () => {
  it('emits the final assistant text once on complete', () => {
    const p = new GooseStreamParser();
    const events = feedAll(p,
      msg('assistant', [{ type: 'text', text: 'Hello world' }]),
      JSON.stringify({ type: 'complete', total_tokens: 10 }));
    assert.equal(p.finalText, 'Hello world');
    assert.equal(kinds(events).filter((k) => k === 'final').length, 1);
    assert.equal(p.hadError, false);
  });

  it('maps tool requests and results', () => {
    const p = new GooseStreamParser();
    const events = feedAll(p,
      msg('assistant', [{ type: 'toolRequest', id: 't1', toolCall: { status: 'success', value: { name: 'developer__shell', arguments: { command: 'ls -la' } } } }]),
      msg('user', [{ type: 'toolResponse', id: 't1', toolResult: { status: 'success', value: [] } }]),
      msg('assistant', [{ type: 'text', text: 'done' }]),
      JSON.stringify({ type: 'complete' }));
    const tool = events.find((e) => e.kind === 'tool');
    assert.equal(tool.name, 'developer__shell');
    assert.equal(tool.summary, 'ls -la');
    assert.ok(events.some((e) => e.kind === 'tool_result' && e.ok));
    assert.equal(p.finalText, 'done');
  });

  it('surfaces intermediate assistant text as progress (not thinking), last as final', () => {
    const p = new GooseStreamParser();
    const events = feedAll(p,
      msg('assistant', [{ type: 'text', text: 'step 1' }]),
      msg('assistant', [{ type: 'text', text: 'final answer' }]),
      JSON.stringify({ type: 'complete' }));
    assert.ok(events.some((e) => e.kind === 'progress' && e.text === 'step 1'));
    assert.ok(!events.some((e) => e.kind === 'thinking')); // interim text never mislabeled
    assert.equal(p.finalText, 'final answer');
    assert.equal(kinds(events).filter((k) => k === 'final').length, 1);
  });

  it('keeps genuine thinking content distinct from interim progress', () => {
    const p = new GooseStreamParser();
    const events = feedAll(p,
      msg('assistant', [{ type: 'text', text: 'interim narration' }]),
      msg('assistant', [{ type: 'thinking', thinking: 'real chain of thought', signature: 's' }, { type: 'text', text: 'answer' }]),
      JSON.stringify({ type: 'complete' }));
    assert.ok(events.some((e) => e.kind === 'progress' && e.text.includes('interim')));
    assert.ok(events.some((e) => e.kind === 'thinking' && e.text.includes('real chain')));
    assert.equal(p.finalText, 'answer');
  });

  it('parses the canonical v1.37.0 stream-json sequence', () => {
    // Derived from the verified serde defs in block/goose v1.37.0 (StreamEvent /
    // MessageContent / tool_result_serde) — identical to tests/agents STABLE_V137_STREAM.
    const STABLE = [
      '{"type":"message","message":{"role":"assistant","created":1718000000,"content":'
      + '[{"type":"text","text":"I\'ll check the files."},'
      + '{"type":"toolRequest","id":"req_1","toolCall":{"status":"success","value":'
      + '{"name":"developer__shell","arguments":{"command":"ls"}}}}]}}',
      '{"type":"message","message":{"role":"user","created":1718000001,"content":'
      + '[{"type":"toolResponse","id":"req_1","toolResult":{"status":"success","value":'
      + '[{"type":"text","text":"README.md\\nsrc"}]}}]}}',
      '{"type":"message","message":{"role":"assistant","created":1718000002,"content":'
      + '[{"type":"text","text":"There are 2 entries: README.md and src."}]}}',
      '{"type":"complete","total_tokens":1234,"input_tokens":1000,"output_tokens":234}',
    ];
    const p = new GooseStreamParser();
    const events = feedAll(p, ...STABLE);
    assert.ok(events.some((e) => e.kind === 'progress' && e.text.includes('check the files')));
    assert.ok(!events.some((e) => e.kind === 'thinking'));
    const tool = events.find((e) => e.kind === 'tool');
    assert.equal(tool.name, 'developer__shell');
    assert.equal(tool.summary, 'ls');
    assert.ok(events.some((e) => e.kind === 'tool_result' && e.ok));
    assert.equal(p.finalText, 'There are 2 entries: README.md and src.');
    assert.equal(kinds(events).filter((k) => k === 'final').length, 1);
    assert.ok(events.some((e) => e.kind === 'complete' && e.tokens === 1234));
    assert.equal(p.hadError, false);
  });

  it('handles JSON split across chunks', () => {
    const p = new GooseStreamParser();
    const line = msg('assistant', [{ type: 'text', text: 'chunked' }]);
    const events = [];
    events.push(...p.feed(line.slice(0, 12)));
    events.push(...p.feed(line.slice(12) + '\n'));
    events.push(...p.feed(JSON.stringify({ type: 'complete' }) + '\n'));
    events.push(...p.finish());
    assert.equal(p.finalText, 'chunked');
  });

  it('ignores blank, invalid, and unknown lines without crashing', () => {
    const p = new GooseStreamParser();
    const events = [];
    events.push(...p.feed('\n'));
    events.push(...p.feed('not json\n'));
    events.push(...p.feed('{ broken\n'));
    events.push(...p.feed(JSON.stringify({ type: 'brand_new_event', x: 1 }) + '\n'));
    events.push(...p.feed(msg('assistant', [{ type: 'text', text: 'ok' }]) + '\n'));
    events.push(...p.finish());
    assert.equal(p.finalText, 'ok');
    assert.equal(p.hadError, false);
  });

  it('treats an error event as failure and suppresses final', () => {
    const p = new GooseStreamParser();
    const events = [];
    events.push(...p.feed(msg('assistant', [{ type: 'text', text: 'partial' }]) + '\n'));
    events.push(...p.feed(JSON.stringify({ type: 'error', error: '401 Unauthorized' }) + '\n'));
    events.push(...p.feed(JSON.stringify({ type: 'complete' }) + '\n'));
    events.push(...p.finish());
    assert.equal(p.hadError, true);
    assert.equal(kinds(events).filter((k) => k === 'final').length, 0);
  });

  it('emits final on EOF when complete is missing', () => {
    const p = new GooseStreamParser();
    const events = feedAll(p, msg('assistant', [{ type: 'text', text: 'partial' }]));
    assert.ok(events.some((e) => e.kind === 'final' && e.text === 'partial'));
  });

  it('surfaces notification progress messages', () => {
    const p = new GooseStreamParser();
    const events = feedAll(p, JSON.stringify({
      type: 'notification', extension_id: 'developer', progress: { progress: 0.5, total: 1, message: 'halfway' },
    }));
    assert.ok(events.some((e) => e.kind === 'notification' && e.text === 'halfway'));
  });

  it('does not blow up on very large output', () => {
    const p = new GooseStreamParser();
    const big = 'x'.repeat(200000);
    feedAll(p, msg('assistant', [{ type: 'text', text: big }]), JSON.stringify({ type: 'complete' }));
    assert.equal(p.finalText, big);
  });
});

describe('classifyGooseError', () => {
  const cases = [
    ['Error: 401 Unauthorized invalid api key', 'authentication'],
    ['429 too many requests', 'rate limit'],
    ['model gpt-x does not exist', 'model'],
    ['no provider configured', 'provider'],
    ['tool execution denied: permission denied', 'denied'],
    ['extension failed to start', 'extension'],
    ['connection refused', 'reach the provider'],
  ];
  for (const [text, needle] of cases) {
    it(`classifies: ${text.slice(0, 24)}`, () => {
      const out = classifyGooseError(text);
      assert.ok(out && out.toLowerCase().includes(needle));
    });
  }
  it('returns null for empty', () => {
    assert.equal(classifyGooseError(''), null);
    assert.equal(classifyGooseError(null), null);
  });
});

describe('redactSecrets', () => {
  it('masks explicit secrets and bearer/api keys', () => {
    const out = redactSecrets('Authorization: Bearer sk-abc123def456 key=topsecret999', ['topsecret999']);
    assert.ok(!out.includes('sk-abc123def456'));
    assert.ok(!out.includes('topsecret999'));
  });
  it('leaves short strings alone', () => {
    assert.equal(redactSecrets('hello world', ['ab']), 'hello world');
  });
});

// ---------------------------------------------------------------------------
// Adapter: registry / session names / command / env
// ---------------------------------------------------------------------------

function makeAdapter(opts = {}) {
  const base = {
    workspaceId: 'ws1', channelName: 'general', token: 'tok',
    agentName: 'agentA', endpoint: 'http://x', agentEnv: { PATH: process.env.PATH },
  };
  const a = new GooseAdapter({ ...base, ...opts });
  a._gooseBinary = '/fake/goose'; // pretend goose exists
  return a;
}

describe('Goose adapter map + session names', () => {
  it('is registered in the adapter map', () => {
    assert.ok(ADAPTER_MAP.goose === GooseAdapter);
  });
  it('session name is stable and isolated', () => {
    const { gooseSessionName } = GooseAdapter;
    assert.equal(gooseSessionName('w', 'a', 'c'), gooseSessionName('w', 'a', 'c'));
    assert.notEqual(gooseSessionName('w', 'a', 'c'), gooseSessionName('w', 'a', 'c2'));
    assert.notEqual(gooseSessionName('w', 'a', 'c'), gooseSessionName('w', 'a2', 'c'));
    assert.notEqual(gooseSessionName('w', 'a', 'c'), gooseSessionName('w2', 'a', 'c'));
  });
  it('session name is filesystem-safe and leaks nothing', () => {
    const name = GooseAdapter.gooseSessionName('ws/../x', 'a b', '../../etc/passwd');
    assert.ok(/^oa_[a-f0-9]{16}$/.test(name));
  });
});

describe('Goose minimum version', () => {
  it('minimum is the verified stable tag 1.37.0', () => {
    assert.deepEqual(GooseAdapter.MIN_GOOSE_VERSION, [1, 37, 0]);
  });
  it('parses goose --version output', () => {
    assert.deepEqual(GooseAdapter.parseGooseVersion('goose 1.37.0'), [1, 37, 0]);
    assert.deepEqual(GooseAdapter.parseGooseVersion('goose-cli 1.40.2 (abc)'), [1, 40, 2]);
    assert.equal(GooseAdapter.parseGooseVersion('no version'), null);
  });
  it('compares against the minimum (lenient on unknown)', () => {
    assert.equal(GooseAdapter.gooseVersionMeetsMinimum([1, 37, 0]), true);
    assert.equal(GooseAdapter.gooseVersionMeetsMinimum([2, 0, 0]), true);
    assert.equal(GooseAdapter.gooseVersionMeetsMinimum([1, 36, 9]), false);
    assert.equal(GooseAdapter.gooseVersionMeetsMinimum(null), true);
  });

  it('blocks a too-old CLI with an upgrade prompt and never runs the task', async () => {
    if (process.platform === 'win32') return; // shell-script fake is POSIX-only
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goose-'));
    const proj = path.join(tmp, 'proj'); fs.mkdirSync(proj);
    // A real executable that reports an ancient version.
    const verBin = path.join(tmp, 'old-goose.sh');
    fs.writeFileSync(verBin, '#!/bin/sh\necho "goose 1.10.0"\n');
    fs.chmodSync(verBin, 0o755);
    const a = makeAdapter({ workingDir: proj, agentEnv: { PATH: process.env.PATH } });
    a._gooseBinary = verBin; // version check runs this
    a._sessionsFile = path.join(tmp, 'sessions.json');
    let ran = false;
    a._buildCmd = () => { ran = true; return [process.execPath, '-e', '0']; };
    const sent = instrument(a);

    await a._handleMessage({ content: 'hi', sessionId: 'general' });

    assert.equal(ran, false); // task never built/spawned
    assert.equal(sent.response.length, 0);
    assert.equal(sent.error.length, 1);
    assert.ok(sent.error[0].includes('>= 1.37.0') && /too old/i.test(sent.error[0]));
  });
});

describe('Goose command building', () => {
  it('builds a new-session command with stream-json + stdin', () => {
    const a = makeAdapter();
    const name = GooseAdapter.gooseSessionName('ws1', 'agentA', 'general');
    const cmd = a._buildCmd(name, false, 'SYS');
    assert.equal(cmd[0], '/fake/goose');
    assert.equal(cmd[1], 'run');
    assert.equal(cmd[cmd.indexOf('--output-format') + 1], 'stream-json');
    assert.equal(cmd[cmd.indexOf('--name') + 1], name);
    assert.ok(cmd.includes('--no-profile'));
    assert.equal(cmd[cmd.indexOf('--with-builtin') + 1], 'developer');
    assert.ok(!cmd.includes('--resume'));
    assert.deepEqual(cmd.slice(-2), ['-i', '-']);
    assert.ok(cmd.includes('--max-turns'));
    assert.ok(cmd.includes('--max-tool-repetitions'));
  });

  it('adds --resume when resuming', () => {
    const a = makeAdapter();
    const cmd = a._buildCmd('oa_x', true, 'SYS');
    assert.ok(cmd.includes('--resume'));
  });

  it('never puts the key or prompt in argv', () => {
    const a = makeAdapter({ agentEnv: { PATH: process.env.PATH, GOOSE_PROVIDER__API_KEY: 'sk-zzz-secret' } });
    const cmd = a._buildCmd('oa_x', false, 'SYS');
    assert.ok(cmd.every((p) => !String(p).includes('sk-zzz-secret')));
  });
});

describe('Goose env / provider', () => {
  it('defaults GOOSE_MODE to auto and coerces blocking modes', () => {
    assert.equal(makeAdapter({ agentEnv: { PATH: '' } })._buildEnv().GOOSE_MODE, 'auto');
    assert.equal(makeAdapter({ agentEnv: { PATH: '', GOOSE_MODE: 'smart_approve' } })._buildEnv().GOOSE_MODE, 'auto');
    assert.equal(makeAdapter({ agentEnv: { PATH: '', GOOSE_MODE: 'approve' } })._buildEnv().GOOSE_MODE, 'auto');
    assert.equal(makeAdapter({ agentEnv: { PATH: '', GOOSE_MODE: 'chat' } })._buildEnv().GOOSE_MODE, 'chat');
  });

  it('passes provider/model/key/host through and keeps existing env', () => {
    const a = makeAdapter({ agentEnv: {
      PATH: '', GOOSE_PROVIDER: 'openai', GOOSE_MODEL: 'gpt-4o',
      GOOSE_PROVIDER__API_KEY: 'sk-secret', GOOSE_PROVIDER__HOST: 'https://proxy/v1',
      OPENAI_API_KEY: 'existing',
    } });
    const env = a._buildEnv();
    assert.equal(env.GOOSE_PROVIDER, 'openai');
    assert.equal(env.GOOSE_MODEL, 'gpt-4o');
    assert.equal(env.GOOSE_PROVIDER__API_KEY, 'sk-secret');
    assert.equal(env.GOOSE_PROVIDER__HOST, 'https://proxy/v1');
    assert.equal(env.OPENAI_API_KEY, 'existing'); // not cleared
  });
});

// ---------------------------------------------------------------------------
// Process-tree termination (stop) — real subprocess that spawns a child
// ---------------------------------------------------------------------------

function readFirstLine(stream) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      fn();
    };
    const t = setTimeout(() => finish(() => reject(new Error('timed out reading pid'))), 3000);
    // Guard the stream against 'error'. When the child is later SIGKILL'd, its
    // stdout pipe can emit EPIPE/EBADF/ECONNRESET (notably on macOS); without an
    // 'error' listener that becomes an unhandled 'error' event that crashes the
    // whole test worker. The listener persists for the stream's lifetime, so a
    // post-resolve error during teardown is swallowed instead of throwing.
    stream.on('error', () => finish(() => reject(new Error('stdout stream error'))));
    stream.on('data', (c) => {
      buf += c.toString('utf-8');
      const i = buf.indexOf('\n');
      if (i >= 0) finish(() => resolve(buf.slice(0, i).trim()));
    });
  });
}

describe('Goose stop terminates the process tree', () => {
  it('kills the spawned process and its children', async () => {
    const a = makeAdapter();
    const script = [
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio:'ignore' });",
      'console.log(child.pid);',
      'setInterval(()=>{}, 1000);',
    ].join('\n');
    const proc = spawn(process.execPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    // Killing the child can make its stdio/process emit 'error' (EPIPE/EBADF on
    // macOS). Swallow so it never becomes an unhandled 'error' that crashes the
    // test worker.
    proc.on('error', () => {});
    if (proc.stdout) proc.stdout.on('error', () => {});
    try {
      const childPid = Number(await readFirstLine(proc.stdout));
      assert.equal(isPidAlive(proc.pid), true);
      assert.equal(isPidAlive(childPid), true);
      await a._stopProcess(proc);
      await sleep(500);
      assert.equal(isPidAlive(proc.pid), false);
      assert.equal(isPidAlive(childPid), false); // tree termination
    } finally {
      await a._stopProcess(proc);
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end run against a fake goose (Node script emitting stream-json)
// ---------------------------------------------------------------------------

function makeFakeGoose(dir, streamLines, { exitCode = 0, stderr = '' } = {}) {
  const file = path.join(dir, 'fake-goose.js');
  const body = `
const chunks = [];
process.stdin.on('data', (d) => chunks.push(d));
process.stdin.on('end', () => {
  for (const line of ${JSON.stringify(streamLines)}) process.stdout.write(line + '\\n');
  if (${JSON.stringify(stderr)}) process.stderr.write(${JSON.stringify(stderr)} + '\\n');
  process.exit(${exitCode});
});
`;
  fs.writeFileSync(file, body);
  // Return an argv-style wrapper: the adapter spawns cmd[0] with cmd.slice(1).
  return file;
}

function instrument(a) {
  const sent = { status: [], thinking: [], response: [], error: [] };
  a.sendStatus = async (_ch, c) => { sent.status.push(c); };
  a.sendThinking = async (_ch, c) => { sent.thinking.push(c); };
  a.sendResponse = async (_ch, c) => { sent.response.push(c); };
  a.sendError = async (_ch, c) => { sent.error.push(c); };
  a._autoTitleChannel = async () => {};
  return sent;
}

describe('Goose end-to-end (fake binary)', () => {
  it('runs a successful turn, posts final once, records the session', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goose-'));
    const proj = path.join(tmp, 'proj'); fs.mkdirSync(proj);
    const lines = [
      msg('assistant', [{ type: 'toolRequest', id: 't1', toolCall: { status: 'success', value: { name: 'developer__shell', arguments: { command: 'echo hi' } } } }]),
      msg('assistant', [{ type: 'text', text: 'All done!' }]),
      JSON.stringify({ type: 'complete', total_tokens: 7 }),
    ];
    const fake = makeFakeGoose(tmp, lines);
    const a = makeAdapter({ workingDir: proj, agentEnv: { PATH: process.env.PATH } });
    a._sessionsFile = path.join(tmp, 'sessions.json');
    // Spawn `node fake-goose.js …` instead of a real goose binary.
    a._buildCmd = (name, resume) => [process.execPath, fake, name, resume ? '--resume' : ''];
    const sent = instrument(a);

    await a._handleMessage({ content: 'do the thing', sessionId: 'general' });

    assert.deepEqual(sent.response, ['All done!']);
    assert.deepEqual(sent.error, []);
    assert.ok(sent.status.some((s) => s.includes('developer__shell')));
    assert.ok(Object.prototype.hasOwnProperty.call(a._channelSessions, 'general'));
  });

  it('treats a non-zero exit as failure even with partial stdout', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goose-'));
    const proj = path.join(tmp, 'proj'); fs.mkdirSync(proj);
    const lines = [msg('assistant', [{ type: 'text', text: 'partial' }])];
    const fake = makeFakeGoose(tmp, lines, { exitCode: 1, stderr: 'Error: 401 Unauthorized invalid api key' });
    const a = makeAdapter({ workingDir: proj, agentEnv: { PATH: process.env.PATH } });
    a._sessionsFile = path.join(tmp, 'sessions.json');
    a._buildCmd = () => [process.execPath, fake];
    const sent = instrument(a);

    await a._handleMessage({ content: 'hi', sessionId: 'general' });

    assert.deepEqual(sent.response, []);
    assert.equal(sent.error.length, 1);
    assert.ok(sent.error[0].toLowerCase().includes('authentication'));
    assert.ok(!Object.prototype.hasOwnProperty.call(a._channelSessions, 'general'));
  });

  it('second message resumes the same channel session', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goose-'));
    const proj = path.join(tmp, 'proj'); fs.mkdirSync(proj);
    const lines = [msg('assistant', [{ type: 'text', text: 'ok' }]), JSON.stringify({ type: 'complete' })];
    const fake = makeFakeGoose(tmp, lines);
    const a = makeAdapter({ workingDir: proj, agentEnv: { PATH: process.env.PATH } });
    a._sessionsFile = path.join(tmp, 'sessions.json');
    const seen = [];
    a._buildCmd = (name, resume) => { seen.push({ name, resume }); return [process.execPath, fake]; };
    instrument(a);

    await a._handleMessage({ content: 'first', sessionId: 'general' });
    await a._handleMessage({ content: 'second', sessionId: 'general' });

    assert.equal(seen[0].resume, false);
    assert.equal(seen[1].resume, true);
    assert.equal(seen[0].name, seen[1].name);
  });

  it('auto-heals a missing session (resume fails → recreate)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goose-'));
    const proj = path.join(tmp, 'proj'); fs.mkdirSync(proj);
    // Fake goose: fail "No session found" when --resume is present, else succeed.
    const fake = path.join(tmp, 'heal-goose.js');
    const success = msg('assistant', [{ type: 'text', text: 'fresh' }]);
    const complete = JSON.stringify({ type: 'complete' });
    fs.writeFileSync(fake, `
const chunks = [];
process.stdin.on('data', (d) => chunks.push(d));
process.stdin.on('end', () => {
  if (process.argv.includes('--resume')) {
    process.stderr.write("Error: No session found with name oa_x\\n");
    process.exit(1);
  }
  process.stdout.write(${JSON.stringify(success)} + '\\n');
  process.stdout.write(${JSON.stringify(complete)} + '\\n');
  process.exit(0);
});
`);
    const a = makeAdapter({ workingDir: proj, agentEnv: { PATH: process.env.PATH } });
    a._sessionsFile = path.join(tmp, 'sessions.json');
    a._channelSessions.general = GooseAdapter.gooseSessionName('ws1', 'agentA', 'general'); // stale
    a._buildCmd = (name, resume) => [process.execPath, fake, ...(resume ? ['--resume'] : [])];
    const sent = instrument(a);

    await a._handleMessage({ content: 'hi', sessionId: 'general' });

    assert.deepEqual(sent.response, ['fresh']);
    assert.ok(sent.status.some((s) => /new one|reset/i.test(s)));
    assert.deepEqual(sent.error, []);
  });

  it('reports an error for an invalid working directory', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goose-'));
    const a = makeAdapter({ workingDir: path.join(tmp, 'missing'), agentEnv: { PATH: process.env.PATH } });
    a._sessionsFile = path.join(tmp, 'sessions.json');
    const sent = instrument(a);
    await a._handleMessage({ content: 'hi', sessionId: 'general' });
    assert.ok(sent.error.length === 1 && sent.error[0].includes('does not exist'));
  });
});

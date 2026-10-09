'use strict';

/**
 * Hermes keeps one session per workspace thread.
 *
 * Reported as "low cache hit rate — every conversation creates a new session,
 * history cannot be reused, work is repeated and replies get slower". Two
 * things in the adapter produced that:
 *
 *   - Hermes exits non-zero for every turn that does not finish (provider
 *     error, iteration limit, user stop) while still printing the session id.
 *     The adapter read any non-zero exit as "the resume failed", dropped the
 *     session and ran the prompt again in an empty one.
 *   - The ~18 KB of workspace instructions were prepended to every user
 *     message, so each turn wrote a new copy into the session.
 *
 * The contract pinned here:
 *   - a session is given up only when Hermes no longer has it;
 *   - an unfinished turn runs once and its own explanation reaches the user;
 *   - the instructions travel as a Hermes prefill (HERMES_PREFILL_MESSAGES_FILE)
 *     and a resumed turn's prompt is the user's message alone;
 *   - a Hermes too old to read that variable still gets the instructions, in
 *     the message as before.
 *
 * Run: node --test test/hermes-session-reuse.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createAdapter } = require('../src/adapters');

const CURRENT_HERMES = 'Hermes Agent v0.21.4 (2026.9.24)\nInstall directory: /opt/hermes';
const CHANNEL = 'thread-1';

let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-reuse-')); });
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** What a `_runHermes` call resolves with, with the uneventful defaults. */
const ran = (over) => ({ stopped: false, exitCode: 0, text: '', sessionId: null, detail: '', ...over });

/**
 * A hermes adapter wired to a fake workspace. `script` is the list of results
 * successive `_runHermes` calls resolve with; pass `script: null` to keep the
 * real `_runHermes` (the caller then points it at a stub CLI).
 */
function makeHermes({ script = [], session = null, transcript = [], version = CURRENT_HERMES } = {}) {
  const a = createAdapter('hermes', {
    workspaceId: 'w',
    channelName: 'general',
    token: 'tok-secret',
    agentName: 'hermes-test',
    endpoint: 'http://127.0.0.1:0',
  });
  a._log = () => {};
  a._hermesBin = '/fake/hermes';
  a._findHermesBinary = () => a._hermesBin;
  a._sessionsFile = path.join(tmp, `sessions-${Math.random().toString(36).slice(2)}.json`);
  for (const k of Object.keys(a._channelSessions)) delete a._channelSessions[k];
  if (session) a._channelSessions[CHANNEL] = session;

  const seen = { runs: [], responses: [], errors: [], versionProbes: 0, historyArgs: [] };
  a._hermesVersionText = async () => {
    seen.versionProbes++;
    if (version instanceof Error) throw version;
    return version;
  };
  a.client = {
    getAgents: async () => [{ agentName: 'hermes-test', role: 'member', status: 'online' }],
    getRecentMessages: async (...args) => { seen.historyArgs.push(args); return transcript; },
  };
  a.sendStatus = async () => {};
  a._autoTitleChannel = async () => {};
  a.sendResponse = async (_ch, text) => { seen.responses.push(text); };
  a.sendError = async (_ch, text) => { seen.errors.push(text); };
  if (script) {
    a._runHermes = async (prompt, channel, resumeId, prefillFile) => {
      seen.runs.push({
        prompt,
        resumeId,
        prefillFile,
        prefill: prefillFile ? JSON.parse(fs.readFileSync(prefillFile, 'utf-8')) : null,
      });
      return script.shift();
    };
  }
  return { a, seen };
}

const say = (a, content) => a._handleMessage({ content, sessionId: CHANNEL });
const savedSessions = (a) => JSON.parse(fs.readFileSync(a._sessionsFile, 'utf-8'));

describe('Hermes: a thread keeps its session', () => {
  it('resumes the stored session and sends the user message alone', async () => {
    const { a, seen } = makeHermes({
      script: [ran({ text: 'noted', sessionId: 'S1' }), ran({ text: '4', sessionId: 'S1' })],
    });

    await say(a, 'remember BANANA-42');
    await say(a, 'what is 2+2?');

    assert.equal(seen.runs[0].resumeId, null);
    assert.equal(seen.runs[1].resumeId, 'S1');
    assert.equal(seen.runs[1].prompt, 'what is 2+2?');
    assert.deepEqual(seen.responses, ['noted', '4']);
    assert.deepEqual(savedSessions(a), { [CHANNEL]: 'S1' });
  });

  it('a turn that does not finish keeps the session and is not run again', async () => {
    const why = 'custom rate-limited every one of 3 attempts — it looks temporarily unavailable.';
    const { a, seen } = makeHermes({
      session: 'S1',
      script: [ran({ exitCode: 1, text: why, sessionId: 'S1' })],
    });

    await say(a, 'asked during a rate limit');

    assert.equal(seen.runs.length, 1, 'the prompt must not be replayed in a fresh session');
    assert.equal(a._channelSessions[CHANNEL], 'S1');
    assert.deepEqual(seen.errors, [why], "Hermes's own explanation reaches the user");
    assert.deepEqual(seen.responses, []);
  });

  it('a first turn that fails still leaves a session to resume', async () => {
    const { a, seen } = makeHermes({
      script: [ran({ exitCode: 1, text: 'provider said no', sessionId: 'S1' }), ran({ text: 'ok', sessionId: 'S1' })],
    });

    await say(a, 'first');
    await say(a, 'second');

    assert.deepEqual(savedSessions(a), { [CHANNEL]: 'S1' });
    assert.equal(seen.runs[1].resumeId, 'S1');
  });

  it('a stopped turn keeps the session and posts nothing', async () => {
    for (const stopped of [
      ran({ stopped: true, exitCode: 130, sessionId: 'S1' }), // interrupted mid-turn
      ran({ stopped: true, exitCode: null }),                 // killed while starting up
    ]) {
      const { a, seen } = makeHermes({ session: 'S1', script: [stopped] });

      await say(a, 'long task');

      assert.equal(seen.runs.length, 1);
      assert.equal(a._channelSessions[CHANNEL], 'S1');
      assert.deepEqual([seen.responses, seen.errors], [[], []]);
    }
  });

  it('follows Hermes to the session id it reports', async () => {
    const { a } = makeHermes({ session: 'S1', script: [ran({ text: 'ok', sessionId: 'S2' })] });

    await say(a, 'hello');

    assert.deepEqual(savedSessions(a), { [CHANNEL]: 'S2' });
  });
});

describe('Hermes: a session that is gone', () => {
  const transcript = [
    { messageId: 'm1', messageType: 'chat', senderType: 'human', senderName: 'alice', content: 'remember BANANA-42' },
    { messageId: 'm2', messageType: 'status', senderType: 'agent', senderName: 'hermes-test', content: 'thinking...' },
    { messageId: 'm3', messageType: 'chat', senderType: 'agent', senderName: 'hermes-test', content: 'noted' },
    { messageId: 'm4', messageType: 'chat', senderType: 'human', senderName: 'alice', content: 'what was the codeword?' },
  ];
  const notFound = ran({ exitCode: 1, detail: 'Session not found: S1\nUse a session ID from a previous CLI run (hermes sessions list).' });

  it('is replaced by a new one that is told what was said before', async () => {
    const { a, seen } = makeHermes({
      session: 'S1',
      transcript,
      script: [notFound, ran({ text: 'BANANA-42', sessionId: 'S2' })],
    });

    await say(a, 'what was the codeword?');

    assert.deepEqual(seen.runs.map((r) => r.resumeId), ['S1', null]);
    const fresh = seen.runs[1].prompt;
    assert.match(fresh, /## Recent Workspace Messages\n- alice: remember BANANA-42\n- hermes-test: noted\n/);
    assert.doesNotMatch(fresh, /thinking\.\.\./, 'status noise is not conversation');
    assert.equal(fresh.split('what was the codeword?').length - 1, 1, 'the message being answered appears once');
    assert.match(fresh, /\n---\n\nUser message:\nwhat was the codeword\?$/);
    assert.deepEqual(seen.historyArgs[0], ['w', CHANNEL, 'tok-secret', 30]);
    assert.deepEqual(savedSessions(a), { [CHANNEL]: 'S2' });
    assert.deepEqual(seen.responses, ['BANANA-42']);
  });

  it('is forgotten even when the new session cannot start either', async () => {
    const { a, seen } = makeHermes({
      session: 'S1',
      script: [notFound, ran({ exitCode: 1, detail: 'No inference provider configured' })],
    });
    a._saveSessions();

    await say(a, 'hello');

    assert.deepEqual(savedSessions(a), {});
    assert.deepEqual(seen.errors, ['Error processing message: hermes exited with code 1: No inference provider configured']);
  });

  it('a Hermes that cannot start at all does not cost the thread its session', async () => {
    const broken = ran({ exitCode: 1, detail: 'No inference provider configured' });
    const { a, seen } = makeHermes({ session: 'S1', script: [broken, { ...broken }] });

    await say(a, 'hello');

    assert.equal(a._channelSessions[CHANNEL], 'S1');
    assert.equal(seen.errors.length, 1);
  });
});

describe('Hermes: workspace instructions travel as a prefill', () => {
  it('writes them to the prefill file and keeps them out of the message', async () => {
    const { a, seen } = makeHermes({ script: [ran({ text: 'hi', sessionId: 'S1' }), ran({ text: 'hi', sessionId: 'S1' })] });

    await say(a, 'hello');
    await say(a, 'again');

    for (const run of seen.runs) {
      assert.equal(run.prefill.length, 1);
      assert.equal(run.prefill[0].role, 'user');
      const text = run.prefill[0].content;
      assert.match(text, /^You are agent 'hermes-test' connected to an OpenAgents workspace\./);
      assert.match(text, /## OpenAgents-specific Rules/);
      assert.match(text, /not a message to answer\. The conversation follows\.$/);
      assert.doesNotMatch(run.prompt, /You are agent 'hermes-test'/);
      assert.equal(fs.existsSync(run.prefillFile), false, 'the file carries the workspace token and is removed after the run');
    }
    assert.equal(seen.runs[0].prefill[0].content, seen.runs[1].prefill[0].content, 'identical from one turn to the next');
    assert.match(seen.runs[0].prompt, /^## Available Workspace Agents\n- hermes-test \(member, online\)\n\n---\n\nUser message:\nhello$/);
    assert.equal(seen.versionProbes, 1, 'the version is asked once per binary');
  });

  it('a message that starts with a dash is not handed to -q bare', async () => {
    const { a, seen } = makeHermes({ session: 'S1', script: [ran({ text: 'ok', sessionId: 'S1' })] });

    await say(a, '--help');

    assert.equal(seen.runs[0].prompt, 'User message:\n--help');
  });

  it('a Hermes too old to read the variable gets them in every message', async () => {
    for (const version of ['Hermes Agent v0.10.0 (2026.4.16)', new Error('spawn ENOENT')]) {
      const { a, seen } = makeHermes({ session: 'S1', version, script: [ran({ text: 'ok', sessionId: 'S1' })] });

      await say(a, 'hello');

      assert.equal(seen.runs[0].prefillFile, null);
      assert.match(seen.runs[0].prompt, /^You are agent 'hermes-test' connected to an OpenAgents workspace\./);
      assert.match(seen.runs[0].prompt, /\n---\n\nUser message:\nhello$/);
    }
  });

  it('reads the release date out of `hermes --version`', () => {
    const { a } = makeHermes();
    const cases = {
      'Hermes Agent v0.10.0 (2026.4.16)': false,
      'Hermes Agent v0.16.0 (2026.6.5)': false,
      'Hermes Agent v0.16.1 (2026.6.15)': true,
      'Hermes Agent vgit.7951ddd (2026.9.24) · upstream 7951ddd7': true,
      'Hermes Agent v1.0.0 (2027.1.2)': true,
      'hermes: command not found': false,
      '': false,
    };
    for (const [text, expected] of Object.entries(cases)) {
      assert.equal(a._readsPrefillEnv(text), expected, text);
    }
  });
});

// ---------------------------------------------------------------------------
// _runHermes against a real child process: a stub that behaves like
// `hermes chat -Q` — body on stdout, bookkeeping on stderr, exit code by
// outcome.
// ---------------------------------------------------------------------------

describe('Hermes: what a run reports', () => {
  let stub;
  before(() => {
    stub = path.join(tmp, 'hermes-stub.js');
    fs.writeFileSync(stub, `
      const mode = process.argv[2];
      if (mode === 'unfinished') {
        process.stdout.write('partial answer\\n\\n⚠️ No reply: the maximum tool-iteration limit was reached.\\n');
        process.stderr.write('↻ Resumed session S1 "t" (2 user messages, 4 total messages)\\n\\nsession_id: S1\\n');
        process.exit(1);
      } else if (mode === 'gone') {
        process.stderr.write('Session not found: S1\\nUse a session ID from a previous CLI run (hermes sessions list).\\n');
        process.exit(1);
      } else if (mode === 'env') {
        process.stdout.write(String(process.env.HERMES_PREFILL_MESSAGES_FILE));
        process.stderr.write('\\nsession_id: S1\\n');
      } else if (mode === 'slow') {
        process.stderr.write('started\\n');
        setTimeout(() => {}, 60000);
      }
    `);
  });

  function stubbed(mode) {
    const made = makeHermes({ script: null, session: 'S1' });
    made.a._hermesBin = process.execPath;
    made.a._buildHermesCmd = () => [stub, mode];
    return made;
  }

  it('an unfinished turn: exit code, the session it is in, and what Hermes said', async () => {
    const { a } = stubbed('unfinished');

    assert.deepEqual(await a._runHermes('p', CHANNEL, 'S1'), {
      stopped: false,
      exitCode: 1,
      text: 'partial answer\n⚠️ No reply: the maximum tool-iteration limit was reached.',
      sessionId: 'S1',
      detail: '',
    });
  });

  it('a resume of a missing session: no session, and the reason without bookkeeping', async () => {
    const { a } = stubbed('gone');

    const run = await a._runHermes('p', CHANNEL, 'S1');

    assert.equal(run.sessionId, null);
    assert.equal(run.exitCode, 1);
    assert.match(run.detail, /^Session not found: S1\n/);
  });

  it('hands the prefill file to the CLI through its environment', async () => {
    const { a } = stubbed('env');

    assert.equal((await a._runHermes('p', CHANNEL, null, '/tmp/prefill.json')).text, '/tmp/prefill.json');
    assert.equal((await a._runHermes('p', CHANNEL, null)).text, 'undefined');
  });

  it('a CLI that cannot be started reports why', async () => {
    const { a } = stubbed('env');
    a._hermesBin = path.join(tmp, 'no-such-hermes');

    const run = await a._runHermes('p', CHANNEL, 'S1');

    assert.equal(run.exitCode, -1);
    assert.equal(run.sessionId, null);
    assert.match(run.detail, /ENOENT/);
  });

  it('a user stop mid-turn ends the run as stopped and the thread keeps its session', async () => {
    const { a, seen } = stubbed('slow');
    a._announceUserStop = async () => {};
    a.cleanupTodos = async () => {};
    a._prefetchPinnedContext = async () => {};

    const msg = { content: 'long task', sessionId: CHANNEL, _acceptedGeneration: a._stopGenerationFor(CHANNEL) };
    const turn = a._channelWorker(CHANNEL, msg);
    // Wait for the stub to be up before stopping it.
    for (let i = 0; i < 200 && !a._channelProcesses[CHANNEL]; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(a._channelProcesses[CHANNEL], 'the stub CLI should be running');
    await a._handleUserStop(CHANNEL);
    await turn;

    assert.equal(a._channelSessions[CHANNEL], 'S1');
    assert.deepEqual([seen.responses, seen.errors], [[], []]);
  });
});

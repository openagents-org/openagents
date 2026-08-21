'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAgyArgv,
  parseAgyEvent,
  toolPreview,
  AgyRunState,
  classifyAgyFailure,
  agyBinaryCandidates,
} = require('../src/adapters/antigravity-stream');

// Helper: run a sequence of NDJSON lines through a fresh run state.
function consumeLines(lines) {
  const run = new AgyRunState();
  const actions = [];
  for (const line of lines) {
    const event = parseAgyEvent(line);
    if (event) actions.push(...run.consume(event));
  }
  return { run, actions };
}

describe('buildAgyArgv', () => {
  it('builds the base headless argv', () => {
    assert.deepEqual(buildAgyArgv({ prompt: 'hi' }), [
      '-p', 'hi',
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
    ]);
  });

  it('appends model and conversation resume', () => {
    const args = buildAgyArgv({ prompt: 'hi', model: 'g3-pro', conversationId: 'c-1' });
    assert.ok(args.includes('--model') && args.includes('g3-pro'));
    assert.ok(args.includes('--conversation') && args.includes('c-1'));
  });

  it('drops the conversation when skipResume is set', () => {
    const args = buildAgyArgv({ prompt: 'hi', conversationId: 'c-1', skipResume: true });
    assert.ok(!args.includes('--conversation'));
  });
});

describe('parseAgyEvent', () => {
  it('parses event lines and rejects everything else', () => {
    assert.equal(parseAgyEvent(''), null);
    assert.equal(parseAgyEvent('not json'), null);
    assert.equal(parseAgyEvent('{"no_event":1}'), null);
    assert.equal(parseAgyEvent('{"event":"init","conversation_id":"c"}').event, 'init');
  });
});

describe('toolPreview', () => {
  it('prefers command, then path, then query, then JSON', () => {
    assert.equal(toolPreview({ CommandLine: 'echo hi' }), 'echo hi');
    assert.equal(toolPreview({ AbsolutePath: '/tmp/x' }), '/tmp/x');
    assert.equal(toolPreview({ Query: 'find me' }), 'find me');
    assert.equal(toolPreview({ foo: 1 }), '{"foo":1}');
    assert.equal(toolPreview(null), '');
  });
});

describe('AgyRunState', () => {
  it('captures the conversation id from init', () => {
    const { run, actions } = consumeLines([
      '{"event":"init","conversation_id":"c-9","init":{"cwd":"/w","tools":[],"permission_mode":"always-proceed"}}',
    ]);
    assert.equal(run.conversationId, 'c-9');
    assert.deepEqual(actions[0], { type: 'conversation', id: 'c-9' });
  });

  it('accumulates text_delta fragments and flushes on DONE as one thinking action', () => {
    const { run, actions } = consumeLines([
      '{"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"Hel"}}',
      '{"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"lo!"}}',
      '{"event":"step_update","step_update":{"step_index":1,"state":"DONE","step_type":"agent_response"}}',
    ]);
    assert.deepEqual(actions, [{ type: 'thinking', text: 'Hello!' }]);
    assert.equal(run.finalResponse(), 'Hello!');
  });

  it('announces each tool step exactly once, with a parameter preview', () => {
    const toolLine = '{"event":"step_update","step_update":{"step_index":2,"state":"%S","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"ls -la"}}}}';
    const { actions } = consumeLines([
      toolLine.replace('%S', 'ACTIVE'),
      toolLine.replace('%S', 'DONE'),
    ]);
    assert.deepEqual(actions, [{ type: 'tool', name: 'run_command', preview: 'ls -la' }]);
  });

  it('prefers the result envelope response over accumulated deltas', () => {
    const { run } = consumeLines([
      '{"event":"step_update","step_update":{"step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"draft text"}}',
      '{"event":"result","result":{"conversation_id":"c-1","status":"SUCCESS","response":"final answer"}}',
    ]);
    assert.equal(run.status, 'SUCCESS');
    assert.equal(run.finalResponse(), 'final answer');
  });

  it('resets narration blocks after a tool step, like the gemini adapter', () => {
    const { run } = consumeLines([
      '{"event":"step_update","step_update":{"step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"Let me check."}}',
      '{"event":"step_update","step_update":{"step_index":2,"state":"DONE","step_type":"tool","tool_info":{"name":"run_command","parameters":{"CommandLine":"date"}}}}',
      '{"event":"step_update","step_update":{"step_index":3,"state":"DONE","step_type":"agent_response","text_delta":"It is Tuesday."}}',
    ]);
    // Stream died before its result event → last block only.
    assert.equal(run.finalResponse(), 'It is Tuesday.');
  });

  it('falls back to a half-flushed delta when the stream dies mid-block', () => {
    const { run } = consumeLines([
      '{"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"partial ans"}}',
    ]);
    assert.equal(run.finalResponse(), 'partial ans');
    assert.equal(run.sawText(), false); // nothing was ever flushed/posted
  });

  it('records the error object from a failed result', () => {
    const { run } = consumeLines([
      '{"event":"result","result":{"status":"ERROR","response":"","error":{"type":"auth","message":"authentication required"}}}',
    ]);
    assert.equal(run.status, 'ERROR');
    assert.equal(run.error.message, 'authentication required');
  });
});

describe('classifyAgyFailure', () => {
  it('classifies authentication failures with actionable guidance', () => {
    const { kind, message } = classifyAgyFailure({ code: 1, stderr: 'Error: authentication required — run agy to sign in' });
    assert.equal(kind, 'auth');
    assert.match(message, /GEMINI_API_KEY/);
    assert.match(message, /`agy`/);
  });

  it('classifies the provider-set-but-no-key startup refusal', () => {
    const { kind, message } = classifyAgyFailure({ code: 1, stderr: 'cannot start: modelProvider is set to gemini but GEMINI_API_KEY is unset' });
    // The auth pattern also matches GEMINI_API_KEY, so auth wins — either way
    // the user is pointed at the key. Accept both kinds but require guidance.
    assert.ok(kind === 'auth' || kind === 'config');
    assert.match(message, /GEMINI_API_KEY/);
  });

  it('classifies unknown-model failures', () => {
    const { kind } = classifyAgyFailure({ code: 1, stderr: 'ERROR: unknown model "g9-ultra"' });
    assert.equal(kind, 'model');
  });

  it('classifies the real agy 1.1.17 string-error payload with empty stderr', () => {
    // Captured verbatim from agy 1.1.17: result.error is a STRING, not the
    // {type, message} object the docs describe.
    const { kind, message } = classifyAgyFailure({
      code: 1,
      stderr: '',
      error: 'authentication failed or timed out',
    });
    assert.equal(kind, 'auth');
    assert.match(message, /GEMINI_API_KEY/);
  });

  it('uses the result error object when stderr is empty', () => {
    const { kind } = classifyAgyFailure({ code: 1, error: { type: 'timeout', message: 'print-timeout exceeded' } });
    assert.equal(kind, 'timeout');
  });

  it('falls back to exit code with the last stderr line', () => {
    const { kind, message } = classifyAgyFailure({ code: 7, stderr: 'boom\nsomething odd happened' });
    assert.equal(kind, 'unknown');
    assert.match(message, /exit 7/);
    assert.match(message, /something odd happened/);
  });
});

describe('agyBinaryCandidates', () => {
  it('lists unix install locations', () => {
    const c = agyBinaryCandidates({ home: '/home/u', isWindows: false });
    assert.ok(c.includes('/home/u/.local/bin/agy'));
    assert.ok(c.includes('/opt/homebrew/bin/agy'));
  });

  it('lists the windows install dir only when LOCALAPPDATA is known', () => {
    assert.deepEqual(
      agyBinaryCandidates({ isWindows: true, localAppData: 'C:\\Users\\u\\AppData\\Local' }),
      ['C:\\Users\\u\\AppData\\Local\\agy\\bin\\agy.exe'],
    );
    assert.deepEqual(agyBinaryCandidates({ isWindows: true }), []);
  });
});

/**
 * Routine fires start a new OpenCode session each time (they carry the routine's
 * full instructions), so a routine thread no longer grows into one conversation
 * that overflows the model. And an error the run already recovered from is not
 * reported as the reason it ended.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const OpenCodeAdapter = require('../src/adapters/opencode');

function makeAdapter() {
  const adapter = new OpenCodeAdapter({ workspaceId: 'ws', channelName: 'thread', token: 'token', agentName: 'opencode-test' });
  adapter._log = () => {};
  adapter.sendStatus = async () => {};
  adapter.sendResponse = async () => {};
  adapter._autoTitleChannel = async () => {};
  adapter._preflight = () => ({ ok: true });
  adapter._opencodeBinary = 'opencode';  // CI has no OpenCode; Windows checks the program's name before running
  adapter._ensureCustomProviderConfig = () => {};
  adapter._resolveModel = () => 'openagents-gateway/test-model';
  adapter._composePrompt = (content) => content;
  adapter._serverEnabled = () => true;
  adapter._turnContextFile = () => null;
  adapter._spawnEnv = () => ({});
  adapter._stoppedBeforeStart = () => false;
  const seen = [];
  adapter._runViaServer = async ({ sessionId }) => { seen.push(sessionId); return 'done'; };
  return { adapter, seen };
}

describe('OpenCode — routine runs start fresh', () => {
  it('a routine fire runs without the stored session; a person replying afterwards resumes it', async () => {
    const { adapter, seen } = makeAdapter();
    adapter._channelSessions['routines:bot'] = 'ses_old_and_huge';
    await adapter._handleMessage({ content: 'Routine Context: check the feed', sessionId: 'routines:bot', senderName: 'system:routine' });
    assert.equal(seen[0], undefined);
    await adapter._handleMessage({ content: 'thanks, what did you find?', sessionId: 'routines:bot', senderName: 'human:alice' });
    assert.equal(seen[1], 'ses_old_and_huge');  // the stub doesn't persist a new id; a real run would have saved its own
  });

  it('ordinary threads keep resuming their session', async () => {
    const { adapter, seen } = makeAdapter();
    adapter._channelSessions.thread = 'ses_thread';
    await adapter._handleMessage({ content: 'hello', sessionId: 'thread', senderName: 'human:alice' });
    assert.equal(seen[0], 'ses_thread');
  });

  it('a routine falling back from the warm server to a plain run still starts fresh', async () => {
    const { adapter } = makeAdapter();
    adapter._channelSessions['routines:bot'] = 'ses_old';
    // Capture the session the plain run would use, without spawning OpenCode.
    let plainSession = 'unset';
    const original = adapter._runOpencode.bind(adapter);
    adapter._runOpencode = function (content, channel, opts = {}) {
      if (opts.noServer) { plainSession = this._freshChannels.has(channel) ? undefined : this._channelSessions[channel]; return Promise.resolve('ok'); }
      return original(content, channel, opts);
    };
    adapter._freshChannels.add('routines:bot');
    const NO_SERVER = OpenCodeAdapter._NO_SERVER;
    assert.ok(NO_SERVER);
    adapter._runViaServer = async () => NO_SERVER;
    await adapter._runOpencode('x', 'routines:bot');
    assert.equal(plainSession, undefined);
  });
});

describe('OpenCode — recovered errors are not the cause', () => {
  const tooLarge = { type: 'error', error: { name: 'APICallError', message: "This model's maximum context length is 262144 tokens." } };

  it('detects an error the run got past', () => {
    const recovered = [tooLarge, { type: 'step_finish', part: {} }, { type: 'tool_use', item: { name: 'bash' } }].map((e) => JSON.stringify(e)).join(' ');
    const fatal = [{ type: 'tool_use', item: { name: 'bash' } }, tooLarge].map((e) => JSON.stringify(e)).join(' ');
    assert.equal(OpenCodeAdapter._errorRecovered(recovered), true);
    assert.equal(OpenCodeAdapter._errorRecovered(fatal), false);
    assert.equal(OpenCodeAdapter._errorRecovered(''), false);
  });

  it('a run that recovered from a too-long request and then ended on a tool is not reported as "too large"', () => {
    const stdout = [tooLarge, { type: 'step_finish', part: {} }, { type: 'tool_use', item: { name: 'workspace_update_routine' } }]
      .map((e) => JSON.stringify(e)).join(' ');
    const out = OpenCodeAdapter._outcomeForCleanExit({
      stdout, stdoutErr: OpenCodeAdapter._extractErrorFromStdout(stdout),
      responseState: { finalText: '', lastTool: 'workspace_update_routine' },
    });
    assert.equal(out.failure.category, 'incomplete_run');
    assert.doesNotMatch(out.failure.diagnostic, /maximum context length/);
  });

  it('an error that really ended the run is still reported', () => {
    const stdout = [{ type: 'tool_use', item: { name: 'bash' } }, tooLarge].map((e) => JSON.stringify(e)).join(' ');
    const out = OpenCodeAdapter._outcomeForCleanExit({
      stdout, stdoutErr: OpenCodeAdapter._extractErrorFromStdout(stdout), responseState: { finalText: '', lastTool: 'bash' },
    });
    assert.equal(out.failure.category, 'request_too_large');
  });
});

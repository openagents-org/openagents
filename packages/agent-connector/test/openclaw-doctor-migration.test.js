'use strict';

// OpenClaw refuses to start while state from an older release still needs its
// own migration, and tells the user to run `openclaw doctor --fix`. Every
// upgrade across a storage change hit this (legacy workspace setup state,
// legacy credentials), so the adapter runs that repair itself and retries once.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const OpenClawAdapter = require('../src/adapters/openclaw');
const { needsDoctorMigration } = OpenClawAdapter;

const WORKSPACE_STATE = 'CLI exited 1: [openclaw] Could not start the CLI. [openclaw] Reason: Legacy workspace setup '
  + 'state requires migration for /Users/me/.openclaw/workspace; run openclaw doctor --fix.';
const CREDENTIALS = 'CLI exited 1: requires legacy credential migration; run openclaw doctor --fix';

describe('needsDoctorMigration', () => {
  it('recognises the migration refusals', () => {
    assert.equal(needsDoctorMigration(WORKSPACE_STATE), true);
    assert.equal(needsDoctorMigration(CREDENTIALS), true);
  });

  it('ignores every other failure', () => {
    assert.equal(needsDoctorMigration('CLI exited 1: 401 invalid api key'), false);
    assert.equal(needsDoctorMigration('CLI timed out after 600 seconds'), false);
    assert.equal(needsDoctorMigration(''), false);
  });
});

/** An adapter shell whose CLI run and Doctor repair are scripted. */
function fakeAdapter({ runs, repair = { ok: true, detail: 'exit 0' } }) {
  const calls = { runs: 0, repairs: 0 };
  const adapter = Object.create(OpenClawAdapter.prototype);
  adapter._log = () => {};
  adapter.sendStatus = async () => {};
  adapter._runCliAgent = async () => {
    const next = runs[calls.runs++];
    if (next instanceof Error) throw next;
    return next;
  };
  adapter._runDoctorRepair = async () => { calls.repairs += 1; return repair; };
  return { adapter, calls };
}

describe('OpenClawAdapter._runCliAgentWithMigration', () => {
  it('runs Doctor once and retries the turn', async () => {
    const { adapter, calls } = fakeAdapter({ runs: [new Error(WORKSPACE_STATE), 'hi'] });
    assert.equal(await adapter._runCliAgentWithMigration('hello', 'ch'), 'hi');
    assert.deepEqual(calls, { runs: 2, repairs: 1 });
  });

  it('does not retry an unrelated failure', async () => {
    const { adapter, calls } = fakeAdapter({ runs: [new Error('CLI exited 1: 401')] });
    await assert.rejects(adapter._runCliAgentWithMigration('hello', 'ch'), /401/);
    assert.deepEqual(calls, { runs: 1, repairs: 0 });
  });

  it('surfaces the original error when Doctor fails, and stops trying', async () => {
    const { adapter, calls } = fakeAdapter({
      runs: [new Error(WORKSPACE_STATE), new Error(WORKSPACE_STATE)],
      repair: { ok: false, detail: 'exit 1' },
    });
    await assert.rejects(adapter._runCliAgentWithMigration('hello', 'ch'), /requires migration/);
    await assert.rejects(adapter._runCliAgentWithMigration('hello', 'ch'), /requires migration/);
    assert.deepEqual(calls, { runs: 2, repairs: 1 });
  });

  it('repairs at most once per turn', async () => {
    const { adapter, calls } = fakeAdapter({ runs: [new Error(WORKSPACE_STATE), new Error(WORKSPACE_STATE)] });
    await assert.rejects(adapter._runCliAgentWithMigration('hello', 'ch'), /requires migration/);
    assert.deepEqual(calls, { runs: 2, repairs: 1 });
  });
});

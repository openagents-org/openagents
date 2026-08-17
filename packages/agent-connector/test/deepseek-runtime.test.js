'use strict';

/**
 * Unit tests for the pure DeepSeek Harness helper module.
 *
 * Everything here runs without dsh, an API key or a network: the module under
 * test has no I/O. The version strings asserted below were captured from a live
 * `dsh -V` on @deepseek-ai/dsh 0.1.0-rc.6, and the row ids from that release's
 * shipped `cordis.patch.yml`.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  SUPPORTED_DSH_VERSION,
  HEADLESS_TASK_INSTRUCTION,
  parseDshVersion,
  compareDshVersions,
  classifyDshVersion,
  defaultInstallCommand,
  classifyNodeVersion,
  safeDshHomeName,
  dshEntryCandidates,
  buildHeadlessArgs,
  buildDumpConfigArgs,
  yamlScalar,
  buildPrivatePatch,
  normalizePermissionMode,
  resolvePermissionMode,
  cleanStdout,
  tailStderr,
  classifyDshFailure,
  FAILURE,
  selectSessionsForGc,
  SESSION_KEEP_COUNT,
} = require('../src/adapters/deepseek-runtime');

// The two comparators already in this repo, asserted against as a regression
// guard: this module exists precisely because neither of them can tell one
// preview release from another.
const { compareVersions: installerCompare } = require('../src/installer');
const { parseVersion: piParseVersion } = require('../src/adapters/pi-stream');

describe('version parsing', () => {
  it('preserves the prerelease segment', () => {
    assert.equal(parseDshVersion('0.1.0-rc.6'), '0.1.0-rc.6');
    assert.equal(parseDshVersion('dsh 0.1.0-rc.6'), '0.1.0-rc.6');
    assert.equal(parseDshVersion('v0.1.0-rc.6\n'), '0.1.0-rc.6');
  });

  it('handles releases without a prerelease', () => {
    assert.equal(parseDshVersion('0.83.0'), '0.83.0');
  });

  it('drops build metadata, which does not affect precedence', () => {
    assert.equal(parseDshVersion('0.1.0-rc.6+abc123'), '0.1.0-rc.6');
  });

  it('returns null for non-version output', () => {
    assert.equal(parseDshVersion('command not found'), null);
    assert.equal(parseDshVersion(''), null);
    assert.equal(parseDshVersion(null), null);
  });
});

describe('version comparison', () => {
  it('orders prereleases: rc.5 < rc.6 < release', () => {
    assert.equal(compareDshVersions('0.1.0-rc.5', '0.1.0-rc.6'), -1);
    assert.equal(compareDshVersions('0.1.0-rc.6', '0.1.0-rc.5'), 1);
    assert.equal(compareDshVersions('0.1.0-rc.6', '0.1.0'), -1);
    assert.equal(compareDshVersions('0.1.0', '0.1.0-rc.6'), 1);
    assert.equal(compareDshVersions('0.1.0-rc.6', '0.1.0-rc.6'), 0);
  });

  it('compares numeric prerelease identifiers numerically', () => {
    assert.equal(compareDshVersions('0.1.0-rc.9', '0.1.0-rc.10'), -1);
  });

  it('orders core versions before looking at prereleases', () => {
    assert.equal(compareDshVersions('0.1.0-rc.6', '0.2.0-rc.1'), -1);
    assert.equal(compareDshVersions('1.0.0', '0.9.9'), 1);
  });

  it('returns null when either side is unparseable', () => {
    assert.equal(compareDshVersions('nope', '0.1.0'), null);
    assert.equal(compareDshVersions('0.1.0', undefined), null);
  });

  // The reason this module carries its own comparator at all.
  it('is NOT equivalent to installer.js compareVersions, which drops the rc', () => {
    assert.equal(installerCompare('0.1.0-rc.5', '0.1.0-rc.6'), 0);
    assert.notEqual(compareDshVersions('0.1.0-rc.5', '0.1.0-rc.6'), 0);
  });

  it('is NOT equivalent to pi-stream parseVersion, which drops the rc', () => {
    assert.equal(piParseVersion('0.1.0-rc.6'), '0.1.0');
    assert.equal(parseDshVersion('0.1.0-rc.6'), '0.1.0-rc.6');
  });
});

describe('classifyDshVersion', () => {
  it('accepts exactly the supported preview', () => {
    const r = classifyDshVersion('0.1.0-rc.6', '0.1.0-rc.6');
    assert.equal(r.compatible, true);
    assert.equal(r.detected, '0.1.0-rc.6');
    assert.equal(r.message, null);
  });

  it('rejects a NEWER preview — a floor would have admitted it', () => {
    const r = classifyDshVersion('0.1.0-rc.7', '0.1.0-rc.6');
    assert.equal(r.compatible, false);
    assert.match(r.message, /0\.1\.0-rc\.7 is not supported/);
  });

  it('rejects the stable release too', () => {
    assert.equal(classifyDshVersion('0.1.0', '0.1.0-rc.6').compatible, false);
  });

  it('rejects an older preview', () => {
    assert.equal(classifyDshVersion('0.1.0-rc.5', '0.1.0-rc.6').compatible, false);
  });

  it('reports unknown rather than passing when the version cannot be read', () => {
    const r = classifyDshVersion(null, '0.1.0-rc.6');
    assert.equal(r.compatible, null);
  });

  it('tells the user how to get back to the pinned version', () => {
    const cmd = 'npm install -g @deepseek-ai/dsh@0.1.0-rc.6';
    for (const raw of ['0.1.0-rc.7', null]) {
      assert.ok(classifyDshVersion(raw, '0.1.0-rc.6', cmd).message.includes(cmd));
    }
  });

  it('falls back to the module constant when no supported version is given', () => {
    assert.equal(classifyDshVersion(SUPPORTED_DSH_VERSION).compatible, true);
  });

  it('pins the fallback constant', () => {
    assert.equal(SUPPORTED_DSH_VERSION, '0.1.0-rc.6');
    assert.equal(
      defaultInstallCommand(),
      'npm install -g @deepseek-ai/dsh@0.1.0-rc.6',
    );
  });
});

describe('classifyNodeVersion', () => {
  it('accepts 22.19.0 and newer 22.x', () => {
    assert.equal(classifyNodeVersion('v22.19.0').supported, true);
    assert.equal(classifyNodeVersion('v22.22.3').supported, true);
  });

  it('rejects 22.x below 22.19.0', () => {
    assert.equal(classifyNodeVersion('v22.18.0').supported, false);
    assert.equal(classifyNodeVersion('v22.0.0').supported, false);
  });

  // The caret in "^22.19.0 || >=24.0.0" excludes 23. A plain floor (which is
  // what the Pi gate is) would wrongly accept it.
  it('rejects Node 23 entirely', () => {
    assert.equal(classifyNodeVersion('v23.0.0').supported, false);
    assert.equal(classifyNodeVersion('v23.11.0').supported, false);
  });

  it('accepts Node 24 and above', () => {
    assert.equal(classifyNodeVersion('v24.0.0').supported, true);
    assert.equal(classifyNodeVersion('v25.1.0').supported, true);
  });

  it('rejects everything older than 22', () => {
    assert.equal(classifyNodeVersion('v20.11.0').supported, false);
    assert.equal(classifyNodeVersion('v18.20.0').supported, false);
  });

  it('reports unknown rather than false when unparseable', () => {
    assert.equal(classifyNodeVersion('not a version').supported, null);
  });
});

describe('safeDshHomeName', () => {
  it('produces a filesystem-safe name', () => {
    const name = safeDshHomeName('ws/../id', 'my agent:1');
    assert.match(name, /^[a-z0-9_-]+$/);
    assert.ok(!name.includes('/'));
    assert.ok(!name.includes('..'));
  });

  it('does NOT collide when two different ids slug identically', () => {
    const a = safeDshHomeName('ws', 'my/agent');
    const b = safeDshHomeName('ws', 'my:agent');
    assert.notEqual(a, b);
  });

  it('is stable for the same input', () => {
    assert.equal(safeDshHomeName('ws', 'a'), safeDshHomeName('ws', 'a'));
  });

  it('stays readable', () => {
    assert.match(safeDshHomeName('team-alpha', 'reviewer'), /^team-alpha_reviewer-[0-9a-f]{8}$/);
  });
});

describe('dsh entry-point candidates', () => {
  const win = require('node:path').win32;
  const posix = require('node:path').posix;
  const ENTRY = ['@deepseek-ai', 'dsh', 'lib', 'bin.js'];

  // The layout the Launcher produces, and the one that used to be missed
  // entirely: on Windows the shim is a .cmd with no symlink to follow, so this
  // candidate is the ONLY route from the shim to the entry point.
  it('covers the managed runtime layout on Windows', () => {
    const shim = 'C:\\\\Users\\\\u\\\\.openagents\\\\runtimes\\\\deepseek\\\\node_modules\\\\.bin\\\\dsh.cmd';
    const want = win.join('C:\\\\Users\\\\u\\\\.openagents\\\\runtimes\\\\deepseek\\\\node_modules', ...ENTRY);
    assert.ok(dshEntryCandidates(shim, win).includes(want));
  });

  it('covers the managed runtime layout on POSIX', () => {
    const shim = '/home/u/.openagents/runtimes/deepseek/node_modules/.bin/dsh';
    const want = posix.join('/home/u/.openagents/runtimes/deepseek/node_modules', ...ENTRY);
    assert.ok(dshEntryCandidates(shim, posix).includes(want));
  });

  it('covers a unix global prefix', () => {
    const want = posix.join('/usr/local/lib/node_modules', ...ENTRY);
    assert.ok(dshEntryCandidates('/usr/local/bin/dsh', posix).includes(want));
  });

  it('covers a windows global prefix', () => {
    const shim = 'C:\\\\Users\\\\u\\\\AppData\\\\Roaming\\\\npm\\\\dsh.cmd';
    const want = win.join('C:\\\\Users\\\\u\\\\AppData\\\\Roaming\\\\npm\\\\node_modules', ...ENTRY);
    assert.ok(dshEntryCandidates(shim, win).includes(want));
  });

  it('never proposes a path with a doubled node_modules segment', () => {
    const shim = '/home/u/.openagents/runtimes/deepseek/node_modules/.bin/dsh';
    for (const c of dshEntryCandidates(shim, posix)) {
      assert.ok(!/node_modules[\\/\\\\].*node_modules[\\/\\\\].*node_modules/.test(c), c);
    }
  });

  it('returns an empty list for no shim', () => {
    assert.deepEqual(dshEntryCandidates(null), []);
  });
});

describe('argv construction', () => {
  const base = { jsEntry: '/opt/dsh/lib/bin.js', taskFile: '/home/x/task.md' };

  it('puts launcher flags before the positional task', () => {
    const args = buildHeadlessArgs({ ...base, patchFile: '/home/x/p.yml' });
    assert.deepEqual(args.slice(0, 5), [
      '/opt/dsh/lib/bin.js', '--profile', 'headless', '--patch', '/home/x/p.yml',
    ]);
    assert.equal(args.length, 6);
  });

  it('passes a CONSTANT sentence as the task, never the prompt', () => {
    const args = buildHeadlessArgs(base);
    const task = args[args.length - 1];
    assert.equal(task, HEADLESS_TASK_INSTRUCTION.replace('%s', base.taskFile));
    assert.match(task, /Do not ask the user any questions\./);
  });

  it('omits --patch when no patch file is given', () => {
    assert.deepEqual(buildHeadlessArgs(base).slice(0, 3), [
      '/opt/dsh/lib/bin.js', '--profile', 'headless',
    ]);
  });

  it('refuses to build without a task file', () => {
    assert.throws(() => buildHeadlessArgs({ jsEntry: 'x' }), /taskFile is required/);
  });

  it('builds the bootstrap probe with --dump-config last', () => {
    const args = buildDumpConfigArgs({ jsEntry: 'x', patchFile: 'p' });
    assert.deepEqual(args, ['x', '--profile', 'headless', '--patch', 'p', '--dump-config']);
  });
});

describe('private patch', () => {
  it('disables the question plugin and forces non-interactive approval', () => {
    const { text } = buildPrivatePatch({});
    assert.match(text, /- id: user-questions\n {2}disabled: true/);
    assert.match(text, /- id: approval\n {2}config:\n {4}policy: never/);
  });

  // The whole point: non-interactive approval WITHOUT removing the sandbox.
  it('keeps each preset\'s own sandbox while setting approval never', () => {
    const { text } = buildPrivatePatch({});
    assert.match(text, /workspace-write:\n {8}sandbox: workspace-write\n {8}approval: never/);
    assert.match(text, /read-only:\n {8}sandbox: read-only\n {8}approval: never/);
    assert.ok(!/sandbox: danger-full-access\n {8}approval: ask/.test(text));
  });

  it('never rewrites sandbox-policy, which owns the filesystem boundary', () => {
    assert.ok(!buildPrivatePatch({}).text.includes('sandbox-policy'));
  });

  it('emits the model override only when a model is configured', () => {
    assert.ok(!buildPrivatePatch({}).text.includes('agent-default-model'));
    const { text } = buildPrivatePatch({ model: 'deepseek-v4-flash' });
    assert.match(text, /- id: agent-default-model/);
    assert.match(text, /model: "deepseek-v4-flash"/);
    assert.match(text, /provider: "deepseek-official"/);
  });

  it('quotes and escapes a hostile model id instead of letting it inject YAML', () => {
    const evil = 'x"\n- id: approval\n  config:\n    policy: ask';
    const { text } = buildPrivatePatch({ model: evil });
    // The payload survives as escaped TEXT inside a quoted scalar...
    assert.match(text, /model: "x\\"\\n- id: approval/);
    // ...but never becomes a real row or a real key. Line anchors are what
    // distinguishes "inside a quoted scalar" from "structure".
    assert.equal((text.match(/^- id: approval$/gm) || []).length, 1);
    assert.equal((text.match(/^\s*policy: ask$/gm) || []).length, 0);
    // The whole payload stays on one physical line.
    assert.equal(text.split('\n').filter((l) => l.includes('policy: ask')).length, 1);
  });

  it('escapes backslashes and quotes in yamlScalar', () => {
    assert.equal(yamlScalar('a"b'), '"a\\"b"');
    assert.equal(yamlScalar('a\\b'), '"a\\\\b"');
    assert.equal(yamlScalar('a\nb'), '"a\\nb"');
  });
});

describe('permission mode', () => {
  it('accepts only the modes dsh declares', () => {
    assert.equal(normalizePermissionMode('workspace-write'), 'workspace-write');
    assert.equal(normalizePermissionMode('read-only'), 'read-only');
    assert.equal(normalizePermissionMode('danger-full-access'), 'danger-full-access');
  });

  it('rejects near-misses rather than silently falling back', () => {
    assert.equal(normalizePermissionMode('workspace_write'), null);
    assert.equal(normalizePermissionMode('yolo'), null);
    assert.equal(normalizePermissionMode('WORKSPACE-WRITE'), null);
  });

  it('forces read-only in plan mode whatever the agent configures', () => {
    assert.equal(
      resolvePermissionMode({ workspaceMode: 'plan', configured: 'danger-full-access' }),
      'read-only',
    );
  });

  it('defaults execute mode to workspace-write', () => {
    assert.equal(resolvePermissionMode({ workspaceMode: 'execute' }), 'workspace-write');
    assert.equal(resolvePermissionMode({ workspaceMode: 'execute', configured: '' }), 'workspace-write');
  });

  it('honours an explicit valid mode in execute mode', () => {
    assert.equal(
      resolvePermissionMode({ workspaceMode: 'execute', configured: 'read-only' }),
      'read-only',
    );
  });
});

describe('output handling', () => {
  it('trims trailing whitespace from the reply', () => {
    assert.equal(cleanStdout('answer\n\n').text, 'answer');
  });

  it('bounds an oversized reply and says so', () => {
    const r = cleanStdout('x'.repeat(100), { maxChars: 10 });
    assert.equal(r.truncated, true);
    assert.match(r.text, /\[output truncated by OpenAgents\]$/);
    assert.ok(r.text.startsWith('xxxxxxxxxx'));
  });

  it('keeps the TAIL of stderr, where the error is', () => {
    const s = 'noise'.repeat(100) + 'FATAL: the real reason';
    const kept = tailStderr(s, { maxChars: 30 });
    assert.ok(kept.includes('the real reason'));
    assert.ok(kept.startsWith('…'));
  });
});

describe('failure classification', () => {
  const cases = [
    ['auth', 'Error: 401 Unauthorized', FAILURE.AUTH],
    ['auth', 'invalid_api_key provided', FAILURE.AUTH],
    ['model', 'model_not_found: deepseek-v9', FAILURE.MODEL],
    ['model', 'HTTP 429 rate limit exceeded', FAILURE.MODEL],
    ['network', 'connect ECONNREFUSED 127.0.0.1:443', FAILURE.NETWORK],
    ['network', 'getaddrinfo ENOTFOUND api.deepseek.com', FAILURE.NETWORK],
    ['permission', "EACCES: permission denied, open '/etc/hosts'", FAILURE.PERMISSION],
    ['version', 'SyntaxError: Unexpected token (ESM)', FAILURE.VERSION],
    ['config', 'failed to compose profile: unknown bundle', FAILURE.CONFIG],
  ];
  for (const [label, stderr, expected] of cases) {
    it(`classifies ${label}`, () => {
      assert.equal(classifyDshFailure({ code: 1, stderr }).category, expected);
    });
  }

  it('falls back to unknown with the exit code when stderr is empty', () => {
    const r = classifyDshFailure({ code: 3, stderr: '' });
    assert.equal(r.category, FAILURE.UNKNOWN);
    assert.match(r.message, /exited with code 3/);
  });

  it('names the signal when the child was killed', () => {
    const r = classifyDshFailure({ code: null, signal: 'SIGKILL', stderr: '' });
    assert.match(r.message, /terminated by signal SIGKILL/);
  });
});

describe('session GC selection', () => {
  const mk = (n, ageDays) => ({
    name: `session-${n}`,
    mtimeMs: Date.now() - ageDays * 24 * 60 * 60 * 1000,
  });

  it('keeps everything when under both bounds', () => {
    const entries = [mk(1, 0), mk(2, 1), mk(3, 2)];
    assert.deepEqual(selectSessionsForGc(entries, { now: Date.now() }), []);
  });

  it('drops sessions past the age bound even when few', () => {
    const entries = [mk(1, 0), mk(2, 30)];
    assert.deepEqual(selectSessionsForGc(entries, { now: Date.now() }), ['session-2']);
  });

  it('drops the oldest past the count bound even when all are fresh', () => {
    const entries = Array.from({ length: SESSION_KEEP_COUNT + 5 }, (_, i) => mk(i, i * 0.001));
    const gone = selectSessionsForGc(entries, { now: Date.now() });
    assert.equal(gone.length, 5);
    // The newest SESSION_KEEP_COUNT survive.
    assert.ok(!gone.includes('session-0'));
  });

  it('is an OR of the two bounds, not an AND', () => {
    const entries = [mk(1, 0), mk(2, 99)];
    const gone = selectSessionsForGc(entries, { now: Date.now(), keepCount: 10 });
    assert.deepEqual(gone, ['session-2']);
  });

  it('handles an empty directory', () => {
    assert.deepEqual(selectSessionsForGc([], { now: Date.now() }), []);
    assert.deepEqual(selectSessionsForGc(null, { now: Date.now() }), []);
  });
});

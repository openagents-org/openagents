'use strict';

/**
 * Unit tests for the pure DeepSeek Harness helper module.
 *
 * Everything here runs without dsh, an API key or a network: the module under
 * test has no I/O. The version strings asserted below were captured from a live
 * `dsh -V` on @deepseek-ai/dsh 0.2.1-rc.5, and the row ids from that release's
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
  verifyComposedConfig,
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
  isOfficialDeepseekRoot,
  classifyDshEndpoint,
  dshModelsEndpoint,
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

// What `dsh --profile headless --patch <ours> --dump-config` prints for the
// rows the private patch addresses — trimmed from dsh 0.2.2-rc.5, whose output
// for these rows matches 0.2.1-rc.5 line for line.
const COMPOSED = [
  '# == @deepseek-ai/dsh-base, patched by /home/u/.openagents/dsh/openagents.patch.yml',
  '- id: user-questions',
  "  name: '@deepseek-ai/dsh-user-questions'",
  '  disabled: true',
  '# == @deepseek-ai/dsh-base, patched by @deepseek-ai/dsh-headless',
  '- id: sandbox-policy',
  "  name: '@deepseek-ai/dsh-sandbox-policy'",
  '  config:',
  "    mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'",
  '    workspaceRoot: !!js process.cwd()',
  '  inject:',
  '    - headlessStartup',
  '# == @deepseek-ai/dsh-base, patched by /home/u/.openagents/dsh/openagents.patch.yml',
  '- id: approval',
  "  name: '@deepseek-ai/dsh-user-approval'",
  '  config:',
  '    policy: never',
  '- id: permission',
  "  name: '@deepseek-ai/dsh-permission-presets'",
  '  config:',
  '    presets:',
  '      read-only:',
  '        sandbox: read-only',
  '        approval: never',
  '      workspace-write:',
  '        sandbox: workspace-write',
  '        approval: never',
  '      danger-full-access:',
  '        sandbox: danger-full-access',
  '        approval: never',
  '# == @deepseek-ai/dsh-base',
  '- id: shell-env',
  "  name: '@deepseek-ai/dsh-shell-env'",
  '',
].join('\n');

describe('verifyComposedConfig', () => {
  it('passes the composition dsh prints with the private patch applied', () => {
    assert.deepEqual(verifyComposedConfig(COMPOSED), { ok: true, problem: null });
  });

  it('reads Windows line endings', () => {
    assert.equal(verifyComposedConfig(COMPOSED.replace(/\n/g, '\r\n')).ok, true);
  });

  it('reads block scalars and nested lists the way dsh prints them', () => {
    const extra = [
      '- id: deepseek-account',
      '  config:',
      '    desktopPlatform: !!js >-',
      "      ctx.get('profileContext')?.name === 'desktop' && ['darwin',",
      "      'win32'].includes(process.platform) ? process.platform : null",
      '  disabled: true',
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      openagents-gateway:',
      '        models:',
      '          - id: "deepseek-4-flash"',
      '  inject:',
      '    - headlessStartup',
      '',
    ].join('\n');
    assert.equal(verifyComposedConfig(COMPOSED + extra).ok, true);
  });

  it('accepts a quoted id and unrelated fields in a preset', () => {
    const text = COMPOSED
      .replace('- id: approval', "- id: 'approval'")
      .replace('        sandbox: read-only', '        sandbox: read-only\n        label: Read only');
    assert.equal(verifyComposedConfig(text).ok, true);
  });

  it('fails when a preview renamed the approval row', () => {
    const r = verifyComposedConfig(COMPOSED.replace('- id: approval', '- id: user-approval'));
    assert.equal(r.ok, false);
    assert.match(r.problem, /row "approval" is missing/);
  });

  it('fails when the approval policy did not take', () => {
    const r = verifyComposedConfig(COMPOSED.replace('    policy: never', '    policy: ask'));
    assert.equal(r.ok, false);
    assert.match(r.problem, /approval\.config\.policy is ask/);
  });

  // Review of f3c738f10: a line-by-line read without paths let a stale value
  // in a sub-field stand in for the real one.
  it('is not fooled by the expected value under another key', () => {
    const legacyPolicy = COMPOSED.replace('    policy: never', '    policy: ask\n    legacy:\n      policy: never');
    assert.equal(verifyComposedConfig(legacyPolicy).ok, false);
    const legacyDisabled = COMPOSED.replace(
      "  name: '@deepseek-ai/dsh-user-questions'\n  disabled: true",
      "  name: '@deepseek-ai/dsh-user-questions'\n  disabled: false\n  legacy:\n    disabled: true",
    );
    assert.match(verifyComposedConfig(legacyDisabled).problem, /user-questions\.disabled is false/);
  });

  it('is not fooled by an old preset table beside the real one', () => {
    const text = COMPOSED
      .replace('    presets:', '    oldPresets:\n      workspace-write:\n        sandbox: workspace-write\n        approval: never\n    presets:')
      .replace('        sandbox: workspace-write\n        approval: never\n      danger', '        sandbox: danger-full-access\n        approval: never\n      danger');
    const r = verifyComposedConfig(text);
    assert.equal(r.ok, false);
    assert.match(r.problem, /presets\.workspace-write\.sandbox is danger-full-access/);
  });

  it('fails when sandbox-policy no longer reads DSH_PERMISSION_MODE', () => {
    const r = verifyComposedConfig(COMPOSED.replace(
      "    mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'",
      '    mode: danger-full-access',
    ));
    assert.equal(r.ok, false);
    assert.match(r.problem, /sandbox-policy\.config\.mode/);
  });

  it('fails when user questions are still mounted', () => {
    const r = verifyComposedConfig(COMPOSED.replace("  name: '@deepseek-ai/dsh-user-questions'\n  disabled: true", "  name: '@deepseek-ai/dsh-user-questions'"));
    assert.equal(r.ok, false);
    assert.match(r.problem, /user-questions\.disabled is missing/);
  });

  it('fails when a preset lost its own sandbox', () => {
    const r = verifyComposedConfig(COMPOSED.replace('        sandbox: workspace-write', '        sandbox: danger-full-access'));
    assert.equal(r.ok, false);
    assert.match(r.problem, /presets\.workspace-write\.sandbox is danger-full-access/);
  });

  // Review of 6b8d93b29: the YAML type of a value is part of what it means.
  const MODE_LINE = "    mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'";
  it('does not take a quoted "!!js …" string for the sandbox expression', () => {
    const r = verifyComposedConfig(COMPOSED.replace(MODE_LINE, "    mode: '!!js process.env.DSH_PERMISSION_MODE ?? ''workspace-write'''"));
    assert.equal(r.ok, false);
    assert.match(r.problem, /sandbox-policy\.config\.mode/);
  });

  it('accepts the same sandbox expression folded over several lines', () => {
    const folded = "    mode: !!js >-\n      process.env.DSH_PERMISSION_MODE ??\n      'workspace-write'";
    assert.equal(verifyComposedConfig(COMPOSED.replace(MODE_LINE, folded)).ok, true);
  });

  it('does not take a quoted "true" for the boolean', () => {
    const r = verifyComposedConfig(COMPOSED.replace("dsh-user-questions'\n  disabled: true", "dsh-user-questions'\n  disabled: 'true'"));
    assert.equal(r.ok, false);
    assert.match(r.problem, /user-questions\.disabled is "true"/);
  });

  it('fails when the approval row itself is disabled', () => {
    const r = verifyComposedConfig(COMPOSED.replace("dsh-user-approval'\n", "dsh-user-approval'\n  disabled: true\n"));
    assert.equal(r.ok, false);
    assert.match(r.problem, /approval\.disabled/);
  });

  it('fails when a plugin group mounts a checked row again', () => {
    const group = [
      '- id: extra',
      "  name: '@cordisjs/plugin-group'",
      '  group: true',
      '  config:',
      '    - id: user-questions',
      "      name: '@deepseek-ai/dsh-user-questions'",
      '      disabled: false',
      '',
    ].join('\n');
    const r = verifyComposedConfig(COMPOSED + group);
    assert.equal(r.ok, false);
    assert.match(r.problem, /"user-questions" appears more than once/);
  });

  // Review of 455f9e769: a block scalar is a string whatever its text says.
  it('does not take a block scalar reading false for "not disabled"', () => {
    const r = verifyComposedConfig(COMPOSED.replace("dsh-user-approval'\n", "dsh-user-approval'\n  disabled: |\n    false\n"));
    assert.equal(r.ok, false);
    assert.match(r.problem, /approval\.disabled/);
  });

  it('does not take a block scalar reading true for the boolean', () => {
    const r = verifyComposedConfig(COMPOSED.replace("dsh-user-questions'\n  disabled: true", "dsh-user-questions'\n  disabled: |\n    true"));
    assert.equal(r.ok, false);
    assert.match(r.problem, /user-questions\.disabled/);
  });

  it('does not count a gateway model named like a checked row', () => {
    const gateway = [
      '- id: llm-pi-ai',
      "  name: '@deepseek-ai/dsh-llm-pi-ai'",
      '  config:',
      '    providers:',
      '      openagents-gateway:',
      '        api: openai-completions',
      '        models:',
      '          - id: "approval"',
      '          - id: "user-questions"',
      '',
    ].join('\n');
    assert.deepEqual(verifyComposedConfig(COMPOSED + gateway), { ok: true, problem: null });
  });

  // Review of ac4f51ac3: only what dsh takes for a group nests plugin rows.
  it('does not count id items in an ordinary plugin whose config is an array', () => {
    const plugin = [
      '- id: some-plugin',
      "  name: '@deepseek-ai/dsh-some-plugin'",
      '  config:',
      '    - id: approval',
      '      label: not a plugin',
      '',
    ].join('\n');
    assert.deepEqual(verifyComposedConfig(COMPOSED + plugin), { ok: true, problem: null });
  });

  it('finds a repeated row in a group known only by its plugin name', () => {
    for (const name of ['cordis:group', "'@deepseek-ai/cordis-plugin-group'"]) {
      const group = [
        '- id: named-group',
        `  name: ${name}`,
        '  config:',
        '    - id: approval',
        '      config:',
        '        policy: ask',
        '',
      ].join('\n');
      const r = verifyComposedConfig(COMPOSED + group);
      assert.equal(r.ok, false, name);
      assert.match(r.problem, /"approval" appears more than once/);
    }
  });

  it('cannot vouch for rows an include loads from a file', () => {
    const include = "- id: extra\n  name: cordis:include\n  config:\n    path: ./more.yml\n";
    const r = verifyComposedConfig(COMPOSED + include);
    assert.equal(r.ok, false);
    assert.match(r.problem, /"extra" includes rows from a file/);
    const off = "- id: extra\n  name: cordis:include\n  disabled: true\n  config:\n    path: ./more.yml\n";
    assert.equal(verifyComposedConfig(COMPOSED + off).ok, true);
  });

  it('fails when a checked row appears twice', () => {
    const r = verifyComposedConfig(`${COMPOSED}- id: approval\n  config:\n    policy: ask\n`);
    assert.equal(r.ok, false);
    assert.match(r.problem, /"approval" appears more than once/);
  });

  it('does not read a key of the next row as part of the previous one', () => {
    const text = COMPOSED.replace('    policy: never', '    policy: ask') + '- id: other\n  config:\n    policy: never\n';
    assert.equal(verifyComposedConfig(text).ok, false);
  });

  it('fails on empty or unreadable output', () => {
    assert.equal(verifyComposedConfig('').ok, false);
    assert.match(verifyComposedConfig('- id: approval\n\t config: x\n').problem, /could not be read/);
  });
});

describe('classifyDshVersion', () => {
  it('accepts exactly the supported preview as tested', () => {
    const r = classifyDshVersion('0.1.0-rc.6', '0.1.0-rc.6');
    assert.equal(r.compatible, true);
    assert.equal(r.tested, true);
    assert.equal(r.detected, '0.1.0-rc.6');
    assert.equal(r.message, null);
  });

  it('accepts a NEWER preview, but not as tested', () => {
    const r = classifyDshVersion('0.1.0-rc.7', '0.1.0-rc.6');
    assert.equal(r.compatible, true);
    assert.equal(r.tested, false);
    assert.equal(r.message, null);
  });

  it('accepts the next minor preview upstream ships as latest', () => {
    const r = classifyDshVersion('0.2.2-rc.5', '0.2.1-rc.5');
    assert.equal(r.compatible, true);
    assert.equal(r.tested, false);
  });

  it('accepts the stable release too', () => {
    assert.equal(classifyDshVersion('0.1.0', '0.1.0-rc.6').compatible, true);
  });

  it('keeps a hyphenated prerelease whole instead of cutting it at the hyphen', () => {
    // Review of f3c738f10: `0.2.1-rc.5-hotfix` compared equal to rc.5, so it
    // passed as the tested release and skipped the composed-config check.
    const r = classifyDshVersion('0.2.1-rc.5-hotfix', '0.2.1-rc.5');
    assert.equal(r.compatible, true);
    assert.equal(r.tested, false);
  });

  it('rejects an older preview — rc.N is ordered, not stripped', () => {
    const r = classifyDshVersion('0.1.0-rc.5', '0.1.0-rc.6');
    assert.equal(r.compatible, false);
    assert.match(r.message, /0\.1\.0-rc\.5 is too old/);
  });

  it('reports unknown rather than passing when the version cannot be read', () => {
    const r = classifyDshVersion(null, '0.1.0-rc.6');
    assert.equal(r.compatible, null);
  });

  it('tells the user how to get back to the supported version', () => {
    const cmd = 'npm install -g @deepseek-ai/dsh@0.1.0-rc.6';
    for (const raw of ['0.1.0-rc.5', null]) {
      assert.ok(classifyDshVersion(raw, '0.1.0-rc.6', cmd).message.includes(cmd));
    }
  });

  it('falls back to the module constant when no supported version is given', () => {
    assert.equal(classifyDshVersion(SUPPORTED_DSH_VERSION).compatible, true);
  });

  it('pins the fallback constant', () => {
    assert.equal(SUPPORTED_DSH_VERSION, '0.2.1-rc.5');
    assert.equal(
      defaultInstallCommand(),
      'npm install -g @deepseek-ai/dsh@0.2.1-rc.5',
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
  // dsh rc.5 refuses a model the official /models listing names but its own
  // catalog lacks — unless the route declares a catalog, which turns the
  // listing off. deepseek-v4-flash, the id OpenAgents offers, is such a model.
  it('declares a non-built-in model in the official route catalog', () => {
    const { text } = buildPrivatePatch({ model: 'deepseek-v4-flash', officialEndpoint: true });
    assert.match(text, /- id: llm-deepseek\n  config:\n    models:\n      - id: "deepseek-v4-flash"/);
    assert.match(text, /- id: agent-default-model\n  config:\n    provider: "deepseek-official"\n    model: "deepseek-v4-flash"/);
  });

  it('leaves the catalog alone for a built-in model, a custom endpoint or a gateway', () => {
    for (const opts of [
      { model: 'deepseek-flash', officialEndpoint: true },
      { model: 'deepseek-v4-pro', officialEndpoint: true },
      { model: 'deepseek-v4-flash', officialEndpoint: false },
      { model: 'deepseek-v4-flash', officialEndpoint: true, gatewayBaseUrl: 'https://relay.example.com/v1' },
      { officialEndpoint: true },
    ]) {
      assert.doesNotMatch(buildPrivatePatch(opts).text, /- id: llm-deepseek\n/, JSON.stringify(opts));
    }
  });

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

  it('routes an OpenAI-compatible gateway through a pi-ai chat-completions route', () => {
    const { text } = buildPrivatePatch({
      model: 'deepseek-v4-flash',
      gatewayBaseUrl: 'https://api-gateway.openagents.org/v1',
    });
    assert.match(text, /^- id: llm-pi-ai$/m);
    assert.match(text, /^ {6}openai-gateway:$/m);
    assert.match(text, /^ {8}api: openai-completions$/m);
    assert.match(text, /^ {8}baseURL: "https:\/\/api-gateway\.openagents\.org\/v1"$/m);
    assert.match(text, /^ {8}apiKeyEnv: DEEPSEEK_API_KEY$/m);
    assert.match(text, /^ {10}- id: "deepseek-v4-flash"$/m);
    assert.match(text, /^ {4}provider: openai-gateway$/m);
    assert.ok(!text.includes('deepseek-official'));
  });

  it('names a model on a gateway route even when none is configured', () => {
    const { text } = buildPrivatePatch({ gatewayBaseUrl: 'https://relay.example.com/v1' });
    assert.match(text, /^ {10}- id: "deepseek-v4\.1-flash"$/m);
    assert.match(text, /^ {4}model: "deepseek-v4\.1-flash"$/m);
  });

  it('quotes a hostile gateway URL instead of letting it inject YAML', () => {
    const { text } = buildPrivatePatch({ gatewayBaseUrl: 'https://x/v1"\n- id: approval\n  config:\n    policy: ask' });
    assert.equal((text.match(/^- id: approval$/gm) || []).length, 1);
    assert.equal((text.match(/^\s*policy: ask$/gm) || []).length, 0);
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
    // dsh 0.2.1-rc.5's refusals, raised before any request is sent.
    ['an unlisted model as model', 'LlmError: DeepSeek model "deepseek-v4-flash" is not supported by DeepSeek Harness; current version is 0.2.1-rc.5', FAILURE.MODEL],
    ['a model needing a newer harness as version', 'LlmError: DeepSeek model "deepseek-v5" requires DeepSeek Harness 0.2.2 or later; current version is 0.2.1-rc.5', FAILURE.VERSION],
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

describe('isOfficialDeepseekRoot', () => {
  it('matches the OpenAI-style roots dsh cannot use', () => {
    assert.equal(isOfficialDeepseekRoot('https://api.deepseek.com'), true);
    assert.equal(isOfficialDeepseekRoot('https://api.deepseek.com/'), true);
    assert.equal(isOfficialDeepseekRoot('https://api.deepseek.com/v1'), true);
    assert.equal(isOfficialDeepseekRoot(' https://API.deepseek.com/V1/ '), true);
  });

  it('leaves the Anthropic endpoint and gateways alone', () => {
    assert.equal(isOfficialDeepseekRoot('https://api.deepseek.com/anthropic'), false);
    assert.equal(isOfficialDeepseekRoot('https://relay.example.com/v1'), false);
    assert.equal(isOfficialDeepseekRoot(''), false);
    assert.equal(isOfficialDeepseekRoot('not a url'), false);
  });
});

describe('classifyDshEndpoint', () => {
  it('leaves blank and DeepSeek\'s own roots to dsh\'s default', () => {
    for (const base of ['', '  ', 'https://api.deepseek.com', 'https://api.deepseek.com/v1/'])
      assert.equal(classifyDshEndpoint(base), 'native');
  });

  it('treats a versioned base as an OpenAI-compatible gateway', () => {
    assert.equal(classifyDshEndpoint('https://api-gateway.openagents.org/v1'), 'openai');
    assert.equal(classifyDshEndpoint('https://tokendance.space/gateway/v1/'), 'openai');
    assert.equal(classifyDshEndpoint('https://open.bigmodel.cn/api/paas/v4'), 'openai');
  });

  it('uses anything else for the Messages API', () => {
    assert.equal(classifyDshEndpoint('https://api.deepseek.com/anthropic'), 'anthropic');
    assert.equal(classifyDshEndpoint('https://tokendance.space/gateway'), 'anthropic');
    assert.equal(classifyDshEndpoint('not a url'), 'anthropic');
  });
});

describe('dshModelsEndpoint', () => {
  it('lists DeepSeek\'s models from its OpenAI-style root, whichever form was set', () => {
    for (const base of ['', 'https://api.deepseek.com', 'https://api.deepseek.com/anthropic'])
      assert.deepEqual(dshModelsEndpoint(base), { baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai' });
  });

  it('lists a gateway in the protocol dsh calls it with', () => {
    assert.deepEqual(dshModelsEndpoint('https://relay.example.com/v1'), { baseUrl: 'https://relay.example.com/v1', protocol: 'openai' });
    assert.deepEqual(dshModelsEndpoint('https://relay.example.com/anthropic'), { baseUrl: 'https://relay.example.com/anthropic', protocol: 'anthropic' });
  });
});

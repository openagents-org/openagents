'use strict';

/**
 * CodeArts Agent adapter — what it changes about OpenCodeAdapter.
 *
 * The CLI is OpenCode-based, so the stream parsing is covered by
 * opencode.test.js. These pin the differences, from the 26.9.3 CLI's own help
 * and error output: the binary the installer lays out, the wrapper's
 * environment, the access-key-only authentication and the run arguments.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CodeArtsAdapter = require('../src/adapters/codearts');
const { ADAPTER_MAP } = require('../src/adapters');

const IS_WINDOWS = process.platform === 'win32';

let home;
let savedHome;
let savedProfile;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-codearts-'));
  savedHome = process.env.HOME;
  savedProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedProfile;
  fs.rmSync(home, { recursive: true, force: true });
});

function makeAdapter(agentEnv = {}) {
  const adapter = new CodeArtsAdapter({
    workspaceId: 'ws',
    channelName: 'thread',
    token: 'token',
    agentName: 'codearts-test',
  });
  adapter._log = () => {};
  adapter.agentEnv = agentEnv;
  return adapter;
}

describe('CodeArts Agent — registry entry', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'registry.json'), 'utf-8'));
  const entry = (registry.agents || registry).find((a) => a.name === 'codearts');

  it('is registered with an adapter', () => {
    assert.ok(entry, 'codearts entry exists');
    assert.equal(ADAPTER_MAP.codearts, CodeArtsAdapter);
  });

  it("installs with Huawei's own script on every platform", () => {
    assert.match(entry.install.macos, /cli_tui\/install_script\/install\.sh/);
    assert.match(entry.install.linux, /cli_tui\/install_script\/install\.sh/);
    assert.match(entry.install.windows, /cli_tui\/install_script\/install\.ps1/);
  });

  it('requires the access key pair, and is not ready without both halves', () => {
    for (const name of ['CODEARTS_CLI_AK', 'CODEARTS_CLI_SK']) {
      const field = entry.env_config.find((f) => f.name === name);
      assert.equal(field.required, true, `${name} required`);
      assert.equal(field.password, true, `${name} masked`);
    }
    assert.deepEqual(entry.check_ready.env_all, ['CODEARTS_CLI_AK', 'CODEARTS_CLI_SK']);
  });
});

describe('CodeArts Agent — finding the CLI', () => {
  it('runs the binary the installer lays out, not the wrapper on PATH', () => {
    const root = CodeArtsAdapter.installRoot(home);
    const bin = path.join(root, 'bin', IS_WINDOWS ? 'codearts.exe' : 'codearts');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '');
    fs.writeFileSync(path.join(root, IS_WINDOWS ? 'codearts.cmd' : 'codearts'), '');

    assert.equal(makeAdapter()._findOpencodeBinary(), bin);
  });
});

describe('CodeArts Agent — running', () => {
  it('runs headless in always-allow mode, with no --dir (the CLI has none)', () => {
    const args = makeAdapter()._buildRunArgs({ runCwd: '/work', model: 'huaweicloud-maas/x', sessionId: null });
    assert.deepEqual(args, ['run', '--format', 'json', '--auto', '--model', 'huaweicloud-maas/x']);
  });

  it('resumes the channel session', () => {
    const args = makeAdapter()._buildRunArgs({ runCwd: '/work', model: 'm/x', sessionId: 'ses_1' });
    assert.deepEqual(args.slice(-2), ['--session', 'ses_1']);
  });

  it('always has a model: the configured one, else the first this key lists, else the fallback', () => {
    assert.equal(makeAdapter({ CODEARTS_MODEL: ' huaweicloud-maas/glm-5 ' })._resolveModel(), 'huaweicloud-maas/glm-5');

    const listed = makeAdapter({ CODEARTS_CLI_AK: 'ak', CODEARTS_CLI_SK: 'sk' });
    listed._listModelIds = () => ['huaweicloud-maas/GLM-5.2', 'huaweicloud-maas/openpangu-2.0-pro'];
    assert.equal(listed._resolveModel(), 'huaweicloud-maas/GLM-5.2');

    const unlisted = makeAdapter();
    unlisted._listModelIds = () => [];
    assert.equal(unlisted._resolveModel(), CodeArtsAdapter.DEFAULT_MODEL);
  });

  it("reads `codearts models`' table", () => {
    // 26.9.3's output for a real account.
    const out = [
      'model_id                              model_name',
      '------------------------------------------------',
      'huaweicloud-maas/GLM-5.2              GLM-5.2',
      'huaweicloud-maas/glm-5.2-sft-harmony  GLM-5.2-ArkTS-SPARK',
      'huaweicloud-maas/openpangu-2.0-flash  OpenPangu-2.0-Flash',
      '',
    ].join('\r\n');
    assert.deepEqual(CodeArtsAdapter.parseModels(out), [
      'huaweicloud-maas/GLM-5.2',
      'huaweicloud-maas/glm-5.2-sft-harmony',
      'huaweicloud-maas/openpangu-2.0-flash',
    ]);
  });

  it('does not ask the CLI for models without a key pair', () => {
    const adapter = makeAdapter();
    adapter._opencodeBinary = '/fake/codearts';
    assert.deepEqual(adapter._listModelIds(), []);
  });

  it("spawns with the installer wrapper's environment, keeping the agent's own", () => {
    const env = makeAdapter({ CODEARTS_CLI_AK: 'ak', CODEARTS_CLI_SK: 'sk', OPENCODE_CONFIG: '/mine.json' })._spawnEnv();
    assert.equal(env.CODEARTS_CLI_AK, 'ak');
    assert.equal(env.CODEARTS_CLI_SK, 'sk');
    assert.equal(env.SCENARIO, 'codeartsdoer');
    assert.equal(env.KERNEL_DATA_DIR, path.join(home, '.codeartsdoer', 'cli-data'));
    assert.equal(env.OPENCODE_CONFIG, path.join(home, '.codeartsdoer', 'codearts_cli.json'), "the user's OpenCode config does not leak in");
    assert.equal(env.NODE_TLS_REJECT_UNAUTHORIZED, undefined, 'certificate checks stay on');
  });
});

describe('CodeArts Agent — credentials and failures', () => {
  it('counts only a complete access key pair as a credential', () => {
    assert.equal(makeAdapter()._credentialState(), 'missing');
    assert.equal(makeAdapter({ CODEARTS_CLI_AK: 'ak' })._credentialState(), 'missing');
    assert.equal(makeAdapter({ CODEARTS_CLI_AK: 'ak', CODEARTS_CLI_SK: 'sk' })._credentialState(), 'present');
  });

  it('refuses to spawn without the key pair, naming where to get one', () => {
    const adapter = makeAdapter();
    adapter._opencodeBinary = '/fake/codearts';
    adapter._detectCliVersion = () => ({ version: '26.9.3', executable: true });
    const pf = adapter._preflight();
    assert.equal(pf.ok, false);
    assert.equal(pf.category, 'credential_missing');
    assert.match(adapter._failureMessages().credential_missing, /CODEARTS_CLI_AK/);
  });

  it("reads the CLI's own wording of a missing key pair and a missing seat as auth failures", () => {
    const missingKey = '|  认证失败，没有设置环境变量CODEARTS_CLI_AK/CODEARTS_CLI_SK';
    assert.equal(CodeArtsAdapter._classifyFailure({ code: 1, stdout: missingKey }).category, 'auth_failed');
    assert.equal(
      CodeArtsAdapter._classifyFailure({ code: 1, stderr: 'Seat revoked. Contact an administrator to reassign a seat.' }).category,
      'auth_failed',
    );
    assert.equal(CodeArtsAdapter._classifyFailure({ code: 1, stderr: 'ETIMEDOUT' }).category, 'network_error');
  });

  it("reports a model the account can't use, which the CLI prints to stderr and exits 0 on", () => {
    // What 26.9.3 printed for a real account: a slice of its bundled source,
    // then the error line — stdout empty, exit code 0. It used to be posted as
    // "finished without producing a final reply".
    const stderr = [
      'let{storedAt:i,...r}=t;return r}return}var Go=nn.create({service:"file-write-metadata-hook"}) network timeout',
      '',
      'error: 未找到模型：huaweicloud-maas/deepseek-v3.2，该模型不存在，或当前未登录。请重新登录或者查看可用模型列表',
      '      at <anonymous> (B:/~BUN/root/chunk-jja9zm6s.js:12065:2705)',
    ].join('\n');
    const outcome = CodeArtsAdapter._outcomeForCleanExit({ stdout: '', stderr });
    assert.equal(outcome.failure.category, 'model_not_found');
    assert.match(outcome.failure.detail, /^未找到模型：huaweicloud-maas\/deepseek-v3\.2/);
  });

  it('keeps an exit 0 with nothing on stderr an empty response', () => {
    const outcome = CodeArtsAdapter._outcomeForCleanExit({ stdout: '', stderr: '' });
    assert.equal(outcome.failure.category, 'empty_response');
  });

  it('never blocks on version: date-shaped versions run, newer ones are flagged', () => {
    assert.equal(CodeArtsAdapter._classifyVersion('26.9.3'), 'ok');
    assert.equal(CodeArtsAdapter._classifyVersion('25.1.0'), 'ok');
    assert.equal(CodeArtsAdapter._classifyVersion('27.0.0'), 'degraded');
    assert.equal(CodeArtsAdapter._classifyVersion('dev'), 'unknown');
  });

  it('names itself in the errors it posts', async () => {
    const adapter = makeAdapter();
    let posted = '';
    adapter.client = { sendMessage: async (_w, _c, _t, content) => { posted = content; } };
    await adapter._sendClassifiedError('thread', 'auth_failed');
    assert.match(posted, /CodeArts Agent couldn't run/);
  });
});

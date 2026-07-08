'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const installer = require('../src/skill-installer');
const BaseAdapter = require('../src/adapters/base');
const CodexAdapter = require('../src/adapters/codex');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oa-skill-test-'));
}

/** A fetcher that writes a fixture SKILL.md (+ extra file) into destDir. */
function fixtureFetcher({ skill, destDir }) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(
    path.join(destDir, 'SKILL.md'),
    `---\nname: ${skill.name}\ndescription: ${skill.description || 'test skill'}\n---\n\n# ${skill.name}\n`,
    'utf-8',
  );
  fs.writeFileSync(path.join(destDir, 'helper.py'), 'print("hi")\n', 'utf-8');
}

const SAMPLE_SKILL = {
  id: 'claude-api',
  name: 'Claude API',
  description: 'Build Claude apps',
  source_repo: 'anthropics/skills',
  source_path: 'skills/claude-api',
};

/** Minimal fake workspace client capturing reportSkillStatus calls. */
function fakeClient(readFileImpl) {
  const calls = [];
  return {
    calls,
    async reportSkillStatus(workspaceId, agentName, token, body) {
      calls.push(body);
      return { ok: true };
    },
    async readFile(workspaceId, agentName, fileId) {
      if (readFileImpl) return readFileImpl(fileId);
      throw new Error('readFile not stubbed');
    },
  };
}

/**
 * Build a minimal but valid .zip Buffer from entries, with no external deps.
 * Each entry: { name, data?, method? (0=store|8=deflate), unixMode? }. CRCs are
 * left 0 — the installer does not verify them. A name ending in "/" is a dir.
 */
function makeZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data || '', 'utf8');
    const method = e.method || 0;
    const comp = method === 8 ? zlib.deflateRawSync(raw) : raw;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    local.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(Math.trunc((e.unixMode || 0) * 0x10000) >>> 0, 38); // external attr
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + comp.length;
  }
  const localBuf = Buffer.concat(local);
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

const SKILL_MD = '---\nname: Uploaded\ndescription: an uploaded skill\n---\n# Uploaded\n';

// ---------------------------------------------------------------------------
// skillsDirForAgentType
// ---------------------------------------------------------------------------

describe('skillsDirForAgentType', () => {
  it('resolves Claude skills under .claude/skills', () => {
    assert.equal(
      installer.skillsDirForAgentType('claude', '/work'),
      path.join('/work', '.claude', 'skills'),
    );
  });

  it('resolves Codex skills under .codex/skills', () => {
    assert.equal(
      installer.skillsDirForAgentType('codex', '/work'),
      path.join('/work', '.codex', 'skills'),
    );
  });

  it('resolves Cursor skills under .cursor/skills', () => {
    assert.equal(
      installer.skillsDirForAgentType('cursor', '/work'),
      path.join('/work', '.cursor', 'skills'),
    );
  });

  it('falls back to .agent/skills for unknown types', () => {
    assert.equal(
      installer.skillsDirForAgentType('mystery', '/work'),
      path.join('/work', '.agent', 'skills'),
    );
  });

  it('is case-insensitive on agent type', () => {
    assert.equal(
      installer.skillsDirForAgentType('CLAUDE', '/work'),
      path.join('/work', '.claude', 'skills'),
    );
  });
});

// ---------------------------------------------------------------------------
// installSkill / uninstallSkill / listInstalledSkills
// ---------------------------------------------------------------------------

describe('installSkill', () => {
  let workDir;
  beforeEach(() => { workDir = tmpWorkDir(); });
  afterEach(() => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {} });

  it('installs a Claude skill into .claude/skills/<id>/ with SKILL.md', () => {
    const res = installer.installSkill({
      skill: SAMPLE_SKILL, agentType: 'claude', workingDir: workDir, fetcher: fixtureFetcher,
    });
    const expected = path.join(workDir, '.claude', 'skills', 'claude-api');
    assert.equal(res.path, expected);
    assert.ok(fs.existsSync(path.join(expected, 'SKILL.md')), 'SKILL.md landed');
    assert.ok(fs.existsSync(path.join(expected, 'helper.py')), 'extra file landed');
  });

  it('installs a Codex skill into .codex/skills/<id>/', () => {
    const res = installer.installSkill({
      skill: SAMPLE_SKILL, agentType: 'codex', workingDir: workDir, fetcher: fixtureFetcher,
    });
    assert.equal(res.path, path.join(workDir, '.codex', 'skills', 'claude-api'));
    assert.ok(fs.existsSync(path.join(res.path, 'SKILL.md')));
  });

  it('accepts camelCase metadata from the UI shape', () => {
    const res = installer.installSkill({
      skill: { id: 's1', name: 'S1', sourceRepo: 'a/b', sourcePath: 'p' },
      agentType: 'claude', workingDir: workDir, fetcher: fixtureFetcher,
    });
    assert.ok(fs.existsSync(path.join(res.path, 'SKILL.md')));
  });

  it('cleans stale files when reinstalling', () => {
    installer.installSkill({ skill: SAMPLE_SKILL, agentType: 'claude', workingDir: workDir, fetcher: fixtureFetcher });
    const dir = path.join(workDir, '.claude', 'skills', 'claude-api');
    fs.writeFileSync(path.join(dir, 'stale.txt'), 'old', 'utf-8');
    installer.installSkill({ skill: SAMPLE_SKILL, agentType: 'claude', workingDir: workDir, fetcher: fixtureFetcher });
    assert.equal(fs.existsSync(path.join(dir, 'stale.txt')), false, 'stale file removed');
    assert.ok(fs.existsSync(path.join(dir, 'SKILL.md')));
  });

  it('throws a clear error when the fetcher produces no SKILL.md', () => {
    const emptyFetcher = ({ destDir }) => { fs.mkdirSync(destDir, { recursive: true }); };
    assert.throws(
      () => installer.installSkill({ skill: SAMPLE_SKILL, agentType: 'claude', workingDir: workDir, fetcher: emptyFetcher }),
      /produced no SKILL\.md/,
    );
  });

  it('throws when the fetcher itself fails', () => {
    const boomFetcher = () => { throw new Error('network down'); };
    assert.throws(
      () => installer.installSkill({ skill: SAMPLE_SKILL, agentType: 'claude', workingDir: workDir, fetcher: boomFetcher }),
      /network down/,
    );
  });

  it('throws on missing skill id', () => {
    assert.throws(
      () => installer.installSkill({ skill: { name: 'x' }, agentType: 'claude', workingDir: workDir, fetcher: fixtureFetcher }),
      /missing id/,
    );
  });

  it('marks a SKILL.md-only fetch as partial (degraded, but not silent)', () => {
    const partialFetcher = ({ destDir }) => {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, 'SKILL.md'), '---\nname: x\n---\n', 'utf-8');
      return { partial: true };
    };
    const logs = [];
    const res = installer.installSkill({
      skill: SAMPLE_SKILL, agentType: 'claude', workingDir: workDir,
      fetcher: partialFetcher, log: (m) => logs.push(m),
    });
    assert.equal(res.partial, true);
    assert.ok(logs.some((l) => /WARNING: only SKILL\.md/.test(l)), 'warns loudly about partial install');
  });
});

describe('installSkill — security hardening', () => {
  let workDir;
  beforeEach(() => { workDir = tmpWorkDir(); });
  afterEach(() => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {} });

  for (const badId of ['../escape', '..', '.', 'a/b', 'foo/../bar', '-rf', 'a b']) {
    it(`rejects path-traversal / unsafe skill id ${JSON.stringify(badId)}`, () => {
      assert.throws(
        () => installer.installSkill({
          skill: { id: badId, source_repo: 'a/b', source_path: 'p' },
          agentType: 'claude', workingDir: workDir, fetcher: fixtureFetcher,
        }),
        /unsafe skill id/,
      );
    });
  }

  it('does not create anything outside the skills dir on a traversal attempt', () => {
    const sentinel = path.join(workDir, 'escape-target');
    try {
      installer.installSkill({
        skill: { id: '../../escape-target', source_repo: 'a/b', source_path: 'p' },
        agentType: 'claude', workingDir: workDir, fetcher: fixtureFetcher,
      });
    } catch {}
    assert.equal(fs.existsSync(sentinel), false, 'no write escaped the skills dir');
  });

  it('rejects an unsafe source_repo (arg-injection / non owner/repo)', () => {
    assert.throws(
      () => installer.installSkill({
        skill: { id: 'ok', source_repo: '--upload-pack=evil', source_path: 'p' },
        agentType: 'claude', workingDir: workDir, fetcher: fixtureFetcher,
      }),
      /unsafe source_repo/,
    );
  });

  it('rejects an unsafe source_path with .. segments', () => {
    assert.throws(
      () => installer.installSkill({
        skill: { id: 'ok', source_repo: 'a/b', source_path: '../../etc' },
        agentType: 'claude', workingDir: workDir, fetcher: fixtureFetcher,
      }),
      /unsafe source_path/,
    );
  });

  it('uninstall refuses ids that escape the skills dir', () => {
    assert.throws(
      () => installer.uninstallSkill({ skill: { id: '../../x' }, agentType: 'claude', workingDir: workDir }),
      /unsafe skill id/,
    );
  });
});

// ---------------------------------------------------------------------------
// installUploadedSkill (custom / workspace_file skills)
// ---------------------------------------------------------------------------

describe('installUploadedSkill', () => {
  let workDir;
  beforeEach(() => { workDir = tmpWorkDir(); });
  afterEach(() => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {} });

  const upload = (skill, buffer) => installer.installUploadedSkill({
    skill, buffer, agentType: 'claude', workingDir: workDir,
  });

  it('installs an uploaded .md as SKILL.md at the skill dir root', () => {
    const res = upload(
      { id: 'my-md', name: 'My MD', source_type: 'workspace_file', package_type: 'md' },
      Buffer.from(SKILL_MD, 'utf8'),
    );
    const dir = path.join(workDir, '.claude', 'skills', 'my-md');
    assert.equal(res.path, dir);
    assert.equal(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), SKILL_MD);
  });

  it('installs a zip with a root-level SKILL.md and keeps bundled assets', () => {
    const zip = makeZip([
      { name: 'SKILL.md', data: SKILL_MD },
      { name: 'assets/helper.py', data: 'print("hi")\n' },
    ]);
    const res = upload({ id: 'z1', source_type: 'workspace_file', package_type: 'zip' }, zip);
    assert.ok(fs.existsSync(path.join(res.path, 'SKILL.md')));
    assert.equal(fs.readFileSync(path.join(res.path, 'assets', 'helper.py'), 'utf8'), 'print("hi")\n');
  });

  it('strips a single top-level directory (my-skill/SKILL.md → SKILL.md)', () => {
    const zip = makeZip([
      { name: 'my-skill/', data: '' },
      { name: 'my-skill/SKILL.md', data: SKILL_MD },
      { name: 'my-skill/refs/notes.txt', data: 'notes' },
    ]);
    const res = upload({ id: 'z2', source_type: 'workspace_file', package_type: 'zip' }, zip);
    assert.ok(fs.existsSync(path.join(res.path, 'SKILL.md')), 'SKILL.md hoisted to root');
    assert.equal(fs.readFileSync(path.join(res.path, 'refs', 'notes.txt'), 'utf8'), 'notes');
    assert.equal(fs.existsSync(path.join(res.path, 'my-skill')), false, 'wrapper dir stripped');
  });

  it('decompresses deflate-compressed zip entries', () => {
    const big = 'x'.repeat(5000);
    const zip = makeZip([{ name: 'SKILL.md', data: SKILL_MD + big, method: 8 }]);
    const res = upload({ id: 'z3', source_type: 'workspace_file', package_type: 'zip' }, zip);
    assert.match(fs.readFileSync(path.join(res.path, 'SKILL.md'), 'utf8'), /x{5000}/);
  });

  it('sniffs zip vs md when package_type is absent', () => {
    const zip = makeZip([{ name: 'SKILL.md', data: SKILL_MD }]);
    const res = upload({ id: 'z4', source_type: 'workspace_file' }, zip); // no package_type
    assert.ok(fs.existsSync(path.join(res.path, 'SKILL.md')));
  });

  it('rejects a zip with a path-traversal entry', () => {
    const zip = makeZip([
      { name: 'SKILL.md', data: SKILL_MD },
      { name: '../escape.txt', data: 'pwned' },
    ]);
    const sentinel = path.join(workDir, '.claude', 'skills', 'escape.txt');
    assert.throws(() => upload({ id: 'bad1', source_type: 'workspace_file', package_type: 'zip' }, zip), /unsafe path/);
    assert.equal(fs.existsSync(sentinel), false, 'nothing escaped the skills dir');
  });

  it('rejects a zip with an absolute-path entry', () => {
    const zip = makeZip([
      { name: 'SKILL.md', data: SKILL_MD },
      { name: '/tmp/oa-abs-escape.txt', data: 'pwned' },
    ]);
    assert.throws(() => upload({ id: 'bad2', source_type: 'workspace_file', package_type: 'zip' }, zip), /unsafe path/);
    assert.equal(fs.existsSync('/tmp/oa-abs-escape.txt'), false);
  });

  it('rejects a zip with a symlink entry', () => {
    const zip = makeZip([
      { name: 'SKILL.md', data: SKILL_MD },
      { name: 'link', data: '/etc/passwd', unixMode: 0o120777 },
    ]);
    assert.throws(() => upload({ id: 'bad3', source_type: 'workspace_file', package_type: 'zip' }, zip), /symlink/);
  });

  it('rejects a zip that has no SKILL.md', () => {
    const zip = makeZip([{ name: 'README.md', data: '# hi\n' }]);
    assert.throws(() => upload({ id: 'bad4', source_type: 'workspace_file', package_type: 'zip' }, zip), /no SKILL\.md/);
  });

  it('throws on an empty buffer', () => {
    assert.throws(() => upload({ id: 'empty', source_type: 'workspace_file', package_type: 'md' }, Buffer.alloc(0)), /no file content/);
  });

  it('reinstalling replaces prior contents', () => {
    upload({ id: 'ru', source_type: 'workspace_file', package_type: 'zip' },
      makeZip([{ name: 'SKILL.md', data: SKILL_MD }, { name: 'old.txt', data: 'old' }]));
    const dir = path.join(workDir, '.claude', 'skills', 'ru');
    assert.ok(fs.existsSync(path.join(dir, 'old.txt')));
    upload({ id: 'ru', source_type: 'workspace_file', package_type: 'md' }, Buffer.from(SKILL_MD, 'utf8'));
    assert.equal(fs.existsSync(path.join(dir, 'old.txt')), false, 'stale file removed on reinstall');
    assert.ok(fs.existsSync(path.join(dir, 'SKILL.md')));
  });
});

describe('BaseAdapter skill.install — workspace_file (custom) skills', () => {
  let workDir;
  beforeEach(() => { workDir = tmpWorkDir(); });
  afterEach(() => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {} });

  it('downloads via readFile, installs, and reports installing → installed', async () => {
    const zip = makeZip([{ name: 'SKILL.md', data: SKILL_MD }]);
    const adapter = new BaseAdapter({
      workspaceId: 'ws', channelName: 'c', token: 't', agentName: 'claude',
      agentType: 'claude', workingDir: workDir,
    });
    const client = fakeClient((fileId) => {
      assert.equal(fileId, 'file-123');
      return zip;
    });
    adapter.client = client;

    await adapter._onControlAction('skill.install', {
      skill: { id: 'cust', source_type: 'workspace_file', file_id: 'file-123', package_type: 'zip' },
    });

    assert.deepEqual(client.calls.map((c) => c.state), ['installing', 'installed']);
    assert.ok(fs.existsSync(path.join(workDir, '.claude', 'skills', 'cust', 'SKILL.md')));
  });

  it('reports failed (not installed) when the download fails', async () => {
    const adapter = new BaseAdapter({
      workspaceId: 'ws', channelName: 'c', token: 't', agentName: 'claude',
      agentType: 'claude', workingDir: workDir,
    });
    const client = fakeClient(() => { throw new Error('download boom'); });
    adapter.client = client;

    await adapter._onControlAction('skill.install', {
      skill: { id: 'cust2', source_type: 'workspace_file', file_id: 'f9', package_type: 'zip' },
    });

    const last = client.calls[client.calls.length - 1];
    assert.equal(last.state, 'failed');
    assert.match(last.error, /download boom/);
    assert.equal(client.calls.some((c) => c.state === 'installed'), false);
  });

  it('reports failed when the uploaded file is empty', async () => {
    const adapter = new BaseAdapter({
      workspaceId: 'ws', channelName: 'c', token: 't', agentName: 'claude',
      agentType: 'claude', workingDir: workDir,
    });
    const client = fakeClient(() => Buffer.alloc(0));
    adapter.client = client;
    await adapter._onControlAction('skill.install', {
      skill: { id: 'cust3', source_type: 'workspace_file', file_id: 'f0', package_type: 'md' },
    });
    const last = client.calls[client.calls.length - 1];
    assert.equal(last.state, 'failed');
    assert.equal(client.calls.some((c) => c.state === 'installed'), false);
  });
});

describe('uninstallSkill', () => {
  let workDir;
  beforeEach(() => { workDir = tmpWorkDir(); });
  afterEach(() => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {} });

  it('removes an installed skill directory and is idempotent', () => {
    installer.installSkill({ skill: SAMPLE_SKILL, agentType: 'claude', workingDir: workDir, fetcher: fixtureFetcher });
    const dir = path.join(workDir, '.claude', 'skills', 'claude-api');
    assert.ok(fs.existsSync(dir));

    const r1 = installer.uninstallSkill({ skill: SAMPLE_SKILL, agentType: 'claude', workingDir: workDir });
    assert.equal(r1.removed, true);
    assert.equal(fs.existsSync(dir), false);

    const r2 = installer.uninstallSkill({ skill: SAMPLE_SKILL, agentType: 'claude', workingDir: workDir });
    assert.equal(r2.removed, false, 'second uninstall is a no-op');
  });
});

describe('listInstalledSkills', () => {
  let workDir;
  beforeEach(() => { workDir = tmpWorkDir(); });
  afterEach(() => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {} });

  it('returns [] when no skills dir exists', () => {
    assert.deepEqual(installer.listInstalledSkills({ agentType: 'codex', workingDir: workDir }), []);
  });

  it('parses SKILL.md frontmatter for installed skills', () => {
    installer.installSkill({ skill: SAMPLE_SKILL, agentType: 'codex', workingDir: workDir, fetcher: fixtureFetcher });
    const list = installer.listInstalledSkills({ agentType: 'codex', workingDir: workDir });
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'claude-api');
    assert.equal(list[0].name, 'Claude API');
    assert.match(list[0].description, /Build Claude apps/);
    assert.ok(list[0].skillMd.endsWith('SKILL.md'));
  });
});

// ---------------------------------------------------------------------------
// BaseAdapter control-action wiring
// ---------------------------------------------------------------------------

describe('BaseAdapter skill.install control action', () => {
  let workDir;
  beforeEach(() => { workDir = tmpWorkDir(); });
  afterEach(() => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {} });

  it('installs to disk and reports installing → installed', async () => {
    const adapter = new BaseAdapter({
      workspaceId: 'ws', channelName: 'c', token: 't', agentName: 'claude',
      agentType: 'claude', workingDir: workDir,
    });
    const client = fakeClient();
    adapter.client = client;
    // Inject the test fetcher by overriding installSkill's fetch via require cache:
    // simplest is to stub the installer module method used by the handler.
    const realInstall = require('../src/skill-installer').installSkill;
    require('../src/skill-installer').installSkill = (args) =>
      realInstall({ ...args, fetcher: fixtureFetcher });
    try {
      await adapter._onControlAction('skill.install', { skill: SAMPLE_SKILL });
    } finally {
      require('../src/skill-installer').installSkill = realInstall;
    }

    const states = client.calls.map((c) => c.state);
    assert.deepEqual(states, ['installing', 'installed']);
    const installedCall = client.calls[1];
    assert.equal(installedCall.skillId, 'claude-api');
    assert.ok(installedCall.path.endsWith(path.join('.claude', 'skills', 'claude-api')));
    assert.ok(fs.existsSync(path.join(workDir, '.claude', 'skills', 'claude-api', 'SKILL.md')));
  });

  it('reports failed (not installed) when the install throws', async () => {
    const adapter = new BaseAdapter({
      workspaceId: 'ws', channelName: 'c', token: 't', agentName: 'claude',
      agentType: 'claude', workingDir: workDir,
    });
    const client = fakeClient();
    adapter.client = client;
    const realInstall = require('../src/skill-installer').installSkill;
    require('../src/skill-installer').installSkill = () => { throw new Error('boom-fetch'); };
    try {
      await adapter._onControlAction('skill.install', { skill: SAMPLE_SKILL });
    } finally {
      require('../src/skill-installer').installSkill = realInstall;
    }

    const last = client.calls[client.calls.length - 1];
    assert.equal(last.state, 'failed');
    assert.match(last.error, /boom-fetch/);
    assert.equal(client.calls.some((c) => c.state === 'installed'), false);
  });

  it('ignores skill.install with no skill metadata', async () => {
    const adapter = new BaseAdapter({
      workspaceId: 'ws', channelName: 'c', token: 't', agentName: 'claude',
      agentType: 'claude', workingDir: workDir,
    });
    const client = fakeClient();
    adapter.client = client;
    await adapter._onControlAction('skill.install', {});
    assert.equal(client.calls.length, 0);
  });

  it('skill.uninstall removes the dir and reports uninstalled', async () => {
    installer.installSkill({ skill: SAMPLE_SKILL, agentType: 'claude', workingDir: workDir, fetcher: fixtureFetcher });
    const dir = path.join(workDir, '.claude', 'skills', 'claude-api');
    assert.ok(fs.existsSync(dir));

    const adapter = new BaseAdapter({
      workspaceId: 'ws', channelName: 'c', token: 't', agentName: 'claude',
      agentType: 'claude', workingDir: workDir,
    });
    const client = fakeClient();
    adapter.client = client;
    await adapter._onControlAction('skill.uninstall', { skill: SAMPLE_SKILL });

    assert.equal(fs.existsSync(dir), false);
    assert.equal(client.calls[client.calls.length - 1].state, 'uninstalled');
  });
});

// ---------------------------------------------------------------------------
// Codex context injection
// ---------------------------------------------------------------------------

describe('CodexAdapter installed-skills context', () => {
  let workDir;
  beforeEach(() => { workDir = tmpWorkDir(); });
  afterEach(() => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {} });

  it('injects installed skills into the system context', () => {
    installer.installSkill({ skill: SAMPLE_SKILL, agentType: 'codex', workingDir: workDir, fetcher: fixtureFetcher });
    const adapter = new CodexAdapter({
      workspaceId: 'ws', channelName: 'c', token: 't', agentName: 'codex',
      agentType: 'codex', workingDir: workDir,
    });
    const ctx = adapter._buildSystemContext('c');
    assert.match(ctx, /Installed Skills/);
    assert.match(ctx, /Claude API/);
    assert.match(ctx, /\.codex[\\/]skills[\\/]claude-api[\\/]SKILL\.md/);
  });

  it('omits the section when nothing is installed', () => {
    const adapter = new CodexAdapter({
      workspaceId: 'ws', channelName: 'c', token: 't', agentName: 'codex',
      agentType: 'codex', workingDir: workDir,
    });
    const ctx = adapter._buildSystemContext('c');
    assert.doesNotMatch(ctx, /Installed Skills/);
  });

  // Codex's real mechanism for "using" a skill is: read the `cat <path>`
  // instruction from its injected context, run it, then follow the SKILL.md.
  // We can't drive the live OpenAI model here, but we CAN prove the contract
  // end-to-end: the path in the injected context resolves to the real file,
  // and running the exact command Codex was told to run yields the skill's
  // behavior spec. This is the deterministic half of "Codex reads & follows".
  it('injected cat path resolves to the real SKILL.md and yields its behavior spec', () => {
    const behaviorFetcher = ({ skill, destDir }) => {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(
        path.join(destDir, 'SKILL.md'),
        `---\nname: ${skill.name}\ndescription: greeter\n---\n` +
        `# ${skill.name}\nWhen the user says hello, reply exactly: GREETER_TOKEN_42\n`,
        'utf-8',
      );
    };
    installer.installSkill({
      skill: { id: 'greeter', name: 'Greeter', source_repo: 'a/b', source_path: 'p' },
      agentType: 'codex', workingDir: workDir, fetcher: behaviorFetcher,
    });

    const adapter = new CodexAdapter({
      workspaceId: 'ws', channelName: 'c', token: 't', agentName: 'codex',
      agentType: 'codex', workingDir: workDir,
    });
    const ctx = adapter._buildSystemContext('c');

    // Extract the exact command Codex is instructed to run.
    const m = ctx.match(/cat ([^\s`]+SKILL\.md)/);
    assert.ok(m, 'context tells Codex how to read the skill');
    const catPath = m[1];

    // Run it exactly as Codex's command tool would (cwd = workingDir).
    const out = require('node:child_process')
      .execFileSync('cat', [catPath], { cwd: workDir })
      .toString('utf-8');
    assert.match(out, /GREETER_TOKEN_42/, 'Codex reading the path gets the behavior spec');
  });
});

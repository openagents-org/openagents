'use strict';

/**
 * Smoke test for the full Workspace → Launcher → skills-dir path, using the
 * REAL WorkspaceClient against a stub HTTP backend.
 *
 * It simulates the backend having queued a `workspace.agent.control` event
 * (action=skill.install), lets the adapter's control poller pick it up via
 * `client.pollControl`, runs the install handler (with a fixture fetcher so no
 * network), and asserts:
 *   1. the skill files land in the agent's skills directory, and
 *   2. the launcher POSTs an `installed` status back to /skills/status.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BaseAdapter = require('../src/adapters/base');
const skillInstaller = require('../src/skill-installer');

function fixtureFetcher({ skill, destDir }) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(
    path.join(destDir, 'SKILL.md'),
    `---\nname: ${skill.name}\ndescription: smoke\n---\n# ${skill.name}\n`,
    'utf-8',
  );
}

/** Minimal store-only .zip with a single root SKILL.md (no external deps). */
function makeSkillZip(skillMd) {
  const raw = Buffer.from(skillMd, 'utf8');
  const nameBuf = Buffer.from('SKILL.md', 'utf8');
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt32LE(raw.length, 18);
  lh.writeUInt32LE(raw.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt32LE(raw.length, 20);
  ch.writeUInt32LE(raw.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt32LE(0, 42);
  const localBuf = Buffer.concat([lh, nameBuf, raw]);
  const centralBuf = Buffer.concat([ch, nameBuf]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

function startStubBackend() {
  const state = {
    controlEvents: [],   // events pollControl will return
    statusPosts: [],     // bodies POSTed to /skills/status
    files: {},           // fileId → Buffer, served by GET /v1/files/{id}
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      // GET /v1/events?type=workspace.agent.control... → control poll
      if (req.method === 'GET' && url.pathname === '/v1/events') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { events: state.controlEvents } }));
        return;
      }
      // GET /v1/files/{fileId} → download uploaded skill package bytes
      const fileMatch = url.pathname.match(/^\/v1\/files\/([^/]+)$/);
      if (req.method === 'GET' && fileMatch) {
        const buf = state.files[fileMatch[1]];
        if (!buf) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'file not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(buf);
        return;
      }
      // POST /v1/workspaces/{id}/members/{name}/skills/status
      if (req.method === 'POST' && /\/skills\/status$/.test(url.pathname)) {
        state.statusPosts.push(JSON.parse(body || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { ok: true } }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'not found' }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, state, endpoint: `http://127.0.0.1:${port}` });
    });
  });
}

describe('skill install smoke (real WorkspaceClient + stub backend)', () => {
  let workDir, backend, realInstall;

  beforeEach(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-smoke-'));
    backend = await startStubBackend();
    // Force the fixture fetcher so the install needs no network.
    realInstall = skillInstaller.installSkill;
    skillInstaller.installSkill = (args) => realInstall({ ...args, fetcher: fixtureFetcher });
  });

  afterEach(() => {
    skillInstaller.installSkill = realInstall;
    backend.server.close();
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  });

  it('polls a queued skill.install event, installs to disk, and reports installed', async () => {
    backend.state.controlEvents = [{
      id: 'evt-1',
      timestamp: 1,
      payload: {
        action: 'skill.install',
        skill: {
          id: 'claude-api', name: 'Claude API',
          source_repo: 'anthropics/skills', source_path: 'skills/claude-api',
        },
      },
    }];

    const adapter = new BaseAdapter({
      workspaceId: 'ws1', channelName: 'main', token: 'tok', agentName: 'claude',
      agentType: 'claude', workingDir: workDir, endpoint: backend.endpoint,
    });

    // Drive one control-poll cycle exactly as the live loop would.
    await adapter._pollControl();

    // 1. Skill landed on disk in the Claude skills directory.
    const skillMd = path.join(workDir, '.claude', 'skills', 'claude-api', 'SKILL.md');
    assert.ok(fs.existsSync(skillMd), 'SKILL.md installed on disk');

    // 2. Launcher reported installing then installed back to the backend.
    const states = backend.state.statusPosts.map((p) => p.state);
    assert.deepEqual(states, ['installing', 'installed']);
    assert.equal(backend.state.statusPosts[1].skill_id, 'claude-api');
    assert.match(backend.state.statusPosts[1].path, /claude-api$/);
  });

  it('downloads an uploaded custom skill via /v1/files and installs it', async () => {
    // Restore the real installer for this case — we want the actual zip
    // extraction path, not the fixture fetcher.
    skillInstaller.installSkill = realInstall;
    const skillMd = '---\nname: Uploaded\ndescription: custom\n---\n# Uploaded\n';
    backend.state.files['file-abc'] = makeSkillZip(skillMd);
    backend.state.controlEvents = [{
      id: 'evt-3', timestamp: 3,
      payload: {
        action: 'skill.install',
        skill: {
          id: 'my-upload', name: 'My Upload',
          source_type: 'workspace_file', file_id: 'file-abc',
          filename: 'my-upload.zip', package_type: 'zip',
        },
      },
    }];

    const adapter = new BaseAdapter({
      workspaceId: 'ws1', channelName: 'main', token: 'tok', agentName: 'claude',
      agentType: 'claude', workingDir: workDir, endpoint: backend.endpoint,
    });
    await adapter._pollControl();

    const skillMdPath = path.join(workDir, '.claude', 'skills', 'my-upload', 'SKILL.md');
    assert.ok(fs.existsSync(skillMdPath), 'uploaded SKILL.md installed on disk');
    assert.equal(fs.readFileSync(skillMdPath, 'utf8'), skillMd);
    const states = backend.state.statusPosts.map((p) => p.state);
    assert.deepEqual(states, ['installing', 'installed']);
  });

  it('reports failed back to the backend when the install errors', async () => {
    skillInstaller.installSkill = () => { throw new Error('fetch exploded'); };
    backend.state.controlEvents = [{
      id: 'evt-2', timestamp: 2,
      payload: { action: 'skill.install', skill: { id: 'broken', name: 'Broken', source_repo: 'x/y' } },
    }];

    const adapter = new BaseAdapter({
      workspaceId: 'ws1', channelName: 'main', token: 'tok', agentName: 'codex',
      agentType: 'codex', workingDir: workDir, endpoint: backend.endpoint,
    });
    await adapter._pollControl();

    const last = backend.state.statusPosts[backend.state.statusPosts.length - 1];
    assert.equal(last.state, 'failed');
    assert.match(last.error, /fetch exploded/);
  });
});

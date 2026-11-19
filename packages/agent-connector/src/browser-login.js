'use strict';

const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const SUPPORTED = new Set(['claude', 'codex']);
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
const stripAnsi = text => text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');

function loginDetails(type, raw) {
  const links = [...raw.matchAll(/\x1b\]8;[^;]*;(https:\/\/[^\x07\x1b]+)/g)].map(m => m[1]);
  const text = stripAnsi(raw);
  links.push(...(text.match(/https:\/\/[^\s<>]+/g) || []));
  const url = links.find(link => {
    try {
      const parsed = new URL(link);
      return !parsed.username && !parsed.password && !parsed.port && (type === 'codex'
        ? parsed.hostname === 'auth.openai.com' && parsed.pathname === '/codex/device'
        : ['claude.ai', 'claude.com'].includes(parsed.hostname) && parsed.pathname.endsWith('/oauth/authorize'));
    } catch { return false; }
  });
  return { url, code: type === 'codex' ? (text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/) || [])[0] : undefined };
}

/** Native CLI owns OAuth and stores its credentials. Never relay its raw output. */
class BrowserLogin {
  constructor({ spawnProcess = spawn, verify, onDone = () => {} } = {}) {
    this.spawnProcess = spawnProcess;
    this.verify = verify;
    this.onDone = onDone;
    this.sessions = new Map();
  }

  start(owner, type, binary, env, platform = process.platform) {
    if (!SUPPORTED.has(type) || !['linux', 'darwin'].includes(platform)) throw new Error('Browser sign-in is not supported on this device.');
    if (!binary || !binary.startsWith('/')) throw new Error('Install this agent on the device before signing in.');
    for (const session of this.sessions.values()) {
      if (session.type === type && ['starting', 'waiting'].includes(session.status)) {
        if (session.owner !== owner) throw new Error('Another sign-in is already running on this device.');
        this.cancel(owner, session.id);
      }
    }
    const args = type === 'codex' ? ['login', '--device-auth'] : ['auth', 'login'];
    // CLI links must not wrap at the pseudo-terminal's default 80 columns.
    const command = `stty cols 500 rows 60; exec ${[binary, ...args].map(quote).join(' ')}`;
    const scriptArgs = platform === 'darwin' ? ['-q', '/dev/null', '/bin/sh', '-c', command]
      : ['-q', '-e', '-c', command, '/dev/null'];
    const cleanEnv = { ...env, BROWSER: '/usr/bin/false', COLUMNS: '500', LINES: '60', TERM: 'xterm-256color' };
    for (const key of Object.keys(cleanEnv)) if (/API_KEY|AUTH_TOKEN|OAUTH_TOKEN|BASE_URL/.test(key)) delete cleanEnv[key];
    // Node implements stdin pipes as sockets on macOS. BSD script rejects
    // tcgetattr's ENOTSUP on those; cat gives it an ordinary POSIX pipe.
    const program = platform === 'darwin' ? '/bin/bash' : 'script';
    const programArgs = platform === 'darwin'
      ? ['-c', `exec ${['script', ...scriptArgs].map(quote).join(' ')} < <(cat)`] : scriptArgs;
    const proc = this.spawnProcess(program, programArgs, { env: cleanEnv, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const session = { id: crypto.randomUUID(), owner, type, proc, status: 'starting', raw: '', expiresAt: Date.now() + 10 * 60_000 };
    this.sessions.set(session.id, session);
    const finish = (status) => {
      session.status = status;
      session.raw = '';
      session.url = undefined;
      session.code = undefined;
      clearTimeout(session.timer);
    };
    const receive = chunk => {
      if (!['starting', 'waiting'].includes(session.status)) return;
      session.raw = (session.raw + chunk.toString()).slice(-64_000);
      const details = loginDetails(type, session.raw);
      if (details.url) Object.assign(session, details, { status: 'waiting' });
    };
    proc.stdout.on('data', receive);
    proc.stderr.on('data', receive);
    proc.on('error', () => finish('failed'));
    proc.stdin.on('error', () => finish('failed'));
    proc.on('exit', async code => {
      proc.stdin.destroy?.();
      if (!['starting', 'waiting'].includes(session.status)) return;
      try {
        const ready = code === 0 && await this.verify(type);
        if (!['starting', 'waiting'].includes(session.status)) return;
        finish(ready ? 'done' : 'failed');
        if (ready) this.onDone(type);
      } catch { finish('failed'); }
    });
    session.timer = setTimeout(() => this.cancel(owner, session.id), 10 * 60_000);
    session.timer.unref?.();
    const cleanup = setTimeout(() => { this.cancel(owner, session.id); this.sessions.delete(session.id); }, 15 * 60_000);
    cleanup.unref?.();
    return this.read(owner, session.id);
  }

  session(owner, id) {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner) throw new Error('Sign-in expired. Start again.');
    return session;
  }

  read(owner, id) {
    const { type, status, url, code, expiresAt } = this.session(owner, id);
    return { sessionId: id, type, status, url, code, expiresAt };
  }

  input(owner, id, code) {
    const session = this.session(owner, id);
    if (session.type !== 'claude' || session.status !== 'waiting' || session.sent || typeof code !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(code)) throw new Error('Start a new sign-in and paste the complete authorization code.');
    session.sent = true;
    session.raw = '';
    session.proc.stdin.write(`${code}\r`);
    return this.read(owner, id);
  }

  cancel(owner, id) {
    const session = this.session(owner, id);
    if (['starting', 'waiting'].includes(session.status)) {
      session.status = 'cancelled';
      session.raw = ''; session.url = undefined; session.code = undefined;
      clearTimeout(session.timer);
      try { process.kill(-session.proc.pid, 'SIGTERM'); } catch { session.proc.kill(); }
    }
    return this.read(owner, id);
  }

  close() { for (const session of this.sessions.values()) this.cancel(session.owner, session.id); }
}

module.exports = { BrowserLogin, loginDetails };

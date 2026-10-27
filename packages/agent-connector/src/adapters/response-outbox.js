'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createHash, randomUUID } = require('crypto');
const { isTransientNetworkError, isLogPoint } = require('./failure-streak');

/** Final answers are saved before delivery; neither tokens nor session IDs are saved. */
class ResponseOutbox {
  constructor({ endpoint, workspaceId, agentName, directory, prepare, send, log, onRevoked }) {
    const scope = createHash('sha256').update(JSON.stringify([endpoint, workspaceId, agentName])).digest('hex');
    this.directory = directory || path.join(os.homedir(), '.openagents', 'response-outbox', scope);
    this.prepare = prepare;
    this.send = send;
    this.log = log;
    this.onRevoked = onRevoked;
    this.flight = null;
  }

  save(entry) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, `${entry.id}.json`);
    const temp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(entry), { mode: 0o600 });
    fs.renameSync(temp, file);
  }

  async enqueue(reply) {
    const createdAt = this.readEntries().reduce((latest, entry) => Math.max(latest, entry.createdAt + 1), Date.now());
    this.save({ ...reply, id: randomUUID(), createdAt, attempts: 0 });
    // A new reply arriving during a drain must not be left waiting for a heartbeat.
    if (this.flight) await this.flight;
    await this.flush();
  }

  flush() {
    if (this.flight) return this.flight;
    this.flight = this.drain().finally(() => { this.flight = null; });
    return this.flight;
  }

  readEntries() {
    let files;
    try { files = fs.readdirSync(this.directory).filter(f => /^[\da-f-]+\.json$/.test(f)); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    return files.map(file => {
      try { return JSON.parse(fs.readFileSync(path.join(this.directory, file), 'utf8')); }
      catch { this.log('Unreadable saved reply in response outbox; retained for recovery.', 'error'); return null; }
    }).filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
  }

  async drain() {
    const entries = this.readEntries();
    const waitingChannels = new Set();
    for (const entry of entries) {
      if (waitingChannels.has(entry.channel)) continue;
      if (entry.blocked || entry.nextAttemptAt > Date.now()) {
        waitingChannels.add(entry.channel);
        continue;
      }
      try {
        if (!entry.prepared) {
          Object.assign(entry, await this.prepare(entry), { prepared: true });
          this.save(entry);
        }
        await this.send(entry);
        fs.unlinkSync(path.join(this.directory, `${entry.id}.json`));
        if (entry.attempts) this.log(`Delivered saved reply ${entry.id} after recovery.`);
      } catch (e) {
        waitingChannels.add(entry.channel);
        entry.attempts++;
        // A replaced session stops this adapter. Its successor can deliver the
        // saved reply with a fresh session and the SAME idempotency key.
        if (e.name === 'SessionRevokedError') {
          this.onRevoked();
          return;
        }
        const retry = isTransientNetworkError(e) && (!entry.prepared || entry.safeRetry);
        entry.blocked = !retry;
        entry.nextAttemptAt = Date.now() + Math.min(300000, 1000 * 2 ** Math.min(entry.attempts, 8));
        this.save(entry);
        if (isLogPoint(entry.attempts)) {
          this.log(`Reply ${entry.id} saved locally: ${retry ? 'delivery will retry' : 'delivery needs attention; automatic retries paused'}${e.status ? ` (HTTP ${e.status})` : ''}.`, retry ? 'warn' : 'error');
        }
      }
    }
  }
}

module.exports = { ResponseOutbox };

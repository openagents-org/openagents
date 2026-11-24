'use strict';

/**
 * Runs src/local-sessions.js off the daemon's main thread. Listing reads many
 * session files and OpenCode's goes through its CLI; on the main thread that
 * froze the daemon — and every agent it runs — until it finished.
 */

const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

if (!isMainThread && workerData && workerData.__localSessions) {
  const sessions = require('./local-sessions');
  try {
    const { fn, args } = workerData;
    parentPort.postMessage({ ok: true, value: sessions[fn](...args) });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: e && e.message ? e.message : String(e) });
  }
}

/** sessions[fn](...args), computed in a worker thread. */
function runLocalSessions(fn, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__filename), { workerData: { __localSessions: true, fn, args } });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Reading local sessions took too long')); }, timeoutMs);
    worker.once('message', (m) => { clearTimeout(timer); worker.terminate(); if (m.ok) resolve(m.value); else reject(new Error(m.error)); });
    worker.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

module.exports = { runLocalSessions };

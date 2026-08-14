/**
 * Outbound is event-driven: the gateway holds a stream open per binding and
 * drains when told there is something to drain.
 *
 * The stream carries no message content, only "there is news". That is not a
 * simplification — the backend publishes through Redis pub/sub, which has no
 * replay, so a subscriber consuming frames directly would lose whatever
 * arrived while it was reconnecting. Frames wake us; the durable cursor is
 * what actually moves the data. Reconnecting therefore costs nothing: drain
 * first, then listen again.
 *
 * A slow watchdog sits underneath. It is not polling — outbound does not run
 * on a timer — it exists because a TCP connection can stay open while data
 * stops arriving, and without it that binding would go quiet until the next
 * inbound message happened to wake it.
 */

import { request } from 'undici';

import { config } from './config.js';
import { log } from './log.js';
import * as oa from './oa-client.js';
import * as outbox from './outbox.js';

/** Backoff for reconnects, so a backend restart doesn't turn into a stampede. */
const RECONNECT_MS = [1_000, 2_000, 5_000, 15_000, 30_000];

export class BindingSubscriber {
  private running = false;
  private failures = 0;
  private draining: Promise<void> | null = null;
  private drainAgain = false;

  constructor(private readonly binding: outbox.ActiveBinding) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  /**
   * Drain, coalescing concurrent requests.
   *
   * A burst of frames should produce one catch-up pass, not one per frame —
   * and two overlapping passes would fight over the same lease and cursor.
   */
  async wake(): Promise<void> {
    if (this.draining) {
      this.drainAgain = true;
      return this.draining;
    }
    this.draining = (async () => {
      try {
        do {
          this.drainAgain = false;
          const queued = await outbox.drain(this.binding);
          if (queued > 0) {
            log.info({ binding: this.binding.id, queued }, 'outbox: queued');
          }
          await outbox.sendDue();
        } while (this.drainAgain);
      } catch (err) {
        log.error({ binding: this.binding.id, err }, 'outbox: drain failed');
      } finally {
        this.draining = null;
      }
    })();
    return this.draining;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      // Always drain before listening. On a first run this picks up anything
      // that arrived while we were down; on a reconnect it covers the gap the
      // stream itself cannot replay.
      await this.wake();

      try {
        await this.listen();
        this.failures = 0;
      } catch (err) {
        if (!this.running) break;
        const wait = RECONNECT_MS[Math.min(this.failures, RECONNECT_MS.length - 1)]!;
        this.failures++;
        log.warn(
          { binding: this.binding.id, err, retryInMs: wait },
          'stream: disconnected, reconnecting',
        );
        await sleep(wait);
      }
    }
  }

  private async listen(): Promise<void> {
    const res = await request(oa.streamUrl(), {
      method: 'GET',
      headers: {
        ...oa.bindingHeaders(this.binding.integrationKey),
        Accept: 'text/event-stream',
      },
      // The stream is open-ended by nature; a body timeout would sever a
      // healthy but quiet connection.
      bodyTimeout: 0,
      headersTimeout: 30_000,
    });

    if (res.statusCode !== 200) {
      throw new Error(`stream returned HTTP ${res.statusCode}`);
    }

    log.info({ binding: this.binding.id }, 'stream: connected');

    let buffer = '';
    for await (const chunk of res.body) {
      if (!this.running) break;
      buffer += chunk.toString('utf-8');

      // SSE frames are separated by a blank line. Keeping the trailing partial
      // in the buffer is what makes a frame split across TCP reads survive.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (frame.split('\n').some((line) => line.startsWith('data:'))) {
          void this.wake();
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Keeps one subscriber per active binding, and notices when the set changes —
 * a newly connected agent has to start streaming without a redeploy, and a
 * disconnected one has to stop.
 */
export class SubscriberPool {
  private readonly subscribers = new Map<string, BindingSubscriber>();
  private timer: NodeJS.Timeout | null = null;

  async sync(): Promise<void> {
    const bindings = await outbox.activeBindings();
    const live = new Set(bindings.map((b) => b.id));

    for (const [id, sub] of this.subscribers) {
      if (!live.has(id)) {
        sub.stop();
        this.subscribers.delete(id);
        await outbox.releaseLease(id);
        log.info({ binding: id }, 'stream: binding no longer active, stopped');
      }
    }

    for (const binding of bindings) {
      if (this.subscribers.has(binding.id)) continue;
      const sub = new BindingSubscriber(binding);
      this.subscribers.set(binding.id, sub);
      sub.start();
      log.info({ binding: binding.id }, 'stream: watching binding');
    }
  }

  /** Nudge one binding — used right after we ourselves put work in the outbox. */
  async wake(bindingId: string): Promise<void> {
    await this.subscribers.get(bindingId)?.wake();
  }

  start(): void {
    void this.sync();
    if (config.watchdogSeconds > 0) {
      this.timer = setInterval(() => {
        // Reconciles the binding set and, because sync() ends up draining any
        // newly-seen binding, also covers a stream that went silent without
        // closing.
        void this.sync().then(() =>
          Promise.all([...this.subscribers.values()].map((s) => s.wake())),
        );
      }, config.watchdogSeconds * 1_000);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    for (const sub of this.subscribers.values()) sub.stop();
    this.subscribers.clear();
  }
}

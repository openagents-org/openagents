/**
 * One live connection per tab to GET /v1/events/live (on by default; the
 * server reports settings.realtime_stream=false when it is turned off). It
 * carries every workspace event this viewer may see plus content-free
 * "refetch this panel" topics, so the thread view, DMs and side panels stop
 * polling on timers while it is connected.
 *
 * States: 'connecting' → 'live'; 'off' (turned off on the server,
 * rechecked every 10 min) or 'retrying' (network trouble, backoff). Anything
 * but 'live' means callers keep their existing polling.
 */

export type LiveState = 'connecting' | 'live' | 'retrying' | 'off' | 'stopped';
export type LiveEvent = Record<string, unknown> & { id?: string; type?: string };

type Listener<T> = (value: T) => void;

export interface LiveStreamOptions {
  request: () => { url: string; headers: Record<string, string> };
  fetchImpl?: typeof fetch;
  /** No bytes for this long (server keepalive is 15 s) = dead connection. */
  idleMs?: number;
  offRecheckMs?: number;
}

const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

export class LiveStream {
  state: LiveState = 'connecting';
  private readonly opts: Required<Omit<LiveStreamOptions, 'fetchImpl'>> & { fetchImpl: typeof fetch };
  private readonly eventListeners = new Set<Listener<LiveEvent>>();
  private readonly wakeListeners = new Set<Listener<string[]>>();
  private readonly stateListeners = new Set<Listener<LiveState>>();
  private readonly syncListeners = new Set<Listener<void>>();
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = RETRY_MIN_MS;
  private stopped = false;

  constructor(opts: LiveStreamOptions) {
    this.opts = {
      idleMs: 45_000,
      offRecheckMs: 10 * 60_000,
      ...opts,
      fetchImpl: opts.fetchImpl ?? ((...args) => fetch(...args)),
    };
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
    this.setState('stopped');
  }

  /** Reconnect now (e.g. the tab came back to the foreground). */
  kick(): void {
    if (this.stopped || this.state === 'live' || this.state === 'connecting') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.connect();
  }

  onEvent(fn: Listener<LiveEvent>) { this.eventListeners.add(fn); return () => { this.eventListeners.delete(fn); }; }
  onWake(fn: Listener<string[]>) { this.wakeListeners.add(fn); return () => { this.wakeListeners.delete(fn); }; }
  onState(fn: Listener<LiveState>) { this.stateListeners.add(fn); return () => { this.stateListeners.delete(fn); }; }
  /** Called when events may have been missed: on every (re)connect and on `resync`. */
  onResync(fn: Listener<void>) { this.syncListeners.add(fn); return () => { this.syncListeners.delete(fn); }; }

  private setState(next: LiveState) {
    if (this.state === next) return;
    this.state = next;
    this.stateListeners.forEach((fn) => { try { fn(next); } catch { /* listener bug */ } });
  }

  private emitResync() {
    this.syncListeners.forEach((fn) => { try { fn(); } catch { /* listener bug */ } });
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.connect(); }, ms);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    if (this.state !== 'live') this.setState(this.state === 'off' ? 'off' : 'connecting');
    let idle: ReturnType<typeof setTimeout> | null = null;
    const armIdle = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => abort.abort(), this.opts.idleMs);
    };
    let endedCleanly = false;
    let disabled = false;
    let openedAt = 0;
    try {
      armIdle();
      const { url, headers } = this.opts.request();
      const res = await this.opts.fetchImpl(url, { headers, signal: abort.signal, cache: 'no-store' });
      if (res.status === 404) {
        disabled = true;
        this.setState('off');
        this.schedule(this.opts.offRecheckMs);
        return;
      }
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !res.body || !type.startsWith('text/event-stream')) throw new Error(`live stream HTTP ${res.status}`);
      openedAt = Date.now();
      this.retryMs = RETRY_MIN_MS;
      this.setState('live');
      this.emitResync();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { endedCleanly = true; break; }
        armIdle();
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (this.handleBlock(block) === 'reconnect') { endedCleanly = true; abort.abort(); break; }
        }
        if (endedCleanly) break;
      }
    } catch {
      // aborted (idle / stop / reconnect) or network error: handled below
    } finally {
      if (idle) clearTimeout(idle);
    }
    if (this.stopped || this.abort !== abort || disabled) return;
    // Healthy streams end every few minutes by design: reconnect soon, with
    // jitter so a deploy does not bring every tab back at once.
    if (endedCleanly && openedAt && Date.now() - openedAt > 10_000) {
      this.setState('connecting');
      this.schedule(Math.floor(Math.random() * 5_000));
      return;
    }
    this.setState('retrying');
    this.schedule(this.retryMs + Math.floor(Math.random() * this.retryMs * 0.2));
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
  }

  private handleBlock(block: string): 'reconnect' | void {
    let name = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (name === 'reconnect') return 'reconnect';
    if (name === 'resync') { this.emitResync(); return; }
    if (data.length === 0) return;
    let parsed: unknown;
    try { parsed = JSON.parse(data.join('\n')); } catch { return; }
    if (name === 'wake') {
      const topics = (parsed as { topics?: unknown }).topics;
      if (Array.isArray(topics)) {
        const list = topics.map(String);
        this.wakeListeners.forEach((fn) => { try { fn(list); } catch { /* listener bug */ } });
      }
      return;
    }
    if (name === 'message' && parsed && typeof parsed === 'object') {
      this.eventListeners.forEach((fn) => { try { fn(parsed as LiveEvent); } catch { /* listener bug */ } });
    }
  }
}

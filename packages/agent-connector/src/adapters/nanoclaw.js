/**
 * NanoClaw adapter for OpenAgents workspace.
 *
 * NanoClaw is a CONTAINERIZED agent runtime (each Agent Group runs in its own
 * Docker container; Bun + Claude Agent SDK inside). It is NOT an stdin/stdout
 * CLI and NOT a direct LLM API. This adapter is the OpenAgents-side ORCHESTRATOR
 * that bridges a workspace to a NanoClaw Agent Group via a thin NATIVE NanoClaw
 * `openagents` *channel* (the official extension point) over a local IPC socket
 * (`<home>/data/openagents.sock`).
 *
 *   workspace message ──poll──▶ this adapter ──IPC inbound──▶ openagents channel
 *      ──native router──▶ session ──▶ container(Agent Group) ──▶ outbound.db
 *      ──host delivery──▶ channel.deliver() ──IPC outbound──▶ this adapter
 *      ──▶ workspace events (text / status / error)
 *
 * Mapping:  OpenAgents Agent ↔ NanoClaw Agent Group (NANOCLAW_AGENT_GROUP)
 *           OpenAgents Channel ↔ NanoClaw Session (distinct platform_id ⇒
 *           distinct messaging group ⇒ isolated session per channel).
 *
 * Management/health uses NanoClaw's official `ncl` control socket (read-only
 * commands only — create/wiring are approval-gated). We never read or write
 * NanoClaw's databases, and never duplicate the workspace token into NanoClaw.
 *
 * Direct port target: sdk/src/openagents/adapters/nanoclaw.py
 */

'use strict';

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt } = require('./utils');
const proto = require('./nanoclaw-protocol');
const {
  findNanoclawHome,
  nclSocketPath,
  bridgeSocketPath,
  readBridgeSecret,
  checkDocker,
  checkNode,
  checkPackageManager,
  NclControl,
} = require('./nanoclaw-control');
const { NanoclawBridge } = require('./nanoclaw-bridge');
const { DeliveryStore, defaultStorePath } = require('./nanoclaw-delivery-store');

const DEFAULT_REPLY_TIMEOUT_MS = 180000; // cold container start can take a while
const DEFAULT_SILENCE_MS = 6000; // end a turn this long after the last reply chunk
const DEFAULT_CONNECT_WAIT_MS = 8000; // wait for the channel to be 'ready' before erroring
const PREFLIGHT_TTL_MS = 30000; // cache agent-group/wiring checks
const STATUS_POLL_MS = 10000; // coarse container_status watchdog
const DETACHED_THREADS_CAP = 500; // bound on suppressed (detached) thread ids

class NanoClawAdapter extends BaseAdapter {
  constructor(opts) {
    super(opts);
    const env = this.agentEnv || process.env;

    this._cfgAgentGroup = (env.NANOCLAW_AGENT_GROUP || env.NANOCLAW_GROUP || '').trim();
    this._replyTimeoutMs = parseInt(env.NANOCLAW_REPLY_TIMEOUT_MS || '', 10) || DEFAULT_REPLY_TIMEOUT_MS;
    this._silenceMs = parseInt(env.NANOCLAW_REPLY_SILENCE_MS || '', 10) || DEFAULT_SILENCE_MS;
    this._connectWaitMs = parseInt(env.NANOCLAW_CONNECT_TIMEOUT_MS || '', 10) || DEFAULT_CONNECT_WAIT_MS;

    // Secrets to scrub from any log line.
    this._secrets = [this.token, env.NANOCLAW_TOKEN, env.ANTHROPIC_API_KEY, env.ANTHROPIC_AUTH_TOKEN].filter(Boolean);

    // Resolve the NanoClaw checkout (sync best-effort; re-checked on start).
    const homeInfo = findNanoclawHome(env);
    this._home = homeInfo ? homeInfo.home : null;
    this._homeSource = homeInfo ? homeInfo.source : null;

    this._control = null;
    this._bridge = null;

    // Turn collectors keyed by platformId.
    this._pending = new Map();
    // Persistent dedup of PROCESSED outbound (delivered or intentionally
    // dropped) — survives bridge restart; drives ACK + no-re-display on replay.
    // NANOCLAW_STATE_DIR overrides the location (used by tests).
    this._delivered = new DeliveryStore(
      defaultStorePath(this.workspaceId, this.agentName, (env.NANOCLAW_STATE_DIR || '').trim() || undefined),
    ).load();
    // Loop guard: ids we injected (so an echo can never be re-forwarded).
    this._injectedIds = new Set();
    // Reliable detach via thread rotation. NanoClaw exposes NO outbound-drained /
    // queue-empty / delivery-completed signal, and container_status 'stopped' does
    // NOT prove the host delivery sweep has flushed the session's last outbound
    // (the sweep delivers any 'active' session's undelivered rows regardless of
    // container state). So we do NOT wait on / reuse the old session. Instead each
    // Stop bumps the channel's delivery epoch → a new threadId → a fresh NanoClaw
    // session (resolveSession per-thread under the SAME wiring; no approval, no DB
    // access). The OLD threadId is recorded: NanoClaw stamps every outbound with
    // the AUTHORITATIVE thread_id of its triggering inbound, so the old session's
    // replies are suppressed reliably — even if they arrive long after the new
    // message. Detach state is per-process and persists across bridge reconnects.
    this._activeTurn = new Map(); // channel → in-flight turnId (turn collector)
    this._channelEpoch = new Map(); // channel → epoch int (delivery thread generation)
    this._detachedThreads = new Set(); // threadIds whose outbound must be dropped

    // Resolved Agent Group, cached preflight, container status.
    this._agentGroup = null; // {id, name}
    this._agentGroupErr = null;
    this._preflight = { at: 0, ok: false, code: null };
    this._containerStatus = new Map(); // sessionId/platformId → status
    this._statusPoller = null;
    this._stopping = false;
    this._authError = null; // set when the channel handshake is rejected
  }

  _redact(s) {
    return proto.redactSecrets(s, this._secrets);
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  async run() {
    await this._startBridge();
    return super.run();
  }

  async _startBridge() {
    const env = this.agentEnv || process.env;
    // Re-resolve home at start (the checkout may appear after construction).
    if (!this._home) {
      const hi = findNanoclawHome(env);
      if (hi) {
        this._home = hi.home;
        this._homeSource = hi.source;
      }
    }

    if (!this._home) {
      this._log('NanoClaw checkout not found — set NANOCLAW_HOME or put `ncl` on PATH. Messages will report this until configured.');
      return;
    }
    this._log(`NanoClaw home: ${this._home} (${this._homeSource})`);

    this._control = new NclControl(nclSocketPath(this._home));
    this._bridge = new NanoclawBridge(bridgeSocketPath(this._home), {
      workspace: this.workspaceId,
      agent: this.agentName,
      // Read the handshake secret fresh per connect (the channel rotates it on
      // each host restart; this also re-authenticates on every reconnect).
      secretProvider: () => {
        const s = this._home ? readBridgeSecret(this._home) : null;
        if (s && !this._secrets.includes(s)) this._secrets.push(s); // keep it out of logs
        return s;
      },
      log: (m) => this._log(this._redact(m)),
    });

    this._bridge.on('outbound', (f) => this._onOutbound(f));
    this._bridge.on('status', (f) => this._onStatusFrame(f));
    this._bridge.on('error-frame', (f) => this._onErrorFrame(f));
    this._bridge.on('dropped', (f) => this._onDropped(f));
    this._bridge.on('auth-failed', (code) => {
      this._authError =
        code === 'incompatible_version'
          ? proto.ERR.INCOMPATIBLE_VERSION
          : code === 'single_connection'
            ? proto.ERR.SINGLE_CONNECTION
            : proto.ERR.AUTH_FAILED;
      this._log(`NanoClaw channel handshake rejected (${code})`);
    });
    this._bridge.on('ready', () => {
      this._authError = null;
      this._log('NanoClaw openagents channel ready');
    });
    this._bridge.on('reconnecting', (n, d) => this._log(`Reconnecting to NanoClaw channel (attempt ${n}, ${d}ms)`));
    this._bridge.on('disconnect', () => this._onBridgeDisconnect());
    this._bridge.connect();

    // Coarse watchdog: detect containers that crash while we're awaiting a reply.
    this._statusPoller = setInterval(() => {
      this._pollContainerStatus().catch(() => {});
    }, STATUS_POLL_MS);
    if (this._statusPoller.unref) this._statusPoller.unref();
  }

  stop() {
    this._stopping = true;
    if (this._statusPoller) {
      clearInterval(this._statusPoller);
      this._statusPoller = null;
    }
    // Settle any in-flight turns so per-channel workers don't hang.
    for (const st of this._pending.values()) {
      try {
        st.settle({ stopped: true });
      } catch {
        /* best-effort */
      }
    }
    this._pending.clear();
    this._activeTurn.clear();
    this._detachedThreads.clear();
    this._channelEpoch.clear();
    if (this._bridge) {
      try {
        this._bridge.close();
      } catch {
        /* best-effort */
      }
    }
    // Note: we deliberately do NOT stop the NanoClaw host or any container —
    // those are shared services other channels/agent groups may rely on.
    super.stop();
  }

  // ------------------------------------------------------------------
  // Incoming workspace message
  // ------------------------------------------------------------------

  async _handleMessage(msg) {
    // Loop / echo guard — never forward our own (or another agent's) output.
    if (!proto.shouldForwardInbound(msg, this.agentName)) return;

    let content = (msg.content || '').trim();
    const attText = formatAttachmentsForPrompt(msg.attachments || []);
    if (attText) content = content ? content + attText : attText.trim();
    if (!content) return;

    const channel = this._channelFor(msg);
    const platformId = proto.platformIdFor(this.workspaceId, channel);
    const msgId = proto.makeMessageId(msg, this.workspaceId);
    const turnId = msgId; // one turn per source message (stable across redelivery)
    // Current delivery epoch → threadId → NanoClaw session for this channel. A
    // prior Stop bumped the epoch, so a new message lands on a fresh session.
    const threadId = this._threadIdFor(channel);
    // Mark the turn in-flight synchronously (before any await) so a Stop during
    // preconditions still detaches the correct channel/thread.
    this._activeTurn.set(channel, turnId);

    // Duplicate guard: same source message already in flight / just handled.
    if (this._injectedIds.has(msgId) && this._pending.has(platformId)) {
      this._log(`Duplicate message ignored (${msgId})`);
      return;
    }

    // Environment / connectivity preconditions → actionable user error.
    const pre = await this._preconditions(channel);
    if (!pre.ok) {
      this._activeTurn.delete(channel);
      await this.sendError(channel, pre.userMessage);
      return;
    }

    await this._autoTitleChannel(channel, content);
    await this.sendStatus(channel, 'thinking...');

    // Inject and await the turn.
    this._injectedIds.add(msgId);
    let injected = false;
    try {
      injected = await this._inject(platformId, channel, msgId, turnId, threadId, content);
    } catch (e) {
      const c = proto.classifyError(e, { secrets: this._secrets });
      this._log(`Inject failed: ${c.detail}`);
      await this.sendError(channel, c.userMessage);
      return;
    }
    if (!injected) {
      await this.sendError(channel, proto.classifyError({ code: proto.ERR.SEND_FAILED }).userMessage);
      return;
    }

    const outcome = await this._awaitTurn(platformId, channel, msgId);
    if (this._activeTurn.get(channel) === turnId) this._activeTurn.delete(channel);
    if (outcome.timedOut && !outcome.firstReplySeen && !outcome.stopped && !outcome.detached) {
      await this.sendError(channel, proto.classifyError({ code: proto.ERR.TIMEOUT }).userMessage);
    }
  }

  // ------------------------------------------------------------------
  // Stop = detach (NOT cancel). NanoClaw has no native per-message cancel
  // from a channel surface, so a "stop" stops OpenAgents from WAITING on and
  // DELIVERING the current turn — it does NOT stop the container task, and it
  // never kills the Agent Group, the NanoClaw host, or any shared container.
  // ------------------------------------------------------------------

  async _onControlAction(action, payload) {
    if (action === 'stop') {
      const ch = payload && (payload.channel || payload.sessionId || payload.session);
      if (ch) this._detachChannel(String(ch));
      else for (const c of this._activeChannels()) this._detachChannel(c);
      return;
    }
    await super._onControlAction(action, payload);
  }

  _activeChannels() {
    return [...this._activeTurn.keys()];
  }

  /** Current threadId for a channel's delivery epoch (→ NanoClaw session). */
  _threadIdFor(channel) {
    return `oa-${this._channelEpoch.get(channel) || 0}`;
  }

  /** Key for the detached-thread set: platformId-scoped (NUL separator) so an
   *  `oa-<epoch>` thread on one channel never matches another channel's. */
  _detachKey(platformId, threadId) {
    return `${platformId} ${threadId}`;
  }

  /**
   * Stop = detach. Record the channel's CURRENT threadId so the old (still
   * running) session's replies are dropped, and bump the epoch so the NEXT
   * message starts a FRESH NanoClaw session/thread — officially-supported
   * per-thread routing under the same wiring (no approval, no DB access).
   *
   * NanoClaw exposes no outbound-drained signal, so we never wait on / reuse the
   * old session. The old session's replies carry the AUTHORITATIVE old thread_id
   * (NanoClaw stamps outbound with the triggering inbound's thread_id), so they
   * are suppressed reliably — even if they arrive after the new message. This
   * never cancels the container task or kills the host / containers / other
   * sessions.
   */
  _detachChannel(channel) {
    const platformId = proto.platformIdFor(this.workspaceId, channel);
    this._detachedThreads.add(this._detachKey(platformId, this._threadIdFor(channel)));
    while (this._detachedThreads.size > DETACHED_THREADS_CAP) {
      const oldest = this._detachedThreads.values().next().value;
      if (oldest === undefined) break;
      this._detachedThreads.delete(oldest);
    }
    this._channelEpoch.set(channel, (this._channelEpoch.get(channel) || 0) + 1);
    this._activeTurn.delete(channel);
    const state = this._pending.get(platformId);
    if (state && state.settle) state.settle({ detached: true });
    if (this._bridge) this._bridge.sendCancel(platformId, null); // best-effort notify
    this.sendStatus(
      channel,
      'Stopped — replies from the previous task are dropped; a new message starts a fresh NanoClaw session. The previous task may keep running in the background.',
      { nanoclaw_state: 'detached' },
    ).catch(() => {});
  }

  /** A queued NanoClaw reply was dropped (overflow / expiry / corrupt) — surface it. */
  _onDropped(frame) {
    // Corrupt records have no recoverable platformId; fall back to the default channel.
    const channel = proto.channelFromPlatformId(frame.platformId, this.workspaceId) || this.channelName || 'general';
    const code =
      frame.reason === 'expired'
        ? proto.ERR.DELIVERY_EXPIRED
        : frame.reason === 'corrupt'
          ? proto.ERR.DELIVERY_CORRUPT
          : proto.ERR.DELIVERY_OVERFLOW;
    this._log(`NanoClaw outbox dropped a reply (${frame.reason})`);
    this.sendStatus(channel, proto.classifyError({ code }).userMessage, { nanoclaw_state: code }).catch(() => {});
  }

  _channelFor(msg) {
    let channel = this.channelName || 'general';
    if (msg.sessionId && !msg.sessionId.startsWith('openagents:') && !msg.sessionId.startsWith('agent:')) {
      channel = msg.sessionId;
    }
    return channel;
  }

  /** Send inbound, retrying once across a short reconnect window. */
  async _inject(platformId, channel, msgId, turnId, threadId, text) {
    const fields = {
      platformId,
      threadId,
      msgId,
      turnId,
      text,
      sender: 'user',
      senderId: `oa:${this.workspaceId}`,
    };
    if (!this._bridge) throw Object.assign(new Error('bridge unavailable'), { code: proto.ERR.HOST_NOT_RUNNING });

    if (this._bridge.isReady()) {
      return this._bridge.sendInbound(fields);
    }
    // Wait briefly for the channel to become ready (host restart / late load).
    const ready = await this._waitReady(this._connectWaitMs);
    if (!ready) throw Object.assign(new Error('openagents channel not ready'), { code: proto.ERR.CHANNEL_NOT_LOADED });
    return this._bridge.sendInbound(fields);
  }

  _waitReady(timeoutMs) {
    if (this._bridge && this._bridge.isReady()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        if (this._bridge) this._bridge.removeListener('ready', onReady);
        resolve(v);
      };
      const onReady = () => finish(true);
      const t = setTimeout(() => finish(false), timeoutMs);
      if (t.unref) t.unref();
      if (this._bridge) this._bridge.once('ready', onReady);
      else finish(false);
    });
  }

  /**
   * Block until the turn settles: hard timeout, or a silence window after the
   * last reply chunk, or an explicit idle status, or adapter stop. Replies are
   * delivered by the global _onOutbound router; this just observes for UX.
   */
  _awaitTurn(platformId, channel) {
    return new Promise((resolve) => {
      const state = {
        channel,
        firstReplySeen: false,
        silenceTimer: null,
        hardTimer: null,
        settle: null,
      };
      const settle = (extra = {}) => {
        if (state._settled) return;
        state._settled = true;
        if (state.silenceTimer) clearTimeout(state.silenceTimer);
        if (state.hardTimer) clearTimeout(state.hardTimer);
        this._pending.delete(platformId);
        resolve({
          firstReplySeen: state.firstReplySeen,
          timedOut: !!extra.timedOut,
          stopped: !!extra.stopped,
          detached: !!extra.detached,
        });
      };
      state.settle = settle;
      state.armSilence = () => {
        if (state.silenceTimer) clearTimeout(state.silenceTimer);
        state.silenceTimer = setTimeout(() => settle({ timedOut: false }), this._silenceMs);
        if (state.silenceTimer.unref) state.silenceTimer.unref();
      };
      state.hardTimer = setTimeout(() => settle({ timedOut: true }), this._replyTimeoutMs);
      if (state.hardTimer.unref) state.hardTimer.unref();
      this._pending.set(platformId, state);
    });
  }

  // ------------------------------------------------------------------
  // Outbound from NanoClaw (replies / status / errors)
  // ------------------------------------------------------------------

  async _onOutbound(frame) {
    const platformId = frame.platformId;
    const channel = proto.channelFromPlatformId(platformId, this.workspaceId);
    // Not our workspace — leave it for the owning bridge; do NOT ACK (acking
    // someone else's message would drop it from the channel's replay buffer).
    if (!channel) return;

    const outId = typeof frame.outId === 'string' ? frame.outId : '';
    const text = typeof frame.text === 'string' ? frame.text : '';

    // Already processed (a replay after reconnect / a re-delivery after a bridge
    // restart): re-ACK so the channel stops holding it, but never re-display.
    if (outId && this._delivered.has(outId)) {
      this._ackOutbound(outId, platformId);
      return;
    }

    // Observe for the turn collector regardless of suppression.
    const state = this._pending.get(platformId);
    if (state) {
      state.firstReplySeen = true;
      if (state.armSilence) state.armSilence();
    }

    // Suppress replies of a detached turn (or anything draining on a still-blocked
    // channel — turnId tagging is best-effort, so while blocked we suppress all).
    // We still ACK + mark processed so the channel stops holding/replaying it,
    // and we keep the channel blocked as long as its old turn keeps producing.
    // Suppress replies of a DETACHED session. NanoClaw stamps every outbound with
    // the AUTHORITATIVE thread_id of its triggering inbound, so a detached
    // (platformId, threadId) reliably identifies the old session's replies — even
    // arriving long after a new message on a new thread. Keyed by platformId too
    // so an `oa-<epoch>` thread on one channel never matches another's. ACK + mark
    // processed so the channel stops holding/replaying, but never write it out.
    const fThread = typeof frame.threadId === 'string' ? frame.threadId : '';
    if (fThread && this._detachedThreads.has(this._detachKey(platformId, fThread))) {
      if (outId) {
        this._delivered.add(outId);
        this._ackOutbound(outId, platformId);
      }
      return;
    }

    if (!text) {
      // Non-text outbound we don't render — still processed; ACK so it isn't
      // replayed forever.
      if (outId) {
        this._delivered.add(outId);
        this._ackOutbound(outId, platformId);
      }
      return;
    }

    try {
      await this.sendResponse(channel, text); // reliable hand-off to the Workspace
    } catch (e) {
      this._log(`Failed to deliver reply: ${this._redact(e.message)}`);
      return; // do NOT ack/persist → the channel replays it on the next cycle
    }
    // Persist BEFORE ACK so a crash after delivery still dedups on restart.
    if (outId) {
      this._delivered.add(outId);
      this._ackOutbound(outId, platformId);
    }
  }

  // ACK confirmation point: an outbound is only ACKed AFTER `sendResponse`
  // (which awaits `client.sendMessage` — an HTTP POST to the Workspace REST API)
  // resolves successfully, i.e. the reply is persisted in the Workspace backend,
  // not merely emitted. A failed/rejected POST does NOT ACK, so the channel
  // replays the reply on the next cycle.
  _ackOutbound(outId, platformId) {
    if (this._bridge) this._bridge.sendAck(outId, platformId);
  }

  async _onStatusFrame(frame) {
    const channel = proto.channelFromPlatformId(frame.platformId, this.workspaceId);
    if (!channel) return;
    if (frame.state === 'working') {
      this.sendStatus(channel, 'working...').catch(() => {});
    } else if (frame.state === 'idle') {
      const state = this._pending.get(frame.platformId);
      // Idle after a reply → settle promptly instead of waiting out the silence.
      if (state && state.firstReplySeen && state.settle) state.settle({ timedOut: false });
    }
  }

  async _onErrorFrame(frame) {
    const channel = proto.channelFromPlatformId(frame.platformId, this.workspaceId);
    if (!channel) return;
    const msg = this._redact(frame.message || 'NanoClaw reported an error.');
    this._log(`Channel error: ${msg}`);
    try {
      await this.sendError(channel, msg);
    } catch {
      /* best-effort */
    }
  }

  _onBridgeDisconnect() {
    this._log('NanoClaw channel disconnected — reconnecting (replies will resume).');
    for (const st of this._pending.values()) {
      this.sendStatus(st.channel, 'reconnecting to NanoClaw…').catch(() => {});
    }
  }

  // ------------------------------------------------------------------
  // Preconditions & status
  // ------------------------------------------------------------------

  async _preconditions(channel) {
    if (!this._home) return { ok: false, userMessage: proto.classifyError({ code: proto.ERR.NOT_INSTALLED }).userMessage };
    if (!this._bridge) return { ok: false, userMessage: proto.classifyError({ code: proto.ERR.HOST_NOT_RUNNING }).userMessage };
    if (this._authError) return { ok: false, userMessage: proto.classifyError({ code: this._authError }).userMessage };

    // Cached agent-group + wiring preflight (also confirms host reachability).
    const now = Date.now();
    if (now - this._preflight.at < PREFLIGHT_TTL_MS && this._preflight.code) {
      if (!this._preflight.ok) return { ok: false, userMessage: proto.classifyError({ code: this._preflight.code }).userMessage };
    } else {
      const pf = await this._runPreflight();
      this._preflight = { at: now, ok: pf.ok, code: pf.code };
      if (!pf.ok) return { ok: false, userMessage: proto.classifyError({ code: pf.code }).userMessage };
    }
    return { ok: true };
  }

  /** Verify host up + agent group exists + wired. Read-only ncl commands. */
  async _runPreflight() {
    try {
      const groups = await this._control.listGroups();
      this._lastGroups = groups;
      const ag = this._matchAgentGroup(groups);
      if (!ag) return { ok: false, code: proto.ERR.AGENT_GROUP_MISSING };
      this._agentGroup = ag;

      const wirings = await this._control.listWirings({ agent_group_id: ag.id }).catch(() => []);
      const hasOpenagentsWiring = Array.isArray(wirings) && wirings.length > 0
        ? await this._hasOpenagentsWiring(wirings)
        : false;
      if (!hasOpenagentsWiring) return { ok: false, code: proto.ERR.WIRING_MISSING };

      return { ok: true, code: 'ok' };
    } catch (e) {
      const c = proto.classifyError(e, { secrets: this._secrets });
      // host unreachable / socket missing
      if (c.code === proto.ERR.TIMEOUT || (e && (e.nclCode === 'host-not-running' || e.nclCode === 'transport-error'))) {
        return { ok: false, code: proto.ERR.HOST_NOT_RUNNING };
      }
      return { ok: false, code: c.code };
    }
  }

  _matchAgentGroup(groups) {
    if (!Array.isArray(groups) || groups.length === 0) return null;
    const want = this._cfgAgentGroup;
    if (!want) {
      // No explicit selection: only safe when there is exactly one group.
      return groups.length === 1 ? { id: groups[0].id, name: groups[0].name } : null;
    }
    const byId = groups.find((g) => g.id === want);
    if (byId) return { id: byId.id, name: byId.name };
    const byName = groups.find((g) => (g.name || '').toLowerCase() === want.toLowerCase());
    return byName ? { id: byName.id, name: byName.name } : null;
  }

  /** Does the agent group have a wiring whose messaging group is channel_type 'openagents'? */
  async _hasOpenagentsWiring(wirings) {
    for (const w of wirings) {
      const mgId = w.messaging_group_id || w.messagingGroupId;
      if (!mgId) continue;
      try {
        const mg = await this._control.request('messaging-groups-get', { id: mgId });
        if (mg && (mg.channel_type === proto.CHANNEL_TYPE || mg.channelType === proto.CHANNEL_TYPE)) return true;
      } catch {
        /* ignore individual lookup errors */
      }
    }
    return false;
  }

  async _pollContainerStatus() {
    if (this._stopping || !this._control || !this._agentGroup) return;
    let sessions;
    try {
      sessions = await this._control.listSessions({ agent_group_id: this._agentGroup.id });
    } catch {
      return;
    }
    for (const s of sessions || []) {
      const prev = this._containerStatus.get(s.id);
      this._containerStatus.set(s.id, s.container_status);
      // A container that flips running→stopped while we await a reply ≈ crash.
      if (prev === 'running' && s.container_status === 'stopped') {
        this._log(`Container for session ${String(s.id).slice(0, 8)} stopped unexpectedly.`);
      }
    }
  }

  // ------------------------------------------------------------------
  // Detection surface (used by health checks / launcher)
  // ------------------------------------------------------------------

  static async detect(env = process.env, opts = {}) {
    const homeInfo = findNanoclawHome(env);
    const node = checkNode();
    const pm = checkPackageManager();
    const docker = await checkDocker(opts.dockerRunner);
    const out = {
      installed: !!homeInfo,
      home: homeInfo ? homeInfo.home : null,
      node,
      packageManager: pm,
      docker,
      hostRunning: false,
    };
    if (homeInfo) {
      try {
        const ctl = new NclControl(nclSocketPath(homeInfo.home), { timeoutMs: 4000 });
        await ctl.ping();
        out.hostRunning = true;
      } catch {
        out.hostRunning = false;
      }
    }
    return out;
  }
}

module.exports = NanoClawAdapter;

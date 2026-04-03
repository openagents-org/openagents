'use strict';

const https = require('https');
const http = require('http');

const DEFAULT_ENDPOINT = 'https://workspace-endpoint.openagents.org';

/**
 * HTTP client for workspace API operations.
 *
 * Mirrors the Python SDK's WorkspaceClient — same endpoints, same
 * auth headers (X-Workspace-Token), same request/response shapes.
 */
class WorkspaceClient {
  constructor(endpoint) {
    this.endpoint = (endpoint || DEFAULT_ENDPOINT).replace(/\/$/, '');
  }

  /**
   * Register an agent identity via POST /v1/agentid/register.
   */
  async registerAgent(agentName, { apiKey, origin = 'cli' } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const data = await this._post('/v1/agentid/register', {
      agent_name: agentName,
      origin,
    }, headers);

    return data.data || data;
  }

  /**
   * Create a workspace via POST /v1/workspaces.
   * @returns {{ workspaceId, slug, name, token, url, channelName }}
   */
  async createWorkspace({ agentName, name, agentType } = {}) {
    const payload = {
      name: name || (agentName ? `${agentName}'s workspace` : 'My Workspace'),
    };
    if (agentName) payload.agent_name = agentName;
    if (agentType) payload.agent_type = agentType;

    const data = await this._post('/v1/workspaces', payload);
    const result = data.data || data;

    const frontendUrl = this.endpoint
      .replace('workspace-endpoint', 'workspace')
      .replace('/v1', '');

    return {
      workspaceId: result.workspaceId,
      slug: result.slug || result.workspaceId,
      name: result.name,
      token: result.token,
      url: `${frontendUrl}/${result.slug || result.workspaceId}?token=${result.token}`,
      channelName: (result.channel || {}).name || '',
    };
  }

  /**
   * Join a workspace via POST /v1/join.
   */
  async joinNetwork(agentName, token, { network, agentType, serverHost, workingDir } = {}) {
    const body = { agent_name: agentName, token };
    if (network) body.network = network;
    if (agentType) body.agent_type = agentType;
    if (serverHost) body.server_host = serverHost;
    if (workingDir) body.working_dir = workingDir;

    const data = await this._post('/v1/join', body);
    return data.data || data;
  }

  /**
   * Resolve a workspace token to workspace info via POST /v1/token/resolve.
   * @returns {{ workspace_id, slug, name }}
   */
  async resolveToken(token) {
    const data = await this._post('/v1/token/resolve', { token });
    return data.data || data;
  }

  /**
   * Send heartbeat via POST /v1/heartbeat.
   */
  async heartbeat(workspaceId, agentName, token) {
    const data = await this._post('/v1/heartbeat', {
      agent_name: agentName,
      network: workspaceId,
    }, this._wsHeaders(token));
    return data.data || data;
  }

  /**
   * Disconnect agent via POST /v1/leave. Best-effort (ignores errors).
   */
  async disconnect(workspaceId, agentName, token) {
    try {
      await this._post('/v1/leave', {
        agent_name: agentName,
        network: workspaceId,
      }, this._wsHeaders(token));
    } catch {}
  }

  /**
   * Post a raw event via POST /v1/events.
   */
  async sendEvent(workspaceId, event, token) {
    event.network = workspaceId;
    const data = await this._post('/v1/events', event, this._wsHeaders(token));
    return data.data || data;
  }

  /**
   * Send a chat message to a workspace channel.
   */
  async sendMessage(workspaceId, channelName, token, content, {
    senderType = 'agent', senderName, messageType = 'chat', metadata, attachments,
  } = {}) {
    const sourcePrefix = senderType === 'agent' ? 'openagents' : 'human';
    const source = senderName ? `${sourcePrefix}:${senderName}` : `${sourcePrefix}:unknown`;

    const payload = { content, message_type: messageType };
    if (attachments && attachments.length) payload.attachments = attachments;

    return this.sendEvent(workspaceId, {
      type: 'workspace.message.posted',
      source,
      target: `channel/${channelName}`,
      payload,
      metadata: metadata || {},
    }, token);
  }

  /**
   * Poll messages in a channel via GET /v1/events.
   * @returns {Array} message-compatible objects
   */
  async pollMessages(workspaceId, channelName, token, { after, limit = 50 } = {}) {
    const params = new URLSearchParams({
      network: workspaceId,
      channel: channelName,
      type: 'workspace.message',
      limit: String(limit),
    });
    if (after) params.set('after', after);

    const data = await this._get(`/v1/events?${params}`, this._wsHeaders(token));
    const result = data.data || data;
    const events = (result && result.events) || [];
    return events.map((e) => this._eventToMessage(e));
  }

  /**
   * Poll for pending messages targeted at an agent via GET /v1/events.
   * Returns { messages, cursor } where cursor is the last event ID.
   */
  async pollPending(workspaceId, agentName, token, { after, limit = 50 } = {}) {
    const params = new URLSearchParams({
      network: workspaceId,
      type: 'workspace.message.posted',
      limit: String(limit),
    });
    if (after) params.set('after', after);

    const data = await this._get(`/v1/events?${params}`, this._wsHeaders(token));
    const result = data.data || data;
    const events = (result && result.events) || [];

    let cursor = null;
    if (events.length > 0) {
      cursor = events[events.length - 1].id || null;
    }

    // Filter for messages targeted at this agent
    const messages = [];
    for (const e of events) {
      const source = e.source || '';
      const meta = e.metadata || {};
      const targetAgents = meta.target_agents || [];

      // Skip own messages
      if (source === `openagents:${agentName}`) continue;

      if (source.startsWith('human:')) {
        // Human messages: pick up if targeted at this agent or broadcast
        if (!targetAgents.length || targetAgents.includes(agentName)) {
          messages.push(this._eventToMessage(e));
        }
      } else if (source.startsWith('openagents:')) {
        // Agent messages: only pick up if explicitly mentioned
        if (targetAgents.includes(agentName)) {
          messages.push(this._eventToMessage(e));
        }
      }
    }

    return { messages, cursor };
  }

  /**
   * Get session/channel info via GET /v1/workspaces/{id}/channels/{name}.
   */
  async getSession(workspaceId, channelName, token) {
    try {
      const data = await this._get(
        `/v1/workspaces/${workspaceId}/channels/${channelName}`,
        this._wsHeaders(token),
      );
      const result = data.data || data;
      return {
        sessionId: result.name || channelName,
        title: result.title || channelName,
        titleManuallySet: result.titleManuallySet || false,
        resumeFrom: result.resumeFrom || null,
        status: result.status || 'active',
      };
    } catch {
      return { sessionId: channelName, title: channelName, status: 'active' };
    }
  }

  /**
   * Update session/channel info via PATCH /v1/workspaces/{id}/channels/{name}.
   */
  async updateSession(workspaceId, channelName, token, { title, status, autoTitle } = {}) {
    const body = {};
    if (title !== undefined) body.title = title;
    if (status !== undefined) body.status = status;
    if (autoTitle !== undefined) body.auto_title = autoTitle;
    try {
      await this._patch(
        `/v1/workspaces/${workspaceId}/channels/${channelName}`,
        body,
        this._wsHeaders(token),
      );
    } catch {}
  }

  /**
   * Poll for control events targeted at an agent via GET /v1/events.
   */
  async pollControl(workspaceId, agentName, token, { after } = {}) {
    try {
      const params = new URLSearchParams({
        network: workspaceId,
        type: 'workspace.agent.control',
        limit: '10',
      });
      if (after) params.set('after', after);
      const data = await this._get(`/v1/events?${params}`, this._wsHeaders(token));
      const result = data.data || data;
      const events = (result && result.events) || [];
      return events.filter((e) => {
        const target = e.target || '';
        return target === `openagents:${agentName}`;
      });
    } catch {
      return [];
    }
  }

  /**
   * Get workspace agents via GET /v1/discover.
   * @returns {Array<{ agentName, role, status }>}
   */
  async getAgents(workspaceId, token) {
    const params = new URLSearchParams({ network: workspaceId });
    const data = await this._get(`/v1/discover?${params}`, this._wsHeaders(token));
    const result = data.data || data;
    const agents = (result && result.agents) || [];
    return agents.map((a) => ({
      agentName: (a.address || '').replace('openagents:', ''),
      role: a.role || 'member',
      status: a.status || 'offline',
    }));
  }

  // ── File methods ──

  /**
   * Upload a file via POST /v1/files/base64.
   */
  async uploadFile(workspaceId, token, filename, contentBase64, {
    contentType = 'application/octet-stream', source = 'human:user', channelName,
  } = {}) {
    const body = {
      filename,
      content_base64: contentBase64,
      content_type: contentType,
      network: workspaceId,
      source,
    };
    if (channelName) body.channel_name = channelName;

    const data = await this._post('/v1/files/base64', body, this._wsHeaders(token), 60000);
    return data.data || data;
  }

  /**
   * List files via GET /v1/files.
   */
  async listFiles(workspaceId, token, { limit = 50, offset = 0 } = {}) {
    const params = new URLSearchParams({
      network: workspaceId,
      limit: String(limit),
      offset: String(offset),
    });
    const data = await this._get(`/v1/files?${params}`, this._wsHeaders(token));
    return data.data || data;
  }

  /**
   * Get file metadata via GET /v1/files/{fileId}/info.
   */
  async getFileInfo(token, fileId) {
    try {
      const data = await this._get(`/v1/files/${fileId}/info`, this._wsHeaders(token));
      return data.data || data;
    } catch {
      return { id: fileId, filename: fileId, content_type: 'application/octet-stream' };
    }
  }

  /**
   * Download a file via GET /v1/files/{fileId}.
   * @returns {Buffer}
   */
  async readFile(workspaceId, token, fileId) {
    const params = new URLSearchParams({ network: workspaceId });
    return this._getRaw(`/v1/files/${fileId}?${params}`, this._wsHeaders(token), 60000);
  }

  /**
   * Delete a file via DELETE /v1/files/{fileId}.
   */
  async deleteFile(workspaceId, token, fileId) {
    const data = await this._delete(`/v1/files/${fileId}`, this._wsHeaders(token), workspaceId);
    return data.data || data;
  }

  // ── Browser methods ──

  /**
   * Open a new browser tab via POST /v1/browser/tabs.
   */
  async browserOpenTab(workspaceId, token, { url = 'about:blank', source = 'human:user', context_id } = {}) {
    const body = { url, network: workspaceId, source };
    if (context_id) body.context_id = context_id;
    const data = await this._post('/v1/browser/tabs', body, this._wsHeaders(token));
    return data.data || data;
  }

  /**
   * List browser tabs via GET /v1/browser/tabs.
   */
  async browserListTabs(workspaceId, token) {
    const params = new URLSearchParams({ network: workspaceId });
    const data = await this._get(`/v1/browser/tabs?${params}`, this._wsHeaders(token));
    return data.data || data;
  }

  /**
   * Navigate a browser tab via POST /v1/browser/tabs/{tabId}/navigate.
   */
  async browserNavigate(workspaceId, token, tabId, url) {
    const data = await this._post(`/v1/browser/tabs/${tabId}/navigate`, { url }, this._wsHeaders(token));
    return data.data || data;
  }

  /**
   * Click an element via POST /v1/browser/tabs/{tabId}/click.
   */
  async browserClick(workspaceId, token, tabId, selector) {
    const data = await this._post(`/v1/browser/tabs/${tabId}/click`, { selector }, this._wsHeaders(token));
    return data.data || data;
  }

  /**
   * Type text via POST /v1/browser/tabs/{tabId}/type.
   */
  async browserType(workspaceId, token, tabId, selector, text) {
    const data = await this._post(`/v1/browser/tabs/${tabId}/type`, { selector, text }, this._wsHeaders(token));
    return data.data || data;
  }

  /**
   * Get screenshot via GET /v1/browser/tabs/{tabId}/screenshot.
   * @returns {Buffer}
   */
  async browserScreenshot(workspaceId, token, tabId) {
    return this._getRaw(`/v1/browser/tabs/${tabId}/screenshot`, this._wsHeaders(token), 30000);
  }

  /**
   * Get accessibility snapshot via GET /v1/browser/tabs/{tabId}/snapshot.
   * @returns {string}
   */
  async browserSnapshot(workspaceId, token, tabId) {
    const buf = await this._getRaw(`/v1/browser/tabs/${tabId}/snapshot`, this._wsHeaders(token));
    return buf.toString('utf-8');
  }

  /**
   * Close a browser tab via DELETE /v1/browser/tabs/{tabId}.
   */
  async browserCloseTab(workspaceId, token, tabId) {
    const data = await this._delete(`/v1/browser/tabs/${tabId}`, this._wsHeaders(token));
    return data.data || data;
  }

  /**
   * List persistent browser contexts via GET /v1/browser/contexts.
   */
  async browserListContexts(workspaceId, token) {
    const params = new URLSearchParams({ network: workspaceId });
    const data = await this._get(`/v1/browser/contexts?${params}`, this._wsHeaders(token));
    return data.data || data;
  }

  // ── Internal helpers ──

  /**
   * Convert an ONM event to a message-compatible object.
   */
  _eventToMessage(event) {
    const source = event.source || '';
    const isHuman = source.startsWith('human:');
    const senderName = source.replace('openagents:', '').replace('human:', '');
    const payload = event.payload || {};
    const target = event.target || '';
    const ts = event.timestamp;

    const msg = {
      messageId: event.id || '',
      sessionId: target.startsWith('channel/') ? target.replace('channel/', '') : target,
      senderType: isHuman ? 'human' : 'agent',
      senderName,
      content: (payload.content || event.content || ''),
      mentions: payload.mentions || [],
      messageType: payload.message_type || 'chat',
      metadata: event.metadata || {},
    };
    if (ts) {
      msg.createdAt = new Date(ts).toISOString();
    }
    if (payload.attachments) {
      msg.attachments = payload.attachments;
    }
    return msg;
  }

  _wsHeaders(token) {
    return {
      'Content-Type': 'application/json',
      'X-Workspace-Token': token,
    };
  }

  _get(urlPath, headers = {}, timeout = 15000) {
    const fullUrl = this.endpoint + urlPath;

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(fullUrl);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const req = transport.request(fullUrl, {
        method: 'GET',
        headers,
        timeout,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(parsed.message || `HTTP ${res.statusCode}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Invalid response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.end();
    });
  }

  _getRaw(urlPath, headers = {}, timeout = 15000) {
    const fullUrl = this.endpoint + urlPath;

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(fullUrl);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const req = transport.request(fullUrl, {
        method: 'GET',
        headers,
        timeout,
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => { chunks.push(chunk); });
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${buf.toString('utf-8').slice(0, 200)}`));
          } else {
            resolve(buf);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.end();
    });
  }

  _post(urlPath, body, headers = {}, timeout = 30000) {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const jsonBody = JSON.stringify(body);
    const fullUrl = this.endpoint + urlPath;

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(fullUrl);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const req = transport.request(fullUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(jsonBody) },
        timeout,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              const msg = parsed.message || `HTTP ${res.statusCode}`;
              reject(new Error(msg));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Invalid response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.write(jsonBody);
      req.end();
    });
  }

  _patch(urlPath, body, headers = {}, timeout = 15000) {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const jsonBody = JSON.stringify(body);
    const fullUrl = this.endpoint + urlPath;

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(fullUrl);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const req = transport.request(fullUrl, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(jsonBody) },
        timeout,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(parsed.message || `HTTP ${res.statusCode}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Invalid response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.write(jsonBody);
      req.end();
    });
  }

  _delete(urlPath, headers = {}, network) {
    const fullUrl = this.endpoint + urlPath + (network ? `?network=${network}` : '');

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(fullUrl);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const req = transport.request(fullUrl, {
        method: 'DELETE',
        headers,
        timeout: 15000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(parsed.message || `HTTP ${res.statusCode}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Invalid response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.end();
    });
  }
}

module.exports = { WorkspaceClient };

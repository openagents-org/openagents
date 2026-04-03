'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_REGISTRY_URL = 'https://endpoint.openagents.org/v1/agent-registry';
const CACHE_FILE = 'agent_catalog.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Default support status — install only.
 */
const DEFAULT_SUPPORT = { install: true, workspace: false, collaboration: false };

/**
 * Sort catalog: featured entries first (by order), then the rest alphabetically.
 * Also ensures every entry has a support field.
 */
function _sortCatalog(catalog) {
  for (const entry of catalog) {
    if (!entry.support) entry.support = { ...DEFAULT_SUPPORT };
  }
  return catalog.sort((a, b) => {
    const af = a.featured ? 1 : 0;
    const bf = b.featured ? 1 : 0;
    if (af !== bf) return bf - af; // featured first
    if (af && bf) return (a.order || 999) - (b.order || 999); // by order within featured
    return (a.label || a.name).localeCompare(b.label || b.name); // alphabetical for the rest
  });
}

/**
 * Agent registry — fetches the catalog of available agent types.
 *
 * Priority: remote API → local cache (24h) → bundled registry.json
 */
class Registry {
  constructor(configDir, registryUrl) {
    this.configDir = configDir;
    this.registryUrl = registryUrl || DEFAULT_REGISTRY_URL;
    this.cacheFile = path.join(configDir, CACHE_FILE);
    this._catalog = null; // in-memory cache
  }

  /**
   * Get the full agent catalog. Tries remote, then cache, then bundled.
   * @returns {Promise<object[]>}
   */
  async getCatalog() {
    if (this._catalog) return this._catalog;

    // Try cache first (avoids network on every call)
    const cached = this._loadCache();
    if (cached) {
      this._catalog = _sortCatalog(this._mergeBundled(cached));
      this._refreshInBackground();
      return this._catalog;
    }

    // No cache — try remote
    const remote = await this._fetchRemote();
    if (remote) {
      this._catalog = _sortCatalog(this._mergeBundled(remote));
      return this._catalog;
    }

    // Fallback to bundled
    this._catalog = _sortCatalog(this._loadBundled());
    return this._catalog;
  }

  /**
   * Get catalog synchronously (cache or bundled only, no network).
   */
  getCatalogSync() {
    if (this._catalog) return this._catalog;
    const cached = this._loadCache();
    if (cached) {
      this._catalog = _sortCatalog(this._mergeBundled(cached));
      return this._catalog;
    }
    this._catalog = _sortCatalog(this._loadBundled());
    return this._catalog;
  }

  /**
   * Merge bundled env_config/resolve_env/install into catalog entries.
   * Remote/cached entries may lack these fields.
   */
  _mergeBundled(catalog) {
    const bundled = this._loadBundled();
    for (const entry of catalog) {
      const b = bundled.find(x => x.name === entry.name);
      if (b) {
        if ((!entry.env_config || entry.env_config.length === 0) && b.env_config && b.env_config.length > 0) entry.env_config = b.env_config;
        if (!entry.resolve_env && b.resolve_env) entry.resolve_env = b.resolve_env;
        if (!entry.install && b.install) entry.install = b.install;
        if (!entry.check_ready && b.check_ready) entry.check_ready = b.check_ready;
        if (!entry.launch && b.launch) entry.launch = b.launch;
        // Always take featured/order/support from bundled (source of truth for ordering)
        if (b.featured !== undefined) entry.featured = b.featured;
        if (b.order !== undefined) entry.order = b.order;
        if (b.support) entry.support = b.support;
      }
    }
    // Add bundled entries not in catalog
    for (const b of bundled) {
      if (!catalog.find(e => e.name === b.name)) catalog.push(b);
    }
    return catalog;
  }

  /**
   * Get env field definitions for an agent type.
   */
  getEnvFields(agentType) {
    const catalog = this.getCatalogSync();
    const entry = catalog.find((e) => e.name === agentType);
    return entry ? (entry.env_config || []) : [];
  }

  /**
   * Get resolve_env rules for an agent type.
   */
  getResolveRules(agentType) {
    const catalog = this.getCatalogSync();
    const entry = catalog.find((e) => e.name === agentType);
    if (!entry || !entry.resolve_env) return [];
    return entry.resolve_env.rules || [];
  }

  /**
   * Get a single catalog entry by name.
   */
  getEntry(agentType) {
    const catalog = this.getCatalogSync();
    const entry = catalog.find((e) => e.name === agentType) || null;
    if (!entry) return null;
    // Merge missing fields from bundled registry
    const bundled = this._loadBundled();
    const b = bundled.find((e) => e.name === agentType);
    if (b) {
      if (!entry.install && b.install) entry.install = b.install;
      if (!entry.check_ready && b.check_ready) entry.check_ready = b.check_ready;
      if (!entry.launch && b.launch) entry.launch = b.launch;
      if ((!entry.env_config || !entry.env_config.length) && b.env_config?.length) entry.env_config = b.env_config;
    }
    return entry;
  }

  /**
   * Force refresh from remote API.
   */
  async refresh() {
    const remote = await this._fetchRemote();
    if (remote) this._catalog = _sortCatalog(this._mergeBundled(remote));
    return this._catalog || this.getCatalogSync();
  }

  // -- Internal --

  _loadCache() {
    try {
      if (!fs.existsSync(this.cacheFile)) return null;
      const stat = fs.statSync(this.cacheFile);
      if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
      const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'));
      return Array.isArray(data) ? data : null;
    } catch {
      return null;
    }
  }

  _saveCache(data) {
    try {
      fs.mkdirSync(this.configDir, { recursive: true });
      fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch {}
  }

  _loadBundled() {
    try {
      const bundledPath = path.join(__dirname, '..', 'registry.json');
      if (fs.existsSync(bundledPath)) {
        return JSON.parse(fs.readFileSync(bundledPath, 'utf-8'));
      }
    } catch {}
    return [];
  }

  async _fetchRemote() {
    try {
      const data = await httpGetJson(this.registryUrl, 5000);
      // API returns { data: [...] } or directly [...]
      const catalog = Array.isArray(data) ? data : (data.data || []);
      if (catalog.length > 0) {
        this._saveCache(catalog);
      }
      return catalog;
    } catch {
      return null;
    }
  }

  _refreshInBackground() {
    // Check if cache is older than TTL
    try {
      const stat = fs.statSync(this.cacheFile);
      if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) return;
    } catch {
      return;
    }
    // Fire and forget
    this._fetchRemote().catch(() => {});
  }
}

/**
 * Simple HTTP GET that returns parsed JSON. No external dependencies.
 */
function httpGetJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === 'https:' ? require('https') : require('http');

    const req = transport.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        httpGetJson(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

module.exports = { Registry };

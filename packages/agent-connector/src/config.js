'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Manages ~/.openagents/daemon.yaml — the agent/network configuration file.
 * Compatible with the Python SDK's daemon_config.py format.
 */
class Config {
  constructor(configDir) {
    this.configDir = configDir;
    this.configFile = path.join(configDir, 'daemon.yaml');
    this.statusFile = path.join(configDir, 'daemon.status.json');
    this.pidFile = path.join(configDir, 'daemon.pid');
    this.cmdFile = path.join(configDir, 'daemon.cmd');
    this.logFile = path.join(configDir, 'daemon.log');
  }

  // -- Read --

  load() {
    try {
      if (fs.existsSync(this.configFile)) {
        const text = fs.readFileSync(this.configFile, 'utf-8');
        return parseYaml(text);
      }
    } catch (err) {
      console.error('Failed to load config:', err.message);
    }
    return { version: 2, agents: [], networks: [] };
  }

  getAgents() {
    return this.load().agents || [];
  }

  getNetworks() {
    return this.load().networks || [];
  }

  getAgent(name) {
    return this.getAgents().find((a) => a.name === name) || null;
  }

  // -- Write --

  save(config) {
    fs.mkdirSync(this.configDir, { recursive: true });
    fs.writeFileSync(this.configFile, serializeYaml(config), 'utf-8');
  }

  addAgent({ name, type, role, path: agentPath }) {
    const config = this.load();
    if (config.agents.some((a) => a.name === name)) {
      throw new Error(`Agent '${name}' already exists`);
    }
    const entry = { name, type: type || 'openclaw', role: role || 'worker' };
    if (agentPath) entry.path = agentPath;
    config.agents.push(entry);
    this.save(config);
    return entry;
  }

  removeAgent(name) {
    const config = this.load();
    const idx = config.agents.findIndex((a) => a.name === name);
    if (idx === -1) return false;
    config.agents.splice(idx, 1);
    this.save(config);
    return true;
  }

  updateAgent(name, updates) {
    const config = this.load();
    const agent = config.agents.find((a) => a.name === name);
    if (!agent) throw new Error(`Agent '${name}' not found`);
    Object.assign(agent, updates);
    this.save(config);
    return agent;
  }

  setAgentNetwork(agentName, networkSlug) {
    const config = this.load();
    const agent = config.agents.find((a) => a.name === agentName);
    if (!agent) throw new Error(`Agent '${agentName}' not found`);
    if (networkSlug) {
      agent.network = networkSlug;
    } else {
      delete agent.network;
    }
    this.save(config);
  }

  addNetwork({ id, slug, name, endpoint, token }) {
    const config = this.load();
    if (config.networks.some((n) => n.slug === slug || n.id === id)) {
      return; // already exists
    }
    const entry = { id, slug };
    if (name) entry.name = name;
    if (endpoint) entry.endpoint = endpoint;
    if (token) entry.token = token;
    config.networks.push(entry);
    this.save(config);
    return entry;
  }

  removeNetwork(slug) {
    const config = this.load();
    const idx = config.networks.findIndex((n) => n.slug === slug || n.id === slug);
    if (idx === -1) return false;
    config.networks.splice(idx, 1);
    // Disconnect any agents that were on this network
    for (const agent of config.agents) {
      if (agent.network === slug) delete agent.network;
    }
    this.save(config);
    return true;
  }

  // -- Status / PID --

  getStatus() {
    try {
      if (fs.existsSync(this.statusFile)) {
        const data = JSON.parse(fs.readFileSync(this.statusFile, 'utf-8'));
        return data.agents || {};
      }
    } catch {}
    return {};
  }

  getDaemonPid() {
    try {
      if (!fs.existsSync(this.pidFile)) return null;
      const pid = parseInt(fs.readFileSync(this.pidFile, 'utf-8').trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  writeCommand(cmd) {
    fs.writeFileSync(this.cmdFile, cmd + '\n', 'utf-8');
  }

  getLogs(agentName, lines = 200) {
    try {
      if (!fs.existsSync(this.logFile)) return [];
      const content = fs.readFileSync(this.logFile, 'utf-8');
      let allLines = content.split('\n').filter(Boolean);
      if (agentName) {
        allLines = allLines.filter(
          (l) => l.includes(agentName) || l.includes('daemon') || l.includes('Daemon')
        );
      }
      return allLines.slice(-lines);
    } catch {
      return [];
    }
  }

  /**
   * Tail log file with optional filter. Returns { lines, size }.
   * @param {Object} opts - { agent, lines, offset }
   * @param {string} [opts.agent] - Filter by agent name
   * @param {number} [opts.lines=100] - Number of lines to return
   * @param {number} [opts.offset=0] - Byte offset for incremental reads (0 = from end)
   */
  tailLogs(opts = {}) {
    const { agent, lines = 100, offset = 0 } = opts;
    try {
      if (!fs.existsSync(this.logFile)) return { lines: [], size: 0 };
      const stat = fs.statSync(this.logFile);
      if (offset > 0 && offset < stat.size) {
        // Incremental read from offset
        const fd = fs.openSync(this.logFile, 'r');
        const buf = Buffer.alloc(stat.size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset);
        fs.closeSync(fd);
        let newLines = buf.toString('utf-8').split('\n').filter(Boolean);
        if (agent) {
          newLines = newLines.filter(l => l.includes(agent) || l.includes('Daemon'));
        }
        return { lines: newLines, size: stat.size };
      }
      // Full read, return last N
      return { lines: this.getLogs(agent, lines), size: stat.size };
    } catch {
      return { lines: [], size: 0 };
    }
  }
}

// -- YAML parser (compatible with Python SDK's daemon.yaml format) --

function parseYaml(text) {
  const lines = text.split('\n');
  const result = { version: 2, agents: [], networks: [] };
  let currentList = null;
  let currentItem = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const stripped = line.trimStart();

    if (!stripped || stripped.startsWith('#')) continue;

    const indent = line.length - stripped.length;

    // List item start (- key: value)
    if (stripped.startsWith('- ') && currentList) {
      if (currentItem) result[currentList].push(currentItem);
      currentItem = {};
      const rest = stripped.slice(2).trim();
      if (rest.includes(':')) {
        const [key, ...valParts] = rest.split(':');
        currentItem[key.trim()] = parseYamlValue(valParts.join(':').trim());
      }
      continue;
    }

    // Top-level keys
    if (indent === 0 && stripped.includes(':') && !stripped.startsWith('- ')) {
      if (currentItem && currentList) {
        result[currentList].push(currentItem);
        currentItem = null;
      }
      const [key, ...rest] = stripped.split(':');
      const val = rest.join(':').trim();
      if (key === 'version') {
        result.version = parseInt(val, 10) || 2;
        currentList = null;
      } else if (key === 'agents') {
        currentList = 'agents';
      } else if (key === 'networks') {
        currentList = 'networks';
      } else {
        currentList = null;
      }
      continue;
    }

    // Continuation of current item (indented key: value)
    if (currentItem && indent >= 2 && stripped.includes(':')) {
      const [key, ...valParts] = stripped.split(':');
      currentItem[key.trim()] = parseYamlValue(valParts.join(':').trim());
    }
  }

  if (currentItem && currentList) result[currentList].push(currentItem);
  return result;
}

function parseYamlValue(val) {
  if (val === '' || val === 'null' || val === '~') return null;
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  if ((val.startsWith("'") && val.endsWith("'")) ||
      (val.startsWith('"') && val.endsWith('"'))) {
    return val.slice(1, -1);
  }
  if (val.startsWith('{') || val.startsWith('[')) {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

// -- YAML serializer --

function serializeYaml(config) {
  const lines = [`version: ${config.version || 2}`];

  lines.push('agents:');
  for (const agent of (config.agents || [])) {
    const keys = Object.keys(agent);
    if (keys.length === 0) continue;
    lines.push(`- name: ${serializeYamlValue(agent.name)}`);
    for (const key of keys) {
      if (key === 'name') continue;
      lines.push(`  ${key}: ${serializeYamlValue(agent[key])}`);
    }
  }
  if (!config.agents || config.agents.length === 0) {
    lines[lines.length - 1] += ' []';
  }

  lines.push('networks:');
  for (const net of (config.networks || [])) {
    const keys = Object.keys(net);
    if (keys.length === 0) continue;
    const firstKey = keys[0];
    lines.push(`- ${firstKey}: ${serializeYamlValue(net[firstKey])}`);
    for (const key of keys.slice(1)) {
      lines.push(`  ${key}: ${serializeYamlValue(net[key])}`);
    }
  }
  if (!config.networks || config.networks.length === 0) {
    lines[lines.length - 1] += ' []';
  }

  return lines.join('\n') + '\n';
}

function serializeYamlValue(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object') return JSON.stringify(val);
  const s = String(val);
  // Quote strings that contain special YAML chars
  if (s.includes(':') || s.includes('#') || s.includes("'") || s.includes('"') ||
      s.includes('\n') || s.startsWith(' ') || s.endsWith(' ') ||
      s === 'true' || s === 'false' || s === 'null' || /^\d+$/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

module.exports = { Config, parseYaml, serializeYaml };

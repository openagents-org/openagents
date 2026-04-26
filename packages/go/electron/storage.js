const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = 'settings.json';

const DEFAULTS = {
  workspaceId: '',
  workspaceToken: '',
  workspaceEndpoint: '',
  workspaceHistory: [],
};

function getSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

function loadSettings() {
  const filePath = getSettingsPath();
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return { ...DEFAULTS, ...data };
    }
  } catch {
    // Corrupted file — fall back to defaults
  }
  return { ...DEFAULTS };
}

function saveSettings(settings) {
  const filePath = getSettingsPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Auto-maintain workspace history when saving a workspace
  const current = loadSettings();
  const history = current.workspaceHistory || [];

  if (settings.workspaceId && settings.workspaceToken) {
    // Add to history if not already there, or update existing entry
    const idx = history.findIndex((h) => h.workspaceId === settings.workspaceId);
    const entry = {
      workspaceId: settings.workspaceId,
      workspaceToken: settings.workspaceToken,
      endpoint: settings.workspaceEndpoint || undefined,
      name: settings.workspaceName || settings.workspaceId,
      lastUsed: Date.now(),
    };
    if (idx >= 0) {
      history[idx] = { ...history[idx], ...entry };
    } else {
      history.unshift(entry);
    }
    // Keep max 10 entries
    settings.workspaceHistory = history.slice(0, 10);
  } else {
    settings.workspaceHistory = history;
  }

  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}

module.exports = { loadSettings, saveSettings, DEFAULTS };

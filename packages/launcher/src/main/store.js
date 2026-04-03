/**
 * Simple JSON file-based settings store.
 * Replaces electron-store to avoid ESM compatibility issues.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Store {
  constructor(defaults = {}) {
    this._data = { ...defaults };
    this._pathResolved = false;
    this._path = null;
  }

  _ensurePath() {
    if (!this._pathResolved) {
      this._path = path.join(app.getPath('userData'), 'settings.json');
      this._pathResolved = true;
      this._load();
    }
  }

  _load() {
    try {
      if (this._path && fs.existsSync(this._path)) {
        const raw = fs.readFileSync(this._path, 'utf-8');
        this._data = { ...this._data, ...JSON.parse(raw) };
      }
    } catch {}
  }

  _save() {
    this._ensurePath();
    try {
      const dir = path.dirname(this._path);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }

  get(key) {
    this._ensurePath();
    if (key === undefined) return { ...this._data };
    return this._data[key];
  }

  set(key, value) {
    if (typeof key === 'object') {
      Object.assign(this._data, key);
    } else {
      this._data[key] = value;
    }
    this._save();
  }

  delete(key) {
    delete this._data[key];
    this._save();
  }

  has(key) {
    return key in this._data;
  }
}

module.exports = { Store };

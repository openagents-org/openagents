import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { writeJsonAtomic } from './atomic-json'

/**
 * Where the settings live.
 *
 * Exported because startup code has to answer "has this profile run the
 * launcher before?", and the only durable evidence is whether this file was
 * already there — a question that must be asked before anything in the run
 * creates it, so it cannot be asked of the store itself.
 */
export function settingsFilePath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export class Store {
  private _data: Record<string, unknown> = {}
  private _pathResolved = false
  private _path: string | null = null

  constructor(defaults: Record<string, unknown> = {}) {
    this._data = { ...defaults }
  }

  private _ensurePath(): void {
    if (!this._pathResolved) {
      this._path = settingsFilePath()
      this._pathResolved = true
      this._load()
    }
  }

  private _load(): void {
    try {
      if (this._path && fs.existsSync(this._path)) {
        const raw = fs.readFileSync(this._path, 'utf-8')
        this._data = { ...this._data, ...JSON.parse(raw) }
      }
    } catch (err) {
      // Falling back to defaults is intentional (a corrupt settings.json must
      // not block startup), but doing it silently means the user's settings
      // appear to reset themselves for no reason.
      console.error('Failed to load settings, falling back to defaults:', err)
    }
  }

  private _save(): void {
    this._ensurePath()
    try {
      writeJsonAtomic(this._path!, this._data)
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
  }

  get(key?: string): unknown {
    this._ensurePath()
    if (key === undefined) return { ...this._data }
    return this._data[key]
  }

  set(key: string | Record<string, unknown>, value?: unknown): void {
    if (typeof key === 'object') {
      Object.assign(this._data, key)
    } else {
      this._data[key] = value
    }
    this._save()
  }

  delete(key: string): void {
    delete this._data[key]
    this._save()
  }

  has(key: string): boolean {
    return key in this._data
  }
}

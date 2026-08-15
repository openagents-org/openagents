import { Notification, BrowserWindow } from 'electron'

export type NotifKind =
  | 'agent_error'
  | 'agent_finished'
  | 'agent_mention'
  | 'agent_waiting_input'
  | 'workspace_mention'
  | 'workspace_message'
  | 'workspace_error'
  | 'platform_error'
  | 'github'
  | 'update_available'
  | 'system'

export type NotifPriority = 'low' | 'normal' | 'high' | 'critical'

export interface NotifInput {
  kind: NotifKind
  title: string
  body: string
  priority?: NotifPriority
  /** Used to deduplicate / mute by source. */
  source?: string
  /** Free-form payload echoed back to the renderer when the user clicks the OS notification. */
  payload?: Record<string, unknown>
  /** When true, the OS-level toast is suppressed (notification still persisted). */
  silent?: boolean
}

export interface NotifRecord extends NotifInput {
  id: string
  createdAt: string
  read: boolean
}

let _mainWindow: BrowserWindow | null = null
const _records: NotifRecord[] = []
const MAX = 200

export function setNotificationsWindow(win: BrowserWindow | null): void {
  _mainWindow = win
}

function id(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function listNotifications(): NotifRecord[] {
  return _records.slice().reverse()
}

export function markRead(idValue: string): void {
  const r = _records.find((n) => n.id === idValue)
  if (r) {
    r.read = true
    broadcast()
  }
}

export function markAllRead(): void {
  for (const r of _records) r.read = true
  broadcast()
}

export function clearAll(): void {
  _records.length = 0
  broadcast()
}

export function clearOne(idValue: string): void {
  const idx = _records.findIndex((n) => n.id === idValue)
  if (idx >= 0) {
    _records.splice(idx, 1)
    broadcast()
  }
}

/**
 * Drop every notification from a source. Used for self-superseding streams like
 * launcher updates: only the newest "update ready" is actionable, so leaving the
 * previous versions' entries behind just inflates the unread badge with prompts
 * for versions the user can no longer install.
 */
export function clearBySource(source: string): number {
  let removed = 0
  for (let i = _records.length - 1; i >= 0; i--) {
    if (_records[i].source === source) {
      _records.splice(i, 1)
      removed++
    }
  }
  if (removed > 0) broadcast()
  return removed
}

export interface NotificationPrefs {
  enabled: boolean
  soundEnabled: boolean
  mutedKinds: NotifKind[]
  mutedSources: string[]
  /** [startHH, endHH] in 24h. When current hour falls in [start, end), OS toast is suppressed. */
  quietHours: [number, number] | null
}

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  soundEnabled: true,
  mutedKinds: [],
  mutedSources: [],
  quietHours: null,
}

let _prefs: NotificationPrefs = { ...DEFAULT_PREFS }

/**
 * Where the prefs are read from and written back to. Injected rather than
 * imported so this module stays free of the settings store (and testable
 * without one); `index.ts` wires it to `settings.json` at startup.
 */
export interface PrefsStorage {
  read: () => unknown
  write: (prefs: NotificationPrefs) => void
}

let _storage: PrefsStorage | null = null

const isHour = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23

const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/**
 * Rebuilds prefs field by field, keeping the default for anything missing or
 * malformed. The stored JSON is not trustworthy: "import settings" feeds it an
 * arbitrary user-supplied file, and a bad `quietHours` there would otherwise
 * reach `inQuietHours()` and throw on every notification.
 */
function sanitise(raw: unknown): NotificationPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS }
  const o = raw as Record<string, unknown>

  const q = o.quietHours
  const quietHours: [number, number] | null =
    Array.isArray(q) && q.length === 2 && isHour(q[0]) && isHour(q[1])
      ? [q[0], q[1]]
      : null

  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_PREFS.enabled,
    soundEnabled:
      typeof o.soundEnabled === 'boolean' ? o.soundEnabled : DEFAULT_PREFS.soundEnabled,
    mutedKinds: stringList(o.mutedKinds) as NotifKind[],
    mutedSources: stringList(o.mutedSources),
    quietHours,
  }
}

/**
 * Loads the persisted prefs and keeps every later change in sync. Until this
 * runs the prefs are the in-memory defaults, so call it before the first
 * notification can fire.
 */
export function setPrefsStorage(storage: PrefsStorage): void {
  _storage = storage
  try {
    _prefs = sanitise(storage.read())
  } catch (err) {
    console.error('Failed to load notification prefs, using defaults:', err)
    _prefs = { ...DEFAULT_PREFS }
  }
}

export function getPrefs(): NotificationPrefs {
  return { ..._prefs, mutedKinds: [..._prefs.mutedKinds], mutedSources: [..._prefs.mutedSources] }
}

export function setPrefs(next: Partial<NotificationPrefs>): NotificationPrefs {
  _prefs = sanitise({ ..._prefs, ...next })
  try {
    _storage?.write(getPrefs())
  } catch (err) {
    console.error('Failed to persist notification prefs:', err)
  }
  return getPrefs()
}

function broadcast(): void {
  if (!_mainWindow || _mainWindow.isDestroyed()) return
  try {
    _mainWindow.webContents.send('notifications:updated', listNotifications())
  } catch {}
}

function inQuietHours(): boolean {
  if (!_prefs.quietHours) return false
  const [start, end] = _prefs.quietHours
  const h = new Date().getHours()
  // An empty window (start === end) is not reachable from the UI — the end
  // picker disables the hour already chosen as the start. It can still arrive
  // through an imported settings file, and staying silent-off is the safe way
  // to fail: an unexpected extra notification is recoverable, a whole day of
  // swallowed ones is not.
  if (start === end) return false
  if (start < end) return h >= start && h < end
  return h >= start || h < end
}

function shouldShowOSToast(n: NotifInput): boolean {
  if (!_prefs.enabled) return false
  if (n.silent) return false
  if (_prefs.mutedKinds.includes(n.kind)) return false
  if (n.source && _prefs.mutedSources.includes(n.source)) return false
  if ((n.priority || 'normal') !== 'critical' && inQuietHours()) return false
  return true
}

export function pushNotification(input: NotifInput): NotifRecord {
  const record: NotifRecord = {
    ...input,
    id: id(),
    createdAt: new Date().toISOString(),
    read: false,
  }
  _records.push(record)
  while (_records.length > MAX) _records.shift()

  if (shouldShowOSToast(input)) {
    try {
      if (Notification.isSupported()) {
        const n = new Notification({
          title: input.title,
          body: input.body,
          silent: !_prefs.soundEnabled,
          urgency:
            input.priority === 'critical'
              ? 'critical'
              : input.priority === 'low'
                ? 'low'
                : 'normal',
        })
        n.on('click', () => {
          if (_mainWindow && !_mainWindow.isDestroyed()) {
            if (_mainWindow.isMinimized()) _mainWindow.restore()
            _mainWindow.focus()
            try {
              _mainWindow.webContents.send('notifications:clicked', record)
            } catch {}
          }
        })
        n.show()
      }
    } catch (err) {
      console.error('Failed to show OS notification:', err)
    }
  }

  broadcast()
  return record
}

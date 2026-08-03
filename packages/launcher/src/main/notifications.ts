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

interface NotificationPrefs {
  enabled: boolean
  soundEnabled: boolean
  mutedKinds: NotifKind[]
  mutedSources: string[]
  /** [startHH, endHH] in 24h. When current hour falls in [start, end), OS toast is suppressed. */
  quietHours: [number, number] | null
}

let _prefs: NotificationPrefs = {
  enabled: true,
  soundEnabled: true,
  mutedKinds: [],
  mutedSources: [],
  quietHours: null,
}

export function getPrefs(): NotificationPrefs {
  return { ..._prefs, mutedKinds: [..._prefs.mutedKinds], mutedSources: [..._prefs.mutedSources] }
}

export function setPrefs(next: Partial<NotificationPrefs>): NotificationPrefs {
  _prefs = { ..._prefs, ...next }
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

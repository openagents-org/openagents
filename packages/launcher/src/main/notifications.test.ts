import { beforeEach, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => ({
  toasts: [] as Array<{ handlers: Record<string, () => void>; show: ReturnType<typeof vi.fn> }>,
}))

vi.mock('electron', () => ({
  Notification: class {
    static isSupported() { return true }
    handlers: Record<string, () => void> = {}
    show = vi.fn()
    constructor() { fakes.toasts.push(this) }
    on(name: string, cb: () => void) { this.handlers[name] = cb }
  },
}))

import { pushNotification, setNotificationsWindow } from './notifications'

beforeEach(() => { fakes.toasts.length = 0 })

it('reveals a tray-hidden window and forwards the clicked notification', () => {
  const window = {
    isDestroyed: () => false, isVisible: () => false, isMinimized: () => false,
    show: vi.fn(), restore: vi.fn(), focus: vi.fn(),
    webContents: { send: vi.fn() },
  }
  setNotificationsWindow(window as never)
  const record = pushNotification({ kind: 'agent_finished', title: 'Agent', body: 'Done' })
  fakes.toasts[0].handlers.click()
  expect(window.show).toHaveBeenCalledOnce()
  expect(window.focus).toHaveBeenCalledOnce()
  expect(window.webContents.send).toHaveBeenCalledWith('notifications:clicked', record)
  setNotificationsWindow(null)
})

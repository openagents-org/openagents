import { beforeEach, describe, expect, it } from 'vitest'
import { readAppEntry, readDeviceOnly, rememberAppEntry, rememberDeviceOnly } from './app-entry'

describe('desktop entry', () => {
  beforeEach(() => localStorage.clear())
  it('opens Workspace unless This Computer was last used', () => {
    expect(readAppEntry()).toBe('workspace')
    rememberAppEntry('launcher')
    expect(readAppEntry()).toBe('launcher')
    rememberAppEntry('workspace')
    expect(readAppEntry()).toBe('workspace')
  })
  it('keeps a device-only computer on This Computer', () => {
    rememberAppEntry('workspace')
    rememberDeviceOnly(true)
    expect(readDeviceOnly()).toBe(true)
    expect(readAppEntry()).toBe('launcher')
    rememberDeviceOnly(false)
    expect(readDeviceOnly()).toBe(false)
    expect(readAppEntry()).toBe('workspace')
  })
  it('does not let invalid stored modes strand the app', () => {
    localStorage.setItem('openagents:last-area', 'missing-screen')
    expect(readAppEntry()).toBe('workspace')
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { readAppEntry, rememberAppEntry } from './app-entry'

describe('desktop entry', () => {
  beforeEach(() => localStorage.clear())
  it('opens Workspace unless This Computer was last used', () => {
    expect(readAppEntry()).toBe('workspace')
    rememberAppEntry('launcher')
    expect(readAppEntry()).toBe('launcher')
    rememberAppEntry('workspace')
    expect(readAppEntry()).toBe('workspace')
  })
  it('does not let invalid stored modes strand the app', () => {
    localStorage.setItem('openagents:last-area', 'missing-screen')
    expect(readAppEntry()).toBe('workspace')
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { readAppEntry, rememberAppEntry } from './app-entry'

describe('desktop entry', () => {
  beforeEach(() => localStorage.clear())
  it('welcomes a new user and opens Workspace for a returning account', () => {
    expect(readAppEntry(false)).toBe('welcome')
    expect(readAppEntry(true)).toBe('workspace')
  })
  it('restores local management with or without an account', () => {
    rememberAppEntry('launcher')
    expect(readAppEntry(false)).toBe('launcher')
    expect(readAppEntry(true)).toBe('launcher')
  })
  it('keeps an expired Workspace session on its sign-in path', () => {
    rememberAppEntry('workspace')
    expect(readAppEntry(false)).toBe('workspace')
  })
  it('does not let invalid stored modes strand the app', () => {
    localStorage.setItem('openagents:last-area', 'missing-screen')
    expect(readAppEntry(false)).toBe('welcome')
  })
})

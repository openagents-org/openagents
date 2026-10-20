import { describe, expect, it } from 'vitest'

import { duplicateOf, findTab, neighbourAfterClose, routeWorkspace } from './workspace-tabs'
import { shortcutTab } from '../shared/workspace-view'

const tab = (origin: string, aliases: string[], workspaceId: string | null = null) =>
  ({ origin, aliases: new Set(aliases), workspaceId })

describe('workspace tab rules', () => {
  it('reads the workspace a route belongs to', () => {
    expect(routeWorkspace('/')).toBeNull()
    expect(routeWorkspace('/acme/settings?x=1')).toBe('acme')
    expect(routeWorkspace('/invite/abc')).toBeUndefined()
    expect(routeWorkspace('//evil.example')).toBeUndefined()
    expect(routeWorkspace('acme')).toBeUndefined()
    expect(routeWorkspace('/%E0%A4%A')).toBeUndefined()
    expect(routeWorkspace(42)).toBeUndefined()
  })
  it('matches a tab by any of its names, on its own deployment only', () => {
    const tabs = [tab('https://a.test', ['acme'], 'ws_1')]
    expect(findTab(tabs, 'acme', 'https://a.test')).toBe(tabs[0])
    expect(findTab(tabs, 'ws_1', 'https://a.test')).toBe(tabs[0])
    expect(findTab(tabs, 'acme', 'https://b.test')).toBeUndefined()
  })
  it('finds the tab already holding the same workspace', () => {
    const tabs = [tab('o', ['acme'], 'ws_1'), tab('o', ['ws_1'], 'ws_1'), tab('p', ['x'], 'ws_1')]
    expect(duplicateOf(tabs, tabs[1])).toBe(tabs[0])
    expect(duplicateOf(tabs, tabs[2])).toBeUndefined()
  })
  it('closes to the right, then the left, then nothing', () => {
    expect(neighbourAfterClose(['a', 'b', 'c'], 'b')).toBe('c')
    expect(neighbourAfterClose(['a', 'b'], 'b')).toBe('a')
    expect(neighbourAfterClose(['a'], 'a')).toBeNull()
  })
  it('maps ⌘1–⌘8 to that tab and ⌘9 to the last, Ctrl off macOS', () => {
    const order = ['a', 'b', 'c']
    const key = (k: string, mods: Partial<{ meta: boolean; control: boolean; shift: boolean }>) =>
      ({ type: 'keyDown', key: k, meta: false, control: false, shift: false, alt: false, ...mods })
    expect(shortcutTab(key('2', { meta: true }), 'darwin', order)).toBe('b')
    expect(shortcutTab(key('9', { meta: true }), 'darwin', order)).toBe('c')
    expect(shortcutTab(key('5', { meta: true }), 'darwin', order)).toBeNull()
    expect(shortcutTab(key('1', { control: true }), 'darwin', order)).toBeNull()
    expect(shortcutTab(key('1', { control: true }), 'win32', order)).toBe('a')
    expect(shortcutTab(key('1', { control: true, shift: true }), 'win32', order)).toBeNull()
  })
})

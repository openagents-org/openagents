import { describe, expect, it } from 'vitest'

import { duplicateOf, findTab, neighbourAfterClose, routeWorkspace } from './workspace-tabs'
import { shortcutTab, visibleTabs } from '../shared/workspace-view'

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
  it('shows five tabs, swapping the active one into the last slot', () => {
    const tabs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({ id }))
    const ids = (active: string | null) => visibleTabs(tabs, active).map((t) => t.id)
    expect(ids('b')).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(ids('g')).toEqual(['a', 'b', 'c', 'd', 'g'])
    expect(ids('home')).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(visibleTabs(tabs.slice(0, 3), 'a')).toHaveLength(3)
    // A narrow window shows fewer, still keeping the active one.
    expect(visibleTabs(tabs, 'g', 2).map((t) => t.id)).toEqual(['a', 'g'])
    expect(visibleTabs(tabs, 'a', 0).map((t) => t.id)).toEqual(['a'])
  })
})

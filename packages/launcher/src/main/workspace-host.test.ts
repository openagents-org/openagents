import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

type Listener = (...args: unknown[]) => void
function makeContents() {
  const listeners = new Map<string, Listener[]>()
  const contents = {
    url: '',
    destroyed: false,
    loadURL: vi.fn(async (url: string) => { contents.url = url }),
    getURL: vi.fn(() => contents.url),
    getUserAgent: vi.fn(() => 'test'), setUserAgent: vi.fn(), setWindowOpenHandler: vi.fn(),
    on: vi.fn((name: string, fn: Listener) => { listeners.set(name, [...(listeners.get(name) ?? []), fn]) }),
    emit: (name: string, ...args: unknown[]) => listeners.get(name)?.forEach((fn) => fn(...args)),
    close: vi.fn(() => { contents.destroyed = true }),
    isDestroyed: () => contents.destroyed,
    send: vi.fn(), reload: vi.fn(),
  }
  return contents
}
const fakes = vi.hoisted(() => ({
  views: [] as Array<{ webContents: ReturnType<typeof makeContents>; setBounds: ReturnType<typeof vi.fn> }>,
  clearStorageData: vi.fn(async () => {}), bundle: true, packaged: false,
}))
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', get isPackaged() { return fakes.packaged } },
  session: { fromPartition: () => ({ clearStorageData: fakes.clearStorageData }) },
  WebContentsView: class {
    webContents = makeContents()
    setBounds = vi.fn()
    constructor() { fakes.views.push(this as never) }
    setBackgroundColor() {}
  },
}))
vi.mock('./workspace-bundle', () => ({
  allowBundleApiAccess: vi.fn(), bundleExists: () => fakes.bundle,
  workspaceBundleUrl: (route: string) => `openagents://workspace/index.html#${route}`,
  WORKSPACE_SCHEME: 'openagents', WORKSPACE_HOST: 'workspace', WORKSPACE_PARTITION: 'persist:workspace',
}))
vi.mock('./web-security', () => ({ openExternalSafely: vi.fn() }))
vi.mock('./bootstrap/startup-log', () => ({ slog: vi.fn() }))
import { WorkspaceHost } from './workspace-host'
import { WORKSPACE_BUNDLE_MISSING } from '../shared/workspace-view'

const bounds = { x:0, y:40, width:1100, height:760 }
function makeHost() {
  const win = { webContents:{ on:vi.fn() }, contentView:{ addChildView:vi.fn(), removeChildView:vi.fn() } }
  const onTabsChanged = vi.fn()
  const host = new WorkspaceHost({ getWindow:() => win as never, endpoint:() => undefined, session:() => null, onExternalLogin:vi.fn(), onTabsChanged })
  return Object.assign(host, { win, onTabsChanged })
}
const contents = (i: number) => fakes.views[i].webContents
const last = (host: ReturnType<typeof makeHost>) => host.onTabsChanged.mock.calls.at(-1)![0]
/** Let loadURL's promise settle, as a finished load would. */
const settle = () => new Promise((resolve) => setTimeout(resolve))

beforeEach(() => {
  vi.clearAllMocks()
  fakes.views.length = 0
  fakes.bundle = true
  fakes.packaged = false
  fakes.clearStorageData.mockImplementation(async () => {})
})

describe('shared workspace host', () => {
  it('opens a notification thread and reopens it on a repeated click', () => {
    const host = makeHost()
    host.show('team', bounds, null, 'thread/one')
    expect(contents(0).loadURL).toHaveBeenCalledWith(
      'openagents://workspace/index.html#/team?thread=thread%2Fone',
    )
    host.show('team', bounds, null, 'thread/one')
    expect(contents(0).loadURL).toHaveBeenCalledTimes(2)
    expect(fakes.views).toHaveLength(1)
  })
  it('keeps the current workspace access token when opening a notification thread', () => {
    const host = makeHost()
    host.show('team', bounds, 'device-secret')
    host.show('team', bounds, null, 'thread')
    expect(contents(0).loadURL).toHaveBeenLastCalledWith(
      'openagents://workspace/index.html#/team?token=device-secret&thread=thread',
    )
  })
  it('resumes on first load and preserves the live page when returning from local management', () => {
    const host = makeHost()
    host.show(null, bounds)
    expect(contents(0).loadURL).toHaveBeenCalledWith('openagents://workspace/index.html#/?desktop_resume=1')
    host.hide(); host.show(null, bounds)
    expect(contents(0).loadURL).toHaveBeenCalledTimes(1)
  })
  it('explicit workspace home navigation never reopens the last workspace', () => {
    const host = makeHost()
    host.openHome(); host.show(null, bounds)
    expect(contents(0).url).toBe('openagents://workspace/index.html#/')
    contents(0).url = 'openagents://workspace/index.html#/invite/abc'
    host.openHome()
    expect(contents(0).url).toBe('openagents://workspace/index.html#/')
  })
  it('only gives native capabilities to the owned local workspace contents', () => {
    const host = makeHost(); host.show(null, bounds)
    expect(host.isWorkspaceSender(contents(0) as never)).toBe(true)
    expect(host.isWorkspaceSender({ getURL:() => contents(0).url } as never)).toBe(false)
    contents(0).url = 'https://openagents.org/login'
    expect(host.isWorkspaceSender(contents(0) as never)).toBe(false)
  })
  it('destroys every view and clears their stored session on sign-out', async () => {
    const host = makeHost(); host.show(null, bounds); host.show('team', bounds)
    await host.signOut()
    expect(contents(0).close).toHaveBeenCalledOnce()
    expect(contents(1).close).toHaveBeenCalledOnce()
    expect(fakes.clearStorageData).toHaveBeenCalledOnce()
    expect(last(host)).toEqual({ tabs: [], active: null, home: null })
  })
  it('reports the storage wipe as finished only once it has', async () => {
    let wiped!: () => void
    fakes.clearStorageData.mockImplementationOnce(() => new Promise<void>(resolve => { wiped = resolve }))
    const host = makeHost(); host.show(null, bounds)
    let cleared = false
    const signingOut = host.signOut()
    void host.whenCleared().then(() => { cleared = true })
    await Promise.resolve()
    expect(cleared).toBe(false)
    wiped()
    await signingOut
    await Promise.resolve()
    expect(cleared).toBe(true)
  })
  it('never reads a session back out of the page', () => {
    const host = makeHost(); host.show(null, bounds)
    const events = contents(0).on.mock.calls.map(([name]) => name)
    expect(events).not.toContain('did-navigate')
    expect(events).not.toContain('did-navigate-in-page')
  })
  it('pushes a renewed session to every loaded page, hidden tabs included', () => {
    const host = makeHost(); host.show('a', bounds); host.show('b', bounds)
    const session = { token:'renewed', email:'person@example.test', displayName:null, expiresAt:1 }
    host.sendSession(session)
    expect(contents(0).send).toHaveBeenCalledWith('workspace-view:session', session)
    expect(contents(1).send).toHaveBeenCalledWith('workspace-view:session', session)
  })
  it('repeats a launcher notice only in the page on screen', () => {
    const host = makeHost()
    const notice = { message:'Opened in your browser', type:'info' }
    host.show('a', bounds); host.hide()
    host.sendNotice(notice)
    expect(contents(0).send).not.toHaveBeenCalled()
    host.show('b', bounds)
    host.sendNotice(notice)
    expect(contents(0).send).not.toHaveBeenCalled()
    expect(contents(1).send).toHaveBeenCalledExactlyOnceWith('workspace-view:notice', notice)
  })
  it('refuses to stand the hosted app in for a missing bundle in an installed app', () => {
    fakes.bundle = false
    fakes.packaged = true
    const host = makeHost()
    expect(() => host.show('team', bounds)).toThrow(WORKSPACE_BUNDLE_MISSING)
    expect(fakes.views).toHaveLength(0)
  })
  it('falls back to the hosted app in a dev checkout without a bundle', () => {
    fakes.bundle = false
    const host = makeHost()
    host.show('team', bounds)
    expect(contents(0).loadURL).toHaveBeenCalledWith('https://workspace.openagents.org/team')
  })
})

describe('workspace tabs', () => {
  it('keeps each workspace in its own live view and switches without reloading', () => {
    const host = makeHost()
    host.show('a', bounds, null, null, 'Alpha')
    host.show('b', bounds)
    expect(fakes.views).toHaveLength(2)
    expect(host.win.contentView.removeChildView).toHaveBeenCalledWith(fakes.views[0])
    host.show('a', bounds)
    expect(fakes.views).toHaveLength(2)
    expect(contents(0).loadURL).toHaveBeenCalledTimes(1)
    expect(host.win.contentView.addChildView).toHaveBeenLastCalledWith(fakes.views[0])
    expect(last(host).tabs.map((t: { title: string }) => t.title)).toEqual(['Alpha', 'b'])
    expect(last(host).active).toBe(last(host).tabs[0].id)
  })
  it('never puts an access token in what the strip is told', () => {
    const host = makeHost(); host.show('a', bounds, 'device-secret')
    expect(JSON.stringify(last(host))).not.toContain('device-secret')
  })
  it('closes to the right-hand neighbour, then the left, then All Workspaces', () => {
    const host = makeHost()
    host.show('a', bounds); host.show('b', bounds); host.show('c', bounds)
    const [a, b, c] = last(host).tabs.map((t: { id: string }) => t.id)
    host.activate(b); host.close(b)
    expect(last(host).active).toBe(c)
    expect(contents(1).close).toHaveBeenCalledOnce()
    host.close(c)
    expect(last(host).active).toBe(a)
    host.close(a)
    expect(last(host)).toMatchObject({ tabs: [], active: 'home' })
    expect(contents(3).url).toBe('openagents://workspace/index.html#/')
  })
  it('moves a tab to where it is dropped, keeping the one showing', () => {
    const host = makeHost()
    for (const name of ['a', 'b', 'c']) host.show(name, bounds)
    const [a, b, c] = last(host).tabs.map((t: { id: string }) => t.id)
    host.move(c, 0)
    expect(last(host).tabs.map((t: { id: string }) => t.id)).toEqual([c, a, b])
    host.move(c, 99)
    expect(last(host).tabs.map((t: { id: string }) => t.id)).toEqual([a, b, c])
    expect(last(host).active).toBe(c)
  })
  it('closes other tabs, tabs to the right and all tabs as Chrome does', () => {
    const host = makeHost()
    for (const name of ['a', 'b', 'c', 'd']) host.show(name, bounds)
    const [a, b, c, d] = last(host).tabs.map((t: { id: string }) => t.id)
    // Right of b while d is showing: d goes, so the tab clicked comes forward.
    host.closeMany([c, d], b)
    expect(last(host).tabs.map((t: { id: string }) => t.id)).toEqual([a, b])
    expect(last(host).active).toBe(b)
    // Others of a while b is showing.
    host.closeMany([b], a)
    expect(last(host)).toMatchObject({ active: a, tabs: [{ id: a }] })
    host.closeMany([a], null)
    expect(last(host)).toMatchObject({ tabs: [], active: 'home' })
    expect(fakes.views.slice(0, 4).every((v) => v.webContents.close.mock.calls.length === 1)).toBe(true)
  })
  it('closing a background tab leaves the current one on screen', () => {
    const host = makeHost()
    host.show('a', bounds); host.show('b', bounds)
    const [a, b] = last(host).tabs.map((t: { id: string }) => t.id)
    host.win.contentView.addChildView.mockClear()
    host.close(a)
    expect(last(host).active).toBe(b)
    expect(host.win.contentView.addChildView).not.toHaveBeenCalled()
  })
  it('opens a workspace picked from the All Workspaces page in its own tab', () => {
    const host = makeHost(); host.show(null, bounds)
    host.openRoute(contents(0) as never, '/acme')
    expect(fakes.views).toHaveLength(2)
    expect(contents(1).loadURL).toHaveBeenCalledWith('openagents://workspace/index.html#/acme')
    // Picking it again only brings the tab forward.
    host.activate('home')
    host.openRoute(contents(0) as never, '/acme')
    expect(fakes.views).toHaveLength(2)
    expect(last(host).active).toBe(last(host).tabs[0].id)
  })
  it('walks an open tab to a deeper route in place, and refuses routes that are not a workspace', () => {
    const host = makeHost(); host.show(null, bounds); host.show('acme', bounds)
    host.openRoute(contents(0) as never, '/acme/settings/members')
    expect(contents(1).send).toHaveBeenCalledWith('workspace-view:navigate', '/acme/settings/members')
    host.openRoute(contents(1) as never, '//evil.example')
    host.openRoute(contents(1) as never, '/invite/abc')
    host.openRoute({} as never, '/other')
    expect(fakes.views).toHaveLength(2)
    host.openRoute(contents(1) as never, '/')
    expect(last(host).active).toBe('home')
  })
  it('names a tab from its page and folds the same workspace opened twice into one tab', () => {
    const host = makeHost()
    host.show('acme', bounds); host.show('ws_1', bounds)
    host.reportWorkspace(contents(0) as never, { id:'ws_1', slug:'acme', name:'Acme' })
    expect(last(host).tabs.map((t: { title: string }) => t.title)).toEqual(['Acme', 'ws_1'])
    host.reportWorkspace(contents(1) as never, { id:'ws_1', slug:'acme', name:'Acme' })
    expect(last(host).tabs).toHaveLength(1)
    expect(contents(1).close).toHaveBeenCalledOnce()
    expect(host.scopeFor(contents(0) as never)).toEqual({ kind:'workspace', aliases:['acme', 'ws_1'] })
  })
  it('takes a failed page off screen for its retry and leaves the other tabs alone', async () => {
    const host = makeHost()
    host.show('a', bounds)
    host.show('b', bounds)
    contents(1).loadURL.mockRejectedValueOnce(Object.assign(new Error('boom'), { code:'ERR_FAILED' }))
    const b = last(host).tabs[1].id
    host.retry(b)
    await settle()
    expect(last(host).tabs[1].state).toBe('failed')
    expect(host.win.contentView.removeChildView).toHaveBeenLastCalledWith(fakes.views[1])
    expect(last(host).tabs[0].state).toBe('ready')
    host.retry(b)
    await settle()
    expect(last(host).tabs[1].state).toBe('ready')
    expect(host.win.contentView.addChildView).toHaveBeenLastCalledWith(fakes.views[1])
  })
  it('switches tabs from ⌘1–⌘9 pressed inside a page', () => {
    const platform = process.platform
    Object.defineProperty(process, 'platform', { value:'darwin', configurable:true })
    onTestFinished(() => { Object.defineProperty(process, 'platform', { value:platform, configurable:true }) })
    const host = makeHost()
    host.show('a', bounds); host.show('b', bounds); host.show('c', bounds)
    const ids = last(host).tabs.map((t: { id: string }) => t.id)
    const preventDefault = vi.fn()
    const key = (k: string, extra = {}) => ({ type:'keyDown', key:k, meta:true, control:false, shift:false, alt:false, ...extra })
    contents(2).emit('before-input-event', { preventDefault }, key('1'))
    expect(last(host).active).toBe(ids[0])
    contents(0).emit('before-input-event', { preventDefault }, key('9'))
    expect(last(host).active).toBe(ids[2])
    contents(2).emit('before-input-event', { preventDefault }, key('2', { shift:true }))
    expect(last(host).active).toBe(ids[2])
    expect(preventDefault).toHaveBeenCalledTimes(2)
  })
})

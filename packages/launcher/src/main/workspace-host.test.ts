import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => {
  const contents = {
    url: '',
    loadURL: vi.fn(async (_url: string) => {}), getURL: vi.fn(() => ''),
    getUserAgent: vi.fn(() => 'test'), setUserAgent: vi.fn(), setWindowOpenHandler: vi.fn(),
    on: vi.fn(), close: vi.fn(), send: vi.fn(), reload: vi.fn(),
  }
  return { contents, clearStorageData: vi.fn(async () => {}), setBounds: vi.fn(), bundle: true, packaged: false }
})
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', get isPackaged() { return fakes.packaged } },
  session: { fromPartition: () => ({ clearStorageData: fakes.clearStorageData }) },
  WebContentsView: class { webContents = fakes.contents; setBounds = fakes.setBounds; setBackgroundColor() {} },
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
  return new WorkspaceHost({ getWindow:() => win as never, endpoint:() => undefined, session:() => null, onExternalLogin:vi.fn() })
}
beforeEach(() => {
  vi.clearAllMocks()
  fakes.bundle = true
  fakes.packaged = false
  fakes.contents.url = ''
  fakes.contents.loadURL.mockImplementation(async url => { fakes.contents.url = url })
  fakes.contents.getURL.mockImplementation(() => fakes.contents.url)
  fakes.clearStorageData.mockImplementation(async () => {})
})

describe('shared workspace host', () => {
  it('resumes on first load and preserves the live page when returning from local management', () => {
    const host = makeHost()
    host.show(null, bounds)
    expect(fakes.contents.loadURL).toHaveBeenCalledWith('openagents://workspace/index.html#/?desktop_resume=1')
    fakes.contents.url = 'openagents://workspace/index.html#/team/settings/devices'
    host.hide(); host.show(null, bounds)
    expect(fakes.contents.loadURL).toHaveBeenCalledTimes(1)
  })
  it('explicit workspace home navigation never reopens the last workspace', () => {
    const host = makeHost()
    host.openHome(); host.show(null, bounds)
    expect(fakes.contents.url).toBe('openagents://workspace/index.html#/')
    fakes.contents.url = 'openagents://workspace/index.html#/team'
    host.openHome()
    expect(fakes.contents.url).toBe('openagents://workspace/index.html#/')
  })
  it('only gives native capabilities to the owned local workspace contents', () => {
    const host = makeHost(); host.show(null, bounds)
    expect(host.isWorkspaceSender(fakes.contents as never)).toBe(true)
    expect(host.isWorkspaceSender({ getURL:() => fakes.contents.url } as never)).toBe(false)
    fakes.contents.url = 'https://openagents.org/login'
    expect(host.isWorkspaceSender(fakes.contents as never)).toBe(false)
  })
  it('destroys the view and clears its stored session on sign-out', async () => {
    const host = makeHost(); host.show(null, bounds)
    await host.signOut()
    expect(fakes.contents.close).toHaveBeenCalledOnce()
    expect(fakes.clearStorageData).toHaveBeenCalledOnce()
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
    const events = fakes.contents.on.mock.calls.map(([name]) => name)
    expect(events).not.toContain('did-navigate')
    expect(events).not.toContain('did-navigate-in-page')
  })
  it('pushes a renewed session to the loaded page', () => {
    const host = makeHost(); host.show(null, bounds)
    const session = { token:'renewed', email:'person@example.test', displayName:null, expiresAt:1 }
    host.sendSession(session)
    expect(fakes.contents.send).toHaveBeenCalledWith('workspace-view:session', session)
  })
  it('repeats a launcher notice only while the page is on screen', () => {
    const host = makeHost()
    const notice = { message:'Opened in your browser', type:'info' }
    host.show(null, bounds); host.hide()
    host.sendNotice(notice)
    expect(fakes.contents.send).not.toHaveBeenCalled()
    host.show(null, bounds)
    host.sendNotice(notice)
    expect(fakes.contents.send).toHaveBeenCalledExactlyOnceWith('workspace-view:notice', notice)
  })
  it('refuses to stand the hosted app in for a missing bundle in an installed app', () => {
    fakes.bundle = false
    fakes.packaged = true
    const host = makeHost()
    expect(() => host.show('team', bounds)).toThrow(WORKSPACE_BUNDLE_MISSING)
    expect(fakes.contents.loadURL).not.toHaveBeenCalled()
  })
  it('falls back to the hosted app in a dev checkout without a bundle', () => {
    fakes.bundle = false
    const host = makeHost()
    host.show('team', bounds)
    expect(fakes.contents.loadURL).toHaveBeenCalledWith('https://workspace.openagents.org/team')
  })
})

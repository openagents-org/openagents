// Shared Workspace bundle with synthetic API data and a simulated desktop host.
// Build first: npm run build. No device is paired and no agent is installed.
import { test, expect, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { previewFixture } from '../scripts/workspace-preview/fixture.mjs'

let server: Server
let origin: string
test.use({ viewport: { width: 1280, height: 850 } })
test.setTimeout(45_000)
test.beforeAll(async () => {
  const bundle = path.resolve('../../workspace/frontend/dist-desktop')
  if (!existsSync(path.join(bundle, 'index.html'))) throw Error('Run npm run build first')
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost')
    const file = path.resolve(bundle, '.' + (url.pathname === '/' ? '/index.html' : url.pathname))
    if (!file.startsWith(bundle + path.sep) || !existsSync(file)) { res.writeHead(404).end(); return }
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream')
    res.end(readFileSync(file))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://localhost:${(server.address() as { port: number }).port}`
})
test.afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
})

async function openOnboarding(page: Page, options: {
  web?: boolean; paired?: boolean; offline?: boolean; failConnect?: boolean; member?: boolean; warning?: boolean;
} = {}) {
  const fixture = previewFixture('en')
  const state = { paired: !!options.paired, online: !options.offline, connects: 0, codes: 0, openedComputer: 0, commands: [] as { nodeId: string; action: string; args: Record<string, unknown> }[], errors: [] as string[] }
  const info = () => ({ hostname: 'Review laptop', deviceType: 'laptop', nodeId: state.paired ? 'this-computer' : null, warning: !!options.warning })
  const node = (id: string, name: string) => ({ nodeId: id, name, hostname: name, deviceType: 'laptop', status: id === 'this-computer' && !state.online ? 'offline' : 'online', agents: [], runtimes: [], os: 'macos', launcherVersion: '1.0.0', lastHeartbeatAt: new Date().toISOString(), createdAt: new Date().toISOString() })
  await page.exposeFunction('testComputerStatus', info)
  await page.exposeFunction('testConnectComputer', async (id: string) => {
    expect(id).toBe('preview')
    state.connects++
    if (options.failConnect && state.connects === 1) throw Error('HTTP 403')
    state.paired = true
    return info()
  })
  await page.exposeFunction('testOpenComputer', () => { state.openedComputer++ })
  await page.addInitScript(({ web }) => {
    const globals = window as any
    globals.__OA_API_URL__ = location.origin
    localStorage.setItem('oa:welcomeFilmSeen', '1')
    localStorage.setItem('theme', 'light')
    localStorage.setItem('oa_workspace_session', JSON.stringify({ token: 'test-only', email: 'alex@example.invalid', displayName: 'Alex', expiresAt: Date.now() / 1000 + 3600 }))
    if (!web) globals.__oaHost__ = {
      getComputerStatus: globals.testComputerStatus,
      connectComputer: globals.testConnectComputer,
      openComputer: globals.testOpenComputer,
      signIn() {}, signOut() {},
      appearance: { theme: 'light', locale: 'en-US' },
      setTheme() {}, setLocale() {}, onAppearance() { return () => {} },
    }
  }, { web: !!options.web })
  page.on('pageerror', error => state.errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) { await route.abort(); return }
    if (!url.pathname.startsWith('/v1/')) { await route.continue(); return }
    const p = url.pathname
    let data: unknown
    if (p === '/v1/agent-catalog' || p.startsWith('/v1/agent-catalog/')) {
      const entry = { name: 'claude', label: 'Claude Code', description: 'Coding assistant', tags: ['cli'], builtin: false, homepage: '', install_command: '', models: [] }
      await route.fulfill({ json: { data: p === '/v1/agent-catalog' ? [entry] : entry } }); return
    }
    if (/^\/v1\/nodes\/[^/]+\/commands$/.test(p)) {
      if (route.request().method() === 'POST') {
        const command = { nodeId: p.split('/')[3], ...route.request().postDataJSON() }
        state.commands.push(command)
        await route.fulfill({ json: { data: { commandId: 'test-command', status: 'pending' } } })
      } else await route.fulfill({ json: { data: [] } })
      return
    }
    if (p === '/v1/events/stream') { await route.fulfill({ body: ': test\n\n', contentType: 'text/event-stream' }); return }
    if (p === '/v1/discover') data = { agents: [], channels: [], mods: [], resources: [] }
    else if (p === '/v1/events') data = { events: [], has_more: false }
    else if (p === '/v1/nodes') data = options.web
      ? (state.paired ? [node('remote-device', 'Remote laptop')] : [])
      : [node('other-device', 'Other device'), ...(state.paired ? [node('this-computer', 'Review laptop')] : [])]
    else if (p.endsWith('/pairing-codes')) { state.codes++; data = { code: 'TEST-CODE', expiresInSeconds: 1800 } }
    else if (p.endsWith('/me')) data = { authenticated: true, email: 'alex@example.invalid', role: options.member ? 'member' : 'owner', effectiveRole: options.member ? 'member' : 'owner' }
    else if (p === '/v1/cloud-agents/providers') data = { providers: [] }
    else if (p === '/v1/cloud-agents') data = { cloud_agents: [] }
    else if (p === '/v1/model-access') data = []
    else data = fixture.response(url, route.request().method())
    await route.fulfill({ json: { data } })
  })
  await page.goto(`${origin}/#/preview?token=test-only`)
  return state
}

test('desktop connects only on request and opens the agent picker for this computer', async ({ page }, testInfo) => {
  const state = await openOnboarding(page)
  await expect(page.getByText('Review laptop', { exact: true })).toBeVisible()
  expect(state.connects).toBe(0)
  expect(state.codes).toBe(0)
  await expect(page.getByText('Get the launcher on your device')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('connect-this-computer.png') })
  await page.getByRole('button', { name: 'Connect this computer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Add an agent', exact: true })).toBeVisible()
  expect(state.connects).toBe(1)
  expect(state.codes).toBe(0)
  expect(state.errors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('add-agent.png') })
})

test('an already connected computer skips pairing', async ({ page }) => {
  const state = await openOnboarding(page, { paired: true })
  await expect(page.getByRole('heading', { name: 'Add an agent', exact: true })).toBeVisible()
  expect(state.connects).toBe(0)
  expect(state.codes).toBe(0)
  expect(state.errors).toEqual([])
})

test('connection errors can be retried', async ({ page }) => {
  const state = await openOnboarding(page, { failConnect: true })
  const connect = page.getByRole('button', { name: 'Connect this computer', exact: true })
  await connect.click()
  await expect(page.getByRole('alert')).toContainText('Could not connect this computer')
  await connect.click()
  await expect(page.getByRole('heading', { name: 'Add an agent', exact: true })).toBeVisible()
  expect(state.connects).toBe(2)
})

test('an offline computer stays in onboarding until that exact device is online', async ({ page }) => {
  await page.clock.install()
  const state = await openOnboarding(page, { paired: true, offline: true })
  await expect(page.getByRole('button', { name: 'Waiting for this computer to come online…' })).toBeVisible()
  await page.clock.fastForward(31_000)
  await expect(page.getByRole('alert')).toContainText('has not come online yet')
  expect(state.connects).toBe(0)
  await page.getByRole('button', { name: 'Open This Computer', exact: true }).click()
  expect(state.openedComputer).toBe(1)
  state.online = true
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByRole('heading', { name: 'Add an agent', exact: true })).toBeVisible()
})

test('another device keeps the pairing flow even with an existing workspace device', async ({ page }) => {
  const state = await openOnboarding(page)
  await page.getByRole('button', { name: 'Connect remote device' }).click()
  await expect(page.getByText('TEST-CODE', { exact: true })).toBeVisible()
  await expect(page.getByText('Get the launcher on your device')).toBeVisible()
  expect(state.connects).toBe(0)
  expect(state.codes).toBe(1)
})

test('browser onboarding keeps the existing download and pairing instructions', async ({ page }) => {
  const state = await openOnboarding(page, { web: true })
  await expect(page.getByText('TEST-CODE', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect this computer', exact: true })).toHaveCount(0)
  await expect(page.getByText('Get the launcher on your device')).toBeVisible()
  expect(state.codes).toBe(1)
})

test('members see the permission requirement without pairing', async ({ page }) => {
  const state = await openOnboarding(page, { member: true })
  await expect(page.getByText('An owner or admin of this workspace needs to connect this computer.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect this computer', exact: true })).toBeDisabled()
  expect(state.connects).toBe(0)
  expect(state.codes).toBe(0)
})


test('shared Workspace editor sends creation to the chosen device exactly once', async ({ page }) => {
  const state = await openOnboarding(page, { paired: true })
  await page.getByRole('button', { name: /Claude Code.*Add/ }).click()
  await expect(page.getByText(/Runs on: This Computer/)).toBeVisible()
  await page.getByRole('textbox', { name: 'Agent name', exact: true }).fill('workspace-helper')
  await page.getByRole('button', { name: 'Add an agent', exact: true }).click()
  await expect.poll(() => state.commands.length).toBe(1)
  expect(state.commands[0]).toEqual({ nodeId: 'this-computer', action: 'create_agent', args: { name: 'workspace-helper', type: 'claude' } })
  expect(state.errors).toEqual([])
})

test('browser creates an agent on a remote device without desktop capabilities', async ({ page }) => {
  const state = await openOnboarding(page, { web: true, paired: true })
  await expect(page.getByRole('heading', { name: 'Add an agent', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cloud Agents', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Manual Connection', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Claude Code.*Add/ }).click()
  await expect(page.getByText(/Runs on: Remote laptop/)).toBeVisible()
  await page.getByRole('textbox', { name: 'Agent name', exact: true }).fill('browser-helper')
  await page.getByRole('button', { name: 'Add an agent', exact: true }).click()
  await expect.poll(() => state.commands.length).toBe(1)
  expect(state.commands[0]).toEqual({ nodeId: 'remote-device', action: 'create_agent', args: { name: 'browser-helper', type: 'claude' } })
  expect(state.connects).toBe(0)
  expect(state.openedComputer).toBe(0)
  expect(state.errors).toEqual([])
})

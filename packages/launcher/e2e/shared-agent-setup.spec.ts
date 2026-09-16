// Exercise the built launcher UI with an isolated, in-memory local backend.
// Every external request is blocked; no real agent, account, or credential is used.
import { test, expect, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
let server: Server
let origin: string
test.setTimeout(60_000)
test.use({ viewport: { width: 1280, height: 900 } })
test.beforeAll(async () => {
  const bundle = path.resolve('out/renderer')
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
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })

async function openComputer(page: Page, existing = false) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await page.addInitScript(({ existing }) => {
    const globals = window as any
    localStorage.setItem('openagents:last-area', 'launcher')
    localStorage.setItem('launcher:last-tab', 'dashboard')
    localStorage.setItem('onboarding_completed', 'true')
    localStorage.setItem('guided_tour_completed', 'true')
    localStorage.setItem('launcher:theme-mode', 'light')
    const calls: { method: string; args: unknown[] }[] = []
    const agents: any[] = existing ? [{ name: 'desk-helper', type: 'claude', state: 'stopped', path: '/review/project', health: { ready: true }, network: null }] : []
    const node = { hostname: 'Review laptop', deviceType: 'laptop', connected: false, nodeId: null, workspaces: [], revoked: [] }
    const catalog = [{ name: 'claude', label: 'Claude Code', description: 'Coding assistant', installed: true, featured: false, tags: ['cli'], check_ready: { login_command: 'claude auth login' } }]
    const env = { ANTHROPIC_API_KEY: 'test-saved-key', ANTHROPIC_MODEL: 'test-model' }
    const health = { ready: true, installed: true, logged_in: true, auth_mode: 'cli_login', version: 'test' }
    const handlers: Record<string, (...args: any[]) => unknown> = {
      getAccount: () => null,
      getSetting: (key: string) => ({ startupPage: 'dashboard', language: 'en', themeMode: 'light', lastSeenRelease: '1.0.0' } as any)[key],
      getAllSettings: () => ({}),
      getNodeStatus: () => node, refreshNodeStatus: () => node,
      listAgents: () => agents.map(a => ({ ...a })), agentStatus: () => ({}),
      getSupportedAgentTypes: () => ['claude'], getCatalog: () => catalog,
      getAgentCoreInfo: () => ({ ready: true, supportedTypes: ['claude'] }),
      healthCheck: () => health, refreshLogin: () => health,
      getEnvFields: () => [{ name: 'ANTHROPIC_API_KEY', description: 'API key', password: true }, { name: 'ANTHROPIC_MODEL', description: 'Model' }],
      getAgentEnv: () => ({ ...env }), getAgentInstanceEnv: () => ({}),
      listModels: () => ({ models: [{ id: 'test-model', label: 'Test model' }], source: 'builtin' }),
      listPaths: () => ({ home: '/review', openagentsHome: '/review/.openagents' }),
      selectDirectory: () => '/review/selected-project',
      addAgent: (config: any) => { agents.push({ ...config, state: 'stopped', health, network: null }); return { success: true } },
      saveAgentInstanceEnv: () => ({ success: true }),
      setAgentWorkingDir: (name: string, dir: string) => { agents.find(a => a.name === name).path = dir; return { success: true } },
      listWorkspaces: () => [], notificationsList: () => [], notificationsGetPrefs: () => ({}),
      getInstalledAgents: () => [], checkAgentUpdates: () => [], getChangelog: () => [],
      appVersion: () => '1.0.0', hasRunBefore: () => true, getWhatsNew: () => null,
      isFullScreen: () => false, launcherUpdateState: () => ({ status: 'idle' }),
    }
    globals.__localTest = { calls, agents }
    globals.api = new Proxy({ platform: 'darwin' }, { get(target, key: string) {
      if (key === 'platform') return target.platform
      if (/^on[A-Z]/.test(key)) return () => () => {}
      return async (...args: unknown[]) => {
        calls.push({ method: key, args })
        if (handlers[key]) return handlers[key](...args)
        if (/^(install|add|save|connect|start|stop|removeAgent)/.test(key)) throw Error(`Unexpected mutation: ${key}`)
        return null
      }
    } })
  }, { existing })
  await page.goto(origin)
  await expect(page.getByRole('heading', { name: 'Agents on this computer' })).toBeVisible()
  return errors
}

test('local setup uses the shared catalogue and stays available without an account', async ({ page }, info) => {
  const errors = await openComputer(page)
  await expect(page.getByRole('button', { name: 'Theme' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Language' })).toBeVisible()
  await expect(page.getByText('v1.0.0')).toBeVisible()
  await expect(page.getByRole('button', { name: 'More options' })).toHaveCount(0)
  await expect(page.getByText('Quick start guide')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('computer-overview.png') })
  await page.getByTestId('new-agent-open').click()
  await expect(page.getByRole('heading', { name: 'Add an agent', exact: true })).toBeVisible()
  await expect(page.getByText('Runs on: This Computer · Local use')).toBeVisible()
  await page.screenshot({ path: info.outputPath('shared-catalogue.png') })
  await page.getByRole('button', { name: /Claude Code.*Add/ }).click()
  await page.getByRole('textbox', { name: 'Agent name' }).fill('review-helper')
  await expect(page.getByRole('tab', { name: 'API key' })).toBeVisible()
  await expect(page.getByText('Verify API settings')).toBeVisible()
  await page.getByRole('button', { name: /^Browse/ }).click()
  await expect(page.getByRole('textbox', { name: /Working directory/ })).toHaveValue('/review/selected-project')
  await page.screenshot({ path: info.outputPath('shared-configuration.png') })
  await page.getByRole('button', { name: 'Add an agent', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('review-helper')
  const calls = await page.evaluate(() => (window as any).__localTest.calls)
  expect(calls.filter((c: any) => c.method === 'addAgent')).toHaveLength(1)
  expect(calls.some((c: any) => c.method === 'installAgentTypeStreaming')).toBe(false)
  expect(calls.some((c: any) => c.method === 'signIn')).toBe(false)
  expect(errors).toEqual([])
})

test('editing the same local agent preserves credentials and changes only its folder', async ({ page }) => {
  const errors = await openComputer(page, true)
  await page.getByRole('button', { name: 'desk-helper', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Configure desk-helper' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Agent name' })).toBeDisabled()
  await page.getByRole('button', { name: /^Browse/ }).click()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Agents on this computer' })).toBeVisible()
  const calls = await page.evaluate(() => (window as any).__localTest.calls)
  expect(calls.filter((c: any) => c.method === 'setAgentWorkingDir')).toEqual([{ method: 'setAgentWorkingDir', args: ['desk-helper', '/review/selected-project'] }])
  expect(calls.some((c: any) => c.method === 'saveAgentInstanceEnv' || c.method === 'addAgent')).toBe(false)
  expect(errors).toEqual([])
})

test('theme menu keeps hover and selection visually separate in the OpenAgents skin', async ({ page }, info) => {
  await openComputer(page)
  await page.evaluate(() => {
    localStorage.setItem('launcher:skin', 'openagents')
    localStorage.setItem('launcher:theme-mode', 'dark')
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Agents on this computer' })).toBeVisible()
  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await page.getByRole('button', { name: 'Theme' }).click()

  const selected = page.getByRole('menuitemradio', { name: 'Dark' })
  const hovered = page.getByRole('menuitemradio', { name: 'Light' })
  await expect(selected).toHaveAttribute('data-state', 'checked')
  await hovered.hover()
  await expect
    .poll(() => hovered.evaluate((el) => getComputedStyle(el).outlineStyle))
    .toBe('none')
  await page.screenshot({ path: info.outputPath('openagents-theme-menu.png') })
})

test('adding an installed type can open its existing agent instead of creating a copy', async ({ page }) => {
  const errors = await openComputer(page, true)
  await page.getByTestId('new-agent-open').click()
  await page.getByRole('button', { name: /Claude Code.*Add/ }).click()
  await expect(page.getByText('Already on this device')).toBeVisible()
  await page.getByRole('button', { name: /desk-helper.*Open settings/ }).click()
  await expect(page.getByRole('heading', { name: 'Configure desk-helper' })).toBeVisible()
  const calls = await page.evaluate(() => (window as any).__localTest.calls)
  expect(calls.some((c: any) => c.method === 'addAgent' || c.method === 'installAgentTypeStreaming')).toBe(false)
  expect(errors).toEqual([])
})

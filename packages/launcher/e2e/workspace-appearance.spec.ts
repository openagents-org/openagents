// Real Workspace UI and production Electron preload; synthetic account data only.
// Run after npm run build. WORKSPACE_BUNDLE_DIR can select an older bundle
// to verify that these tests reproduce the original theme feedback loop.
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { previewFixture } from '../scripts/workspace-preview/fixture.mjs'

let server: Server
let origin: string
let electron: ElectronApplication
let profile: string
let page: Page
let errors: string[]

test.setTimeout(30_000)
test.beforeAll(async () => {
  const bundle = path.resolve(process.env.WORKSPACE_BUNDLE_DIR || '../../workspace/frontend/dist-desktop')
  if (!existsSync(path.join(bundle, 'index.html'))) throw Error('Run npm run build first')
  const fixture = previewFixture('en')
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost')
    if (url.pathname.startsWith('/v1/')) {
      if (url.pathname === '/v1/events/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(': test\n\n')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: fixture.response(url, req.method) }))
      return
    }
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
  server?.closeAllConnections()
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
})

test.beforeEach(async () => {
  profile = mkdtempSync(path.join(tmpdir(), 'openagents-appearance-test-'))
  const main = path.join(profile, 'main.cjs')
  const preload = path.resolve('out/preload/workspace-view.js')
  // A delayed reply models the launcher renderer forwarding appearance back
  // through main. No core runtime, device pairing, or real account is started.
  writeFileSync(main, `
    const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
    app.setPath('userData', ${JSON.stringify(path.join(profile, 'profile'))});
    const state = global.appearanceTest = {
      theme: 'light', locale: 'en-US', outbound: [], delay: 100,
      apply(next) {
        Object.assign(state, next);
        nativeTheme.themeSource = state.theme;
        state.window.webContents.send('workspace-view:appearance', { theme: state.theme, locale: state.locale });
      },
    };
    nativeTheme.themeSource = 'light';
    ipcMain.on('workspace-view:config', event => {
      event.returnValue = {
        theme: state.theme, locale: state.locale, apiUrl: ${JSON.stringify(origin)},
        session: { token: 'test-only', email: 'alex@example.invalid', displayName: 'Alex', expiresAt: Date.now() / 1000 + 3600 },
      };
    });
    ipcMain.on('workspace-view:theme-changed', (_event, theme) => {
      state.outbound.push(theme);
      setTimeout(() => state.apply({ theme }), state.delay);
    });
    ipcMain.on('workspace-view:locale-changed', (_event, locale) => {
      setTimeout(() => state.apply({ locale }), state.delay);
    });
    ipcMain.handle('workspace-view:computer-status', () => ({ hostname: 'Test computer', nodeId: null }));
    app.whenReady().then(() => {
      state.window = new BrowserWindow({ show: false, width: 1280, height: 850,
        webPreferences: { preload: ${JSON.stringify(preload)}, contextIsolation: true, sandbox: true } });
      state.window.loadURL('about:blank');
    });
    app.on('window-all-closed', () => app.quit());
  `)
  electron = await _electron.launch({ args: [main] })
  page = await electron.firstWindow()
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.context().route('**/*', async route => {
    if (new URL(route.request().url()).origin === origin) await route.continue()
    else await route.abort()
  })
  await page.addInitScript(() => localStorage.setItem('oa:welcomeFilmSeen', '1'))
  await page.goto(`${origin}/#/preview?token=test-only`)
  await expect(page.getByTitle('alex@example.invalid')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/light/)
  await page.evaluate(() => {
    const globals = window as any
    globals.themeChanges = []
    let last = document.documentElement.className
    new MutationObserver(() => {
      const next = document.documentElement.className
      if (next !== last) globals.themeChanges.push(next)
      last = next
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  })
})

test.afterEach(async () => {
  await electron?.close()
  if (profile) rmSync(profile, { recursive: true, force: true })
})

async function chooseTheme(name: 'Dark' | 'Light' | 'System') {
  const account = page.getByTitle('alex@example.invalid')
  await expect(account).toHaveAttribute('aria-expanded', 'false')
  await account.click()
  await page.getByRole('menuitem', { name: /^Theme/ }).hover()
  await page.getByRole('menuitemradio', { name, exact: true }).click()
  await expect(account).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('menuitemradio', { name, exact: true })).toBeHidden()
}

async function settled() {
  // Observe several complete asynchronous round trips, not just one dark frame.
  await new Promise(resolve => setTimeout(resolve, 700))
}

async function hostTheme(theme: string) {
  await electron.evaluate((_electron, theme) => (globalThis as any).appearanceTest.apply({ theme }), theme)
}

async function outbound() {
  return electron.evaluate(() => (globalThis as any).appearanceTest.outbound as string[])
}

test('Workspace dark mode remains dark with exactly one host update, including reload', async () => {
  await chooseTheme('Dark')
  await settled()
  await expect(page.locator('html')).toHaveClass(/dark/)
  expect(await outbound()).toEqual(['dark'])
  expect(await page.evaluate(() => (window as any).themeChanges)).toEqual(['dark'])
  expect(await electron.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
  await page.reload()
  await expect(page.getByTitle('alex@example.invalid')).toBeVisible()
  await settled()
  await expect(page.locator('html')).toHaveClass(/dark/)
  expect(await outbound()).toEqual(['dark'])
  expect(errors).toEqual([])
})

test('launcher changes apply without echoing the previous Workspace theme', async () => {
  await hostTheme('dark')
  await settled()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await hostTheme('light')
  await settled()
  await expect(page.locator('html')).toHaveClass(/light/)
  expect(await outbound()).toEqual([])
  expect(await page.evaluate(() => (window as any).themeChanges)).toEqual(['dark', 'light'])
  expect(errors).toEqual([])
})

test('system preference follows OS appearance without reporting extra theme selections', async () => {
  await page.emulateMedia({ colorScheme: 'light' })
  await chooseTheme('System')
  await settled()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.emulateMedia({ colorScheme: 'light' })
  await settled()
  await expect(page.locator('html')).toHaveClass(/light/)
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('system')
  expect(await outbound()).toEqual(['system'])
  expect(errors).toEqual([])
})

test('rapid Workspace changes keep the last selection while replies are delayed', async () => {
  await electron.evaluate(() => { (globalThis as any).appearanceTest.delay = 1_500 })
  await chooseTheme('Dark')
  await chooseTheme('Light')
  await chooseTheme('Dark')
  await new Promise(resolve => setTimeout(resolve, 3_500))
  await expect(page.locator('html')).toHaveClass(/dark/)
  expect(await page.evaluate(() => (window as any).themeChanges)).toEqual(['dark', 'light', 'dark'])
  await hostTheme('light')
  await settled()
  await expect(page.locator('html')).toHaveClass(/light/)
  expect(errors).toEqual([])
})

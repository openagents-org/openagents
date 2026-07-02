#!/usr/bin/env node
/**
 * Ensure the Electron binary is actually downloaded after `npm install`.
 *
 * Why this exists:
 * npm only runs a dependency's own postinstall (electron's binary downloader)
 * when it (re)links that dependency. If `node_modules/electron` already exists
 * from a previous/partial install, a fresh `npm i` skips electron's postinstall
 * and the binary (`dist/`, `path.txt`) never gets created. electron-vite then
 * fails to start with the misleading `Error: Electron uninstall`.
 *
 * This guard runs on every install of the launcher package, is idempotent
 * (electron's installer no-ops when the binary already matches), and repairs
 * the missing-binary case so nobody gets stuck unable to start dev.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

async function main() {
  let electronDir
  try {
    // Resolve electron regardless of where it is hoisted.
    electronDir = dirname(require.resolve('electron/package.json'))
  } catch {
    // electron isn't installed at all (e.g. --ignore-scripts on a first install);
    // nothing we can repair here.
    console.warn('[ensure-electron] electron package not found, skipping.')
    return
  }

  const pathTxt = join(electronDir, 'path.txt')
  if (existsSync(pathTxt)) {
    const rel = readFileSync(pathTxt, 'utf-8').trim()
    if (rel && existsSync(join(electronDir, 'dist', rel))) {
      // Binary already present — nothing to do.
      return
    }
  }

  console.log('[ensure-electron] Electron binary missing — downloading...')
  try {
    await import(pathToFileURL(join(electronDir, 'install.js')).href)
  } catch (err) {
    // Don't fail the whole install on a transient download error; surface a hint.
    console.warn(
      `[ensure-electron] Failed to download Electron binary: ${err?.message || err}\n` +
        '  Run `npm rebuild electron` (or `npm run postinstall`) once network is available.'
    )
  }
}

main()

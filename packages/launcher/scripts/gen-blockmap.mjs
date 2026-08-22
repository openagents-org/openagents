#!/usr/bin/env node
// Regenerates the .blockmap files electron-updater needs for differential
// ("delta") downloads.
//
// A blockmap is a gzipped index of an installer: content-defined chunks of
// ~16 KB, each with its own checksum. Given the old and the new blockmap, the
// client copies every unchanged chunk out of the copy it already has on disk
// and range-requests only the rest — a launcher update moves ~10-30 MB instead
// of the whole 140 MB, because the Electron framework is identical between
// versions.
//
// electron-builder already writes one next to every installer at build time,
// but two of our release steps rewrite the installer bytes AFTERWARDS: the
// macOS zip is repacked with ditto (to keep the framework symlinks) and the
// Windows binaries are re-signed by SignPath. A blockmap describing the
// pre-rewrite bytes is worse than no blockmap at all — the client reassembles
// the file from stale offsets and the result fails its sha512 check. So CI
// deletes the build-time one and calls this script on the exact bytes we ship.
//
//   node scripts/gen-blockmap.mjs dist/OpenAgents-Launcher-1.2.3-mac-arm64.zip
//
// Writes <file>.blockmap beside each input and prints one JSON line per file
// with the {size, sha512} that the matching latest*.yml entry must carry.
//
// The chunking lives in app-builder-lib (pure JS since electron-builder 26), so
// this stays byte-identical to what electron-builder itself would have
// produced. Jobs without the launcher's node_modules can install app-builder-lib
// anywhere and point BLOCKMAP_MODULES_DIR at the containing node_modules.
import { createRequire } from "node:module"
import { join } from "node:path"

const require = createRequire(import.meta.url)

const MODULE_PATH = "app-builder-lib/out/targets/blockmap/blockmap.js"

function loadBuildBlockMap() {
  const override = process.env.BLOCKMAP_MODULES_DIR
  const specifier = override ? join(override, MODULE_PATH) : MODULE_PATH
  try {
    return require(specifier).buildBlockMap
  } catch (err) {
    console.error(
      `gen-blockmap: cannot load ${specifier} — ${err.message}\n` +
        "Run from packages/launcher after npm install, or set " +
        "BLOCKMAP_MODULES_DIR to a node_modules holding app-builder-lib.",
    )
    process.exit(1)
  }
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error("usage: gen-blockmap.mjs <installer> [<installer>...]")
  process.exit(1)
}

const buildBlockMap = loadBuildBlockMap()

for (const file of files) {
  const out = `${file}.blockmap`
  // "gzip" (not "deflate") + a separate output file is the combination
  // electron-updater fetches over HTTP; "deflate" is only for the copy embedded
  // inside nsis-web packages, which we do not build.
  const { size, sha512 } = await buildBlockMap(file, "gzip", out)
  console.log(JSON.stringify({ file, blockmap: out, size, sha512 }))
}

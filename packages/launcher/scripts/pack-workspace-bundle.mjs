#!/usr/bin/env node
// Packs and signs the Workspace desktop bundle for installed launchers to
// download, so a Workspace change reaches them without a launcher release.
//
//   node scripts/pack-workspace-bundle.mjs --out <dir> [--dir <dist-desktop>]
//   node scripts/pack-workspace-bundle.mjs --keygen
//
// Writes:
//   <out>/<version>/workspace-<version>.tar.gz   the bundle (plain ustar, gzip)
//   <out>/latest.json                            { payload, signature }
//
// `payload` is the manifest's JSON text and `signature` its ed25519 signature
// (base64), made with the PKCS#8 PEM key in WORKSPACE_BUNDLE_SIGNING_KEY. The
// launcher's src/main/bundle-ota/ is the reading end of every format here: the
// tar reader accepts only what packTar writes.
//
// --keygen prints a fresh key pair: the private PEM for the CI secret, and the
// public key to add to TRUSTED_KEYS in src/main/bundle-ota/manifest.ts (or, for
// a self-hosted feed, to OPENAGENTS_WORKSPACE_BUNDLE_PUBLIC_KEY).
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto"
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

const BLOCK = 512

function writeString(header, offset, length, value) {
  const bytes = Buffer.from(value, "utf-8")
  if (bytes.length > length) throw new Error(`tar field too long: ${value}`)
  bytes.copy(header, offset)
}

function writeOctal(header, offset, length, value) {
  // length - 1 digits and a NUL, as ustar wants.
  writeString(header, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`)
}

/** ustar keeps long paths in a 155-byte prefix and a 100-byte name. */
function splitName(name) {
  if (Buffer.byteLength(name) <= 100) return ["", name]
  for (let i = name.indexOf("/"); i >= 0; i = name.indexOf("/", i + 1)) {
    const prefix = name.slice(0, i)
    const rest = name.slice(i + 1)
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) return [prefix, rest]
  }
  throw new Error(`path too long for ustar: ${name}`)
}

/**
 * A tar of regular files, deterministic: no timestamps, owners or modes that
 * vary between machines, so the same tree always packs to the same bytes.
 */
export function packTar(files) {
  const blocks = []
  for (const { name, data } of files) {
    const header = Buffer.alloc(BLOCK)
    const [prefix, base] = splitName(name)
    writeString(header, 0, 100, base)
    writeOctal(header, 100, 8, 0o644)
    writeOctal(header, 108, 8, 0)
    writeOctal(header, 116, 8, 0)
    writeOctal(header, 124, 12, data.length)
    writeOctal(header, 136, 12, 0)
    header.fill(0x20, 148, 156)
    header[156] = 0x30
    writeString(header, 257, 6, "ustar\0")
    writeString(header, 263, 2, "00")
    writeString(header, 345, 155, prefix)
    let sum = 0
    for (const byte of header) sum += byte
    writeString(header, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `)
    blocks.push(header, data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK))
  }
  blocks.push(Buffer.alloc(BLOCK * 2))
  return Buffer.concat(blocks)
}

function listFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) out.push(relative(root, full).split(sep).join("/"))
      else throw new Error(`not a regular file: ${full}`)
    }
  }
  walk(root)
  return out.sort()
}

/** Pack `dir` and write the signed release into `out`. Returns the manifest. */
export function buildRelease({ dir, out, privateKeyPem }) {
  const info = JSON.parse(readFileSync(join(dir, "bundle-info.json"), "utf-8"))
  for (const key of ["schema", "version", "commit", "committedAt", "minHostApi"]) {
    if (info[key] === undefined) throw new Error(`bundle-info.json has no "${key}"`)
  }
  if (!statSync(join(dir, "index.html")).isFile()) throw new Error("bundle has no index.html")
  const files = listFiles(dir).map((name) => ({ name, data: readFileSync(join(dir, name)) }))
  const archive = gzipSync(packTar(files), { level: 9 })
  const archivePath = `${info.version}/workspace-${info.version}.tar.gz`
  mkdirSync(join(out, info.version), { recursive: true })
  writeFileSync(join(out, archivePath), archive)

  const manifest = {
    schema: info.schema,
    version: info.version,
    commit: info.commit,
    committedAt: info.committedAt,
    minHostApi: info.minHostApi,
    archive: archivePath,
    sha256: createHash("sha256").update(archive).digest("hex"),
    size: archive.length,
  }
  const payload = JSON.stringify(manifest)
  const signature = sign(null, Buffer.from(payload, "utf-8"), createPrivateKey(privateKeyPem)).toString("base64")
  writeFileSync(join(out, "latest.json"), `${JSON.stringify({ payload, signature }, null, 2)}\n`)
  return { manifest, files: files.length }
}

function main(argv) {
  if (argv.includes("--keygen")) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    console.log(privateKey.export({ type: "pkcs8", format: "pem" }).trim())
    console.log(`\npublic key: ${publicKey.export({ type: "spki", format: "der" }).toString("base64")}`)
    return
  }
  const arg = (name) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
  const dir = resolve(arg("--dir") ?? join(repo, "workspace", "frontend", "dist-desktop"))
  const out = arg("--out")
  const privateKeyPem = process.env.WORKSPACE_BUNDLE_SIGNING_KEY
  if (!out) throw new Error("--out <dir> is required")
  if (!privateKeyPem) throw new Error("WORKSPACE_BUNDLE_SIGNING_KEY is not set")
  const { manifest, files } = buildRelease({ dir, out: resolve(out), privateKeyPem })
  console.log(`Packed ${files} files as ${manifest.archive} (${manifest.size} bytes, sha256 ${manifest.sha256})`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (err) {
    console.error(`pack-workspace-bundle: ${err.message}`)
    process.exit(1)
  }
}

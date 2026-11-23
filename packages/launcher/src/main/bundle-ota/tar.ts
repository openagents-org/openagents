import fs from "fs"
import path from "path"
import { promisify } from "util"
import zlib from "zlib"

/**
 * Just enough of a tar reader for the Workspace bundle archive.
 *
 * The archive is written by scripts/pack-workspace-bundle.mjs and nothing else,
 * so this reads that writer's output — plain ustar, regular files only — and
 * refuses everything else rather than trying to be a general tar tool. A
 * dependency would have to be added to the installer's `build.files`
 * whitelist along with its whole dependency closure; this is sixty lines.
 *
 * The archive is signature-checked before it gets here, but the reader still
 * treats it as untrusted: no links, no absolute paths, nothing that climbs out
 * of the destination, and a ceiling on size.
 */

const gunzip = promisify(zlib.gunzip)

const BLOCK = 512
const MAX_ENTRIES = 20_000
const MAX_BYTES = 256 * 1024 * 1024

/**
 * The archive itself is wrong — it will not unpack, or does not hold the build
 * its manifest describes — as opposed to the machine failing to write it out.
 * Only this gives up on a build for good.
 */
export class BundleContentError extends Error {
  name = "BundleContentError"
}

export interface TarEntry {
  /** Forward-slash relative path, already checked by safeRelative. */
  name: string
  data: Buffer
}

function text(block: Buffer, offset: number, length: number): string {
  const raw = block.subarray(offset, offset + length)
  const end = raw.indexOf(0)
  return raw.subarray(0, end < 0 ? length : end).toString("utf-8")
}

function octal(block: Buffer, offset: number, length: number): number {
  const value = text(block, offset, length).trim()
  if (!/^[0-7]*$/.test(value)) throw new Error("malformed number in tar header")
  return value ? parseInt(value, 8) : 0
}

function checksumMatches(header: Buffer): boolean {
  let sum = 0
  // The checksum field itself counts as eight spaces.
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i]
  return sum === octal(header, 148, 8)
}

/** A relative path that stays inside wherever it is joined to, or null. */
export function safeRelative(name: string): string | null {
  if (!name || name.includes("\0") || name.includes("\\")) return null
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return null
  const parts = name.split("/").filter((part) => part && part !== ".")
  if (!parts.length || parts.includes("..")) return null
  return parts.join("/")
}

export function readTar(buffer: Buffer): TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  let total = 0
  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK)
    if (header.every((byte) => byte === 0)) return entries
    if (!checksumMatches(header)) throw new Error("tar header checksum mismatch")
    const prefix = text(header, 345, 155)
    const base = text(header, 0, 100)
    const name = prefix ? `${prefix}/${base}` : base
    const type = header[156]
    const size = octal(header, 124, 12)
    offset += BLOCK
    // Directories carry nothing; the files below them create them.
    if (type === 0x35) continue
    // '0' or NUL: a regular file. Links, pax and GNU long-name records are
    // refused — the writer never produces them.
    if (type !== 0x30 && type !== 0) throw new Error(`unsupported tar entry for ${name}`)
    const safe = safeRelative(name)
    if (!safe) throw new Error(`unsafe path in archive: ${name}`)
    if (offset + size > buffer.length) throw new Error("tar archive is truncated")
    total += size
    if (entries.length >= MAX_ENTRIES || total > MAX_BYTES) throw new Error("archive is too large")
    entries.push({ name: safe, data: buffer.subarray(offset, offset + size) })
    offset += Math.ceil(size / BLOCK) * BLOCK
  }
  throw new Error("tar archive has no end marker")
}

/** Unpack a .tar.gz into `dest`, which should be empty. Returns the file count. */
export async function extractTarGz(archive: string, dest: string): Promise<number> {
  const gz = await fs.promises.readFile(archive)
  let entries: TarEntry[]
  try {
    entries = readTar(await gunzip(gz, { maxOutputLength: MAX_BYTES + 64 * BLOCK }))
  } catch (err) {
    throw new BundleContentError((err as Error).message)
  }
  for (const entry of entries) {
    const target = path.join(dest, ...entry.name.split("/"))
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await fs.promises.writeFile(target, entry.data)
  }
  return entries.length
}

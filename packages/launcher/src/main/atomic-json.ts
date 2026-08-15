import * as fs from "fs"
import * as path from "path"

/**
 * Write JSON through a temp file + rename.
 *
 * `writeFileSync` onto the live path truncates it first, so a crash, a power
 * cut, or a full disk mid-write leaves a half-written file — and every loader
 * here treats unparseable JSON as "fall back to defaults". That is how settings
 * appear to reset themselves and how a saved workspace connection vanishes: the
 * data was never corrupt in memory, only the moment of writing was unprotected.
 *
 * rename(2) is atomic within a filesystem, so a reader sees either the old file
 * or the new one. fsync before the rename because the rename can otherwise be
 * durable while the bytes it points at are not — the exact case a power cut
 * turns into a zero-length file.
 */
export function writeJsonAtomic(
  file: string,
  data: unknown,
  opts: { mode?: number } = {},
): void {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  // Same directory, so the rename never crosses a filesystem boundary. The pid
  // keeps two processes writing the same file from sharing a temp path.
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`)
  try {
    const fd = fs.openSync(tmp, "w", opts.mode ?? 0o644)
    try {
      fs.writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`, "utf-8")
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    // openSync's mode is masked by umask; set it explicitly so a credentials
    // file really is 0600 rather than whatever the umask allowed.
    if (opts.mode !== undefined) fs.chmodSync(tmp, opts.mode)
    fs.renameSync(tmp, file)
  } catch (err) {
    try {
      fs.unlinkSync(tmp)
    } catch {}
    throw err
  }
}

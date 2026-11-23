// @vitest-environment node
import fs from "fs"
import os from "os"
import path from "path"
import zlib from "zlib"
import { afterEach, describe, expect, it } from "vitest"

import { packTar } from "../../../scripts/pack-workspace-bundle.mjs"
import { extractTarGz, readTar, safeRelative } from "./tar"

const file = (name: string, text: string) => ({ name, data: Buffer.from(text) })

/** Rewrite one header byte and fix the checksum, as a hostile writer would. */
function patchType(tar: Buffer, type: string): Buffer {
  const out = Buffer.from(tar)
  out[156] = type.charCodeAt(0)
  out.fill(0x20, 148, 156)
  let sum = 0
  for (let i = 0; i < 512; i++) sum += out[i]
  out.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1")
  return out
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("bundle tar reader", () => {
  it("reads back exactly what the packer wrote, long paths included", () => {
    const long = `assets/${"nested/".repeat(20)}chunk-${"x".repeat(60)}.js`
    const files = [file("index.html", "<html></html>"), file(long, "export {}"), file("empty.txt", "")]
    const entries = readTar(packTar(files))
    expect(entries.map((e) => [e.name, e.data.toString()])).toEqual(files.map((f) => [f.name, f.data.toString()]))
  })

  it("refuses paths that climb out, and anything that is not a plain file", () => {
    expect(() => readTar(packTar([file("../evil.js", "x")]))).toThrow(/unsafe path/)
    expect(() => readTar(packTar([file("/etc/passwd", "x")]))).toThrow(/unsafe path/)
    expect(() => readTar(patchType(packTar([file("link", "")]), "2"))).toThrow(/unsupported/)
    expect(() => readTar(patchType(packTar([file("long", "")]), "L"))).toThrow(/unsupported/)
  })

  it("refuses a damaged or cut-off archive", () => {
    const tar = packTar([file("index.html", "x".repeat(2000))])
    const corrupt = Buffer.from(tar)
    corrupt[10] ^= 0xff
    expect(() => readTar(corrupt)).toThrow(/checksum/)
    expect(() => readTar(tar.subarray(0, 1024))).toThrow(/truncated/)
  })

  it("normalizes harmless relative forms and rejects the rest", () => {
    expect(safeRelative("./assets//a.js")).toBe("assets/a.js")
    expect(safeRelative("a/../../b")).toBeNull()
    expect(safeRelative("C:/x")).toBeNull()
    expect(safeRelative("a\\b")).toBeNull()
  })

  it("unpacks a .tar.gz into a folder", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-tar-"))
    dirs.push(dir)
    const archive = path.join(dir, "b.tar.gz")
    fs.writeFileSync(archive, zlib.gzipSync(packTar([file("index.html", "hi"), file("assets/a.js", "js")])))
    expect(await extractTarGz(archive, path.join(dir, "out"))).toBe(2)
    expect(fs.readFileSync(path.join(dir, "out", "assets", "a.js"), "utf-8")).toBe("js")
  })
})

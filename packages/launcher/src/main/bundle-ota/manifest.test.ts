// @vitest-environment node
import crypto from "crypto"
import { describe, expect, it } from "vitest"

import { bundleFeedUrl, DEFAULT_BUNDLE_FEED, parseBundleInfo, trustedKeys, verifyManifest } from "./manifest"

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
const KEY = publicKey.export({ type: "spki", format: "der" }).toString("base64")
const OTHER = crypto.generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64")

const manifest = {
  schema: 1, version: "20261120.081500-abc1234", commit: "abc1234", committedAt: 1_763_600_000_000, minHostApi: 1,
  archive: "20261120.081500-abc1234/workspace.tar.gz", sha256: "a".repeat(64), size: 10,
}
function signed(doc: unknown) {
  const payload = JSON.stringify(doc)
  return { payload, signature: crypto.sign(null, Buffer.from(payload), privateKey).toString("base64") }
}

describe("bundle manifest", () => {
  it("accepts a manifest signed with a trusted key", () => {
    expect(verifyManifest(signed(manifest), [OTHER, KEY])).toEqual(manifest)
  })

  it("rejects a wrong key, a tampered payload and a malformed document", () => {
    expect(verifyManifest(signed(manifest), [OTHER])).toBeNull()
    const doc = signed(manifest)
    expect(verifyManifest({ ...doc, payload: doc.payload.replace("abc1234", "abc1235") }, [KEY])).toBeNull()
    expect(verifyManifest({ payload: doc.payload }, [KEY])).toBeNull()
    expect(verifyManifest(null, [KEY])).toBeNull()
    expect(verifyManifest(signed({ ...manifest, sha256: "nope" }), [KEY])).toBeNull()
  })

  it("only accepts versions that are safe as folder names", () => {
    expect(parseBundleInfo({ ...manifest, version: "../up" })).toBeNull()
    expect(parseBundleInfo({ ...manifest, version: "a/b" })).toBeNull()
    expect(parseBundleInfo({ ...manifest, schema: 2 })).toBeNull()
  })

  it("lets a self-hosted feed bring its own key", () => {
    expect(trustedKeys({ OPENAGENTS_WORKSPACE_BUNDLE_PUBLIC_KEY: `${KEY}, ${OTHER}` })).toEqual([KEY, OTHER])
    expect(trustedKeys({}).length).toBeGreaterThan(0)
  })
})

describe("bundle feed", () => {
  const hosted = "https://workspace-endpoint.openagents.org"
  it("uses the hosted feed only for an installed app on the hosted endpoint", () => {
    expect(bundleFeedUrl({ endpoint: undefined, packaged: true, env: {} })).toBe(DEFAULT_BUNDLE_FEED)
    expect(bundleFeedUrl({ endpoint: hosted, packaged: true, env: {} })).toBe(DEFAULT_BUNDLE_FEED)
    expect(bundleFeedUrl({ endpoint: "https://ws.example.com", packaged: true, env: {} })).toBeNull()
    expect(bundleFeedUrl({ endpoint: undefined, packaged: false, env: {} })).toBeNull()
  })

  it("can be pointed elsewhere or turned off", () => {
    const env = (value: string) => ({ OPENAGENTS_WORKSPACE_BUNDLE_FEED: value })
    expect(bundleFeedUrl({ endpoint: "https://ws.example.com", packaged: true, env: env("https://dl.example.com/latest.json") }))
      .toBe("https://dl.example.com/latest.json")
    expect(bundleFeedUrl({ endpoint: undefined, packaged: false, env: env("http://127.0.0.1:9000/latest.json") }))
      .toBe("http://127.0.0.1:9000/latest.json")
    expect(bundleFeedUrl({ endpoint: undefined, packaged: true, env: env("off") })).toBeNull()
    expect(bundleFeedUrl({ endpoint: undefined, packaged: true, env: env("http://dl.example.com/latest.json") })).toBeNull()
  })
})

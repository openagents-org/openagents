// Types for the tests that drive the packer as the launcher's other end.
export function packTar(files: Array<{ name: string; data: Buffer }>): Buffer
export function buildRelease(opts: { dir: string; out: string; privateKeyPem: string }): {
  manifest: {
    schema: number
    version: string
    commit: string
    committedAt: number
    minHostApi: number
    archive: string
    sha256: string
    size: number
  }
  files: number
}

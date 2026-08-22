import { describe, expect, it } from 'vitest'

import { OPENCODE_RUNTIME_MANIFEST, resolveOpencodeReleaseTarget } from './runtime-release'

describe('openCode runtime release manifest', () => {
  it('pins the installed SDK-compatible release and official integrity metadata', () => {
    expect(OPENCODE_RUNTIME_MANIFEST).toMatchObject({
      schemaVersion: 1,
      sdkVersion: '1.18.21',
      releaseTag: 'v1.18.21',
      repository: 'anomalyco/opencode',
    })
    for (const target of Object.values(OPENCODE_RUNTIME_MANIFEST.targets)) {
      expect(target.sizeBytes).toBeGreaterThan(0)
      expect(target.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(target.assetName).not.toContain('desktop')
    }
  })

  it.each([
    ['darwin', 'arm64', null, 'darwin-arm64'],
    ['darwin', 'x64', null, 'darwin-x64'],
    ['linux', 'arm64', 'glibc', 'linux-arm64-glibc'],
    ['linux', 'arm64', 'musl', 'linux-arm64-musl'],
    ['linux', 'x64', 'glibc', 'linux-x64-glibc'],
    ['linux', 'x64', 'musl', 'linux-x64-musl'],
    ['win32', 'arm64', null, 'win32-arm64'],
    ['win32', 'x64', null, 'win32-x64'],
  ] as const)('resolves %s/%s/%s explicitly', (platform, arch, libc, key) => {
    expect(resolveOpencodeReleaseTarget({ platform, arch, libc })?.key).toBe(key)
  })

  it('does not guess unsupported architecture or Linux libc', () => {
    expect(resolveOpencodeReleaseTarget({ platform: 'linux', arch: 'x64', libc: null })).toBeNull()
    expect(resolveOpencodeReleaseTarget({ platform: 'freebsd', arch: 'x64' })).toBeNull()
    expect(resolveOpencodeReleaseTarget({ platform: 'darwin', arch: 'ia32' })).toBeNull()
  })
})

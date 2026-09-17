import { describe, expect, it } from 'vitest'

import { CLAUDE_CODE_RUNTIME_MANIFEST, resolveClaudeCodeReleaseTarget } from './runtime-release'

describe('resolveClaudeCodeReleaseTarget', () => {
  it.each([
    ['darwin', 'arm64', null, 'darwin-arm64'],
    ['darwin', 'x64', null, 'darwin-x64'],
    ['linux', 'arm64', 'glibc', 'linux-arm64'],
    ['linux', 'arm64', 'musl', 'linux-arm64-musl'],
    ['linux', 'x64', 'glibc', 'linux-x64'],
    ['linux', 'x64', 'musl', 'linux-x64-musl'],
    ['win32', 'arm64', null, 'win32-arm64'],
    ['win32', 'x64', null, 'win32-x64'],
  ] as const)('resolves %s/%s/%s to %s', (platform, arch, libc, key) => {
    const target = resolveClaudeCodeReleaseTarget({ platform, arch, libc })
    expect(target?.key).toBe(key)
    expect(target?.version).toBe(CLAUDE_CODE_RUNTIME_MANIFEST.sdkVersion)
    expect(target?.packageName).toBe(`@anthropic-ai/claude-agent-sdk-${key}`)
    expect(target?.downloadUrl).toBe(`https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-${key}/-/claude-agent-sdk-${key}-${CLAUDE_CODE_RUNTIME_MANIFEST.sdkVersion}.tgz`)
    expect(target?.executableName).toBe(platform === 'win32' ? 'claude.exe' : 'claude')
  })

  it('falls back across libc variants on linux', () => {
    const target = resolveClaudeCodeReleaseTarget({ platform: 'linux', arch: 'x64', libc: 'musl' })
    expect(target?.key).toBe('linux-x64-musl')
  })

  it('does not guess unsupported platforms or architectures', () => {
    expect(resolveClaudeCodeReleaseTarget({ platform: 'freebsd', arch: 'x64' } as never)).toBeNull()
    expect(resolveClaudeCodeReleaseTarget({ platform: 'darwin', arch: 'riscv64' })).toBeNull()
  })
})

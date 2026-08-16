import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  getCodexCodeModeHostRuntimePath,
  resolveCodexRuntimeTarget,
} from './sync-codex-runtime.mjs'

const targets = [
  ['darwin', 'arm64', 'codex-code-mode-host-aarch64-apple-darwin.tar.gz', 'codex-code-mode-host'],
  ['darwin', 'x64', 'codex-code-mode-host-x86_64-apple-darwin.tar.gz', 'codex-code-mode-host'],
  ['linux', 'arm64', 'codex-code-mode-host-aarch64-unknown-linux-musl.tar.gz', 'codex-code-mode-host'],
  ['linux', 'x64', 'codex-code-mode-host-x86_64-unknown-linux-musl.tar.gz', 'codex-code-mode-host'],
  ['win32', 'arm64', 'codex-code-mode-host-aarch64-pc-windows-msvc.exe.tar.gz', 'codex-code-mode-host.exe'],
  ['win32', 'x64', 'codex-code-mode-host-x86_64-pc-windows-msvc.exe.tar.gz', 'codex-code-mode-host.exe'],
]

describe('Codex code-mode host runtime targets', () => {
  it.each(targets)('maps %s-%s to the matching release asset', (platform, arch, assetName, executableName) => {
    const target = resolveCodexRuntimeTarget({ platform, arch })

    expect(target.codeModeHostAssetName).toBe(assetName)
    expect(target.codeModeHostExecutableName).toBe(executableName)
    expect(path.basename(getCodexCodeModeHostRuntimePath({ platform, arch }))).toBe(executableName)
  })
})

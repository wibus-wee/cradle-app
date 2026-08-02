import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { resolveCradleDataDir } from '../worktree/worktree-paths'

/** Cradle-owned sandbox metadata root under Application Support. */
export function resolveSandboxDataDir(): string {
  return join(resolveCradleDataDir(), 'sandboxes')
}

export function resolveSandboxStorePath(): string {
  return join(resolveSandboxDataDir(), 'state.json')
}

export function resolveSandboxScratchDir(instanceId: string): string {
  return join(resolveSandboxDataDir(), 'scratch', instanceId)
}

export function ensureSandboxDataDirs(): void {
  mkdirSync(resolveSandboxDataDir(), { recursive: true })
  mkdirSync(join(resolveSandboxDataDir(), 'scratch'), { recursive: true })
}

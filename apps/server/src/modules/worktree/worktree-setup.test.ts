import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runWorktreeSetupHooks } from './worktree-setup'

let workspacePath: string | undefined
let checkoutPath: string | undefined

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function writeSetupConfig(commands: string[]): void {
  if (!workspacePath) {
    throw new Error('workspacePath is not initialized')
  }
  const cradleDir = join(workspacePath, '.cradle')
  mkdirSync(cradleDir, { recursive: true })
  writeFileSync(join(cradleDir, 'worktrees.json'), JSON.stringify({
    setup: {
      default: commands,
    },
  }))
}

describe('worktree setup hooks', () => {
  afterEach(() => {
    if (workspacePath) {
      rmSync(workspacePath, { recursive: true, force: true })
      workspacePath = undefined
    }
    if (checkoutPath) {
      rmSync(checkoutPath, { recursive: true, force: true })
      checkoutPath = undefined
    }
  })

  it('returns pending setup commands without executing them for untrusted workspaces', async () => {
    workspacePath = createTempDir('cradle-worktree-setup-workspace-')
    checkoutPath = createTempDir('cradle-worktree-setup-checkout-')
    writeSetupConfig(['printf "ran" > setup-result.txt'])

    const warnings = await runWorktreeSetupHooks(workspacePath, checkoutPath, {
      trusted: false,
      fabricNodeExposed: false,
    })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('explicit workspace trust')
    expect(warnings[0]).toContain('printf "ran" > setup-result.txt')
    expect(existsSync(join(checkoutPath, 'setup-result.txt'))).toBe(false)
  })

  it('executes setup commands for trusted workspaces', async () => {
    workspacePath = createTempDir('cradle-worktree-setup-workspace-')
    checkoutPath = createTempDir('cradle-worktree-setup-checkout-')
    writeSetupConfig(['printf "ran" > setup-result.txt'])

    const warnings = await runWorktreeSetupHooks(workspacePath, checkoutPath, {
      trusted: true,
      fabricNodeExposed: false,
    })

    expect(warnings).toEqual([])
    expect(readFileSync(join(checkoutPath, 'setup-result.txt'), 'utf8')).toBe('ran')
  })

  it('skips setup commands while relay host enrollments expose the server', async () => {
    workspacePath = createTempDir('cradle-worktree-setup-workspace-')
    checkoutPath = createTempDir('cradle-worktree-setup-checkout-')
    writeSetupConfig(['printf "ran" > setup-result.txt'])

    const warnings = await runWorktreeSetupHooks(workspacePath, checkoutPath, {
      trusted: true,
      fabricNodeExposed: true,
    })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('relay host enrollments')
    expect(warnings[0]).toContain('printf "ran" > setup-result.txt')
    expect(existsSync(join(checkoutPath, 'setup-result.txt'))).toBe(false)
  })
})

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { normalizeRepoKey, probeLocalGitIdentity } from './repo-identity'

describe('normalizeRepoKey', () => {
  it('collapses remote syntax variants of the same repository', () => {
    const expected = 'github.com/wibus/cradle-app'
    expect(normalizeRepoKey('git@github.com:wibus/cradle-app.git')).toBe(expected)
    expect(normalizeRepoKey('https://github.com/wibus/cradle-app.git')).toBe(expected)
    expect(normalizeRepoKey('https://GitHub.com/wibus/cradle-app')).toBe(expected)
    expect(normalizeRepoKey('ssh://git@github.com/wibus/cradle-app.git')).toBe(expected)
    expect(normalizeRepoKey('git@github.com:wibus/cradle-app/')).toBe(expected)
  })

  it('keeps distinct repositories distinct', () => {
    expect(normalizeRepoKey('https://github.com/wibus/other.git'))
      .not
.toBe('github.com/wibus/cradle-app')
  })

  it('returns null for blank or missing urls', () => {
    expect(normalizeRepoKey(null)).toBeNull()
    expect(normalizeRepoKey(undefined)).toBeNull()
    expect(normalizeRepoKey('')).toBeNull()
    expect(normalizeRepoKey('   ')).toBeNull()
  })
})

describe('probeLocalGitIdentity', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'cradle-repo-identity-'))
  const repoPath = join(tempRoot, 'repo')

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('collects origin, root, branch, and head from a real repository', async () => {
    const { execSync } = await import('node:child_process') as typeof import('node:child_process')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(repoPath)
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.email t@t && git config user.name t && git config commit.gpgsign false', { cwd: repoPath })
    execSync('git remote add origin https://github.com/wibus/cradle-app.git', { cwd: repoPath })
    writeFileSync(join(repoPath, 'file.txt'), 'x')
    execSync('git add . && git commit -m init', { cwd: repoPath })

    const identity = await probeLocalGitIdentity(repoPath)
    expect(identity.originUrl).toBe('https://github.com/wibus/cradle-app.git')
    expect(identity.branch).toBe('main')
    expect(identity.headSha).toMatch(/^[0-9a-f]{40}$/)
    expect(identity.repoRoot?.endsWith('repo')).toBe(true)
  })

  it('returns an empty identity for a non-git directory', async () => {
    const plainDir = join(tempRoot, 'plain')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(plainDir)
    expect(await probeLocalGitIdentity(plainDir)).toEqual({})
  })
})

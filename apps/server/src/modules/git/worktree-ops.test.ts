import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '../../errors/app-error'
import * as GitCommand from './git-command'
import { resolveRemoteDefaultBaseRef } from './worktree-ops'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveRemoteDefaultBaseRef', () => {
  it('prefers origin/HEAD when available', async () => {
    const run = vi.spyOn(GitCommand, 'runGitCommand').mockImplementation(async (_cwd, args) => {
      if (args.includes('refs/remotes/origin/HEAD^{commit}')) {
        return 'origin-head-sha\n'
      }
      throw new Error('missing')
    })

    await expect(resolveRemoteDefaultBaseRef('/repo')).resolves.toBe('origin-head-sha')
    expect(run).toHaveBeenCalledWith('/repo', ['rev-parse', '--verify', 'refs/remotes/origin/HEAD^{commit}'])
  })

  it('falls back to origin/main then origin/master', async () => {
    const run = vi.spyOn(GitCommand, 'runGitCommand').mockImplementation(async (_cwd, args) => {
      const ref = args.at(-1)
      if (ref === 'refs/remotes/origin/main^{commit}') {
        return 'origin-main-sha\n'
      }
      throw new Error('missing')
    })

    await expect(resolveRemoteDefaultBaseRef('/repo')).resolves.toBe('origin-main-sha')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('throws a stable error when no remote default tip exists', async () => {
    vi.spyOn(GitCommand, 'runGitCommand').mockRejectedValue(new Error('missing'))

    await expect(resolveRemoteDefaultBaseRef('/repo')).rejects.toMatchObject({
      code: 'work_remote_base_unavailable',
    })
    await expect(resolveRemoteDefaultBaseRef('/repo')).rejects.toBeInstanceOf(AppError)
  })
})

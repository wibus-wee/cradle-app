import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { listDirectory, probeRepository, statPath } from './filesystem'

describe('remote filesystem capabilities', () => {
  it('lists and stats arbitrary remote directories without configured workspace roots', async () => {
    const previousRoots = process.env.CRADLE_AGENTD_WORKSPACE_ROOTS
    const root = mkdtempSync(join(tmpdir(), 'cradle-agentd-fs-'))
    try {
      delete process.env.CRADLE_AGENTD_WORKSPACE_ROOTS
      mkdirSync(join(root, 'project-a'))
      writeFileSync(join(root, 'README.md'), '# test\n')

      const listing = await listDirectory({ path: root })
      expect(listing.path).toBe(root)
      expect(listing.entries).toEqual([
        expect.objectContaining({ name: 'project-a', kind: 'directory' }),
        expect.objectContaining({ name: 'README.md', kind: 'file' }),
      ])

      await expect(statPath({ path: join(root, 'project-a') })).resolves.toEqual(expect.objectContaining({
        name: 'project-a',
        kind: 'directory',
      }))
    }
    finally {
      rmSync(root, { recursive: true, force: true })
      if (previousRoots === undefined) {
        delete process.env.CRADLE_AGENTD_WORKSPACE_ROOTS
      }
      else {
        process.env.CRADLE_AGENTD_WORKSPACE_ROOTS = previousRoots
      }
    }
  })

  it('probes git repository roots from a selected remote path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-agentd-git-'))
    const nested = join(root, 'packages', 'app')
    try {
      mkdirSync(nested, { recursive: true })
      execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' })

      await expect(probeRepository({ path: nested })).resolves.toEqual(expect.objectContaining({
        path: nested,
        isRepository: true,
        rootPath: realpathSync(root),
      }))
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { listWorkspaces } from './workspaces'

describe('remote workspace listing', () => {
  it('recognizes cradle-workspace.json as a workspace marker', () => {
    const previousRoots = process.env.CRADLE_AGENTD_WORKSPACE_ROOTS
    const root = mkdtempSync(join(tmpdir(), 'cradle-agentd-ws-'))
    try {
      process.env.CRADLE_AGENTD_WORKSPACE_ROOTS = root

      // A directory whose only marker is cradle-workspace.json.
      mkdirSync(join(root, 'cradle-monorepo'))
      writeFileSync(
        join(root, 'cradle-monorepo', 'cradle-workspace.json'),
        JSON.stringify({ name: 'mono', folders: [] }),
      )

      // A plain git project.
      mkdirSync(join(root, 'git-project'))
      mkdirSync(join(root, 'git-project', '.git'))

      // A non-workspace directory.
      mkdirSync(join(root, 'random-dir'))

      const result = listWorkspaces({ root })
      const names = result.workspaces.map(workspace => workspace.name)
      expect(names).toEqual(expect.arrayContaining(['cradle-monorepo', 'git-project']))
      expect(names).not.toContain('random-dir')

      const cradle = result.workspaces.find(workspace => workspace.name === 'cradle-monorepo')
      expect(cradle?.reason).toBe('cradle-workspace.json')
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
})

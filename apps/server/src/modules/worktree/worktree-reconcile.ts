import { existsSync } from 'node:fs'

import type { Worktree } from '@cradle/db'
import { worktrees } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { listGitWorktrees, resolveGitRepoRoot } from '../git/worktree-ops'
import * as Workspace from '../workspace/service'

export type WorktreeHealth = 'ok' | 'missing' | 'stale'

export function assessWorktreeHealthSync(worktree: Pick<Worktree, 'status' | 'path'> | null): WorktreeHealth | null {
  if (!worktree) {
    return null
  }
  if (worktree.status !== 'active') {
    return 'stale'
  }
  if (!existsSync(worktree.path)) {
    return 'missing'
  }
  return 'ok'
}

export async function reconcileWorktreeRecord(worktree: Worktree): Promise<WorktreeHealth> {
  const syncHealth = assessWorktreeHealthSync(worktree)
  if (syncHealth !== 'ok') {
    return syncHealth ?? 'missing'
  }

  const workspacePath = Workspace.getLocalWorkspacePath(worktree.sourceWorkspaceId)
  if (!workspacePath) {
    return 'missing'
  }

  try {
    const repoRoot = await resolveGitRepoRoot(workspacePath)
    const entries = await listGitWorktrees(repoRoot)
    const match = entries.find(entry => entry.path === worktree.path)
    if (!match) {
      return 'missing'
    }
    if (match.branch && match.branch !== worktree.branch) {
      db().update(worktrees).set({
        branch: match.branch,
        updatedAt: currentUnixSeconds(),
      }).where(eq(worktrees.id, worktree.id)).run()
      return 'ok'
    }
    return 'ok'
  }
  catch {
    return 'missing'
  }
}

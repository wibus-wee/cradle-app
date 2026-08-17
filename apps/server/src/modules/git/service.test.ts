import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { getGraph } from './service'

const workspaceServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('../workspace/service', () => workspaceServiceMock)

let repositoryPath: string | null = null

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repositoryPath!, encoding: 'utf8' }).trim()
}

afterEach(() => {
  vi.clearAllMocks()
  if (repositoryPath) {
    rmSync(repositoryPath, { recursive: true, force: true })
    repositoryPath = null
  }
})

describe('getGraph', () => {
  it('omits Cradle-owned checkpoint refs from the user commit graph', async () => {
    repositoryPath = mkdtempSync(join(tmpdir(), 'cradle-git-graph-'))
    git('init')
    git('config', 'user.name', 'Cradle Test')
    git('config', 'user.email', 'cradle@example.com')
    git('config', 'commit.gpgsign', 'false')
    writeFileSync(join(repositoryPath, 'tracked.txt'), 'main\n')
    git('add', 'tracked.txt')
    git('commit', '-m', 'User commit')

    const tree = git('write-tree')
    const checkpointCommit = git('commit-tree', tree, '-m', 'Cradle turn checkpoint')
    git('update-ref', 'refs/cradle/checkpoints/session/run/start', checkpointCommit)
    git('update-ref', 'refs/cradle/internal-head', 'HEAD')

    workspaceServiceMock.get.mockReturnValue({
      locator: { nodeId: 'local', path: repositoryPath },
    })

    const graph = await getGraph('workspace-1', 100)

    expect(graph.map(commit => commit.subject)).toEqual(['User commit'])
    expect(graph.flatMap(commit => commit.refs).some(ref => ref.includes('refs/cradle'))).toBe(false)
  })
})

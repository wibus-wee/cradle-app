import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceFileChangeEvent } from '../workspace/file-watch'
import { subscribeWorkspaceFileChanges } from '../workspace/file-watch'
import * as Workspace from '../workspace/service'
import { resolveSessionExecutionRootById } from '../worktree/service'
import { openSessionEvents } from './service'

vi.mock('../workspace/service', () => ({ get: vi.fn() }))
vi.mock('../workspace/file-watch', () => ({ subscribeWorkspaceFileChanges: vi.fn() }))
vi.mock('../worktree/service', () => ({ resolveSessionExecutionRootById: vi.fn() }))

function decodeSseChunk(chunk: Uint8Array): unknown {
  const frame = new TextDecoder().decode(chunk)
  return JSON.parse(frame.slice('data: '.length).trim())
}

describe('code activity service', () => {
  let fileListener: ((event: WorkspaceFileChangeEvent) => void) | null

  beforeEach(() => {
    vi.resetAllMocks()
    fileListener = null
    vi.mocked(resolveSessionExecutionRootById).mockReturnValue({
      rootPath: '/managed/worktrees/session-1',
      sourceWorkspaceId: 'workspace-1',
      worktreeId: 'worktree-1',
      branch: 'cradle/wt/session-1',
      isIsolated: true,
      worktreeHealth: 'ok',
    })
    vi.mocked(Workspace.get).mockReturnValue({
      id: 'workspace-1',
      name: 'Cradle',
      locator: { nodeId: 'local', path: '/source/cradle' },
      gitIdentity: {},
      identifier: 'CRA',
      availability: 'available',
      multiFolder: false,
      pinned: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    vi.mocked(subscribeWorkspaceFileChanges).mockImplementation((input) => {
      fileListener = input.listener
      return vi.fn()
    })
  })

  it('observes the session worktree and emits only relative file metadata', async () => {
    const stream = openSessionEvents('session-1')
    const reader = stream.getReader()
    const ready = await reader.read()

    expect(subscribeWorkspaceFileChanges).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      workspacePath: '/managed/worktrees/session-1',
    }))
    expect(ready.done).toBe(false)
    expect(decodeSseChunk(ready.value!)).toMatchObject({
      type: 'ready',
      sessionId: 'session-1',
      workspace: { id: 'workspace-1', name: 'Cradle' },
    })

    fileListener?.({
      type: 'file-changed',
      workspaceId: 'workspace-1',
      path: 'src/index.ts',
      timestamp: 123,
    })
    const changed = await reader.read()
    const event = decodeSseChunk(changed.value!)
    expect(event).toEqual({
      type: 'file-changed',
      sessionId: 'session-1',
      workspace: { id: 'workspace-1', name: 'Cradle' },
      file: { relativePath: 'src/index.ts' },
      occurredAt: 123,
    })
    expect(JSON.stringify(event)).not.toContain('/managed/worktrees')
    expect(JSON.stringify(event)).not.toContain('/source/cradle')

    await reader.cancel()
  })
})

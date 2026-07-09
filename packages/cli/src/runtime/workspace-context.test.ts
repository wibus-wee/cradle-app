import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CommandContext } from './types'
import { resolveWorkspaceReference } from './workspace-context'

const UUID_A = '11111111-1111-1111-1111-111111111111'
const UUID_B = '22222222-2222-2222-2222-222222222222'

function createContext(request: CommandContext['request']): CommandContext {
  return { request, serverUrl: 'http://localhost:21423' }
}

describe('resolveWorkspaceReference', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.CRADLE_WORKSPACE_ID
  })

  it('returns a UUID-shaped explicit value directly, without listing workspaces', async () => {
    const request = vi.fn().mockResolvedValue([])
    const context = createContext(request)

    await expect(resolveWorkspaceReference(context, UUID_A)).resolves.toBe(UUID_A)
    expect(request).not.toHaveBeenCalled()
  })

  it('resolves an explicit name to its workspace id', async () => {
    const request = vi.fn().mockResolvedValue([
      { id: UUID_A, locator: { path: '/repo/project-a' }, name: 'project-a' },
      { id: UUID_B, locator: { path: '/repo/project-b' }, name: 'project-b' },
    ])
    const context = createContext(request)

    await expect(resolveWorkspaceReference(context, 'project-b')).resolves.toBe(UUID_B)
  })

  it('resolves an explicit name case-insensitively', async () => {
    const request = vi.fn().mockResolvedValue([
      { id: UUID_A, locator: { path: '/repo/project-a' }, name: 'Project-A' },
    ])
    const context = createContext(request)

    await expect(resolveWorkspaceReference(context, 'project-a')).resolves.toBe(UUID_A)
  })

  it('falls back to CRADLE_WORKSPACE_ID when no explicit value is given', async () => {
    process.env.CRADLE_WORKSPACE_ID = UUID_A
    const request = vi.fn().mockResolvedValue([])
    const context = createContext(request)

    await expect(resolveWorkspaceReference(context, undefined)).resolves.toBe(UUID_A)
    expect(request).not.toHaveBeenCalled()
  })

  it('prefers an explicit value over CRADLE_WORKSPACE_ID', async () => {
    process.env.CRADLE_WORKSPACE_ID = UUID_A
    const request = vi.fn().mockResolvedValue([])
    const context = createContext(request)

    await expect(resolveWorkspaceReference(context, UUID_B)).resolves.toBe(UUID_B)
  })

  it('detects the workspace whose registered path is an ancestor of cwd', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/repo/project-a/src/nested')
    const request = vi.fn().mockResolvedValue([
      { id: UUID_A, locator: { path: '/repo/project-a' }, name: 'project-a' },
      { id: UUID_B, locator: { path: '/repo/project-b' }, name: 'project-b' },
    ])
    const context = createContext(request)

    await expect(resolveWorkspaceReference(context, undefined)).resolves.toBe(UUID_A)
  })

  it('picks the most specific (longest) matching path when workspaces are nested', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/repo/project-a/apps/web')
    const request = vi.fn().mockResolvedValue([
      { id: UUID_A, locator: { path: '/repo/project-a' }, name: 'project-a' },
      { id: UUID_B, locator: { path: '/repo/project-a/apps/web' }, name: 'project-a-web' },
    ])
    const context = createContext(request)

    await expect(resolveWorkspaceReference(context, undefined)).resolves.toBe(UUID_B)
  })

  it('returns undefined when nothing matches cwd and no other tier applies', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/somewhere/else')
    const request = vi.fn().mockResolvedValue([
      { id: UUID_A, locator: { path: '/repo/project-a' }, name: 'project-a' },
    ])
    const context = createContext(request)

    await expect(resolveWorkspaceReference(context, undefined)).resolves.toBeUndefined()
  })

  it('does not fall back to env or cwd when ambient is false', async () => {
    process.env.CRADLE_WORKSPACE_ID = UUID_A
    vi.spyOn(process, 'cwd').mockReturnValue('/repo/project-a')
    const request = vi.fn().mockResolvedValue([
      { id: UUID_A, locator: { path: '/repo/project-a' }, name: 'project-a' },
    ])
    const context = createContext(request)

    await expect(resolveWorkspaceReference(context, undefined, { ambient: false })).resolves.toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })

  it('still resolves an explicit name when ambient is false', async () => {
    const request = vi.fn().mockResolvedValue([
      { id: UUID_A, locator: { path: '/repo/project-a' }, name: 'project-a' },
    ])
    const context = createContext(request)

    await expect(resolveWorkspaceReference(context, 'project-a', { ambient: false })).resolves.toBe(UUID_A)
  })

  it('throws a clear error listing candidates when a name is ambiguous', async () => {
    const request = vi.fn().mockResolvedValue([
      { id: UUID_A, locator: { path: '/repo/a' }, name: 'app' },
      { id: UUID_B, locator: { path: '/repo/b' }, name: 'app' },
    ])
    const context = createContext(request)

    await expect(resolveWorkspaceReference(context, 'app')).rejects.toThrow(/Multiple workspaces are named "app"/)
  })

  it('throws a helpful error when no workspace matches the given name', async () => {
    const request = vi.fn().mockResolvedValue([
      { id: UUID_A, locator: { path: '/repo/a' }, name: 'app' },
    ])
    const context = createContext(request)

    await expect(resolveWorkspaceReference(context, 'missing')).rejects.toThrow(/No workspace matches "missing"/)
  })
})

import { describe, expect, it } from 'vitest'

import type { GetWorkspacesResponse } from '~/api-gen/types.gen'
import type { UiActivityResolutionInputs } from '~/features/activity/resolution-inputs'

import { resolveCodeActivityTarget } from './code-activity-resolver'

const workspaces: GetWorkspacesResponse = [{
  id: 'workspace-1',
  name: 'Cradle',
  locator: { hostId: 'local', path: '/private/cradle' },
  gitIdentity: {},
  identifier: 'cradle',
  availability: 'available',
  multiFolder: false,
  pinned: 0,
  createdAt: 1,
  updatedAt: 1,
}]

function fileInputs(): UiActivityResolutionInputs {
  return {
    visible: true,
    activeBrowserTab: {
      kind: 'workspace-file',
      id: 'file-tab',
      workspaceId: 'workspace-1',
      path: 'apps/web/src/app.tsx',
      view: 'editor',
      title: 'app.tsx',
      loading: false,
      favicon: null,
    },
    focusedSplitRoute: null,
    activeSurface: {
      id: 'chat:session-1',
      kind: 'chat',
      title: 'Chat',
      route: { to: '/chat/$sessionId', params: { sessionId: 'session-1' } },
      closable: true,
    },
    resolved: { entity: 'apps/web/src/app.tsx', entityType: 'file' },
  }
}

describe('resolveCodeActivityTarget', () => {
  it('returns only workspace identity, relative file path, and language', () => {
    expect(resolveCodeActivityTarget(fileInputs(), workspaces, 'workspace-1')).toEqual({
      workspace: { id: 'workspace-1', name: 'Cradle' },
      file: {
        relativePath: 'apps/web/src/app.tsx',
        language: 'typescript',
      },
    })
  })

  it('requires a visible file on an active chat surface', () => {
    const hidden = fileInputs()
    hidden.visible = false
    expect(resolveCodeActivityTarget(hidden, workspaces, 'workspace-1')).toBeNull()

    const workspaceSurface = fileInputs()
    workspaceSurface.activeSurface = {
      id: 'workspace:workspace-1',
      kind: 'workspace',
      title: 'Cradle',
      route: { to: '/workspaces/$workspaceId', params: { workspaceId: 'workspace-1' } },
      closable: true,
    }
    expect(resolveCodeActivityTarget(workspaceSurface, workspaces, 'workspace-1')).toBeNull()
  })

  it('requires the active chat and file tab to use the same known workspace', () => {
    expect(resolveCodeActivityTarget(fileInputs(), [], 'workspace-1')).toBeNull()
    expect(resolveCodeActivityTarget(fileInputs(), workspaces, null)).toBeNull()
    expect(resolveCodeActivityTarget(fileInputs(), workspaces, 'workspace-2')).toBeNull()
  })
})

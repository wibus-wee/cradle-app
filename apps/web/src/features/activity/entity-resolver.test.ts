import { describe, expect, it } from 'vitest'

import {
  resolveEntityFromBrowserTab,
  resolveUiActivityEntity,
} from './entity-resolver'

describe('resolveUiActivityEntity', () => {
  it('prefers browser-panel workspace-file tab over workspace surface route', () => {
    const resolved = resolveUiActivityEntity({
      activeBrowserTab: {
        kind: 'workspace-file',
        id: 'tab-1',
        workspaceId: 'ws-1',
        path: 'apps/web/src/app.tsx',
        view: 'editor',
        title: 'app.tsx',
        loading: false,
        favicon: null,
      },
      focusedSplitRoute: null,
      activeSurface: {
        id: 'workspace:ws-1',
        kind: 'workspace',
        title: 'Workspace',
        route: { to: '/workspaces/$workspaceId', params: { workspaceId: 'ws-1' } },
        closable: true,
      },
    })

    expect(resolved).toEqual({
      entity: 'apps/web/src/app.tsx',
      entityType: 'file',
    })
  })

  it('maps pull-request and workspace-diff browser tabs', () => {
    expect(resolveEntityFromBrowserTab({
      kind: 'pull-request',
      id: 'pr-tab',
      owner: 'acme',
      repo: 'app',
      number: 12,
      workId: 'work-9',
      title: 'PR',
      loading: false,
      favicon: null,
    })).toEqual({ entity: 'pr:work-9', entityType: 'pr' })

    expect(resolveEntityFromBrowserTab({
      kind: 'workspace-diff',
      id: 'diff-tab',
      workspaceId: 'ws-1',
      paths: ['src/a.ts'],
      title: 'diff',
      loading: false,
      favicon: null,
    })).toEqual({ entity: 'diff:src/a.ts', entityType: 'diff' })
  })

  it('uses focused split pane when it differs from the surface primary route', () => {
    const resolved = resolveUiActivityEntity({
      activeBrowserTab: null,
      focusedSplitRoute: { to: '/chat/$sessionId', params: { sessionId: 's-2' } },
      activeSurface: {
        id: 'chat:s-1',
        kind: 'chat',
        title: 'Chat',
        route: { to: '/chat/$sessionId', params: { sessionId: 's-1' } },
        closable: true,
      },
    })
    expect(resolved).toEqual({ entity: 'chat:s-2', entityType: 'chat' })
  })

  it('falls back to active surface route entities', () => {
    expect(resolveUiActivityEntity({
      activeBrowserTab: null,
      focusedSplitRoute: null,
      activeSurface: {
        id: 'settings',
        kind: 'settings',
        title: 'Settings',
        route: { to: '/settings/$section', params: { section: 'general' } },
        closable: true,
      },
    })).toEqual({ entity: 'settings:general', entityType: 'settings' })

    expect(resolveUiActivityEntity({
      activeBrowserTab: null,
      focusedSplitRoute: null,
      activeSurface: {
        id: 'plugin:foo:bar',
        kind: 'plugin',
        title: 'Plugin',
        route: {
          to: '/plugins/$routeSegment/$localId',
          params: { routeSegment: 'foo', localId: 'bar' },
        },
        closable: true,
      },
    })).toEqual({ entity: 'plugin:foo:bar', entityType: 'plugin' })
  })
})

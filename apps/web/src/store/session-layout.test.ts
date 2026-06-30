import { beforeEach, describe, expect, it } from 'vitest'

import { useSessionLayoutStore } from './session-layout'

describe('session layout store', () => {
  beforeEach(() => {
    useSessionLayoutStore.setState({
      sessions: {},
      workspaces: {},
    })
  })

  it('merges partial session layout patches without dropping known fields', () => {
    useSessionLayoutStore.getState().upsertSession({
      sessionId: 'session-a',
      sessionTitle: 'Session A',
      workspaceId: 'workspace-a',
      workspacePath: '/workspace-a',
      runtimeKind: 'standard',
    })

    useSessionLayoutStore.getState().upsertSession({
      sessionId: 'session-a',
      sessionTitle: 'Renamed Session A',
    })

    expect(useSessionLayoutStore.getState().sessions['session-a']).toEqual({
      sessionId: 'session-a',
      sessionTitle: 'Renamed Session A',
      workspaceId: 'workspace-a',
      workspacePath: '/workspace-a',
      runtimeKind: 'standard',
    })
  })

  it('treats explicit null session fields as identity updates', () => {
    useSessionLayoutStore.getState().upsertSession({
      sessionId: 'session-a',
      sessionTitle: 'Session A',
      workspaceId: 'workspace-a',
      workspacePath: '/workspace-a',
      runtimeKind: 'standard',
    })

    useSessionLayoutStore.getState().upsertSession({
      sessionId: 'session-a',
      workspaceId: null,
      workspacePath: null,
      runtimeKind: null,
    })

    expect(useSessionLayoutStore.getState().sessions['session-a']).toEqual({
      sessionId: 'session-a',
      sessionTitle: 'Session A',
      workspaceId: null,
      workspacePath: null,
      runtimeKind: null,
    })
  })

  it('merges workspace layout patches and preserves known path metadata', () => {
    useSessionLayoutStore.getState().upsertWorkspace({
      workspaceId: 'workspace-a',
      workspaceName: 'Workspace A',
      workspacePath: '/workspace-a',
    })

    useSessionLayoutStore.getState().upsertWorkspace({
      workspaceId: 'workspace-a',
      workspaceName: 'Renamed Workspace A',
    })

    expect(useSessionLayoutStore.getState().workspaces['workspace-a']).toEqual({
      workspaceId: 'workspace-a',
      workspaceName: 'Renamed Workspace A',
      workspacePath: '/workspace-a',
    })
  })
})

import { describe, expect, it } from 'vitest'

import { deriveActiveLayoutContract } from './layout-contract'

const explicitInputs = {
  explicitPanel: undefined,
  explicitHasBrowserPanel: undefined,
  explicitHasPanel: undefined,
}

function chatTab(sessionId: string) {
  return {
    type: 'chat',
    label: `Chat ${sessionId}`,
    params: { sessionId },
  }
}

function workspaceTab(workspaceId: string) {
  return {
    type: 'workspace-detail',
    label: `Workspace ${workspaceId}`,
    params: { workspaceId },
  }
}

describe('deriveActiveLayoutContract', () => {
  it('derives chat chrome synchronously from cached session workspace metadata', () => {
    const contract = deriveActiveLayoutContract({
      activeTab: chatTab('session-b'),
      slots: {
        asideSessionId: 'session-a',
        asideWorkspaceId: 'workspace-a',
        hasBrowserPanel: true,
        hasPanel: true,
        panel: 'Terminal A',
      },
      sessionLayout: {
        sessionId: 'session-b',
        sessionTitle: 'Session B',
        workspaceId: 'workspace-b',
        workspacePath: '/workspace-b',
        runtimeKind: 'standard',
      },
      ...explicitInputs,
    })

    expect(contract).toEqual({
      asideSessionId: 'session-b',
      asideWorkspaceId: 'workspace-b',
      hasAside: true,
      hasBrowserPanel: true,
      hasPanel: true,
      panel: undefined,
    })
  })

  it('ignores stale chat slots from the previously active session', () => {
    const contract = deriveActiveLayoutContract({
      activeTab: chatTab('session-b'),
      slots: {
        asideSessionId: 'session-a',
        asideWorkspaceId: 'workspace-a',
        hasBrowserPanel: true,
        hasPanel: true,
        panel: 'Terminal A',
      },
      sessionLayout: undefined,
      ...explicitInputs,
    })

    expect(contract.asideSessionId).toBe('session-b')
    expect(contract.asideWorkspaceId).toBeNull()
    expect(contract.hasAside).toBe(true)
    expect(contract.hasBrowserPanel).toBeUndefined()
    expect(contract.hasPanel).toBeUndefined()
    expect(contract.panel).toBeUndefined()
  })

  it('uses matching chat slots when session metadata has not arrived yet', () => {
    const contract = deriveActiveLayoutContract({
      activeTab: chatTab('session-b'),
      slots: {
        asideSessionId: 'session-b',
        asideWorkspaceId: 'workspace-b',
        hasBrowserPanel: true,
        hasPanel: true,
        panel: 'Terminal B',
      },
      sessionLayout: undefined,
      ...explicitInputs,
    })

    expect(contract.asideSessionId).toBe('session-b')
    expect(contract.asideWorkspaceId).toBe('workspace-b')
    expect(contract.hasAside).toBe(true)
    expect(contract.hasBrowserPanel).toBe(true)
    expect(contract.hasPanel).toBe(true)
    expect(contract.panel).toBe('Terminal B')
  })

  it('derives workspace detail chrome from route params instead of stale chat slots', () => {
    const contract = deriveActiveLayoutContract({
      activeTab: workspaceTab('workspace-b'),
      slots: {
        asideSessionId: 'session-a',
        asideWorkspaceId: 'workspace-a',
        hasBrowserPanel: true,
        hasPanel: true,
        panel: 'Terminal A',
      },
      sessionLayout: undefined,
      ...explicitInputs,
    })

    expect(contract).toEqual({
      asideSessionId: null,
      asideWorkspaceId: 'workspace-b',
      hasAside: true,
      hasBrowserPanel: true,
      hasPanel: true,
      panel: undefined,
    })
  })

  it('keeps browser and bottom panel capability for cached cli-tui workspace sessions', () => {
    const contract = deriveActiveLayoutContract({
      activeTab: chatTab('session-b'),
      slots: {},
      sessionLayout: {
        sessionId: 'session-b',
        sessionTitle: 'Session B',
        workspaceId: 'workspace-b',
        workspacePath: '/workspace-b',
        runtimeKind: 'cli-tui',
      },
      ...explicitInputs,
    })

    expect(contract.asideSessionId).toBe('session-b')
    expect(contract.asideWorkspaceId).toBe('workspace-b')
    expect(contract.hasAside).toBe(true)
    expect(contract.hasBrowserPanel).toBe(true)
    expect(contract.hasPanel).toBe(true)
  })
})

// Verifies BrowserPanel store tab shortcuts and render subscription boundaries.
import { act, cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BrowserAnnotationRecord, ThreadBrowserState } from './browser-panel'
import {
  DEFAULT_BROWSER_PANEL_OWNER_ID,
  handleBrowserPanelTabShortcut,
  handleBrowserPanelTabShortcutPayload,
  readBrowserPanelPersistedState,
  useBrowserPanelStore,
} from './browser-panel'

const BROWSER_PANEL_STORAGE_KEY = 'cradle:browser-panel:v2'

function commandKeyEvent(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: true,
  })
  vi.spyOn(event, 'preventDefault')
  vi.spyOn(event, 'stopPropagation')
  vi.spyOn(event, 'stopImmediatePropagation')
  return event
}

function annotationInput(
  overrides: Partial<Omit<BrowserAnnotationRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'>> = {},
): Omit<BrowserAnnotationRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'> {
  return {
    ownerId: DEFAULT_BROWSER_PANEL_OWNER_ID,
    tabId: overrides.tabId ?? 'browser-tab-1',
    title: overrides.title ?? 'Example',
    url: overrides.url ?? 'https://example.com',
    body: overrides.body ?? 'Initial note',
    anchor: overrides.anchor ?? { kind: 'point', x: 12, y: 24 },
    designChange: overrides.designChange ?? null,
    attachedImages: overrides.attachedImages ?? [],
    screenshot: overrides.screenshot ?? {
      type: 'file',
      filename: 'browser.png',
      mediaType: 'image/png',
      url: 'data:image/png;base64,AAAA',
    },
    elements: overrides.elements ?? [],
    surfaceSize: overrides.surfaceSize ?? { width: 800, height: 600 },
  }
}

function threadState(version: number, activeTabId: string | null, tabIds: string[]): ThreadBrowserState {
  return {
    threadId: DEFAULT_BROWSER_PANEL_OWNER_ID,
    version,
    open: tabIds.length > 0,
    activeTabId,
    tabs: tabIds.map(id => ({
      id,
      url: 'about:blank',
      title: 'New tab',
      status: 'live',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      faviconUrl: null,
      lastCommittedUrl: null,
      lastError: null,
    })),
    lastError: null,
  }
}

describe('browser panel shortcuts', () => {
  beforeEach(() => {
    vi.useRealTimers()
    cleanup()
    localStorage.clear()
    useBrowserPanelStore.setState({
      activeOwnerId: DEFAULT_BROWSER_PANEL_OWNER_ID,
      owners: {},
      open: false,
      tabs: [],
      activeTabId: null,
      requestedTab: null,
      scrollToFilePath: null,
      recentHistoryByOwnerId: {},
      annotationInteractionModeByOwnerId: {},
      annotationTrayCollapsedByOwnerId: {},
    })
  })

  it('closes the active browser panel tab on command W', () => {
    const firstTabId = useBrowserPanelStore.getState().createTab('https://example.com')
    const secondTabId = useBrowserPanelStore.getState().createTab('https://openai.com')
    const event = commandKeyEvent('w')

    expect(handleBrowserPanelTabShortcut(event, { panelOpen: true })).toBe(true)

    const state = useBrowserPanelStore.getState()
    expect(state.tabs.map(tab => tab.id)).toEqual([firstTabId])
    expect(state.activeTabId).toBe(firstTabId)
    expect(state.tabs.some(tab => tab.id === secondTabId)).toBe(false)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
  })

  it('activates the previous adjacent browser panel tab when closing the active tab', () => {
    const firstTabId = useBrowserPanelStore.getState().createTab('https://one.test')
    const secondTabId = useBrowserPanelStore.getState().createTab('https://two.test')
    const thirdTabId = useBrowserPanelStore.getState().createTab('https://three.test')

    useBrowserPanelStore.getState().setActiveTab(secondTabId)
    useBrowserPanelStore.getState().closeTab(secondTabId)

    const state = useBrowserPanelStore.getState()
    expect(state.tabs.map(tab => tab.id)).toEqual([firstTabId, thirdTabId])
    expect(state.activeTabId).toBe(firstTabId)
  })

  it('does not leave a stale active browser panel tab id after closing an inactive stale target', () => {
    const firstTabId = useBrowserPanelStore.getState().createTab('https://one.test')
    const secondTabId = useBrowserPanelStore.getState().createTab('https://two.test')
    const thirdTabId = useBrowserPanelStore.getState().createTab('https://three.test')

    useBrowserPanelStore.setState(state => ({
      ...state,
      owners: {
        ...state.owners,
        [DEFAULT_BROWSER_PANEL_OWNER_ID]: {
          ...state.owners[DEFAULT_BROWSER_PANEL_OWNER_ID]!,
          activeTabId: 'missing-tab',
        },
      },
      activeTabId: 'missing-tab',
    }))
    useBrowserPanelStore.getState().closeTab(secondTabId)

    const state = useBrowserPanelStore.getState()
    expect(state.tabs.map(tab => tab.id)).toEqual([firstTabId, thirdTabId])
    expect(state.activeTabId).toBe(thirdTabId)
  })

  it('normalizes stale native active browser tab ids to an existing tab', () => {
    useBrowserPanelStore.getState().upsertOwnerState(threadState(1, 'missing-tab', ['tab-1', 'tab-2']))

    expect(useBrowserPanelStore.getState().activeTabId).toBe('tab-2')
  })

  it('switches browser panel tabs on command number', () => {
    const firstTabId = useBrowserPanelStore.getState().createTab('https://example.com')
    useBrowserPanelStore.getState().createTab('https://openai.com')
    const event = commandKeyEvent('1')

    expect(handleBrowserPanelTabShortcut(event, { panelOpen: true })).toBe(true)

    expect(useBrowserPanelStore.getState().activeTabId).toBe(firstTabId)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
  })

  it('handles forwarded webview command W payloads', () => {
    useBrowserPanelStore.getState().createTab('https://example.com')

    expect(handleBrowserPanelTabShortcutPayload({
      key: 'w',
      metaKey: true,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
    }, { panelOpen: true })).toBe(true)

    expect(useBrowserPanelStore.getState().tabs).toHaveLength(0)
  })

  it('stores session source metadata when creating a browser tab', () => {
    const tabId = useBrowserPanelStore.getState().createTab('https://example.com', {
      sessionId: 'session-a',
      sessionTitle: 'Session A',
    })

    expect(useBrowserPanelStore.getState().tabs.find(tab => tab.id === tabId)).toMatchObject({
      kind: 'browser',
      sessionId: 'session-a',
      sessionTitle: 'Session A',
    })
  })

  it('ignores stale native snapshots after a newer tab state is applied', () => {
    useBrowserPanelStore.getState().upsertOwnerState(threadState(2, 'tab-2', ['tab-1', 'tab-2']))
    useBrowserPanelStore.getState().upsertOwnerState(threadState(3, 'tab-1', ['tab-1']))
    useBrowserPanelStore.getState().upsertOwnerState(threadState(2, 'tab-2', ['tab-1', 'tab-2']))

    expect(useBrowserPanelStore.getState().tabs.map(tab => tab.id)).toEqual(['tab-1'])
    expect(useBrowserPanelStore.getState().activeTabId).toBe('tab-1')
  })

  it('stores enabled script ids per browser tab', () => {
    const tabId = useBrowserPanelStore.getState().createTab('https://example.com')

    useBrowserPanelStore.getState().setBrowserTabScripts(tabId, ['react-scan', 'eruda'])

    expect(useBrowserPanelStore.getState().tabs.find(tab => tab.id === tabId)).toMatchObject({
      kind: 'browser',
      scriptIds: ['react-scan', 'eruda'],
    })
  })

  it('stores custom scripts per browser tab with insertion timing', () => {
    const tabId = useBrowserPanelStore.getState().createTab('https://example.com')

    const scriptId = useBrowserPanelStore.getState().addBrowserTabCustomScript(tabId, {
      label: 'Debug Hook',
      runAt: 'document-start',
      source: 'globalThis.__debugHook = true',
    })

    expect(useBrowserPanelStore.getState().tabs.find(tab => tab.id === tabId)).toMatchObject({
      kind: 'browser',
      customScripts: [{
        id: scriptId,
        label: 'Debug Hook',
        runAt: 'document-start',
        source: 'globalThis.__debugHook = true',
      }],
    })
  })

  it('preserves session source metadata for requested browser tabs', () => {
    useBrowserPanelStore.getState().requestTab('https://example.com', {
      sessionId: 'session-a',
      sessionTitle: 'Session A',
    })
    const requestedTab = useBrowserPanelStore.getState().requestedTab

    expect(useBrowserPanelStore.getState().open).toBe(true)
    expect(requestedTab).toMatchObject({
      sessionId: 'session-a',
      sessionTitle: 'Session A',
    })

    useBrowserPanelStore.getState().fulfillRequestedTab(requestedTab!.id)

    expect(useBrowserPanelStore.getState().requestedTab).toBeNull()

    const tabId = useBrowserPanelStore.getState().createTab(requestedTab!.url, {
      sessionId: requestedTab!.sessionId,
      sessionTitle: requestedTab!.sessionTitle,
    })
    expect(useBrowserPanelStore.getState().tabs.find(tab => tab.id === tabId)).toMatchObject({
      kind: 'browser',
      sessionId: 'session-a',
      sessionTitle: 'Session A',
    })
  })

  it('keeps browser panel tabs scoped to their owning app tab', () => {
    const firstOwnerTabId = useBrowserPanelStore.getState().createTab('https://example.com', undefined, 'app-tab-a')
    useBrowserPanelStore.getState().setActiveOwner('app-tab-b')

    expect(useBrowserPanelStore.getState().tabs).toEqual([])

    const secondOwnerTabId = useBrowserPanelStore.getState().createTab('https://openai.com')

    expect(useBrowserPanelStore.getState().tabs.map(tab => tab.id)).toEqual([secondOwnerTabId])

    useBrowserPanelStore.getState().setActiveOwner('app-tab-a')

    expect(useBrowserPanelStore.getState().tabs.map(tab => tab.id)).toEqual([firstOwnerTabId])
    expect(useBrowserPanelStore.getState().activeTabId).toBe(firstOwnerTabId)
  })

  it('does not consume shortcuts when the browser panel is closed', () => {
    useBrowserPanelStore.getState().createTab('https://example.com')
    const event = commandKeyEvent('w')

    expect(handleBrowserPanelTabShortcut(event, { panelOpen: false })).toBe(false)

    expect(useBrowserPanelStore.getState().tabs).toHaveLength(1)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('closes the active workspace file panel tab on command W', () => {
    useBrowserPanelStore.getState().openWorkspaceFileTab({
      workspaceId: 'workspace-1',
      path: 'src/index.ts',
      view: 'preview',
    })
    const event = commandKeyEvent('w')

    expect(handleBrowserPanelTabShortcut(event, { panelOpen: true })).toBe(true)

    expect(useBrowserPanelStore.getState().tabs).toHaveLength(0)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
  })

  it('notifies when command W closes the final browser panel tab', () => {
    useBrowserPanelStore.getState().createTab('https://example.com')
    const onCloseLastTab = vi.fn()
    const event = commandKeyEvent('w')

    expect(handleBrowserPanelTabShortcut(event, { panelOpen: true, onCloseLastTab })).toBe(true)

    expect(onCloseLastTab).toHaveBeenCalledWith(DEFAULT_BROWSER_PANEL_OWNER_ID)
    expect(useBrowserPanelStore.getState().tabs).toHaveLength(0)
  })

  it('does not notify when command W leaves other browser panel tabs open', () => {
    const firstTabId = useBrowserPanelStore.getState().createTab('https://example.com')
    useBrowserPanelStore.getState().createTab('https://openai.com')
    const onCloseLastTab = vi.fn()
    const event = commandKeyEvent('w')

    expect(handleBrowserPanelTabShortcut(event, { panelOpen: true, onCloseLastTab })).toBe(true)

    expect(onCloseLastTab).not.toHaveBeenCalled()
    expect(useBrowserPanelStore.getState().tabs.map(tab => tab.id)).toEqual([firstTabId])
  })

  it('scopes file scroll requests to a workspace diff tab', () => {
    const tabId = useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-1',
      title: 'All Changes',
    })

    useBrowserPanelStore.getState().requestScrollToFilePath({
      path: 'src/index.ts',
      tabId,
    })

    expect(useBrowserPanelStore.getState().scrollToFilePath).toMatchObject({
      path: 'src/index.ts',
      tabId,
    })
  })

  it('does not notify tab subscribers for file scroll requests', () => {
    const tabId = useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-1',
      title: 'All Changes',
    })
    let renderCount = 0

    function TabsProbe() {
      useBrowserPanelStore(state => state.tabs)
      renderCount++
      return null
    }

    render(createElement(TabsProbe))
    expect(renderCount).toBe(1)

    act(() => {
      useBrowserPanelStore.getState().requestScrollToFilePath({
        path: 'src/index.ts',
        tabId,
      })
    })

    expect(renderCount).toBe(1)
  })

  it('does not notify store subscribers when reopening the active diff tab', () => {
    useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-1',
      title: 'All Changes',
    })
    const listener = vi.fn()
    const unsubscribe = useBrowserPanelStore.subscribe(listener)

    useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-1',
      title: 'All Changes',
    })

    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })

  it('reuses an inactive matching diff tab instead of creating a duplicate', () => {
    const diffTabId = useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-1',
      title: 'All Changes',
    })
    useBrowserPanelStore.getState().createTab('https://example.com')

    const reopenedTabId = useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-1',
      title: 'All Changes',
    })

    expect(reopenedTabId).toBe(diffTabId)
    expect(useBrowserPanelStore.getState().activeTabId).toBe(diffTabId)
    expect(
      useBrowserPanelStore.getState().tabs.filter(tab => tab.kind === 'workspace-diff'),
    ).toHaveLength(1)
  })

  it('updates the singleton workspace diff pane when it is reopened for new content', () => {
    const firstTabId = useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-1',
      title: 'All Changes',
    })
    const reopenedTabId = useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-2',
      repositoryPath: 'packages/web',
      paths: ['src/app.tsx'],
      title: 'app.tsx',
    })

    expect(reopenedTabId).toBe(firstTabId)
    expect(useBrowserPanelStore.getState().tabs).toEqual([
      expect.objectContaining({
        id: firstTabId,
        kind: 'workspace-diff',
        workspaceId: 'workspace-2',
        repositoryPath: 'packages/web',
        paths: ['src/app.tsx'],
        title: 'app.tsx',
      }),
    ])
  })

  it('opens a pull request in a reusable Browser Panel tab keyed by owner/repo/number', () => {
    const firstTabId = useBrowserPanelStore.getState().openPullRequestTab({
      owner: 'cradle',
      repo: 'app',
      number: 42,
      workId: 'work-1',
      sessionId: 'session-1',
      title: 'Add pull request view',
      ownerId: 'pull-requests',
    })
    useBrowserPanelStore.getState().createTab('https://example.com', undefined, 'pull-requests')

    const reopenedTabId = useBrowserPanelStore.getState().openPullRequestTab({
      owner: 'cradle',
      repo: 'app',
      number: 42,
      workId: 'work-1',
      sessionId: 'session-1',
      title: 'Add pull request view',
      ownerId: 'pull-requests',
    })
    const ownerState = useBrowserPanelStore.getState().owners['pull-requests']

    expect(reopenedTabId).toBe(firstTabId)
    expect(ownerState?.activeTabId).toBe(firstTabId)
    expect(ownerState?.tabs.filter(tab => tab.kind === 'pull-request')).toEqual([
      expect.objectContaining({
        owner: 'cradle',
        repo: 'app',
        number: 42,
        workId: 'work-1',
        sessionId: 'session-1',
      }),
    ])
  })

  it('opens a non-Cradle pull request tab without workId or sessionId', () => {
    const tabId = useBrowserPanelStore.getState().openPullRequestTab({
      owner: 'octocat',
      repo: 'hello-world',
      number: 7,
      title: 'Improve README',
      ownerId: 'pull-requests',
    })
    const ownerState = useBrowserPanelStore.getState().owners['pull-requests']
    const tab = ownerState?.tabs.find(candidate => candidate.id === tabId)

    expect(tab).toEqual(expect.objectContaining({
      kind: 'pull-request',
      owner: 'octocat',
      repo: 'hello-world',
      number: 7,
      workId: undefined,
      sessionId: undefined,
    }))
  })

  it('updates an existing annotation by id while preserving creation time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    const annotationId = useBrowserPanelStore.getState().saveAnnotation(annotationInput({
      body: 'Initial note',
    }))

    vi.setSystemTime(2_000)
    useBrowserPanelStore.getState().saveAnnotation({
      ...annotationInput({
        body: 'Updated note',
        anchor: { kind: 'region', x: 10, y: 20, width: 100, height: 120 },
      }),
      id: annotationId,
      status: 'sent',
    })

    expect(useBrowserPanelStore.getState().owners[DEFAULT_BROWSER_PANEL_OWNER_ID]?.annotations).toEqual([
      expect.objectContaining({
        id: annotationId,
        body: 'Updated note',
        anchor: { kind: 'region', x: 10, y: 20, width: 100, height: 120 },
        createdAt: 1_000,
        updatedAt: 2_000,
        status: 'sent',
      }),
    ])
  })

  it('removes annotations for a closed browser tab', () => {
    const tabId = useBrowserPanelStore.getState().createTab('https://example.com')
    const retainedTabId = useBrowserPanelStore.getState().createTab('https://openai.com')

    useBrowserPanelStore.getState().saveAnnotation(annotationInput({ tabId, body: 'Closed tab note' }))
    useBrowserPanelStore.getState().saveAnnotation(annotationInput({ tabId: retainedTabId, body: 'Retained tab note' }))

    useBrowserPanelStore.getState().closeTab(tabId)

    expect(useBrowserPanelStore.getState().owners[DEFAULT_BROWSER_PANEL_OWNER_ID]?.annotations).toEqual([
      expect.objectContaining({
        tabId: retainedTabId,
        body: 'Retained tab note',
      }),
    ])
  })

  it('clears annotations for the selected browser tab only', () => {
    const tabId = useBrowserPanelStore.getState().createTab('https://example.com')
    const retainedTabId = useBrowserPanelStore.getState().createTab('https://openai.com')

    useBrowserPanelStore.getState().saveAnnotation(annotationInput({ tabId, body: 'Current tab note' }))
    useBrowserPanelStore.getState().saveAnnotation(annotationInput({ tabId: retainedTabId, body: 'Other tab note' }))

    useBrowserPanelStore.getState().clearAnnotations({ tabId })

    expect(useBrowserPanelStore.getState().owners[DEFAULT_BROWSER_PANEL_OWNER_ID]?.annotations).toEqual([
      expect.objectContaining({
        tabId: retainedTabId,
        body: 'Other tab note',
      }),
    ])
  })

  it('keeps annotation interaction state scoped by owner', () => {
    useBrowserPanelStore.getState().setAnnotationInteractionMode('comment', 'app-tab-a')

    expect(useBrowserPanelStore.getState().annotationInteractionModeByOwnerId).toMatchObject({
      'app-tab-a': 'comment',
    })
    expect(useBrowserPanelStore.getState().annotationInteractionModeByOwnerId['app-tab-b']).toBeUndefined()
  })

  it('persists annotation UI preferences without annotation payloads', () => {
    useBrowserPanelStore.getState().saveAnnotation(annotationInput({
      body: 'Screenshot note',
      attachedImages: [{
        type: 'file',
        filename: 'attached.png',
        mediaType: 'image/png',
        url: 'data:image/png;base64,BBBB',
      }],
    }))
    useBrowserPanelStore.getState().setAnnotationTrayCollapsed(true, 'app-tab-a')

    const partialize = useBrowserPanelStore.persist.getOptions().partialize
    expect(partialize).toBeTypeOf('function')
    if (!partialize) {
      throw new TypeError('Expected browser panel store persistence to define partialize')
    }
    const persisted = partialize(useBrowserPanelStore.getState()) as Record<string, unknown>

    expect(persisted).toEqual({
      recentHistoryByOwnerId: {},
      annotationTrayCollapsedByOwnerId: { 'app-tab-a': true },
      dockStateByOwnerId: {},
    })
  })

  it('persists restorable dock panes per owner without runtime browser or TUI handles', () => {
    const fileTabId = useBrowserPanelStore.getState().openWorkspaceFileTab({
      workspaceId: 'workspace-1',
      path: 'src/index.ts',
      view: 'editor',
      ownerId: 'chat:session-a',
    })
    useBrowserPanelStore.getState().createTab('https://example.com', undefined, 'chat:session-a')
    useBrowserPanelStore.getState().openTuiTab({
      cwd: '/tmp/workspace-1',
      ownerId: 'chat:session-a',
    })
    useBrowserPanelStore.getState().setActiveTab(fileTabId, 'chat:session-a')

    const partialize = useBrowserPanelStore.persist.getOptions().partialize
    if (!partialize) {
      throw new TypeError('Expected browser panel store persistence to define partialize')
    }
    const persisted = partialize(useBrowserPanelStore.getState()) as {
      dockStateByOwnerId?: Record<string, { open: boolean, activePaneId: string | null, panes: Array<{ id: string, kind: string }> }>
    }

    expect(persisted.dockStateByOwnerId?.['chat:session-a']).toEqual({
      open: true,
      activePaneId: fileTabId,
      panes: [expect.objectContaining({ id: fileTabId, kind: 'workspace-file' })],
    })
  })

  it('releases runtime resources while retaining restorable thread dock metadata', () => {
    const fileTabId = useBrowserPanelStore.getState().openWorkspaceFileTab({
      workspaceId: 'workspace-1',
      path: 'README.md',
      view: 'preview',
      ownerId: 'chat:session-a',
    })
    useBrowserPanelStore.getState().createTab('https://example.com', undefined, 'chat:session-a')

    useBrowserPanelStore.getState().releaseOwnerRuntimeState('chat:session-a')

    expect(useBrowserPanelStore.getState().owners['chat:session-a']).toMatchObject({
      open: true,
      threadState: null,
      activeTabId: fileTabId,
      tabs: [expect.objectContaining({ id: fileTabId, kind: 'workspace-file' })],
    })
  })

  it('rehydrates corrupt browser panel persisted maps as empty state', async () => {
    useBrowserPanelStore.setState({
      recentHistoryByOwnerId: {
        'owner-a': [{ url: 'https://example.com', title: 'Example', tabId: 'tab-a' }],
      },
      annotationTrayCollapsedByOwnerId: { 'owner-a': true },
    })
    localStorage.setItem(BROWSER_PANEL_STORAGE_KEY, JSON.stringify({
      state: {
        recentHistoryByOwnerId: {
          'owner-a': [{ url: 'https://example.com', title: 'Example', tabId: 'tab-a' }],
          'owner-b': 'not-history',
        },
        annotationTrayCollapsedByOwnerId: {
          'owner-a': true,
          'owner-b': 'yes',
        },
      },
    }))

    await useBrowserPanelStore.persist.rehydrate()

    expect(useBrowserPanelStore.getState().recentHistoryByOwnerId).toEqual({})
    expect(useBrowserPanelStore.getState().annotationTrayCollapsedByOwnerId).toEqual({})
  })

  it('keeps valid old browser panel persisted maps without a version field', async () => {
    localStorage.setItem(BROWSER_PANEL_STORAGE_KEY, JSON.stringify({
      state: {
        recentHistoryByOwnerId: {
          'owner-a': [{ url: 'https://example.com', title: 'Example', tabId: 'tab-a' }],
        },
        annotationTrayCollapsedByOwnerId: { 'owner-a': true },
      },
    }))

    await useBrowserPanelStore.persist.rehydrate()

    expect(useBrowserPanelStore.getState().recentHistoryByOwnerId).toEqual({
      'owner-a': [{ url: 'https://example.com', title: 'Example', tabId: 'tab-a' }],
    })
    expect(useBrowserPanelStore.getState().annotationTrayCollapsedByOwnerId).toEqual({
      'owner-a': true,
    })
  })

  it('does not throw when parsing a corrupt browser panel persisted payload', () => {
    expect(readBrowserPanelPersistedState('not-an-object')).toEqual({
      recentHistoryByOwnerId: {},
      annotationTrayCollapsedByOwnerId: {},
      dockStateByOwnerId: {},
    })
  })

  it('drops stale persisted pane kinds and repairs the active pane', () => {
    const restored = readBrowserPanelPersistedState({
      dockStateByOwnerId: {
        'chat:session-a': {
          open: true,
          activePaneId: 'legacy',
          panes: [
            { id: 'legacy', kind: 'removed-pane' },
            {
              kind: 'workspace-file',
              id: 'file-a',
              workspaceId: 'workspace-1',
              path: 'README.md',
              view: 'preview',
              title: 'README.md',
              loading: false,
              favicon: null,
            },
          ],
        },
      },
    })

    expect(restored.dockStateByOwnerId?.['chat:session-a']).toEqual({
      open: true,
      activePaneId: 'file-a',
      panes: [expect.objectContaining({ id: 'file-a', kind: 'workspace-file' })],
    })
  })

  it('keeps the browser panel store instance across module reloads in dev', async () => {
    const tabId = useBrowserPanelStore.getState().createTab('https://example.com')
    const firstStore = useBrowserPanelStore

    vi.resetModules()
    const { useBrowserPanelStore: reloadedStore } = await import('./browser-panel')

    expect(reloadedStore).toBe(firstStore)
    expect(reloadedStore.getState().activeTabId).toBe(tabId)
    expect(reloadedStore.getState().tabs.map(tab => tab.id)).toEqual([tabId])
  })
})

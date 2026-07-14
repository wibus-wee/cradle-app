// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ThreadBrowserState } from '~/store/browser-panel'
import { DEFAULT_BROWSER_PANEL_OWNER_ID, useBrowserPanelStore } from '~/store/browser-panel'

import { BrowserPanel } from './browser-panel'
import { useNativeBrowserSurfaceSuppressionStore } from './native-surface-suppression'

const diffViewerRender = vi.hoisted(() => vi.fn())

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function createTestThreadState(
  threadId: string,
  url = 'about:blank',
  version = 1,
): ThreadBrowserState {
  return {
    threadId,
    version,
    open: true,
    activeTabId: 'native-tab-1',
    tabs: [
      {
        id: 'native-tab-1',
        url,
        title: url === 'about:blank' ? 'New tab' : 'example.com',
        status: 'live',
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        faviconUrl: null,
        lastCommittedUrl: url === 'about:blank' ? null : url,
        lastError: null,
      },
    ],
    lastError: null,
  }
}

function createClosedThreadState(threadId: string): ThreadBrowserState {
  return {
    threadId,
    version: 0,
    open: false,
    activeTabId: null,
    tabs: [],
    lastError: null,
  }
}

function installTestBrowserBridge() {
  const states = new Map<string, ThreadBrowserState>()
  const listeners = new Set<(state: ThreadBrowserState) => void>()
  const open = vi.fn(async (input: { threadId: string, initialUrl?: string }) => {
    const state = createTestThreadState(input.threadId, input.initialUrl ?? 'about:blank')
    states.set(input.threadId, state)
    for (const listener of listeners) {
      listener(state)
    }
    return state
  })
  const getState = vi.fn(
    async (input: { threadId: string }) =>
      states.get(input.threadId) ?? createClosedThreadState(input.threadId),
  )
  const bridge = {
    open,
    close: vi.fn(async (input: { threadId: string }) => {
      const state = createClosedThreadState(input.threadId)
      states.set(input.threadId, state)
      return state
    }),
    hide: vi.fn(async () => {}),
    getState,
    setBounds: vi.fn(),
    captureScreenshot: vi.fn(),
    copyScreenshotToClipboard: vi.fn(),
    executeCdp: vi.fn(),
    discoverLocalServers: vi.fn(async () => []),
    navigate: vi.fn(async (input: { threadId: string, url: string }) => {
      const state = createTestThreadState(input.threadId, input.url, 2)
      states.set(input.threadId, state)
      return state
    }),
    reload: vi.fn(
      async (input: { threadId: string }) =>
        states.get(input.threadId) ?? createClosedThreadState(input.threadId),
    ),
    goBack: vi.fn(
      async (input: { threadId: string }) =>
        states.get(input.threadId) ?? createClosedThreadState(input.threadId),
    ),
    goForward: vi.fn(
      async (input: { threadId: string }) =>
        states.get(input.threadId) ?? createClosedThreadState(input.threadId),
    ),
    newTab: vi.fn(async (input: { threadId: string, url?: string }) => {
      const state = createTestThreadState(input.threadId, input.url ?? 'about:blank', 2)
      states.set(input.threadId, state)
      return state
    }),
    closeTab: vi.fn(
      async (input: { threadId: string }) =>
        states.get(input.threadId) ?? createClosedThreadState(input.threadId),
    ),
    selectTab: vi.fn(
      async (input: { threadId: string }) =>
        states.get(input.threadId) ?? createClosedThreadState(input.threadId),
    ),
    openDevTools: vi.fn(async () => {}),
    onState: vi.fn((handler: (state: ThreadBrowserState) => void) => {
      listeners.add(handler)
      return () => {
        listeners.delete(handler)
      }
    }),
  }

  window.cradle = {
    browser: bridge,
  } as unknown as Window['cradle']

  return bridge
}

vi.mock('./workspace-diff-viewer', () => ({
  WorkspaceDiffViewer: (props: {
    tabId: string
    workspaceId: string
    repositoryPath?: string | null
    paths?: string[]
  }) => {
    diffViewerRender(props)
    return null
  },
}))

vi.mock('~/lib/electron', () => ({
  getServerUrl: () => 'http://localhost:3000',
  getServerWebSocketUrl: (path: string) => new URL(path, 'ws://localhost:3000').toString(),
  isLocalMode: () => false,
  isTearoffWindow: false,
  isElectron: true,
  nativeIpc: {},
  platform: 'darwin',
  tearoffSurfaceId: null,
  tearoffSurfaceRoute: null,
}))

vi.mock('~/features/workspace/workspace-file-editor', () => ({
  WorkspaceFileEditor: () => <div data-testid="workspace-file-editor" />,
}))

vi.mock('~/features/workspace/workspace-file-preview', () => ({
  WorkspaceFilePreview: () => <div data-testid="workspace-file-preview" />,
}))

vi.mock('~/features/pull-requests/pull-request-detail-panel', () => ({
  PullRequestDetailPanel: ({ owner, repo, number, workId }: { owner: string, repo: string, number: number, workId?: string }) => (
    <div data-testid="pull-request-detail-panel">{`${owner}/${repo}#${number}:${workId}`}</div>
  ),
}))

describe('browserPanel rendering', () => {
  let browserBridge: ReturnType<typeof installTestBrowserBridge>

  beforeEach(() => {
    cleanup()
    diffViewerRender.mockClear()
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    browserBridge = installTestBrowserBridge()
    useBrowserPanelStore.setState({
      activeOwnerId: DEFAULT_BROWSER_PANEL_OWNER_ID,
      owners: {},
      tabs: [],
      activeTabId: null,
      requestedTab: null,
      scrollToFilePath: null,
    })
    useNativeBrowserSurfaceSuppressionStore.setState({ suppressCount: 0 })
  })

  it('does not repaint the panel shell for diff scroll commands', () => {
    const tabId = useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-1',
      title: 'All Changes',
    })

    render(<BrowserPanel />)
    expect(diffViewerRender).toHaveBeenCalledTimes(1)

    act(() => {
      useBrowserPanelStore.getState().requestScrollToFilePath({
        path: 'src/index.ts',
        tabId,
      })
    })

    expect(diffViewerRender).toHaveBeenCalledTimes(1)
  })

  it('renders pull request details as a Browser Panel tab', () => {
    useBrowserPanelStore.getState().openPullRequestTab({
      owner: 'cradle',
      repo: 'app',
      number: 42,
      workId: 'work-1',
      sessionId: 'session-1',
      title: 'Add pull request view',
    })

    render(<BrowserPanel />)

    expect(screen.getByTestId('pull-request-detail-panel').textContent).toBe('cradle/app#42:work-1')
  })

  it('shows the source session marker for browser tabs from another session', () => {
    useBrowserPanelStore.getState().createTab('https://example.com', {
      sessionId: 'session-a',
      sessionTitle: 'Session A',
    })

    render(<BrowserPanel activeSessionId="session-b" activeSessionTitle="Session B" />)

    expect(screen.getByLabelText('From Session A')).not.toBeNull()
  })

  it('does not show a source marker for browser tabs from the active session', () => {
    useBrowserPanelStore.getState().createTab('https://example.com', {
      sessionId: 'session-a',
      sessionTitle: 'Session A',
    })

    render(<BrowserPanel activeSessionId="session-a" activeSessionTitle="Session A" />)

    expect(screen.queryByLabelText('From Session A')).toBeNull()
  })

  it('does not show a source marker for workspace tabs', () => {
    useBrowserPanelStore.getState().openWorkspaceFileTab({
      workspaceId: 'workspace-1',
      path: 'src/index.ts',
      view: 'preview',
    })
    useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-1',
      title: 'All Changes',
    })

    render(<BrowserPanel activeSessionId="session-b" activeSessionTitle="Session B" />)

    expect(screen.queryByLabelText(/From /)).toBeNull()
  })

  it('marks the rendered fallback tab active when active tab state is missing', () => {
    const tabId = useBrowserPanelStore.getState().createTab('https://example.com')
    useBrowserPanelStore.setState(state => ({
      ...state,
      owners: {
        ...state.owners,
        [DEFAULT_BROWSER_PANEL_OWNER_ID]: {
          ...state.owners[DEFAULT_BROWSER_PANEL_OWNER_ID]!,
          activeTabId: null,
        },
      },
      activeTabId: null,
    }))

    render(<BrowserPanel />)

    expect(
      screen.getByRole('button', { name: 'https://example.com' }).getAttribute('aria-current'),
    ).toBe('page')
    expect(useBrowserPanelStore.getState().activeTabId).toBe(tabId)
  })

  it('opens requested native browser tabs once after unrelated tab state updates', async () => {
    useBrowserPanelStore.getState().requestTab('https://example.com')

    render(<BrowserPanel />)

    await waitFor(() => {
      expect(browserBridge.open).toHaveBeenCalledTimes(1)
    })
    expect(browserBridge.open).toHaveBeenCalledWith({
      threadId: DEFAULT_BROWSER_PANEL_OWNER_ID,
      initialUrl: 'https://example.com',
    })

    act(() => {
      useBrowserPanelStore.getState().updateTab('native-tab-1', { loading: true })
    })

    expect(browserBridge.open).toHaveBeenCalledTimes(1)
  })

  it('attaches a renderer webview with the owner session and BrowserPanel preload', async () => {
    const state = await browserBridge.open({
      threadId: DEFAULT_BROWSER_PANEL_OWNER_ID,
      initialUrl: 'https://example.com',
    })
    useBrowserPanelStore.getState().upsertOwnerState(state)

    const attachWebview = vi.fn(async () => state)
    const detachWebview = vi.fn(async () => {})
    Object.assign(browserBridge, {
      getWebviewConfig: vi.fn(() => ({
        partition: 'persist:cradle-browser-test',
        preloadUrl: 'file:///tmp/browser-panel.js',
      })),
      attachWebview,
      detachWebview,
    })

    const originalCreateElement = document.createElement.bind(document)
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = originalCreateElement(tagName, options)
      if (tagName.toLowerCase() === 'webview') {
        Object.assign(element, { getWebContentsId: () => 42 })
      }
      return element
    })

    try {
      render(<BrowserPanel />)

      await waitFor(() => {
        expect(attachWebview).toHaveBeenCalledWith({
          threadId: DEFAULT_BROWSER_PANEL_OWNER_ID,
          tabId: 'native-tab-1',
          webContentsId: 42,
        })
      })

      const webview = document.querySelector('webview')
      expect(webview?.getAttribute('partition')).toBe('persist:cradle-browser-test')
      expect(webview?.getAttribute('preload')).toBe('file:///tmp/browser-panel.js')
      expect(webview?.getAttribute('allowpopups')).toBe('true')

      const viewport = webview?.parentElement?.parentElement
      expect(viewport).not.toBeNull()
      viewport!.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400)
      const popover = originalCreateElement('div')
      popover.setAttribute('data-slot', 'popover-content')
      popover.getClientRects = () => [new DOMRect(100, 100, 200, 120)] as unknown as DOMRectList
      document.body.append(popover)

      await waitFor(() => {
        expect((webview as HTMLElement).style.visibility).toBe('hidden')
        expect(browserBridge.setBounds).toHaveBeenCalledWith({
          threadId: DEFAULT_BROWSER_PANEL_OWNER_ID,
          surface: 'renderer',
          bounds: null,
        })
      })
      popover.remove()
    }
    finally {
      createElementSpy.mockRestore()
    }
  })

  it('hides the native browser surface while a global suppressor is active', async () => {
    const state = await browserBridge.open({
      threadId: DEFAULT_BROWSER_PANEL_OWNER_ID,
      initialUrl: 'https://example.com',
    })
    useBrowserPanelStore.getState().upsertOwnerState(state)
    const release = useNativeBrowserSurfaceSuppressionStore.getState().acquire()

    try {
      render(<BrowserPanel />)

      await waitFor(() => {
        expect(browserBridge.setBounds).toHaveBeenCalledWith({
          threadId: DEFAULT_BROWSER_PANEL_OWNER_ID,
          surface: 'native',
          bounds: null,
        })
      })
    }
    finally {
      release()
    }
  })
})

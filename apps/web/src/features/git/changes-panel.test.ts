import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitFileStatus } from '~/features/git/types'
import { DEFAULT_BROWSER_PANEL_OWNER_ID, useBrowserPanelStore } from '~/store/browser-panel'

import { groupGitFileStatuses } from './changes-grouping'
import { ChangesPanel } from './changes-panel'
import { resolveTreeItemFromEvent } from './tree-event-target'

const treeMocks = vi.hoisted(() => {
  const select = vi.fn()
  return {
    select,
    focusPath: vi.fn(),
    getItem: vi.fn(() => ({ select })),
    getFocusedPath: vi.fn(() => 'src/app.tsx'),
    getSelectedPaths: vi.fn(() => ['src/app.tsx']),
    resetPaths: vi.fn(),
    setGitStatus: vi.fn(),
    startRenaming: vi.fn(),
  }
})

const gitQueryMocks = vi.hoisted(() => ({
  useGitRepositories: vi.fn(),
}))

vi.mock('@pierre/trees/react', async () => {
  const React = await import('react')
  return {
    FileTree: () =>
      React.createElement(
        'div',
        { 'data-testid': 'mock-pierre-tree' },
        React.createElement('button', {
          'type': 'button',
          'data-item-path': 'src/app.tsx',
          'data-item-type': 'file',
        }, 'src/app.tsx'),
        React.createElement('button', {
          'type': 'button',
          'data-item-path': 'src',
          'data-item-type': 'folder',
        }, 'src'),
      ),
    useFileTree: () => ({ model: treeMocks }),
    useFileTreeSelection: () => ['src/app.tsx'],
  }
})

vi.mock('./use-git', () => ({
  useGitRepositories: gitQueryMocks.useGitRepositories,
}))

vi.mock('~/navigation/navigation-commands', () => ({
  openWorkspaceDiffs: vi.fn(),
}))

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  useBrowserPanelStore.setState({
    activeOwnerId: DEFAULT_BROWSER_PANEL_OWNER_ID,
    owners: {},
    open: false,
    tabs: [],
    activeTabId: null,
    requestedTab: null,
    scrollToFilePath: null,
  })
  gitQueryMocks.useGitRepositories.mockReturnValue({
    data: [createGitRepository([{ path: 'src/app.tsx', workspacePath: 'src/app.tsx', status: 'modified' }])],
    isLoading: false,
    isError: false,
    isSuccess: true,
  })
})

function createGitRepository(files: GitFileStatus[]) {
  return {
    path: '.',
    name: 'workspace-1',
    absolutePath: '/tmp/workspace-1',
    branch: 'main',
    tracking: null,
    ahead: 0,
    behind: 0,
    isDetached: false,
    files,
  }
}

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    createElement(QueryClientProvider, { client: queryClient }, children),
  )
}

describe('groupGitFileStatuses', () => {
  it('places tests, markdown docs, and all other files into stable sections', () => {
    const files: GitFileStatus[] = [
      { path: 'src/app.tsx', workspacePath: 'src/app.tsx', status: 'modified' },
      { path: 'README.md', workspacePath: 'README.md', status: 'modified' },
      { path: 'src/app.test.ts', workspacePath: 'src/app.test.ts', status: 'added' },
      { path: 'docs/spec.mdx', workspacePath: 'docs/spec.mdx', status: 'untracked' },
      { path: 'src/app.spec.ts', workspacePath: 'src/app.spec.ts', status: 'modified' },
    ]

    expect(groupGitFileStatuses(files)).toEqual([
      {
        id: 'sources',
        label: 'Sources',
        files: [
          { path: 'src/app.spec.ts', workspacePath: 'src/app.spec.ts', status: 'modified' },
          { path: 'src/app.tsx', workspacePath: 'src/app.tsx', status: 'modified' },
        ],
      },
      {
        id: 'docs',
        label: 'Docs / Specs',
        files: [
          { path: 'docs/spec.mdx', workspacePath: 'docs/spec.mdx', status: 'untracked' },
          { path: 'README.md', workspacePath: 'README.md', status: 'modified' },
        ],
      },
      {
        id: 'tests',
        label: 'Tests',
        files: [{ path: 'src/app.test.ts', workspacePath: 'src/app.test.ts', status: 'added' }],
      },
    ])
  })
})

describe('changesPanel type interactions', () => {
  it('opens the All Changes browser panel tab for clicked files', () => {
    gitQueryMocks.useGitRepositories.mockReturnValue({
      data: [createGitRepository([
        { path: 'src/app.tsx', workspacePath: 'src/app.tsx', status: 'modified' },
        { path: 'src/feature.ts', workspacePath: 'src/feature.ts', status: 'added' },
      ])],
      isLoading: false,
      isError: false,
      isSuccess: true,
    })

    renderWithQueryClient(createElement(ChangesPanel, { workspaceId: 'workspace-1' }))

    const rows = screen.getAllByTestId('changes-file-row')
    fireEvent.click(rows[0]!)
    fireEvent.click(rows[1]!)

    const state = useBrowserPanelStore.getState()
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]).toMatchObject({
      kind: 'workspace-diff',
      workspaceId: 'workspace-1',
      repositoryPath: undefined,
      paths: undefined,
      title: 'All Changes',
    })
    expect(state.activeTabId).toBe(state.tabs[0]?.id)
    expect(state.scrollToFilePath).toMatchObject({
      path: 'src/feature.ts',
      tabId: state.tabs[0]?.id,
    })
    expect(state.open).toBe(true)
  })
})

describe('changesPanel tree interactions', () => {
  it('opens the All Changes browser panel tab for the double-clicked tree file', () => {
    renderWithQueryClient(createElement(ChangesPanel, { workspaceId: 'workspace-1' }))

    fireEvent.click(screen.getByRole('radio', { name: 'Show changes as tree' }))
    fireEvent.doubleClick(screen.getByText('src/app.tsx'))

    expect(treeMocks.focusPath).toHaveBeenCalledWith('src/app.tsx')
    expect(treeMocks.select).toHaveBeenCalled()
    const state = useBrowserPanelStore.getState()
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]).toMatchObject({
      kind: 'workspace-diff',
      workspaceId: 'workspace-1',
      repositoryPath: undefined,
      paths: undefined,
      title: 'All Changes',
    })
    expect(state.scrollToFilePath).toMatchObject({
      path: 'src/app.tsx',
      tabId: state.tabs[0]?.id,
    })
  })

  it('ignores double-clicks on tree folders', () => {
    renderWithQueryClient(createElement(ChangesPanel, { workspaceId: 'workspace-1' }))

    fireEvent.click(screen.getByRole('radio', { name: 'Show changes as tree' }))
    fireEvent.doubleClick(screen.getByText('src'))

    expect(useBrowserPanelStore.getState().tabs).toHaveLength(0)
  })
})

describe('resolveTreeItemFromEvent', () => {
  it('reads file rows from the closest tree item element', () => {
    const row = document.createElement('button')
    row.dataset.itemPath = 'src/app.tsx'
    row.dataset.itemType = 'file'

    const label = document.createElement('span')
    row.append(label)
    document.body.append(row)

    const event = new MouseEvent('dblclick', { bubbles: true })
    Object.defineProperty(event, 'target', { configurable: true, value: label })

    expect(resolveTreeItemFromEvent(event)).toEqual({
      path: 'src/app.tsx',
      kind: 'file',
    })
  })

  it('falls back to composedPath entries when the event target is outside the tree root', () => {
    const row = document.createElement('button')
    row.dataset.itemPath = 'src'
    row.dataset.itemType = 'folder'

    const event = new MouseEvent('dblclick', { bubbles: true })
    Object.defineProperty(event, 'target', {
      configurable: true,
      value: document.createElement('div'),
    })
    Object.defineProperty(event, 'composedPath', {
      configurable: true,
      value: () => [document.createElement('span'), row, document.body, document],
    })

    expect(resolveTreeItemFromEvent(event)).toEqual({
      path: 'src',
      kind: 'directory',
    })
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

import { TooltipProvider } from '../ui/tooltip'
import { RightAside } from './right-aside'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('~/features/browser/browser-annotation-adjustment-panel', () => ({
  BROWSER_ANNOTATION_ADJUSTMENT_APPLY_EVENT: 'browser:annotation-adjustment-apply',
  BrowserAnnotationAdjustmentPanel: () => <div data-testid="adjustment-panel" />,
}))

vi.mock('~/features/chat/runtime/runtime-session-panel', () => ({
  RuntimeSessionPanel: () => <div data-testid="runtime-panel" />,
}))

vi.mock('~/features/session-await/await-panel', () => ({
  AwaitPanel: () => <div data-testid="await-panel" />,
}))

vi.mock('~/features/git', () => ({
  ChangesPanel: () => <div data-testid="changes-panel" />,
  GitPanel: () => <div data-testid="git-panel" />,
}))

vi.mock('~/features/kanban/issue-aside-panel', () => ({
  IssueAsidePanel: () => <div data-testid="issue-panel" />,
}))

vi.mock('~/features/kanban/use-kanban', () => ({
  useLinkedIssue: () => ({ data: null }),
}))

vi.mock('~/features/workspace/file-tree', () => ({
  FileTree: () => <div data-testid="file-tree" />,
}))

vi.mock('~/features/chat/session/use-session-await', () => ({
  useSessionAwaitSummary: () => ({ data: null }),
}))

function renderRightAside(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  )
}

describe('rightAside browser panel coupling', () => {
  beforeEach(() => {
    useLayoutStore.setState({
      asideOpen: true,
      asideActiveTab: 'files',
      activeBrowserPanelOwnerId: 'owner-a',
      browserPanelOpen: true,
      browserPanelOpenByOwnerId: {
        'owner-a': true,
        'owner-b': true,
      },
    })
    useBrowserPanelStore.setState({
      activeOwnerId: 'owner-a',
      owners: {},
      tabs: [],
      activeTabId: null,
      requestedTab: null,
      scrollToFilePath: null,
      annotationAdjustmentSession: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('checks browser adjustment visibility against the retained aside owner', () => {
    useBrowserPanelStore.getState().createTab('https://example.com', undefined, 'owner-a')

    renderRightAside(<RightAside ownerId="owner-b" visible />)

    expect(screen.queryByTestId('right-aside-tab-adjustment')).toBeNull()
  })

  it('shows browser adjustment for the retained owner with an active browser tab', () => {
    useBrowserPanelStore.getState().createTab('https://example.com', undefined, 'owner-b')

    renderRightAside(<RightAside ownerId="owner-b" visible />)

    expect(screen.getByTestId('right-aside-tab-adjustment')).not.toBeNull()
  })

  it('repairs a visible stale right-aside active tab when adjustment is unavailable', async () => {
    useLayoutStore.setState({
      asideActiveTab: 'adjustment',
      browserPanelOpenByOwnerId: {
        'owner-b': true,
      },
    })

    renderRightAside(<RightAside ownerId="owner-b" visible />)

    expect(screen.getByTestId('right-aside').getAttribute('data-active-tab')).toBe('files')
    await waitFor(() => {
      expect(useLayoutStore.getState().asideActiveTab).toBe('files')
    })
  })
})

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBrowserPanelStore } from '~/store/browser-panel'

import { MarkdownFileLink } from './markdown-file-link'

vi.mock('../session/use-session-binding', () => ({
  useSessionBinding: () => ({ workspaceId: 'workspace-1' }),
}))

describe('markdownFileLink', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    useBrowserPanelStore.setState({
      activeOwnerId: 'chat:session-1',
      owners: {},
      open: false,
      tabs: [],
      activeTabId: null,
      requestedTab: null,
      scrollToFilePath: null,
    })
  })

  it('opens a GitHub pull request in the current chat Surface owner', () => {
    render(
      <MarkdownFileLink href="https://github.com/cradle/app/pull/42" sessionId="session-1">
        #42
      </MarkdownFileLink>,
    )

    fireEvent.click(screen.getByRole('link', { name: '#42' }))

    const ownerState = useBrowserPanelStore.getState().owners['chat:session-1']
    expect(ownerState?.activeTabId).toBe('pull-request:cradle/app#42')
    expect(ownerState?.tabs).toEqual([
      expect.objectContaining({
        kind: 'pull-request',
        owner: 'cradle',
        repo: 'app',
        number: 42,
        title: '#42',
      }),
    ])
  })
})

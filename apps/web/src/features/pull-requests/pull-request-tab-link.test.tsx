import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useBrowserPanelStore } from '~/store/browser-panel'

import { PullRequestTabLink } from './pull-request-tab-link'

const pullRequest = {
  owner: 'cradle',
  repo: 'app',
  number: 39,
  url: 'https://github.com/cradle/app/pull/39',
  title: 'Fix Claude Agent permission mode switching',
}

describe('pull request tab link', () => {
  beforeEach(() => {
    localStorage.clear()
    useBrowserPanelStore.setState({
      activeOwnerId: 'surface-1',
      owners: {},
      open: false,
      tabs: [],
      activeTabId: null,
      requestedTab: null,
      scrollToFilePath: null,
      recentHistoryByOwnerId: {},
      annotationInteractionModeByOwnerId: {},
      annotationTrayCollapsedByOwnerId: {},
      annotationAdjustmentSession: null,
    })
  })

  afterEach(cleanup)

  it('opens the matching PR tab for a normal click', () => {
    render(
      <PullRequestTabLink pullRequest={pullRequest} workId="work-1" sessionId="session-1">
        <span>Open PR</span>
      </PullRequestTabLink>,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Open PR' }))

    const ownerState = useBrowserPanelStore.getState().owners['surface-1']
    expect(ownerState?.open).toBe(true)
    expect(ownerState?.activeTabId).toBe('pull-request:cradle/app#39')
    expect(ownerState?.tabs).toEqual([
      expect.objectContaining({
        kind: 'pull-request',
        owner: 'cradle',
        repo: 'app',
        number: 39,
        workId: 'work-1',
        sessionId: 'session-1',
      }),
    ])
  })

  it('keeps modified clicks as external GitHub links', () => {
    render(
      <PullRequestTabLink pullRequest={pullRequest}>
        <span>Open PR</span>
      </PullRequestTabLink>,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Open PR' }), { ctrlKey: true })

    expect(useBrowserPanelStore.getState().owners['surface-1']).toBeUndefined()
  })
})

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { pullRequestDetailFixture } from './fixtures/pull-requests'
import { PullRequestDetailPanelView } from './pull-request-detail-panel-view'

vi.mock('./pull-request-summary-view', () => ({
  PullRequestSummaryView: () => <div>Summary content</div>,
}))
vi.mock('./pull-request-timeline-view', () => ({
  PullRequestTimelineView: () => <div>Timeline content</div>,
}))
vi.mock('./pull-request-code-view', () => ({
  PullRequestCodeView: () => <div>Code content</div>,
}))

afterEach(cleanup)

describe('pull request detail panel view', () => {
  it('moves tab focus and selection with standard arrow keys', () => {
    render(
      <PullRequestDetailPanelView
        detail={pullRequestDetailFixture}
        owner="openai"
        repo="cradle"
        number={42}
        locale="en-US"
        isFetching={false}
        onRefresh={() => {}}
        onCopyLink={vi.fn()}
      />,
    )

    const tabs = screen.getAllByRole('tab')
    tabs[0]?.focus()
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' })

    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[1])

    fireEvent.keyDown(tabs[1]!, { key: 'End' })
    expect(tabs[2]?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[2])
  })
})

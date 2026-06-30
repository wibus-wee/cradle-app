import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { KanbanIssueActivityItem } from '~/features/kanban/types'

import { ActivityTimeline } from './activity-timeline'

const mocks = vi.hoisted(() => ({
  addCommentMutate: vi.fn(),
  activity: [] as KanbanIssueActivityItem[],
  deleteCommentMutate: vi.fn(),
}))

vi.mock('../use-kanban', () => ({
  useAddComment: () => ({
    mutate: mocks.addCommentMutate,
  }),
  useDeleteComment: () => ({
    mutate: mocks.deleteCommentMutate,
  }),
  useIssueActivity: () => ({
    data: mocks.activity,
  }),
}))

afterEach(() => {
  cleanup()
})

function comment(content: string): KanbanIssueActivityItem {
  return {
    id: 'comment-1',
    issueId: 'issue-1',
    kind: 'comment',
    actor: {
      kind: 'agent',
      id: 'agent-1',
      displayName: 'Jarvis',
      avatarUrl: null,
      label: 'AI',
    },
    comment: {
      content,
      systemKind: null,
    },
    fieldChange: null,
    sourceChatSessionId: 'chat-session-1',
    createdAt: 1_700_000_000,
  }
}

describe('activity timeline', () => {
  beforeEach(() => {
    mocks.addCommentMutate.mockReset()
    mocks.deleteCommentMutate.mockReset()
    mocks.activity = []
  })

  it('renders agent comments as static markdown', () => {
    mocks.activity = [
      comment('**Root cause:** blocked navigation\n\n- First finding'),
    ]

    render(<ActivityTimeline issueId="issue-1" />)

    const row = screen.getByTestId('comment-comment-1')
    const strong = row.querySelector('strong')
    const listItem = screen.getByText('First finding').closest('li')

    expect(strong?.textContent).toBe('Root cause:')
    expect(listItem).toBeTruthy()
    expect(row.textContent).not.toContain('**Root cause:**')
  })
})

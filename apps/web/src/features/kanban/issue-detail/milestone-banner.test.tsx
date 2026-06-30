import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { KanbanMilestone } from '~/features/kanban/types'

import { MilestoneBanner } from './milestone-banner'

afterEach(() => {
  cleanup()
})

const milestone: KanbanMilestone = {
  id: 'milestone-1',
  workspaceId: 'workspace-1',
  title: 'MVP Release',
  description: 'Ship the focused issue detail improvements.',
  dueDate: null,
  status: 'open',
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
}

describe('milestone banner', () => {
  it('renders milestone metadata and progress', () => {
    render(
      <MilestoneBanner
        milestone={milestone}
        progress={{ completed: 2, total: 5, percentage: 40 }}
      />,
    )

    expect(screen.getByText('MVP Release')).toBeTruthy()
    expect(screen.getByText('Ship the focused issue detail improvements.')).toBeTruthy()
    expect(screen.getByText('open')).toBeTruthy()
    expect(screen.getByText('2/5 done')).toBeTruthy()
    expect(screen.getByText('No due date')).toBeTruthy()
  })

  it('opens the milestone when clicked', () => {
    const onOpenMilestone = vi.fn()

    render(
      <MilestoneBanner
        milestone={milestone}
        progress={{ completed: 2, total: 5, percentage: 40 }}
        onOpenMilestone={onOpenMilestone}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open milestone MVP Release' }))

    expect(onOpenMilestone).toHaveBeenCalledWith('milestone-1')
  })
})

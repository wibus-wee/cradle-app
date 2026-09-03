// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '~/components/ui/tooltip'

import { computeGraphLayout } from '../../shared/graph-layout'
import { gitGraphCommitsFixture } from '../fixtures/git-history'
import { GitGraphRowView } from './git-graph-row-view'

vi.mock('~/i18n/instance', () => ({
  getI18n: () => ({ t: (key: string) => key }),
}))

describe('git graph row view', () => {
  it('copies the full commit SHA from an abbreviated history row', () => {
    const onCopySha = vi.fn()
    const [commit] = computeGraphLayout(gitGraphCommitsFixture)

    render(
      <TooltipProvider>
        <GitGraphRowView commit={commit!} onCopySha={onCopySha} />
      </TooltipProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'git:graphRow.copySha' }))

    expect(onCopySha).toHaveBeenCalledWith(gitGraphCommitsFixture[0]!.sha)
  })
})

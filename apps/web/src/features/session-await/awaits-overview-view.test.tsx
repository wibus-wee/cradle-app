import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AwaitsOverviewView } from './awaits-overview-view'

afterEach(cleanup)

describe('awaits overview view', () => {
  it('lets the user retry after await data fails to load', () => {
    const onRetry = vi.fn()
    render(
      <AwaitsOverviewView
        awaits={[]}
        isReady={false}
        hasError
        onRetry={onRetry}
        onOpenChat={() => {}}
        onPreloadChat={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'error.retry' }))

    expect(onRetry).toHaveBeenCalledOnce()
  })
})

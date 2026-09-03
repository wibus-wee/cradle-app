// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PersonalPluginReviewCardView } from './personal-plugin-review-card-view'

afterEach(cleanup)

describe('personalPluginReviewCardView', () => {
  it('remains interactive inside the pointer-transparent composer overlay', () => {
    const onActivate = vi.fn()
    const { container } = render(
      <div className="pointer-events-none">
        <PersonalPluginReviewCardView
          title="Plugin ready to review"
          description="Review permissions before activation."
          actionLabel="Review and activate"
          permissionFallback="No permissions requested"
          plugins={[
            {
              identity: 'runtime-radar',
              displayName: 'Runtime Radar',
              permissions: [{ id: 'network.read', label: 'Read public metadata' }],
              layers: [
                { layer: 'server', status: 'disabled' },
                { layer: 'web', status: 'disabled' },
              ],
            },
          ]}
          activating={false}
          onActivate={onActivate}
        />
      </div>,
    )

    const overlay = container.firstElementChild
    const card = overlay?.firstElementChild
    expect(card?.classList.contains('pointer-events-auto')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Review and activate' }))
    expect(onActivate).toHaveBeenCalledOnce()
  })
})

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BackgroundActivityFooterItem } from './background-activity-footer-state'
import { BackgroundActivityFooterView } from './background-activity-footer-view'

afterEach(cleanup)

const items: BackgroundActivityFooterItem[] = [
  {
    identity: 'first',
    ownerNamespace: 'codex-reset-watch',
    priority: 'normal',
    title: 'Codex reset watch',
    description: '80% chance by end of Saturday',
    actionLabel: 'View source',
    actionUrl: 'https://example.com/source',
    expiresAt: null,
    updatedAt: 2,
  },
  {
    identity: 'second',
    ownerNamespace: 'release',
    priority: 'low',
    title: 'Another activity',
    description: 'Needs attention',
    actionLabel: null,
    actionUrl: null,
    expiresAt: null,
    updatedAt: 1,
  },
]

const labels = {
  title: 'Background activity',
  open: 'Open background activity',
}

describe('backgroundActivityFooterView', () => {
  it('keeps every active notice visible without acknowledgement controls', () => {
    render(
      <BackgroundActivityFooterView
        items={items}
        labels={labels}
        onOpenAction={vi.fn()}
      />,
    )

    expect(screen.getByText('+1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: labels.open }))

    const panel = screen.getByRole('region', { name: labels.title })
    expect(panel.closest('[data-testid="background-activity-footer"]')).toBeTruthy()
    expect(panel.querySelector('[data-background-activity-icon="codex"]')).toBeTruthy()
    expect(panel.querySelector('[data-background-activity-icon="info"]')).toBeTruthy()
    expect(screen.getAllByTestId('background-activity-footer-item')).toHaveLength(2)
    expect(screen.queryByText('OK')).toBeNull()
    expect(screen.queryByText('Dismiss all')).toBeNull()
  })

  it('opens a notice action without removing the notice', () => {
    const onOpenAction = vi.fn()
    render(
      <BackgroundActivityFooterView
        items={items}
        labels={labels}
        onOpenAction={onOpenAction}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: labels.open }))
    fireEvent.click(screen.getByRole('button', { name: 'View source' }))

    expect(onOpenAction).toHaveBeenCalledWith('https://example.com/source')
    expect(screen.getAllByTestId('background-activity-footer-item')).toHaveLength(2)
  })

  it('closes the activity layer without removing notices', () => {
    render(
      <BackgroundActivityFooterView
        items={items}
        labels={labels}
        onOpenAction={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: labels.open })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    expect(screen.getByText('Codex reset watch')).toBeTruthy()

    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('Codex reset watch')).toBeTruthy()
  })
})

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { cloneElement, createContext, isValidElement, useContext } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BackgroundActivityFooterItem } from './background-activity-footer-state'
import { BackgroundActivityFooterView } from './background-activity-footer-view'

const PopoverContext = createContext<{
  open: boolean
  onOpenChange: (open: boolean) => void
}>({ open: false, onOpenChange: () => {} })

vi.mock('~/components/ui/popover', () => ({
  Popover: ({
    children,
    open,
    onOpenChange,
  }: {
    children: ReactNode
    open: boolean
    onOpenChange: (open: boolean) => void
  }) => (
    <PopoverContext.Provider value={{ open, onOpenChange }}>
      {children}
    </PopoverContext.Provider>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => {
    const { open } = useContext(PopoverContext)
    return open ? <div>{children}</div> : null
  },
  PopoverTrigger: ({ children }: { children: ReactNode }) => {
    const { onOpenChange } = useContext(PopoverContext)
    if (!isValidElement(children)) {
      return null
    }
    return cloneElement(children as ReactElement<{ onClick?: () => void }>, {
      onClick: () => onOpenChange(true),
    })
  },
}))

afterEach(cleanup)

const items: BackgroundActivityFooterItem[] = [
  {
    identity: 'first',
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
  dismiss: 'OK',
  dismissAll: 'Dismiss all',
  noticeCount: (count: number) => `${count} notices`,
}

describe('backgroundActivityFooterView', () => {
  it('keeps OK out of the footer and exposes every notice after opening', () => {
    const onDismiss = vi.fn()
    render(
      <BackgroundActivityFooterView
        items={items}
        labels={labels}
        onDismiss={onDismiss}
        onDismissAll={vi.fn()}
        onOpenAction={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull()
    expect(screen.getByText('+1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: labels.open }))

    expect(screen.getByText('2 notices')).toBeTruthy()
    expect(screen.getAllByTestId('background-activity-footer-item')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'OK' })[0]!)
    expect(onDismiss).toHaveBeenCalledWith('first')
  })

  it('dismisses the visible notice batch together', () => {
    const onDismissAll = vi.fn()
    render(
      <BackgroundActivityFooterView
        items={items}
        labels={labels}
        onDismiss={vi.fn()}
        onDismissAll={onDismissAll}
        onOpenAction={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: labels.open }))
    fireEvent.click(screen.getByRole('button', { name: labels.dismissAll }))

    expect(onDismissAll).toHaveBeenCalledWith(['first', 'second'])
  })
})

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useLayoutSlotsStore } from './layout-slots-context'
import { useLayoutSlotsCtx, useRegisterLayoutSlots, useSyncLayoutSlotScope } from './use-layout-slots'

function SlotProbe() {
  const { slots } = useLayoutSlotsCtx()
  return (
    <div
      data-testid="slot-probe"
      data-browser-panel={slots.hasBrowserPanel ? 'true' : 'false'}
      data-bottom-panel={slots.hasPanel ? 'true' : 'false'}
    >
      {slots.panel}
    </div>
  )
}

function RegisterWithEffect({ id, label }: { id: string, label: string }) {
  const slots = ({
    hasBrowserPanel: true,
    hasPanel: true,
    panel: <span>{label}</span>,
  })

  useRegisterLayoutSlots(id, slots)

  return null
}

function LayoutSlotRuntime({
  activeSlotId,
  validSlotIds,
  children,
}: {
  activeSlotId: string | null
  validSlotIds: readonly string[]
  children: ReactNode
}) {
  useSyncLayoutSlotScope(activeSlotId, validSlotIds)
  return children
}

describe('layout slots store', () => {
  afterEach(() => {
    cleanup()
    useLayoutSlotsStore.getState().resetSlots()
  })

  it('keeps the last known slots while the newly active slot has not registered yet', async () => {
    const { rerender } = render(
      <LayoutSlotRuntime activeSlotId="session-a" validSlotIds={['session-a', 'session-b']}>
        <RegisterWithEffect id="session-a" label="Terminal A" />
        <SlotProbe />
      </LayoutSlotRuntime>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('slot-probe').getAttribute('data-browser-panel')).toBe('true')
      expect(screen.getByTestId('slot-probe').getAttribute('data-bottom-panel')).toBe('true')
      expect(screen.getByText('Terminal A')).not.toBeNull()
    })

    rerender(
      <LayoutSlotRuntime activeSlotId="session-b" validSlotIds={['session-a', 'session-b']}>
        <RegisterWithEffect id="session-a" label="Terminal A" />
        <SlotProbe />
      </LayoutSlotRuntime>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('slot-probe').getAttribute('data-browser-panel')).toBe('true')
      expect(screen.getByTestId('slot-probe').getAttribute('data-bottom-panel')).toBe('true')
      expect(screen.getByText('Terminal A')).not.toBeNull()
    })

    rerender(
      <LayoutSlotRuntime activeSlotId="session-b" validSlotIds={['session-a', 'session-b']}>
        <RegisterWithEffect id="session-a" label="Terminal A" />
        <RegisterWithEffect id="session-b" label="Terminal B" />
        <SlotProbe />
      </LayoutSlotRuntime>,
    )

    await waitFor(() => {
      expect(screen.getByText('Terminal B')).not.toBeNull()
    })
  })

  it('keeps the layout slot store instance across module reloads in dev', async () => {
    useLayoutSlotsStore.getState().registerSlot('session-a', {
      hasBrowserPanel: true,
      hasPanel: true,
      panel: <span>Terminal A</span>,
    })
    useLayoutSlotsStore.getState().setSlotScope('session-a', ['session-a'])
    const firstStore = useLayoutSlotsStore

    vi.resetModules()
    const { useLayoutSlotsStore: reloadedStore, readActiveLayoutSlots } = await import('./layout-slots-context')

    expect(reloadedStore).toBe(firstStore)
    expect(readActiveLayoutSlots()).toMatchObject({
      hasBrowserPanel: true,
      hasPanel: true,
    })
  })
})

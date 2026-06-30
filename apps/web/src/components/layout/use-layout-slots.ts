import { useEffect, useMemo } from 'react'

import type { LayoutSlots } from './layout-slots-context'
import { useActiveLayoutSlots, useLayoutSlotsStore } from './layout-slots-context'

export { type LayoutSlots } from './layout-slots-context'

export function useLayoutSlotsCtx() {
  const slots = useActiveLayoutSlots()
  return useMemo(() => ({ slots }), [slots])
}

/**
 * Register layout slots (asideSessionId, asideWorkspaceId, panel, hasAside, hasPanel,
 * hasBrowserPanel, title, workspace, gitBranch)
 * for a route content component. Hidden route surfaces unmount by default, so
 * slot lifetime is pruned by the active surface scope.
 *
 * Prefer passing a stable `slots` reference (e.g. produced by useMemo) so the
 * effect only re-fires when slot content actually changes.
 */
export function useRegisterLayoutSlots(id: string, slots: LayoutSlots) {
  const registerSlot = useLayoutSlotsStore(state => state.registerSlot)

  useEffect(() => {
    registerSlot(id, slots)
  }, [id, slots, registerSlot])
}

export function useSyncLayoutSlotScope(activeSlotId?: string | null, validSlotIds?: readonly string[]) {
  const setSlotScope = useLayoutSlotsStore(state => state.setSlotScope)
  const validSlotKey = validSlotIds?.join('\n') ?? null

  useEffect(() => {
    setSlotScope(activeSlotId, validSlotKey?.split('\n').filter(Boolean))
  }, [activeSlotId, setSlotScope, validSlotKey])
}

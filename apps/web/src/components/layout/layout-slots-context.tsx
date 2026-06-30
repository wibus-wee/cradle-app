import type { ReactNode } from 'react'
import { shallow } from 'zustand/shallow'
import { createWithEqualityFn } from 'zustand/traditional'

export interface LayoutSlots {
  aside?: ReactNode
  asideSessionId?: string | null
  asideWorkspaceId?: string | null
  panel?: ReactNode
  hasAside?: boolean
  hasPanel?: boolean
  hasBrowserPanel?: boolean
  headerActions?: ReactNode
}

interface LayoutSlotsState {
  activeSlotId: string | null | undefined
  map: Record<string, LayoutSlots>
  previousSlots: LayoutSlots
  registerSlot: (id: string, slots: LayoutSlots) => void
  unregisterSlot: (id: string) => void
  setSlotScope: (activeSlotId: string | null | undefined, validSlotIds?: readonly string[]) => void
  resetSlots: () => void
}

const EMPTY_LAYOUT_SLOTS: LayoutSlots = {}

function areLayoutSlotsEqual(left: LayoutSlots | undefined, right: LayoutSlots): boolean {
  if (left === right) {
    return true
  }
  if (!left) {
    return false
  }

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length
    && rightKeys.every(key => Object.is(
      left[key as keyof LayoutSlots],
      right[key as keyof LayoutSlots],
    ))
}

type LayoutSlotsStore = ReturnType<typeof createLayoutSlotsStore>

interface LayoutSlotsStoreGlobal {
  __CRADLE_LAYOUT_SLOTS_STORE__?: LayoutSlotsStore
}

function selectActiveSlots(state: LayoutSlotsState): LayoutSlots {
  if (state.activeSlotId === undefined) {
    return state.previousSlots
  }
  if (state.activeSlotId === null) {
    return EMPTY_LAYOUT_SLOTS
  }
  return state.map[state.activeSlotId] ?? state.previousSlots
}

function createLayoutSlotsStore() {
  return createWithEqualityFn<LayoutSlotsState>()(set => ({
    activeSlotId: undefined,
    map: {},
    previousSlots: EMPTY_LAYOUT_SLOTS,

    registerSlot: (id, slots) => {
      set((state) => {
        const existing = state.map[id]
        const merged = existing ? { ...existing, ...slots } : slots
        if (areLayoutSlotsEqual(existing, merged)) {
          return state
        }

        const nextPreviousSlots = id === state.activeSlotId ? merged : state.previousSlots
        return {
          map: { ...state.map, [id]: merged },
          previousSlots: nextPreviousSlots,
        }
      })
    },

    unregisterSlot: (id) => {
      set((state) => {
        if (!(id in state.map)) {
          return state
        }

        const { [id]: _removed, ...nextMap } = state.map
        const nextPreviousSlots = id === state.activeSlotId ? EMPTY_LAYOUT_SLOTS : state.previousSlots
        return {
          map: nextMap,
          previousSlots: nextPreviousSlots,
        }
      })
    },

    setSlotScope: (activeSlotId, validSlotIds) => {
      set((state) => {
        const validSlotSet = validSlotIds ? new Set(validSlotIds) : null
        let mapChanged = false
        let nextMap = state.map

        if (validSlotSet) {
          nextMap = {}
          for (const [id, slots] of Object.entries(state.map)) {
            if (validSlotSet.has(id)) {
              nextMap[id] = slots
            }
            else {
              mapChanged = true
            }
          }
        }

        const activeSlots = activeSlotId ? nextMap[activeSlotId] : undefined
        const nextPreviousSlots = activeSlots ?? (activeSlotId === null ? EMPTY_LAYOUT_SLOTS : state.previousSlots)
        if (
          !mapChanged
          && state.activeSlotId === activeSlotId
          && state.previousSlots === nextPreviousSlots
        ) {
          return state
        }

        return {
          activeSlotId,
          map: nextMap,
          previousSlots: nextPreviousSlots,
        }
      })
    },

    resetSlots: () => {
      set({
        activeSlotId: undefined,
        map: {},
        previousSlots: EMPTY_LAYOUT_SLOTS,
      })
    },
  }), shallow)
}

function getLayoutSlotsStore(): LayoutSlotsStore {
  if (!import.meta.env.DEV) {
    return createLayoutSlotsStore()
  }
  const globalStore = globalThis as typeof globalThis & LayoutSlotsStoreGlobal
  globalStore.__CRADLE_LAYOUT_SLOTS_STORE__ ??= createLayoutSlotsStore()
  return globalStore.__CRADLE_LAYOUT_SLOTS_STORE__
}

export const useLayoutSlotsStore = getLayoutSlotsStore()

export function readActiveLayoutSlots(): LayoutSlots {
  return selectActiveSlots(useLayoutSlotsStore.getState())
}

export function useActiveLayoutSlots(): LayoutSlots {
  return useLayoutSlotsStore(selectActiveSlots, shallow)
}
